# ThreeNative networking proof

This is the required cold-package game for PRD-359. It is deliberately small: a fixed-camera
arena, a cyan local cube, a pink server-owned peer cube, and a floor. WASD and the on-screen
direction pad send input through the same `@threenative/core/net` client. The server, not the
client, owns both positions. The on-screen action button sends a reliable numbered action and
the ACK counter changes only after the Go server accepts it.

## Installed package proof

This folder was scaffolded with the tarball sandbox command from engine commit `7cf85387`.
The package graph resolves `@threenative/core/net` from installed package dist; it does not import
workspace source or use a fake transport.

| Package | Version | Tarball SHA-256 |
| --- | --- | --- |
| `@threenative/core` | 0.3.0 | `514e0bb4cc843b883f7992acc023044e81c06264594420dd215c93e35ce42083` |
| `@threenative/physics` | 0.3.0 | `15e1261f0d2cbfd4a4f251392c949f2e97c0748527cf1a20004794440f7cd25c` |
| `@threenative/ui` | 0.3.0 | `48199aa2c8213e2a252fbe1e03f90076e173b7224f44a06b8bad12ea4ba39c0b` |
| `@threenative/assets` | 0.3.0 | `4558d72d3d61cd52c4c80322973a934a429ac17f4b2c4d13d879c5b252f44f20` |
| `@threenative/playtest` | 0.3.0 | `aa06cbe4b8f58fc9e539a0c83e635704d238a92075f8d58e8250c99455bca0f4` |
| `@threenative/runtime-native` | 0.3.0 | `9e121cfc251f221dcb64b2140408a17f6167f108bba70c5908fa5260aab100dd` |
| `create-threenative` | 0.2.3 | `e4dc59d475d1d22adb25d38108501ad650e04ed69060d92f32bafae9ef6e970b` |
| `threenative-engine-mcp` | 0.2.0 | `b132222e3578e1339e3a310d674e08a95ae1636ab790c87ae7ff26832587a454` |

Baseline commands, run from this directory:

```sh
pnpm exec tsc --noEmit
pnpm build
pnpm build:web
pnpm build:desktop
```

`build:desktop` needs a locally available native runtime toolchain or prebuilt runtime package.
The package is optional in this cold sandbox, so a missing published native binary is an
environment prerequisite, not a browser proof result.

## Runtime configuration

Networking is disabled unless `THREENATIVE_NETWORKING_CONFIG` points to a JSON file. Start the
Go reference server and its HTTPS issuer, then give each client a distinct config based on
[`networking.config.example.json`](./networking.config.example.json). The proof runner writes
these per-client files and stages the short-lived, ignored `networking-session.json` grant beside
each client asset directory. Grants and join tokens never belong in source or evidence.

The enabled schema is:

```json
{
  "enabled": true,
  "endpoint": "https://127.0.0.1:4433/game",
  "issuerUrl": "https://127.0.0.1:9443/token",
  "room": "networking-proof",
  "playerId": "player-a"
}
```

For a local proof from the engine checkout, build the server in
`packages/runtime-native/examples/webtransport/server`, use a trusted certificate with a
`127.0.0.1` SAN, and invoke the repository runner. It starts two isolated Vite/browser clients,
uses separate authenticated player identities, checks the server log, and runs the partner-loss
negative control:

```sh
node scripts/run-networking-proof.mjs \
  --config /absolute/path/to/networking-proof-run.json \
  --output /absolute/path/to/networking-proof-result.json
```

The scenario intentionally waits for measured connection, peer presence, remote distance, and an
accepted action before holding the real loop long enough to collect the required latency and CPU
windows. `playtests/networking.playtest.json` is also suitable for one client with `pnpm dev`:

```sh
pnpm dev --host 127.0.0.1 --port 5173
node /absolute/path/to/packages/playtest/dist/runner/cli.js \
  --scenario playtests/networking.playtest.json \
  --url http://127.0.0.1:5173 --browser-recipe webgpu
```

The same game source is used for browser and desktop packaging. A proof is only complete when
browser/browser and browser/native desktop runs record distinct sessions, both server-owned
players moving at least one metre, accepted actions, and the sender-disabled and partner-loss
negative controls.
