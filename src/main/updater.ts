// The desktop app updates itself. The signed catalog (tools/release.py
// `publish desktop`) lists each channel's installers under its own top-level
// key, which members' cores ignore:
//
//   catalog.desktop = { stable: Entry, beta: Entry }
//   Entry = { version, published, notes, assets: { win: Asset, mac: Asset } }
//   Asset = { name, url, sha256, size }   (public github.com links)
//
// 60 s after the dashboard first shows, then once a day, the app reads the
// catalog (verified with the release key, as the core's updater does) and
// downloads a newer installer for this platform, checking its SHA-256. It is
// put in place only when the member quits, after VidLift's Python side has
// stopped, so no video is ever cut short:
//   Windows: the NSIS installer runs silently (/S --force-run) and starts the
//            new app when it is done.
//   Mac:     the .dmg is mounted, its VidLift.app copied (ditto) beside the
//            running bundle and swapped in, and the new app opened. Any
//            failure keeps the old app.
//
// No Electron import here: main.ts passes in what it needs, so the choices
// below are tested with plain node (updater.test.ts).

import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { type Catalog, download, fetchCatalog } from "./catalog";
import { API_PORT } from "./constants";

const run = promisify(execFile);

export interface DesktopAsset {
  name: string;
  url: string;
  sha256: string;
  size?: number;
}

export interface DesktopEntry {
  version: string;
  published?: string;
  notes?: string;
  assets: Partial<Record<"win" | "mac", DesktopAsset>>;
}

export type Channel = "stable" | "beta";

// --- the choices (pure) -------------------------------------------------------------

/** "1.2.3" (a leading "v" and a "-beta.1" / "+build" tail allowed) as numbers
 * and its pre-release tag; null when it is not a version. */
export function parseSemver(v: string): { nums: [number, number, number]; pre: string } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v ?? "").trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" };
}

/** Whether version `a` is newer than `b`. A release is newer than its own
 * pre-releases (1.2.0 > 1.2.0-beta.1); anything unreadable is never newer. */
export function semverNewer(a: string, b: string): boolean {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i];
  }
  if (x.pre === y.pre) return false;
  if (!x.pre) return true;
  if (!y.pre) return false;
  return x.pre.localeCompare(y.pre, "en", { numeric: true }) > 0;
}

function isEntry(e: unknown): e is DesktopEntry {
  const o = e as DesktopEntry | null;
  return !!o && typeof o === "object" && typeof o.version === "string" && !!parseSemver(o.version) && !!o.assets && typeof o.assets === "object";
}

/** The entry a channel offers: Stable's on Stable; on Beta whichever of
 * Beta's and Stable's is newer (as the core's updates.latest). */
export function pickDesktop(catalog: Catalog | Record<string, unknown>, channel: string): DesktopEntry | null {
  const desk = (catalog as { desktop?: Record<string, unknown> }).desktop;
  if (!desk || typeof desk !== "object") return null;
  const stable = isEntry(desk.stable) ? desk.stable : null;
  if (channel !== "beta") return stable;
  const beta = isEntry(desk.beta) ? desk.beta : null;
  if (beta && (!stable || semverNewer(beta.version, stable.version))) return beta;
  return stable;
}

/** This platform's key in an entry's assets. */
export function platformKey(platform: NodeJS.Platform = process.platform): "win" | "mac" | null {
  if (platform === "win32") return "win";
  if (platform === "darwin") return "mac";
  return null;
}

/** The asset to install, when the channel offers something newer than `current`. */
export function choose(
  catalog: Catalog | Record<string, unknown>,
  channel: string,
  current: string,
  platform: NodeJS.Platform = process.platform,
): { version: string; asset: DesktopAsset } | null {
  const entry = pickDesktop(catalog, channel);
  const key = platformKey(platform);
  if (!entry || !key || !semverNewer(entry.version, current)) return null;
  const asset = entry.assets[key];
  if (!asset || typeof asset.url !== "string" || !/^[0-9a-f]{64}$/i.test(String(asset.sha256 ?? ""))) return null;
  return { version: entry.version, asset };
}

/** The member's channel: user/data/update-channel.json (Settings › Updates),
 * the retired "fixes" reading as Stable, anything else Stable. */
export function readChannel(installDir: string): Channel {
  try {
    const raw = JSON.parse(readFileSync(path.join(installDir, "user", "data", "update-channel.json"), "utf-8")) as { channel?: string };
    return raw?.channel === "beta" ? "beta" : "stable";
  } catch {
    return "stable";
  }
}

/** The GitHub token the core keeps (user/data/github.json). */
export function readToken(installDir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(installDir, "user", "data", "github.json"), "utf-8")) as { token?: string };
    return typeof raw?.token === "string" && raw.token ? raw.token : null;
  } catch {
    return null;
  }
}

/** Updates are paused by the licence (`GET /api/license` -> paused: true).
 * The route missing, or any error, does not pause them. */
export async function updatesPaused(port = API_PORT): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/license`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { paused?: unknown };
    return j?.paused === true;
  } catch {
    return false;
  }
}

async function fileSha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

// --- the updater ------------------------------------------------------------------

export interface UpdaterOptions {
  /** The running app's version (app.getVersion()). */
  version: string;
  /** Where downloads go: <userData>/updates. */
  dir: string;
  /** The install folder (user/data/...), or null before setup. */
  installDir: () => string | null;
  /** The running executable (app.getPath("exe")). */
  exePath: string;
  /** A token when github.json has none (the shell's own sign-in). */
  fallbackToken?: () => Promise<string | null>;
  log: (text: string) => void;
  platform?: NodeJS.Platform;
}

interface Pending {
  version: string;
  file: string;
  sha256: string;
}

export const FIRST_CHECK_MS = 60_000;
export const CHECK_EVERY_MS = 24 * 60 * 60_000;

export class ShellUpdater {
  private pending: Pending | null = null;
  private busy = false;
  private started = false;
  private timers: NodeJS.Timeout[] = [];
  private readonly platform: NodeJS.Platform;

  constructor(private readonly o: UpdaterOptions) {
    this.platform = o.platform ?? process.platform;
  }

  private log(text: string): void {
    this.o.log(`updater: ${text}`);
  }

  private get marker(): string {
    return path.join(this.o.dir, "pending.json");
  }

  /** The dashboard has loaded: the first check in 60 s, then once a day. Only once. */
  dashboardLoaded(): void {
    if (this.started) return;
    this.started = true;
    void this.restore();
    const first = setTimeout(() => {
      void this.check();
      const every = setInterval(() => void this.check(), CHECK_EVERY_MS);
      every.unref?.();
      this.timers.push(every);
    }, FIRST_CHECK_MS);
    first.unref?.();
    this.timers.push(first);
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** An installer downloaded in an earlier session and not yet put in place;
   * older ones (already installed) are removed. */
  private async restore(): Promise<void> {
    try {
      const p = JSON.parse(await fs.readFile(this.marker, "utf-8")) as Pending;
      if (p?.version && semverNewer(p.version, this.o.version) && (await fileSha256(p.file)) === p.sha256.toLowerCase()) {
        this.pending ??= p;
        this.log(`${p.version} is downloaded and goes in when VidLift quits`);
        return;
      }
    } catch {
      /* none */
    }
    await this.clear();
  }

  private async clear(keep?: string): Promise<void> {
    try {
      for (const name of await fs.readdir(this.o.dir)) {
        const f = path.join(this.o.dir, name);
        if (keep && f === keep) continue;
        if (name.startsWith("mnt-")) continue; // a mount point, never deleted while mounted
        await fs.rm(f, { force: true, recursive: true }).catch(() => undefined);
      }
    } catch {
      /* no folder yet */
    }
  }

  /** One check: read the catalog, download a newer installer. Never throws;
   * never two at a time. */
  async check(): Promise<void> {
    if (this.busy) {
      this.log("a check is already running");
      return;
    }
    this.busy = true;
    try {
      await this.checkOnce();
    } catch (e) {
      this.log(`check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busy = false;
    }
  }

  private async checkOnce(): Promise<void> {
    const install = this.o.installDir();
    if (!install) return this.log("no install yet; skipped");
    if (!platformKey(this.platform)) return this.log(`no installer for ${this.platform}; skipped`);
    if (await updatesPaused()) return this.log("updates are paused by the licence; skipped");
    const token = readToken(install) ?? (await this.o.fallbackToken?.()) ?? null;
    if (!token) return this.log("not signed in to GitHub; skipped");
    const channel = readChannel(install);
    this.log(`checking (${channel}, running ${this.o.version})`);
    const catalog = await fetchCatalog(token);
    const got = choose(catalog, channel, this.o.version, this.platform);
    if (!got) return this.log(`up to date (${pickDesktop(catalog, channel)?.version ?? "no desktop entry"} on ${channel})`);
    if (this.pending && !semverNewer(got.version, this.pending.version)) {
      return this.log(`${this.pending.version} is already downloaded`);
    }
    const file = path.join(this.o.dir, `${got.version}-${path.basename(got.asset.name || got.asset.url)}`);
    this.log(`downloading ${got.version}: ${got.asset.url}`);
    // Public links: no token (it would only be dropped at GitHub's redirect).
    await download(got.asset.url, null, file, got.asset.sha256);
    const p: Pending = { version: got.version, file, sha256: got.asset.sha256.toLowerCase() };
    await this.clear(file); // an older download, the old marker
    await fs.writeFile(this.marker, JSON.stringify(p, null, 2), "utf-8");
    this.pending = p;
    this.log(`${got.version} downloaded (sha256 checked); it goes in when VidLift quits`);
  }

  get pendingVersion(): string | null {
    return this.pending?.version ?? null;
  }

  /** At quit, after VidLift's Python side has stopped: start putting the
   * downloaded version in place. True when it has been handed over (the app
   * must exit now); false when there was nothing to do or it failed (the old
   * app stays, and the reason is logged). */
  async applyAtQuit(): Promise<boolean> {
    const p = this.pending;
    if (!p) return false;
    if (this.busy) {
      this.log("a download is still running; the update waits for the next quit");
      return false;
    }
    try {
      if ((await fileSha256(p.file)) !== p.sha256) throw new Error(`${path.basename(p.file)} changed on disk; not run`);
      this.log(`putting ${p.version} in place`);
      if (this.platform === "win32") return this.applyWindows(p);
      if (this.platform === "darwin") return await this.applyMac(p);
      return false;
    } catch (e) {
      this.log(`update to ${p.version} not applied, the old app stays: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private applyWindows(p: Pending): boolean {
    const child = spawn(p.file, ["/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", (e) => this.log(`installer did not start: ${e.message}`));
    child.unref();
    this.log(`started ${path.basename(p.file)} /S --force-run`);
    return true;
  }

  private async applyMac(p: Pending): Promise<boolean> {
    // .../VidLift.app/Contents/MacOS/VidLift -> .../VidLift.app
    const bundle = path.resolve(this.o.exePath, "../../..");
    if (!bundle.endsWith(".app")) throw new Error(`not running from an app bundle (${bundle})`);
    const mnt = path.join(this.o.dir, `mnt-${process.pid}`);
    const fresh = `${bundle}.new-${process.pid}`;
    const old = `${bundle}.old-${process.pid}`;
    await fs.mkdir(mnt, { recursive: true });
    let mounted = false;
    let swapped = false;
    try {
      await run("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mnt, p.file]);
      mounted = true;
      const apps = (await fs.readdir(mnt)).filter((n) => n.endsWith(".app"));
      const src = apps.includes("VidLift.app") ? "VidLift.app" : apps[0];
      if (!src) throw new Error("the disk image has no app in it");
      await fs.rm(fresh, { recursive: true, force: true });
      await run("ditto", [path.join(mnt, src), fresh]);
      // The swap: the old bundle is kept until the new one is in place.
      await fs.rename(bundle, old);
      try {
        await fs.rename(fresh, bundle);
        swapped = true;
      } catch (e) {
        await fs.rename(old, bundle);
        throw e;
      }
      this.log(`${src} ${p.version} copied over ${bundle}`);
    } finally {
      if (mounted) await run("hdiutil", ["detach", mnt, "-force"]).catch((e) => this.log(`detach: ${String(e)}`));
      await fs.rm(mnt, { recursive: true, force: true }).catch(() => undefined);
      if (!swapped) await fs.rm(fresh, { recursive: true, force: true }).catch(() => undefined);
    }
    await fs.rm(old, { recursive: true, force: true }).catch((e) => this.log(`old bundle left at ${old}: ${String(e)}`));
    await fs.rm(p.file, { force: true }).catch(() => undefined);
    await fs.rm(this.marker, { force: true }).catch(() => undefined);
    // After this app has exited (its single-instance lock released).
    const child = spawn("/bin/sh", ["-c", 'sleep 2; open -n "$0"', bundle], { detached: true, stdio: "ignore" });
    child.unref();
    this.log(`opening the new app (${bundle})`);
    return true;
  }
}
