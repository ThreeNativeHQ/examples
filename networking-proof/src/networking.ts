import { connect, type INetworkConnection, type INetworkOptions } from "@threenative/core/net";

export interface INetworkingConfig {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly issuerUrl?: string;
  readonly playerId?: string;
  readonly room?: string;
}

export type NetworkingStatus = "disabled" | "connecting" | "connected" | "disconnected";

export interface INetworkingInput {
  readonly actionPressed: boolean;
  readonly x: number;
  readonly z: number;
}

interface INetworkingState {
  networkActionAcks: number;
  networkConnected: boolean;
  networkError: string;
  networkLocalX?: number;
  networkLocalZ?: number;
  networkPeerId: string;
  networkPeerObserved: boolean;
  networkProtocolErrors: number;
  networkReconnects: number;
  networkRemoteDistance: number;
  networkRemoteX?: number;
  networkRemoteZ?: number;
  networkRetry: number;
  networkSessionId: string;
  networkStatus: NetworkingStatus;
  networkUnmatchedActionAcks: number;
}

interface INetworkingStore<TState extends INetworkingState> {
  getState(): TState;
  set(patch: Partial<TState>): void;
  flush(): void;
}

export interface INetworkingGame<TState extends INetworkingState> {
  enter(store: INetworkingStore<TState>): void;
  update(store: INetworkingStore<TState>, input: INetworkingInput): void;
  retry(): void;
  exit(): void;
}

interface IRemotePlayer {
  id: string;
  x: number;
  z: number;
}

interface IClockSample {
  offsetMs: number;
  rttMs: number;
  uncertaintyMs: number;
}

interface IMetrics {
  actionAckLatencyMs: number[];
  appliedStateAgeMs: number[];
  clockProbes: IClockSample[];
  collectionStartedAtMs: number | undefined;
  connectedAtMs: number | undefined;
  jsNetworkingCpuMs: number[];
  lastSampleAtMs: number | undefined;
  pendingActions: Map<number, number>;
  pendingClockProbes: Map<number, number>;
  unmatchedActionAckCount: number;
}

const APPLICATION_PROTOCOL = "threenative-smoke/1";
const NETWORK_SESSION_ASSET = "networking-session.json";
const METRIC_WARMUP_MS = 10_000;
const METRIC_EMIT_INTERVAL_MS = 5_000;
const PEER_SILENCE_TIMEOUT_MS = 500;
const MOVEMENT_PROBE_MS = 2_000;
const MAX_SAMPLES = 10_000;
const CHANNELS = [
  { id: 1, delivery: "unreliable" },
  { id: 2, delivery: "unreliable" },
  { id: 3, delivery: "reliable-ordered" },
  { id: 4, delivery: "reliable-ordered" },
] as const;

function patch<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  values: Partial<INetworkingState>,
): void {
  store.set(values as Partial<TState>);
  store.flush();
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`TN_NETWORK_PROTOCOL: ${name} must be an object`);
  return value as Record<string, unknown>;
}

function exactObject(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  const record = object(value, name);
  if (Object.keys(record).sort().join(",") !== [...keys].sort().join(","))
    throw new Error(`TN_NETWORK_PROTOCOL: ${name} has unexpected keys`);
  return record;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`TN_NETWORK_PROTOCOL: ${name} is invalid`);
  return value;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`TN_NETWORK_PROTOCOL: ${name} is invalid`);
  return value;
}

function decode(data: Uint8Array, name: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new Error(`TN_NETWORK_PROTOCOL: ${name} is not valid JSON`);
  }
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parseSnapshot(data: Uint8Array): {
  readonly player: IRemotePlayer & { lastActionId: number };
  readonly serverMonoMs: number;
  readonly tick: number;
} {
  const record = exactObject(decode(data, "snapshot"), ["player", "serverMonoMs", "tick"], "snapshot");
  const player = exactObject(record.player, ["id", "lastActionId", "x", "z"], "snapshot player");
  if (typeof player.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(player.id))
    throw new Error("TN_NETWORK_PROTOCOL: snapshot player id is invalid");
  return {
    player: {
      id: player.id,
      lastActionId: nonNegativeInteger(player.lastActionId, "snapshot action id"),
      x: finiteNumber(player.x, "snapshot x"),
      z: finiteNumber(player.z, "snapshot z"),
    },
    serverMonoMs: finiteNumber(record.serverMonoMs, "snapshot server time"),
    tick: nonNegativeInteger(record.tick, "snapshot tick"),
  };
}

function parseActionReply(data: Uint8Array): { accepted: boolean; id: number } {
  const record = exactObject(
    decode(data, "action acknowledgement"),
    ["accepted", "id"],
    "action acknowledgement",
  );
  if (typeof record.accepted !== "boolean")
    throw new Error("TN_NETWORK_PROTOCOL: action acknowledgement accepted is invalid");
  return { accepted: record.accepted, id: nonNegativeInteger(record.id, "action id") };
}

function parseClockReply(data: Uint8Array): {
  clientSentMs: number;
  probeId: number;
  serverReceivedMs: number;
  serverSentMs: number;
} {
  const record = exactObject(
    decode(data, "clock reply"),
    ["clientSentMs", "probeId", "serverReceivedMs", "serverSentMs"],
    "clock reply",
  );
  return {
    clientSentMs: finiteNumber(record.clientSentMs, "clock client send time"),
    probeId: nonNegativeInteger(record.probeId, "clock probe id"),
    serverReceivedMs: finiteNumber(record.serverReceivedMs, "clock server receive time"),
    serverSentMs: finiteNumber(record.serverSentMs, "clock server send time"),
  };
}

function futureExpiry(value: unknown, name: string, maximumMs: number): void {
  if (typeof value !== "string") throw new Error(`TN_NETWORK_AUTH: ${name} is missing`);
  const expiry = Date.parse(value);
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + maximumMs)
    throw new Error(`TN_NETWORK_AUTH: ${name} is expired or outside its validity window`);
}

async function issueCredential(config: INetworkingConfig): Promise<string> {
  if (!config.enabled || config.issuerUrl === undefined || config.playerId === undefined)
    throw new Error("TN_NETWORK_AUTH: enabled networking requires issuerUrl and playerId");
  const grantResponse = await fetch(NETWORK_SESSION_ASSET);
  if (!grantResponse.ok) throw new Error("TN_NETWORK_AUTH: networking session is unavailable");
  const grant = object(await grantResponse.json(), "networking session");
  if (Object.keys(grant).sort().join(",") !== "expiresAt,issuerAuthorization")
    throw new Error("TN_NETWORK_AUTH: networking session has unexpected keys");
  futureExpiry(grant.expiresAt, "grant expiry", 15 * 60 * 1000);
  if (typeof grant.issuerAuthorization !== "string" || grant.issuerAuthorization.length === 0)
    throw new Error("TN_NETWORK_AUTH: grant authorization is invalid");
  const response = await fetch(config.issuerUrl, {
    body: JSON.stringify({ playerId: config.playerId }),
    headers: {
      Authorization: `Bearer ${grant.issuerAuthorization}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error("TN_NETWORK_AUTH: credential issuer rejected the request");
  const issued = object(await response.json(), "issuer response");
  if (Object.keys(issued).sort().join(",") !== "credential,expiresAt")
    throw new Error("TN_NETWORK_AUTH: issuer response has unexpected keys");
  futureExpiry(issued.expiresAt, "join-token expiry", 65_000);
  if (typeof issued.credential !== "string" || issued.credential.length === 0)
    throw new Error("TN_NETWORK_AUTH: issued credential is invalid");
  return issued.credential;
}

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function movementForPlayer(playerId: string): INetworkingInput {
  let checksum = 0;
  for (const character of playerId) checksum = (checksum + character.charCodeAt(0)) % 2;
  return checksum === 0
    ? { actionPressed: false, x: 1, z: 0 }
    : { actionPressed: false, x: 0, z: 1 };
}

function appendSample(samples: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  samples.push(value);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

function metricsActive(metrics: IMetrics, nowMs: number): boolean {
  if (metrics.connectedAtMs === undefined || nowMs - metrics.connectedAtMs < METRIC_WARMUP_MS)
    return false;
  metrics.collectionStartedAtMs ??= nowMs;
  metrics.lastSampleAtMs = nowMs;
  return true;
}

function emptyMetrics(): IMetrics {
  return {
    actionAckLatencyMs: [],
    appliedStateAgeMs: [],
    clockProbes: [],
    collectionStartedAtMs: undefined,
    connectedAtMs: undefined,
    jsNetworkingCpuMs: [],
    lastSampleAtMs: undefined,
    pendingActions: new Map(),
    pendingClockProbes: new Map(),
    unmatchedActionAckCount: 0,
  };
}

function metricsPayload(metrics: IMetrics): Record<string, unknown> {
  const collectionDurationMs =
    metrics.collectionStartedAtMs === undefined || metrics.lastSampleAtMs === undefined
      ? 0
      : Math.max(0, metrics.lastSampleAtMs - metrics.collectionStartedAtMs);
  const warmupMs =
    metrics.connectedAtMs === undefined || metrics.collectionStartedAtMs === undefined
      ? 0
      : Math.max(0, metrics.collectionStartedAtMs - metrics.connectedAtMs);
  return {
    actionAckLatencyMs: metrics.actionAckLatencyMs,
    appliedStateAgeMs: metrics.appliedStateAgeMs,
    clockProbes: metrics.clockProbes,
    collectionDurationMs,
    jsNetworkingCpuMs: metrics.jsNetworkingCpuMs,
    schemaVersion: 2,
    unmatchedActionAckCount: metrics.unmatchedActionAckCount,
    warmupMs,
  };
}

export function createNetworkingGame<TState extends INetworkingState>(
  config: INetworkingConfig,
): INetworkingGame<TState> {
  let connection: INetworkConnection | undefined;
  let connecting: Promise<void> | undefined;
  let generation = 0;
  let closed = true;
  let retryRequested = false;
  let inputTick = 0;
  let nextActionId = 1;
  let nextProbeId = 1;
  let movementStartedAt: number | undefined;
  let nextActionAt = 0;
  let nextProbeAt = 0;
  let lastMetricEmitAt = 0;
  let initialActionSent = false;
  let metrics = emptyMetrics();
  let lastTicks = new Map<string, number>();
  let local: { x: number; z: number } | undefined;
  let remote: IRemotePlayer | undefined;
  let remoteSeenAt: number | undefined;
  let remoteDistance = 0;

  const resetRuntime = (): void => {
    inputTick = 0;
    nextActionId = 1;
    nextProbeId = 1;
    movementStartedAt = undefined;
    nextActionAt = 0;
    nextProbeAt = 0;
    lastMetricEmitAt = 0;
    initialActionSent = false;
    metrics = emptyMetrics();
    lastTicks = new Map();
    local = undefined;
    remote = undefined;
    remoteSeenAt = undefined;
    remoteDistance = 0;
  };

  const emitMetrics = (force = false): void => {
    const nowMs = performance.now();
    if (
      metrics.collectionStartedAtMs === undefined ||
      metrics.actionAckLatencyMs.length === 0 ||
      (!force && nowMs - lastMetricEmitAt < METRIC_EMIT_INTERVAL_MS)
    )
      return;
    lastMetricEmitAt = nowMs;
    console.log(`TN_NETWORK_METRICS:${JSON.stringify(metricsPayload(metrics))}`);
  };

  const start = (store: INetworkingStore<TState>, retry: boolean): void => {
    if (!config.enabled || connecting !== undefined || !closed) return;
    closed = false;
    const run = ++generation;
    const current = store.getState();
    resetRuntime();
    patch(store, {
      networkActionAcks: 0,
      networkConnected: false,
      networkError: "",
      networkLocalX: undefined,
      networkLocalZ: undefined,
      networkPeerId: "",
      networkPeerObserved: false,
      networkProtocolErrors: 0,
      networkReconnects: retry ? current.networkReconnects + 1 : current.networkReconnects,
      networkRemoteDistance: 0,
      networkRemoteX: undefined,
      networkRemoteZ: undefined,
      networkRetry: retry ? current.networkRetry + 1 : current.networkRetry,
      networkSessionId: "",
      networkStatus: "connecting",
      networkUnmatchedActionAcks: 0,
    });
    const work = issueCredential(config).then((credential) => {
      if (run !== generation || closed || config.endpoint === undefined)
        throw new Error("TN_NETWORK_AUTH: connection was canceled");
      const options: INetworkOptions = {
        applicationProtocol: APPLICATION_PROTOCOL,
        channels: CHANNELS,
        connectTimeoutMs: 10_000,
        credential,
        maxQueuedDatagrams: 256,
        maxQueuedReliableBytes: 1_048_576,
        maxReliableMessageBytes: 65_536,
      };
      return connect(config.endpoint, options);
    });
    connecting = work
      .then((opened) => {
        if (run !== generation || closed) {
          void opened.close();
          return;
        }
        connection = opened;
        metrics.connectedAtMs = performance.now();
        patch(store, {
          networkConnected: true,
          networkError: "",
          networkSessionId: opened.getStats().sessionId,
          networkStatus: "connected",
        });
      })
      .catch(() => {
        if (run !== generation || closed) return;
        closed = true;
        patch(store, {
          networkConnected: false,
          networkError: "network connection failed; press Retry",
          networkSessionId: "",
          networkStatus: "disconnected",
        });
      })
      .finally(() => {
        if (run === generation) connecting = undefined;
      });
  };

  const protocolError = (store: INetworkingStore<TState>): void => {
    const state = store.getState();
    patch(store, { networkProtocolErrors: state.networkProtocolErrors + 1 });
  };

  const receive = (store: INetworkingStore<TState>, messages: readonly { channel: number; data: Uint8Array }[]): void => {
    for (const message of messages) {
      try {
        if (message.channel === 2) {
          const snapshot = parseSnapshot(message.data);
          const previousTick = lastTicks.get(snapshot.player.id);
          if (previousTick !== undefined && snapshot.tick <= previousTick) continue;
          lastTicks.set(snapshot.player.id, snapshot.tick);
          const nowMs = performance.now();
          if (snapshot.player.id === config.playerId) {
            local = { x: snapshot.player.x, z: snapshot.player.z };
          } else {
            if (remote?.id === snapshot.player.id)
              remoteDistance += Math.hypot(snapshot.player.x - remote.x, snapshot.player.z - remote.z);
            remote = { id: snapshot.player.id, x: snapshot.player.x, z: snapshot.player.z };
            remoteSeenAt = nowMs;
          }
          const clock = metrics.clockProbes.at(-1);
          if (clock !== undefined && metricsActive(metrics, nowMs)) {
            appendSample(
              metrics.appliedStateAgeMs,
              Math.max(0, nowMs + clock.offsetMs - snapshot.serverMonoMs + clock.uncertaintyMs),
            );
          }
          patch(store, {
            networkLocalX: local?.x,
            networkLocalZ: local?.z,
            networkPeerId: remote?.id ?? "",
            networkPeerObserved: remote !== undefined,
            networkRemoteDistance: remoteDistance,
            networkRemoteX: remote?.x,
            networkRemoteZ: remote?.z,
          });
        } else if (message.channel === 3) {
          const reply = parseActionReply(message.data);
          const sentAt = metrics.pendingActions.get(reply.id);
          metrics.pendingActions.delete(reply.id);
          if (sentAt === undefined) {
            metrics.unmatchedActionAckCount += 1;
            patch(store, { networkUnmatchedActionAcks: metrics.unmatchedActionAckCount });
          } else if (reply.accepted) {
            const nowMs = performance.now();
            const state = store.getState();
            patch(store, { networkActionAcks: state.networkActionAcks + 1 });
            if (metricsActive(metrics, nowMs)) appendSample(metrics.actionAckLatencyMs, nowMs - sentAt);
          }
        } else if (message.channel === 4) {
          const reply = parseClockReply(message.data);
          const sentAt = metrics.pendingClockProbes.get(reply.probeId);
          metrics.pendingClockProbes.delete(reply.probeId);
          if (sentAt === undefined || Math.abs(reply.clientSentMs - sentAt) > 0.001) continue;
          const receivedAt = performance.now();
          const rttMs = receivedAt - reply.clientSentMs - (reply.serverSentMs - reply.serverReceivedMs);
          const uncertaintyMs = rttMs / 2;
          const offsetMs =
            (reply.serverReceivedMs - reply.clientSentMs + reply.serverSentMs - receivedAt) / 2;
          if (rttMs < 0 || !Number.isFinite(offsetMs) || !Number.isFinite(uncertaintyMs)) continue;
          if (metricsActive(metrics, receivedAt)) {
            metrics.clockProbes.push({ offsetMs, rttMs, uncertaintyMs });
            if (metrics.clockProbes.length > MAX_SAMPLES) metrics.clockProbes.shift();
          }
        }
      } catch {
        protocolError(store);
      }
    }
  };

  const sendAction = (active: INetworkConnection): void => {
    const id = nextActionId++;
    const sentAt = performance.now();
    if (!active.send(3, encode({ id }))) {
      nextActionId -= 1;
      return;
    }
    metrics.pendingActions.set(id, sentAt);
    if (metrics.pendingActions.size > MAX_SAMPLES) {
      const oldest = metrics.pendingActions.keys().next().value;
      if (typeof oldest === "number") metrics.pendingActions.delete(oldest);
    }
  };

  const update = (store: INetworkingStore<TState>, input: INetworkingInput): void => {
    if (retryRequested && connecting === undefined) {
      retryRequested = false;
      const previous = connection;
      connection = undefined;
      generation += 1;
      closed = true;
      resetRuntime();
      if (previous !== undefined) void previous.close();
      start(store, true);
    }
    const active = connection;
    if (active === undefined) return;
    const startedAt = performance.now();
    const batch = active.poll();
    receive(store, batch.messages);
    const nowMs = performance.now();
    if (remoteSeenAt !== undefined && nowMs - remoteSeenAt >= PEER_SILENCE_TIMEOUT_MS) {
      remote = undefined;
      remoteSeenAt = undefined;
      patch(store, { networkPeerId: "", networkPeerObserved: false, networkRemoteX: undefined, networkRemoteZ: undefined });
    }
    if (batch.disconnected) {
      connection = undefined;
      closed = true;
      patch(store, {
        networkConnected: false,
        networkError: batch.reason ?? "network connection failed; press Retry",
        networkSessionId: "",
        networkStatus: "disconnected",
      });
      void active.close();
      emitMetrics(true);
      return;
    }
    const state = store.getState();
    const manual = { x: clampAxis(input.x), z: clampAxis(input.z) };
    let axes = manual;
    if (manual.x === 0 && manual.z === 0 && state.networkPeerObserved) {
      movementStartedAt ??= nowMs;
      axes =
        nowMs - movementStartedAt < MOVEMENT_PROBE_MS
          ? movementForPlayer(config.playerId ?? "player")
          : { actionPressed: false, x: 0, z: 0 };
    }
    inputTick += 1;
    try {
      active.send(1, encode({ tick: inputTick, x: axes.x, z: axes.z }));
      if (input.actionPressed) {
        initialActionSent = true;
        sendAction(active);
      } else if (state.networkPeerObserved && !initialActionSent) {
        initialActionSent = true;
        nextActionAt = nowMs + 500;
        sendAction(active);
      } else if (metricsActive(metrics, nowMs) && nowMs >= nextActionAt) {
        nextActionAt = nowMs + 500;
        sendAction(active);
      }
      if (nowMs >= nextProbeAt) {
        nextProbeAt = nowMs + 500;
        const probeId = nextProbeId++;
        const clientSentMs = performance.now();
        if (active.send(4, encode({ clientSentMs, probeId })))
          metrics.pendingClockProbes.set(probeId, clientSentMs);
      }
    } catch {
      protocolError(store);
    }
    if (metricsActive(metrics, nowMs)) appendSample(metrics.jsNetworkingCpuMs, performance.now() - startedAt);
    emitMetrics();
  };

  return {
    enter(store) {
      retryRequested = false;
      closed = true;
      resetRuntime();
      if (!config.enabled) {
        patch(store, { networkConnected: false, networkError: "", networkSessionId: "", networkStatus: "disabled" });
        return;
      }
      start(store, false);
    },
    update,
    retry() {
      retryRequested = true;
    },
    exit() {
      generation += 1;
      closed = true;
      retryRequested = false;
      const active = connection;
      connection = undefined;
      if (active !== undefined) void active.close();
      emitMetrics(true);
    },
  };
}
