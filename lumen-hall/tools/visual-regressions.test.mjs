import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("saint glass keeps authored top-to-bottom orientation", async () => {
  const source = await readFile(new URL("src/render/surfaces.ts", root), "utf8");
  const body = source.slice(source.indexOf("function dressGlass"), source.indexOf("function fitPanel"));
  assert.match(body, /const panel = uv\(\);/u);
  assert.doesNotMatch(body, /\.y\.oneMinus\(\)/u);
});

test("every statue slot uses an authored model", async () => {
  const furnishings = await readFile(new URL("src/render/furnishings.ts", root), "utf8");
  const play = await readFile(new URL("src/scenes/Play.ts", root), "utf8");
  const slots = furnishings.slice(
    furnishings.indexOf("export const AUTHORED_STATUES"),
    furnishings.indexOf("export const AUTHORED_STANDS"),
  );

  assert.equal([...slots.matchAll(/\{ model: /gu)].length, 6);
  assert.doesNotMatch(furnishings, /function statue\(/u);
  assert.doesNotMatch(furnishings, /readonly (?:robe|stoneHead): IBatch/u);
  assert.match(play, /for \(const statue of AUTHORED_STATUES\)/u);
});
