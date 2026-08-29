# mined-features

A ThreeNative sandbox game that exercises the features mined from the Three.js ecosystem in the
2026-08-28 batch, installed from tarballs exactly as a user would get them. See `brief.md` for what
each feature has to do to count, and `playtests/mined-features.playtest.json` for the proof.

```sh
pnpm dev                                     # play it
pnpm exec threenative-playtest \
  --scenario playtests/mined-features.playtest.json \
  --browser-recipe webgpu --headed \
  --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort"
```
