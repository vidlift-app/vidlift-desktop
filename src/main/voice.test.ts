import assert from "node:assert/strict";
import { test } from "node:test";
import { voiceDefault } from "./voice";

test("an online choice keeps its engine", () => {
  assert.deepEqual(voiceDefault({ mode: "online", engine: "elevenlabs" }), { mode: "online", engine: "elevenlabs" });
  assert.deepEqual(voiceDefault({ mode: "online", engine: "fish" }), { mode: "online", engine: "fish" });
});

test("local, nothing, or an unknown engine is the local voice", () => {
  assert.deepEqual(voiceDefault({ mode: "local", engine: "minimax" }), { mode: "local" });
  assert.deepEqual(voiceDefault(null), { mode: "local" });
  assert.deepEqual(voiceDefault({ mode: "online" }), { mode: "local" });
  assert.deepEqual(voiceDefault({ mode: "online", engine: "openai" as never }), { mode: "local" });
});
