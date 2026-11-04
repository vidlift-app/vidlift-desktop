// The shell's own small files, in Electron's userData folder (never inside the
// install): shell.json (where VidLift is, how far the wizard got) and
// secret.bin (the GitHub token between wizard steps, encrypted by the OS).

import { app, safeStorage } from "electron";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ShellState } from "../shared/types";

const DEFAULTS: ShellState = {
  installDir: null,
  setupDone: false,
  step: "welcome",
  licenseKey: null,
  githubLogin: null,
  parts: null,
  packs: null,
  voice: null,
  crashReports: true,
  openAtLogin: false,
};

function file(name: string): string {
  return path.join(app.getPath("userData"), name);
}

let cached: ShellState | null = null;

export function load(): ShellState {
  if (cached) return cached;
  try {
    cached = { ...DEFAULTS, ...JSON.parse(readFileSync(file("shell.json"), "utf-8")) };
  } catch {
    cached = { ...DEFAULTS };
  }
  // Before "Set up AI" (2026-10-30) the keys step came after Parts as "keys".
  // "import" was the old-folder step, gone since 2026-10-31.
  if (["keys", "import"].includes(cached!.step as string)) cached!.step = "ai";
  return cached!;
}

export async function save(patch: Partial<ShellState>): Promise<ShellState> {
  const next = { ...load(), ...patch };
  cached = next;
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  const tmp = file(`shell.json.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf-8");
  await fs.rename(tmp, file("shell.json"));
  return next;
}

/** The OS's own encryption on Windows (DPAPI: no prompt). Not on a Mac
 * (2026-10-31): there it is the keychain, and an app without an Apple
 * certificate is a new one to it after every update, so it asked for the
 * login password ("VidLift wants to access key 'VidLift Safe Storage'").
 * The file stays readable by this user only (0600), as the core's own copy
 * of the token (user/data/github.json) is. */
const osCrypt = (): boolean => process.platform !== "darwin" && safeStorage.isEncryptionAvailable();

function seal(text: string): Buffer {
  return osCrypt() ? safeStorage.encryptString(text) : Buffer.from(text, "utf-8");
}

/** The text, or null for what can't be read without a prompt: a file an
 *  earlier build sealed with the Mac keychain ("v10..."), so the member
 *  signs in again instead. */
function unseal(data: Buffer): string | null {
  if (osCrypt()) return safeStorage.decryptString(data);
  if (process.platform === "darwin" && data.subarray(0, 3).toString("latin1") === "v10") return null;
  return data.toString("utf-8");
}

export async function saveToken(token: string | null): Promise<void> {
  if (!token) {
    await fs.rm(file("secret.bin"), { force: true });
    return;
  }
  const data = seal(token);
  await fs.writeFile(file("secret.bin"), data, { mode: 0o600 });
}

export async function loadToken(): Promise<string | null> {
  try {
    const data = await fs.readFile(file("secret.bin"));
    return unseal(data);
  } catch {
    return null;
  }
}

/** The signed licence from activation, kept (OS-encrypted, like the token)
 * until the install writes it into user/data/license.json: a restart between
 * the GitHub step and the install must not lose it. */
export async function saveLicense(signed: { license: string; signature: string } | null): Promise<void> {
  if (!signed) {
    await fs.rm(file("license.bin"), { force: true });
    return;
  }
  const text = JSON.stringify(signed);
  const data = seal(text);
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(file("license.bin"), data, { mode: 0o600 });
}

export async function loadLicense(): Promise<{ license: string; signature: string } | null> {
  try {
    const data = await fs.readFile(file("license.bin"));
    const text = unseal(data);
    if (text === null) return null;
    const v = JSON.parse(text) as { license?: unknown; signature?: unknown };
    return typeof v.license === "string" && typeof v.signature === "string" ? { license: v.license, signature: v.signature } : null;
  } catch {
    return null;
  }
}

/** The API keys typed on "Set up AI", kept like the licence (OS-encrypted on
 * Windows, this user only) until the install writes them into user/.env
 * (2026-11-04: they lived only in the wizard's page, so a wizard closed and
 * reopened, or an install run again, went on with none and Settings › API
 * keys came up empty). Never in shell.json. */
export async function saveKeys(keys: Record<string, string> | null): Promise<void> {
  const kept = Object.fromEntries(Object.entries(keys ?? {}).filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && !!v?.trim()));
  if (!Object.keys(kept).length) {
    await fs.rm(file("keys.bin"), { force: true });
    return;
  }
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(file("keys.bin"), seal(JSON.stringify(kept)), { mode: 0o600 });
}

export async function loadKeys(): Promise<Record<string, string>> {
  try {
    const text = unseal(await fs.readFile(file("keys.bin")));
    if (text === null) return {};
    const v = JSON.parse(text) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

/** Where VidLift goes unless the member picks another folder: the app data
 * folder of this account, which needs no administrator. */
export function defaultInstallDir(): string {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "VidLift");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "VidLift");
  }
  return path.join(os.homedir(), ".local", "share", "vidlift");
}
