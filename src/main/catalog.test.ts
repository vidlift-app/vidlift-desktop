import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { type Catalog, type Entry, latest, newer, verifyEd25519 } from "./catalog";

function pair(): { publicB64: string; sign: (data: Buffer) => string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return {
    publicB64: Buffer.from(jwk.x, "base64url").toString("base64"),
    sign: (data) => sign(null, data, privateKey).toString("base64"),
  };
}

test("verifyEd25519 accepts the signer's bytes", () => {
  const k = pair();
  const data = Buffer.from('{"channels":{}}', "utf-8");
  assert.equal(verifyEd25519(data, k.sign(data), k.publicB64), true);
  assert.equal(verifyEd25519(data, `${k.sign(data)}\n`, k.publicB64), true); // a .sig file's newline
});

test("verifyEd25519 refuses tampered bytes", () => {
  const k = pair();
  const data = Buffer.from('{"channels":{}}', "utf-8");
  const sig = k.sign(data);
  assert.equal(verifyEd25519(Buffer.from('{"channels":{ }}', "utf-8"), sig, k.publicB64), false);
});

test("verifyEd25519 refuses another key, and junk keys", () => {
  const a = pair();
  const b = pair();
  const data = Buffer.from("hello", "utf-8");
  assert.equal(verifyEd25519(data, a.sign(data), b.publicB64), false);
  assert.equal(verifyEd25519(data, a.sign(data), ""), false);
  assert.equal(verifyEd25519(data, a.sign(data), "bm90IGEga2V5"), false);
  assert.equal(verifyEd25519(data, "not base64 at all!", a.publicB64), false);
});

test("newer compares calendar versions part by part", () => {
  assert.equal(newer("2026.10.30", "2026.10.6"), true);
  assert.equal(newer("2026.10.06.2", "2026.10.06"), true);
  assert.equal(newer("2026.10.06", "2026.10.06.2"), false);
  assert.equal(newer("2026.10.06", "2026.10.06"), false);
  assert.equal(newer("2026.9.30", "2026.10.1"), false);
});

const entry = (version: string): Entry => ({ version, name: `core-${version}.zip`, asset: "u", sha256: "0" });

test("latest: Beta offers Beta's entry when it is newer", () => {
  const c: Catalog = { channels: { stable: { core: entry("2026.10.20") }, beta: { core: entry("2026.10.30") } } };
  assert.equal(latest(c, "beta", "core")?.version, "2026.10.30");
  assert.equal(latest(c, "stable", "core")?.version, "2026.10.20");
});

test("latest: Beta offers Stable's entry when Stable caught up", () => {
  const c: Catalog = { channels: { stable: { core: entry("2026.10.30.1") }, beta: { core: entry("2026.10.30") } } };
  assert.equal(latest(c, "beta", "core")?.version, "2026.10.30.1");
});

test("latest: a component missing on one or both channels", () => {
  const onlyBeta: Catalog = { channels: { stable: {}, beta: { core: entry("2026.10.30") } } };
  assert.equal(latest(onlyBeta, "beta", "core")?.version, "2026.10.30");
  assert.equal(latest(onlyBeta, "stable", "core"), null);
  const none: Catalog = { channels: {} };
  assert.equal(latest(none, "beta", "core"), null);
  assert.equal(latest(none, "stable", "graphics"), null);
});
