import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { watchAssets } from "@threenative/assets";
import { createEngineFreshnessPlugin, createWebBrandPlugin } from "create-threenative";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import config from "./threenative.config.js";

interface IViteNetworkingConfig {
  enabled: boolean;
  endpoint?: string;
  issuerUrl?: string;
  playerId?: string;
  room?: string;
}

const NETWORKING_KEYS = new Set(["enabled", "endpoint", "issuerUrl", "playerId", "room"]);

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`THREENATIVE_NETWORKING_CONFIG: ${name} must be a nonempty string`);
  return value;
}

function httpsUrl(value: unknown, name: string): string {
  const text = requiredString(value, name);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`THREENATIVE_NETWORKING_CONFIG: ${name} must be an HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error(`THREENATIVE_NETWORKING_CONFIG: ${name} must be an HTTPS URL without credentials or a fragment`);
  return url.toString();
}

function readNetworkingConfig(): IViteNetworkingConfig {
  const declaredPath = process.env.THREENATIVE_NETWORKING_CONFIG?.trim();
  if (declaredPath === undefined || declaredPath === "") return { enabled: false };
  const path = resolve(declaredPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `THREENATIVE_NETWORKING_CONFIG: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`THREENATIVE_NETWORKING_CONFIG: ${path} must contain an object`);
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!NETWORKING_KEYS.has(key)) throw new Error(`THREENATIVE_NETWORKING_CONFIG: unknown key '${key}'`);
  }
  if (typeof record.enabled !== "boolean")
    throw new Error("THREENATIVE_NETWORKING_CONFIG: enabled must be boolean");
  if (!record.enabled) return { enabled: false };
  return {
    enabled: true,
    endpoint: httpsUrl(record.endpoint, "endpoint"),
    issuerUrl: httpsUrl(record.issuerUrl, "issuerUrl"),
    playerId: requiredString(record.playerId, "playerId"),
    room: requiredString(record.room, "room"),
  };
}

const networkingConfig = readNetworkingConfig();

function readDevTls(): { cert: Buffer; key: Buffer } | undefined {
  const certPath = process.env.THREENATIVE_DEV_CERT?.trim();
  const keyPath = process.env.THREENATIVE_DEV_KEY?.trim();
  if (certPath === undefined && keyPath === undefined) return undefined;
  if (certPath === undefined || keyPath === undefined)
    throw new Error("THREENATIVE_DEV_TLS: set both THREENATIVE_DEV_CERT and THREENATIVE_DEV_KEY");
  return { cert: readFileSync(resolve(certPath)), key: readFileSync(resolve(keyPath)) };
}

const devTls = readDevTls();

/**
 * Recompiles assets/ into public/ while the dev server runs, so editing a texture does not
 * need a rebuild. Serve-only by declaration: builds compile through `threenative build`.
 */
function assetsWatchPlugin(): Plugin {
  return {
    name: "threenative-assets-watch",
    apply: "serve",
    configureServer(server) {
      const handle = watchAssets({ config: config.assets, cwd: server.config.root });
      server.httpServer?.once("close", () => handle.close());
    },
  };
}

export default defineConfig({
  define: {
    __TN_NETWORKING_CONFIG__: JSON.stringify(networkingConfig),
  },
  plugins: [createEngineFreshnessPlugin(), createWebBrandPlugin(), assetsWatchPlugin()],
  server: {
    ...(devTls === undefined ? {} : { https: devTls }),
    watch: {
      ignored: ["**/artifacts/**", "**/screenshots/**", "**/playtests/**"],
      usePolling: true,
    },
  },
});
