# HUD startup ordering

The HUD and controls now wait for `revealTreeCount >= 0`, the existing snapshot emitted when
Valley's loading curtain lifts. `valleyReady` alone is too early: world construction can finish
while the loading screen is still visible. The UI bridge remains connected during preload.

`node --test tests/hud-startup.test.mjs` exercises the real HUD/menu components:

```text
Before: 3 tests, 1 pass, 2 fail
After:  3 tests, 3 pass, 0 fail
```

Cases cover preload, reveal, and hiding again on restart. `pnpm typecheck`, the production Vite
build and the native UI build also passed. The engine investigation and native receipts are in
`threenative-engine/docs/verification/wildwood-native-depth-warmup-2026-09-07.md` and
`threenative-engine/artifacts/wildwood-performance-20260907/` on the same machine.
