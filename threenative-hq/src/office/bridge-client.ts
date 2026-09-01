import type {
  IOfficeSnapshot,
  ISessionSummary,
  OfficeMessage,
} from "../../tools/office-bridge/protocol.js";

/**
 * The office's end of the bridge.
 *
 * One socket, one snapshot on connect, deltas after. It owns no scene objects and decides no
 * poses: it publishes a session list and whether the daemon is there, and the scene does the rest.
 *
 * When the daemon is not running the office is *empty and says so*. An office that keeps its last
 * known workers on screen after the bridge dies is a screensaver of a machine that may have gone
 * quiet hours ago.
 */
export interface IBridgeClientOptions {
  readonly url?: string;
  /** Milliseconds between reconnection attempts. */
  readonly retryMs?: number;
  readonly onChange?: () => void;
}

export const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:7373/office";

/** Frames between viewer heartbeats. */
export const HEARTBEAT_FRAMES = 20;

export class BridgeClient {
  readonly #url: string;
  readonly #retryMs: number;
  readonly #onChange: () => void;
  readonly #sessions = new Map<string, ISessionSummary>();
  #socket: WebSocket | undefined;
  #frame = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #connected = false;
  #closed = false;

  constructor(options: IBridgeClientOptions = {}) {
    // A query parameter wins so one machine can watch another's office, or a proof can point the
    // game at a fixture bridge without the game carrying a test-only code path.
    const fromQuery =
      typeof location === "undefined" ? null : new URLSearchParams(location.search).get("bridge");
    this.#url = options.url ?? fromQuery ?? DEFAULT_BRIDGE_URL;
    this.#retryMs = options.retryMs ?? 2_000;
    this.#onChange = options.onChange ?? (() => {});
    this.#connect();
  }

  get connected(): boolean {
    return this.#connected;
  }

  /** Live sessions, oldest first — the order desks are handed out in. */
  sessions(): readonly ISessionSummary[] {
    return [...this.#sessions.values()].sort(
      (a, b) => a.startedMs - b.startedMs || (a.id < b.id ? -1 : 1),
    );
  }

  /**
   * Call once per frame. Sends a heartbeat every {@link HEARTBEAT_FRAMES} frames.
   *
   * A viewer that says it is still there lets a bridge drop state for offices that closed without
   * a clean socket close, and it gives a scripted bridge a clock in the only unit this game
   * actually shares with a proof: frames.
   */
  tick(): void {
    this.#frame += 1;
    if (this.#frame % HEARTBEAT_FRAMES !== 0) return;
    const socket = this.#socket;
    if (socket === undefined || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ frame: this.#frame, kind: "viewer" }));
  }

  close(): void {
    this.#closed = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#socket?.close();
  }

  #connect(): void {
    if (this.#closed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.#url);
    } catch {
      this.#retry();
      return;
    }
    this.#socket = socket;
    socket.onopen = () => {
      this.#connected = true;
      this.#onChange();
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      this.#receive(event.data);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.#connected = false;
      // Everyone leaves. The floor is only ever as current as the socket.
      this.#sessions.clear();
      this.#onChange();
      this.#retry();
    };
  }

  #retry(): void {
    if (this.#closed) return;
    this.#timer = setTimeout(() => this.#connect(), this.#retryMs);
  }

  #receive(raw: string): void {
    let message: OfficeMessage;
    try {
      message = JSON.parse(raw) as OfficeMessage;
    } catch {
      // The daemon is the only writer on this socket; anything unparseable is a bug there, and
      // acting on half a message would put a worker at a desk for a session that does not exist.
      console.warn("TN_HQ_BRIDGE_MALFORMED");
      return;
    }
    if (message.kind === "snapshot") {
      this.#sessions.clear();
      for (const session of (message as IOfficeSnapshot).sessions)
        this.#sessions.set(session.id, session);
    } else if (message.kind === "delta") {
      this.#sessions.set(message.session.id, message.session);
    } else if (message.kind === "gone") {
      this.#sessions.delete(message.id);
    } else {
      console.warn("TN_HQ_BRIDGE_UNKNOWN_MESSAGE");
      return;
    }
    this.#onChange();
  }
}
