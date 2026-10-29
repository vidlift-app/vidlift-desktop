import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { choose, type DesktopEntry, parseSemver, pickDesktop, platformKey, readChannel, readToken, semverNewer } from "./updater";

test("semverNewer compares major, minor and patch as numbers", () => {
  assert.equal(semverNewer("1.0.10", "1.0.9"), true);
  assert.equal(semverNewer("1.10.0", "1.9.9"), true);
  assert.equal(semverNewer("2.0.0", "1.99.99"), true);
  assert.equal(semverNewer("1.0.0", "1.0.0"), false);
  assert.equal(semverNewer("1.0.0", "1.0.1"), false);
  assert.equal(semverNewer("v1.2.3", "1.2.2"), true);
});

test("semverNewer: a release beats its pre-releases; junk is never newer", () => {
  assert.equal(semverNewer("1.2.0", "1.2.0-beta.1"), true);
  assert.equal(semverNewer("1.2.0-beta.1", "1.2.0"), false);
  assert.equal(semverNewer("1.2.0-beta.10", "1.2.0-beta.9"), true);
  assert.equal(semverNewer("2026.10.30.1", "1.0.0"), false);
  assert.equal(semverNewer("", "1.0.0"), false);
  assert.equal(semverNewer("1.0.1", "nonsense"), false);
  assert.equal(parseSemver("1.2"), null);
});

const sha = "a".repeat(64);
const entry = (version: string): DesktopEntry => ({
  version,
  assets: {
    win: { name: "VidLift-Setup.exe", url: `https://example.test/${version}/VidLift-Setup.exe`, sha256: sha },
    mac: { name: "VidLift.dmg", url: `https://example.test/${version}/VidLift.dmg`, sha256: sha },
  },
});
const cat = (desktop: Record<string, unknown> | undefined) => ({ channels: {}, ...(desktop ? { desktop } : {}) });

test("pickDesktop: Stable reads Stable; Beta the newer of the two", () => {
  const c = cat({ stable: entry("1.0.1"), beta: entry("1.0.2") });
  assert.equal(pickDesktop(c, "stable")?.version, "1.0.1");
  assert.equal(pickDesktop(c, "beta")?.version, "1.0.2");
  const caught = cat({ stable: entry("1.0.3"), beta: entry("1.0.2") });
  assert.equal(pickDesktop(caught, "beta")?.version, "1.0.3");
  const onlyBeta = cat({ beta: entry("1.0.2") });
  assert.equal(pickDesktop(onlyBeta, "stable"), null);
  assert.equal(pickDesktop(onlyBeta, "beta")?.version, "1.0.2");
  assert.equal(pickDesktop(cat(undefined), "beta"), null);
  assert.equal(pickDesktop(cat({ stable: { version: "x" } }), "stable"), null);
  // Retired or unknown channels read as Stable.
  assert.equal(pickDesktop(c, "fixes")?.version, "1.0.1");
});

test("choose: only a newer version, only this platform's asset, only with a checksum", () => {
  const c = cat({ stable: entry("1.0.1"), beta: entry("1.0.2") });
  assert.equal(choose(c, "stable", "1.0.1", "win32"), null);
  assert.equal(choose(c, "stable", "1.0.0", "win32")?.asset.name, "VidLift-Setup.exe");
  assert.equal(choose(c, "beta", "1.0.0", "darwin")?.asset.name, "VidLift.dmg");
  assert.equal(choose(c, "beta", "1.0.0", "darwin")?.version, "1.0.2");
  assert.equal(choose(c, "beta", "1.0.0", "linux"), null);
  const noMac = cat({ stable: { version: "1.0.5", assets: { win: entry("1.0.5").assets.win } } });
  assert.equal(choose(noMac, "stable", "1.0.0", "darwin"), null);
  const badSha = cat({ stable: { version: "1.0.5", assets: { win: { name: "a", url: "u", sha256: "<from the Actions build>" } } } });
  assert.equal(choose(badSha, "stable", "1.0.0", "win32"), null);
});

test("platformKey", () => {
  assert.equal(platformKey("win32"), "win");
  assert.equal(platformKey("darwin"), "mac");
  assert.equal(platformKey("linux"), null);
});

test("readChannel and readToken from the install's user/data", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vl-upd-"));
  assert.equal(readChannel(dir), "stable");
  assert.equal(readToken(dir), null);
  mkdirSync(path.join(dir, "user", "data"), { recursive: true });
  writeFileSync(path.join(dir, "user", "data", "update-channel.json"), JSON.stringify({ channel: "beta" }));
  writeFileSync(path.join(dir, "user", "data", "github.json"), JSON.stringify({ token: "gho_x", login: "me" }));
  assert.equal(readChannel(dir), "beta");
  assert.equal(readToken(dir), "gho_x");
  writeFileSync(path.join(dir, "user", "data", "update-channel.json"), JSON.stringify({ channel: "fixes" }));
  assert.equal(readChannel(dir), "stable");
});
