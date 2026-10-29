// Licence activation against license.vidlift.io (docs/desktop/contracts.md §2).
// The server checks the key, the GitHub account behind the token and the Skool
// membership; the signed answer is written to user/data/license.json, where
// the core (apps/worker/license.py) reads and re-checks it.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { verifyEd25519 } from "./catalog";
import { LICENSE_PUBLIC_KEY, LICENSE_SERVER } from "./constants";
import { loadLicense, saveLicense } from "./state";
import type { LicenseResult } from "../shared/types";

export { normalizeKey } from "./key";

export interface Machine {
  id: string;
  name: string;
  os: string;
  arch: string;
  app_version: string;
}

export function machine(machineId: string): Machine {
  return {
    id: machineId,
    name: os.hostname(),
    os: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux",
    arch: process.arch,
    app_version: app.getVersion(),
  };
}

/** A stable id for this computer's VidLift: made once in the shell's folder,
 * and copied into user/data/machine-id where the core reads it. */
export async function machineId(userDir: string | null): Promise<string> {
  const f = path.join(app.getPath("userData"), "machine-id");
  const id = await readOrMake(f);
  if (userDir) {
    await fs.mkdir(path.join(userDir, "data"), { recursive: true });
    await fs.writeFile(path.join(userDir, "data", "machine-id"), id, "utf-8");
  }
  return id;
}

async function readOrMake(f: string): Promise<string> {
  try {
    const id = (await fs.readFile(f, "utf-8")).trim();
    if (id) return id;
  } catch {
    /* first time */
  }
  const id = randomUUID();
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, id, "utf-8");
  return id;
}

export interface Signed {
  license: string;
  signature: string;
}

let lastSigned: Signed | null = null;

export async function activate(key: string, token: string, userDir: string | null): Promise<LicenseResult> {
  const id = await machineId(userDir);
  let r: Response;
  try {
    r = await fetch(`${LICENSE_SERVER}/api/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "VidLift-Desktop" },
      body: JSON.stringify({ key, github_token: token, machine: machine(id) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return {
      ok: false,
      error: "unreachable",
      message: "The licence server didn't answer. Check the internet connection and try again.",
    };
  }
  const body = (await r.json().catch(() => ({}))) as Record<string, string>;
  if (!r.ok) {
    return { ok: false, error: body.error || `http_${r.status}`, message: body.message || "The licence was refused." };
  }
  if (typeof body.license !== "string" || typeof body.signature !== "string") {
    return { ok: false, error: "unreachable", message: "The licence server sent an answer VidLift can't read. Try again in a minute." };
  }
  if (LICENSE_PUBLIC_KEY && !verifyEd25519(Buffer.from(body.license, "utf-8"), body.signature, LICENSE_PUBLIC_KEY)) {
    return { ok: false, error: "bad_signature", message: "The licence server's answer was not signed correctly." };
  }
  let lic: {
    status: "active" | "ended";
    updates_until: string | null;
    member: { name?: string; skool_username?: string };
  };
  try {
    lic = JSON.parse(body.license);
  } catch {
    return { ok: false, error: "bad_signature", message: "The licence server's answer could not be read." };
  }
  lastSigned = { license: body.license, signature: body.signature };
  await saveLicense(lastSigned).catch(() => undefined);
  return {
    ok: true,
    status: lic.status,
    name: lic.member?.name,
    skool: lic.member?.skool_username,
    updatesUntil: lic.updates_until,
  };
}

/** Write what the last activation returned into the install's user folder
 * (from memory, or from the shell's encrypted copy after a restart), then drop
 * the shell's copy. */
export async function writeLicense(userDir: string, key: string): Promise<void> {
  lastSigned ??= await loadLicense();
  if (!lastSigned) return;
  const f = path.join(userDir, "data", "license.json");
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(
    f,
    JSON.stringify(
      { key, license: lastSigned.license, signature: lastSigned.signature, checked_at: new Date().toISOString(), error: null },
      null,
      2,
    ),
    { encoding: "utf-8", mode: 0o600 },
  );
  await saveLicense(null).catch(() => undefined);
}
