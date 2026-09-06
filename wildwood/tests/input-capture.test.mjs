import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { transform } from "esbuild";

test("native canvas clicks request relative pointer capture", async () => {
  const source = await readFile(new URL("../src/entities/Wanderer.ts", import.meta.url), "utf8");
  const start = source.indexOf("export function capturePointerOnClick");
  assert.notEqual(start, -1, "capturePointerOnClick must remain exported");
  const compiled = await transform(source.slice(start), { format: "cjs", loader: "ts" });
  const module = { exports: {} };
  new Function("module", "exports", compiled.code)(module, module.exports);

  let listener;
  let removed;
  let requests = 0;
  const canvas = {
    addEventListener(type, callback) {
      assert.equal(type, "click");
      listener = callback;
    },
    removeEventListener(type, callback) {
      assert.equal(type, "click");
      removed = callback;
    },
    requestPointerLock() {
      requests += 1;
      globalThis.document.pointerLockElement = canvas;
    },
  };
  globalThis.document = {
    pointerLockElement: null,
    getElementById(id) {
      assert.equal(id, "canvas");
      return canvas;
    },
    querySelector() {
      throw new Error("native capture must not require querySelector");
    },
  };
  globalThis.isWeb = () => false;

  try {
    const release = module.exports.capturePointerOnClick();
    assert.equal(typeof listener, "function");
    listener();
    listener();
    assert.equal(requests, 1, "a captured pointer should not be requested twice");
    release();
    assert.equal(removed, listener);
  } finally {
    delete globalThis.document;
    delete globalThis.isWeb;
  }
});
