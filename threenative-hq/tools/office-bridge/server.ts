/**
 * The bridge: one HTTP port on the loopback interface, and one WebSocket path.
 *
 * Nothing here reaches the network. Nothing here spawns a session, writes to one, or reads a
 * prompt body — the office is a wall display, and a wall display that quietly republishes what
 * someone typed into their terminal is a different product with a different consent question.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { MAX_EVENT_BYTES, ProtocolError, parseSessionEvent } from "./protocol.js";
import type { OfficeRegistry, RegistryChange } from "./registry.js";

export interface IOfficeServerOptions {
  readonly registry: OfficeRegistry;
  readonly port: number;
  readonly host?: string;
  readonly log?: (message: string) => void;
}

export interface IOfficeServer {
  readonly http: Server;
  readonly port: number;
  broadcast(changes: readonly RegistryChange[]): void;
  close(): Promise<void>;
}

export async function startOfficeServer(options: IOfficeServerOptions): Promise<IOfficeServer> {
  const host = options.host ?? "127.0.0.1";
  const log = options.log ?? (() => {});
  const { registry } = options;

  // Declared before the server so the request handler can hand a hook's event straight to every
  // connected office: an accepted event that nobody is told about is a desk that never updates.
  let publish: (changes: readonly RegistryChange[]) => void = () => {};
  const http = createServer((request, response) => {
    void handle(request, response, registry, log, (change) => publish([change]));
  });
  const sockets = new WebSocketServer({ noServer: true });

  http.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/office") {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      client.send(JSON.stringify(registry.snapshot()));
      sockets.emit("connection", client, request);
    });
  });

  await new Promise<void>((resolve, reject) => {
    // Fail closed on a busy port. Binding somewhere else would leave the office connected to
    // nothing and looking exactly like a machine with no sessions running.
    http.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(`Port ${String(options.port)} is already in use; free it or pass --port.`)
          : error,
      );
    });
    http.listen(options.port, host, () => resolve());
  });
  log(`office bridge listening on http://${host}:${String(options.port)}`);

  const server: IOfficeServer = {
    broadcast(changes) {
      if (changes.length === 0) return;
      for (const change of changes) {
        const message =
          change.kind === "gone"
            ? JSON.stringify({ id: change.id, kind: "gone" })
            : JSON.stringify({ kind: "delta", session: change.session });
        for (const client of sockets.clients) {
          if (client.readyState === 1) client.send(message);
        }
      }
    },
    async close() {
      for (const client of sockets.clients) client.close();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
    http,
    port: options.port,
  };
  publish = (changes) => server.broadcast(changes);
  return server;
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  registry: OfficeRegistry,
  log: (message: string) => void,
  publish: (change: RegistryChange) => void,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const json = (status: number, body: unknown): void => {
    const text = JSON.stringify(body);
    response.writeHead(status, {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    });
    response.end(text);
  };

  if (request.method === "GET" && url.pathname === "/sessions") {
    json(200, registry.snapshot());
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    json(200, { ok: true, sessions: registry.size });
    return;
  }
  if (request.method === "POST" && url.pathname === "/event") {
    let body = "";
    let oversized = false;
    for await (const chunk of request) {
      body += String(chunk);
      if (body.length > MAX_EVENT_BYTES) {
        oversized = true;
        break;
      }
    }
    if (oversized) {
      json(413, { error: `An event may not exceed ${String(MAX_EVENT_BYTES)} bytes.` });
      return;
    }
    let event;
    try {
      event = parseSessionEvent(JSON.parse(body) as unknown);
    } catch (error) {
      // Rejected, and the registry is untouched: a malformed event must change nothing on screen.
      json(400, {
        error: error instanceof ProtocolError ? error.message : "An event must be valid JSON.",
      });
      return;
    }
    const change = registry.applyEvent(event);
    publish(change);
    log(`event ${event.host}:${event.kind} -> ${change.kind}`);
    json(202, { accepted: true, kind: change.kind });
    return;
  }
  json(404, { error: "The office bridge serves /sessions, /health, /event and /office." });
}
