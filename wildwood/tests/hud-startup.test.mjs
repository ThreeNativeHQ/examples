import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "wildwood-hud-startup-"));
after(() => rm(directory, { recursive: true, force: true }));
const bundle = await build({
  stdin: {
    contents: `import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { GameUi } from './src/ui/GameUi.tsx';
      export function render(state) {
        globalThis.__wildwoodTestState = state;
        return renderToStaticMarkup(createElement(GameUi));
      }`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  plugins: [
    {
      name: "published-ui-state",
      setup(builder) {
        builder.onResolve({ filter: /^@threenative\/ui$/ }, () => ({
          path: "ui-state",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: `
        export const UiLayer = ({children}) => children;
        export const useUiState = () => globalThis.__wildwoodTestState;
        export const useUiIntent = () => () => {};`,
        }));
      },
    },
  ],
});
const file = join(directory, "ui.mjs");
await writeFile(file, bundle.outputFiles[0].text);
const { render } = await import(pathToFileURL(file).href);
const loading = {
  valleyReady: true,
  revealTreeCount: -1,
  revealFernCount: -1,
  heading: 0,
  discovered: 0,
  landmarkTotal: 5,
  nearest: "old oak",
  nearestDistance: 100,
  odometer: 0,
  journal: [],
  paused: false,
};

test("HUD and controls stay hidden before the loading curtain reveals the world", () => {
  assert.equal(render(undefined), "");
  assert.equal(render(loading), "", "a loaded valley is still covered until the reveal");
});

test("world reveal shows the HUD and interactive controls", () => {
  const html = render({ ...loading, revealTreeCount: 2341, revealFernCount: 7600 });
  assert.match(html, /nearest unfound/);
  assert.match(html, /old oak/);
  assert.match(html, /data-tn-interactive/);
  assert.match(html, /restart/);
});

test("restarting hides the previous world's HUD while the next world loads", () => {
  render({ ...loading, revealTreeCount: 2341, revealFernCount: 7600 });
  assert.equal(render(loading), "");
});
