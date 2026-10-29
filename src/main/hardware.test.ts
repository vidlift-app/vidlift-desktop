import assert from "node:assert/strict";
import { test } from "node:test";
import { describeHardware } from "./hardware";

test("an NVIDIA card with CUDA", () => {
  const s = { profile: { gpus: [{ vendor: "nvidia", name: "NVIDIA GeForce RTX 3070", vram_mb: 8192 }], torch_device: "cuda" } };
  assert.equal(describeHardware(s), "NVIDIA GeForce RTX 3070 (8 GB) · AI runs on the NVIDIA GPU");
});

test("Apple Silicon without a VRAM figure", () => {
  const s = { profile: { gpus: [{ vendor: "apple", name: "Apple M2" }], torch_device: "mps" } };
  assert.equal(describeHardware(s), "Apple M2 · AI runs on the Apple GPU");
});

test("no GPU: the CPU", () => {
  assert.equal(describeHardware({ profile: { gpus: [], cpu_cores: 8, torch_device: "cpu" } }), "8-core CPU · AI runs on the CPU");
  assert.equal(describeHardware({ profile: {} }), "?-core CPU · AI runs on the CPU");
});

test("no profile: nothing to say", () => {
  assert.equal(describeHardware(null), null);
  assert.equal(describeHardware({}), null);
});
