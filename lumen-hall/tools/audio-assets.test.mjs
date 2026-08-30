import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rejectedGeneratedClips = new Set([
  "c801861d4c6335b42daf0615467940a9bf34a6674a5a85190d3d0eb20ebdec73",
  "6e344d9d7593f15e150c7fcb158abccad3186a35c272d3bdeebc0a86ad18d7d6",
  "7c55d081bb6aff98d8aa2b0517b7806188325e3a09671557e7061f7e1a31e195",
  "995d8dd5b2cfb9392d592191f3db3a4e381e8549a50c41500244aa45accc4664",
  "c0e8fed6154e6164fa689108d080cec1dfe9252e0f396592bf390e3193baabe6",
]);

test("footsteps use the licensed hard-surface recording instead of generated clips", async () => {
  const credits = await readFile(new URL("../assets/AUDIO-CREDITS.md", import.meta.url), "utf8");
  assert.match(credits, /Footsteps on heels on the pavement/u);
  assert.match(credits, /mixkit\.co\/free-sound-effects\/footsteps/u);

  for (let index = 1; index <= 5; index += 1) {
    const bytes = await readFile(new URL(`../assets/footstep-${index}.wav`, import.meta.url));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(rejectedGeneratedClips.has(hash), false, `footstep-${index}.wav is the rejected generated clip`);

    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
    const channels = bytes.readUInt16LE(22);
    const sampleRate = bytes.readUInt32LE(24);
    const dataIndex = bytes.indexOf(Buffer.from("data"));
    assert.notEqual(dataIndex, -1, `footstep-${index}.wav has no PCM data chunk`);
    const seconds = bytes.readUInt32LE(dataIndex + 4) / (sampleRate * channels * 2);
    assert.equal(channels, 1, `footstep-${index}.wav must be mono`);
    assert.equal(sampleRate, 44100, `footstep-${index}.wav must be 44.1 kHz`);
    assert.ok(seconds >= 0.4 && seconds <= 0.5, `footstep-${index}.wav is ${seconds.toFixed(3)}s`);
  }
});
