// The first install, in order: folders, the member's old data, uv, the core
// release, Python and its packages (tools/boot.py), then the parts and media
// packs the member picked, through the core's own setup API.
//
//   <install>/app      the core release; replaced by updates
//   <install>/runtime  uv, Python, venvs, Node, FFmpeg; rebuilt from app/
//   <install>/user     keys, projects, videos, templates; never touched

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import extract from "extract-zip";
import { download, fetchCatalog, latest, NoAccess } from "./catalog";
import { API_PORT, REQUIRED_PARTS, UV_ASSETS, UV_VERSION } from "./constants";
import { writeLicense, machineId } from "./license";
import { saveKeys } from "./state";
import { describeHardware, type SetupStatus } from "./hardware";
import type { Supervisor } from "./supervisor";
import { voiceDefault } from "./voice";
import type { InstallPlan, InstallProgress } from "../shared/types";

const run = promisify(execFile);

/** A problem that trying again cannot fix (no access, an unsupported computer). */
class Final extends Error {}

interface PartRow {
  id: string;
  label?: string;
  installed: boolean;
  needs?: string[];
  error?: string | null;
  job?: { status?: string; step?: string; progress?: number | null; error?: string | null } | null;
}

export { describeHardware } from "./hardware";

export const STEPS = ["prepare", "uv", "core", "python", "parts", "packs", "finish"] as const;

export interface Layout {
  install: string;
  app: string;
  runtime: string;
  user: string;
}

export function layout(install: string): Layout {
  return { install, app: path.join(install, "app"), runtime: path.join(install, "runtime"), user: path.join(install, "user") };
}

export function uvPath(l: Layout): string {
  return path.join(l.runtime, "uv", process.platform === "win32" ? "uv.exe" : "uv");
}

type Report = (p: Partial<InstallProgress>) => void;

export class Installer {
  private progress: InstallProgress = {
    step: "prepare",
    message: "",
    fraction: null,
    done: [],
    log: [],
    error: null,
    hardware: null,
    notes: [],
  };

  constructor(
    private readonly l: Layout,
    private readonly token: string,
    private readonly licenseKey: string,
    private readonly supervisor: Supervisor,
    private readonly emit: (p: InstallProgress) => void,
  ) {}

  private report: Report = (p) => {
    this.progress = { ...this.progress, ...p };
    this.emit(this.progress);
  };

  log = (line: string): void => {
    const lines = line.split(/\r?\n/).filter((s) => s.trim());
    if (!lines.length) return;
    this.progress.log = [...this.progress.log, ...lines].slice(-200);
    this.emit(this.progress);
  };

  private begin(step: string, message: string): void {
    this.report({ step, message, fraction: null });
  }

  private finished(step: string): void {
    this.report({ done: [...this.progress.done, step] });
  }

  /** Something left for later, shown on the install page at once. */
  private note(line: string): void {
    this.log(`! ${line}`);
    this.report({ notes: [...this.progress.notes, line] });
  }

  /** Nothing in the install just fails (2026-10-30, the owner: "if anything
   * goes wrong, just report it live in the installer"): a step that goes
   * wrong says why on the page and is tried again, counting down. Only what
   * trying again cannot fix (Final, no access) ends the install. */
  private async again<T>(what: string, fn: () => Promise<T>, tries = 6): Promise<T> {
    for (let n = 1; ; n++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof Final || e instanceof NoAccess || n >= tries) throw e;
        await this.wait(`${what}: ${e instanceof Error ? e.message : String(e)}`, Math.min(60, 5 * 2 ** (n - 1)), n);
      }
    }
  }

  /** "<why>. Trying again in 20 s (attempt 2)", counting down on the page. */
  private async wait(why: string, seconds: number, attempt: number): Promise<void> {
    this.log(`! ${why}`);
    for (let s = seconds; s > 0; s--) {
      this.report({ message: `${why}. Trying again in ${s} s (attempt ${attempt + 1})`, fraction: null });
      await sleep(1000);
    }
    this.report({ message: "Trying again" });
  }

  async run(plan: InstallPlan): Promise<void> {
    try {
      await this.prepare(plan);
      await this.uv();
      await this.core();
      await this.python();
      await this.parts(plan.parts);
      await this.packs(plan.packs);
      this.begin("finish", "Finishing");
      await this.restartServices();
      this.finished("finish");
      this.report({ message: "VidLift is installed." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`x ${msg}`);
      this.report({ error: msg });
      throw e;
    }
  }

  private async prepare(plan: InstallPlan): Promise<void> {
    this.begin("prepare", "Making VidLift's folders");
    for (const d of [this.l.install, this.l.runtime, path.join(this.l.user, "data")]) {
      await fs.mkdir(d, { recursive: true });
    }
    // The same token file the core's updater reads (apps/worker/updates.py).
    const login = (await this.whoAmI()) ?? null;
    await writeJson(path.join(this.l.user, "data", "github.json"), { token: this.token, login }, 0o600);
    if (Object.keys(plan.keys).length) await mergeEnv(path.join(this.l.user, ".env"), plan.keys);
    // In the install's own .env now: the shell's copy goes.
    await saveKeys(null).catch(() => undefined);
    // Who narrates new videos (Settings › Preferences shows and changes it).
    await writeJson(path.join(this.l.user, "data", "voice-default.json"), voiceDefault(plan.voice));
    this.finished("prepare");
  }

  private async whoAmI(): Promise<string | null> {
    const { whoAmI } = await import("./github");
    return whoAmI(this.token);
  }

  private async uv(): Promise<void> {
    const uv = uvPath(this.l);
    if (await exists(uv)) {
      this.finished("uv");
      return;
    }
    this.begin("uv", "Downloading the Python installer");
    const asset = UV_ASSETS[`${process.platform}-${process.arch}`];
    if (!asset) throw new Final(`This computer (${process.platform} ${process.arch}) is not supported yet.`);
    const dir = path.dirname(uv);
    await fs.mkdir(dir, { recursive: true });
    const archive = path.join(dir, asset.file);
    await this.again("Downloading the Python installer", () =>
      download(
        `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset.file}`,
        null,
        archive,
        asset.sha256,
        (f) => this.report({ fraction: f }),
      ),
    );
    if (asset.file.endsWith(".zip")) {
      await extract(archive, { dir: dir });
    } else {
      await run("tar", ["-xzf", archive, "-C", dir, "--strip-components", "1"]);
    }
    await fs.rm(archive, { force: true });
    if (process.platform !== "win32") await fs.chmod(uv, 0o755);
    this.finished("uv");
  }

  private async core(): Promise<void> {
    if (await exists(path.join(this.l.app, "tools", "boot.py"))) {
      this.finished("core");
      return;
    }
    this.begin("core", "Reading the release list");
    const catalog = await this.again("Reading the release list", () => fetchCatalog(this.token));
    const channel = await readChannel(this.l.user);
    const entry = latest(catalog, channel, "core");
    if (!entry) throw new Final("No VidLift release is published yet.");
    const name = `VidLift ${String(entry.release_name ?? entry.version)}`;
    const cache = path.join(this.l.runtime, "cache", "downloads");
    const archive = await this.again(`Downloading ${name}`, () => {
      this.report({ message: `Downloading ${name}`, fraction: null });
      return download(entry.asset, this.token, path.join(cache, entry.name), entry.sha256, (f) => this.report({ fraction: f }));
    });
    this.report({ message: "Unpacking", fraction: null });
    const tmp = path.join(this.l.install, `.unpack-${process.pid}`);
    await fs.rm(tmp, { recursive: true, force: true });
    await extract(archive, { dir: tmp });
    // core-<ver>.zip holds app/...: move that folder into place whole.
    const inner = (await exists(path.join(tmp, "app"))) ? path.join(tmp, "app") : tmp;
    await fs.rm(this.l.app, { recursive: true, force: true });
    await fs.rename(inner, this.l.app);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(archive, { force: true });
    this.finished("core");
  }

  /** tools/boot.py makes the core venv on its first start and then runs the
   * supervisor; the wizard waits for the API to answer. */
  private async python(): Promise<void> {
    this.begin("python", "Installing VidLift's Python (a few minutes the first time)");
    await writeLicense(this.l.user, this.licenseKey);
    await machineId(this.l.user);
    // Another VidLift on the port says so on the page and is waited out.
    await this.again("Starting VidLift", () => this.supervisor.start(this.log), 12);
    await this.supervisor.waitHealthy(30 * 60_000);
    // The licence, when the shell no longer had the server's signed answer
    // (it was lost with the shell's copy): the install asks for it itself.
    if (this.licenseKey && !(await exists(path.join(this.l.user, "data", "license.json")))) {
      const r = await postJson<{ state?: string }>("/api/license/activate", { key: this.licenseKey });
      this.log(r ? `licence activated by the install (${r.state ?? "?"})` : "! the install could not activate the licence");
    }
    this.report({ hardware: describeHardware(await getJson<SetupStatus>("/api/setup")) });
    this.finished("python");
  }

  /** The parts, through the core's install queue. A part that goes wrong is
   * tried again, saying why on the page; one VidLift needs (FFmpeg, Node,
   * the graphics, the renderer) until it is in, an optional one three times,
   * then it is left for Settings › Setup and the rest carry on. */
  private async parts(chosen: string[]): Promise<void> {
    this.begin("parts", "Installing the parts you picked");
    const wanted = [...new Set([...REQUIRED_PARTS, ...chosen])];
    const skipped = new Set<string>();
    const tries = new Map<string, number>();
    for (;;) {
      const status = await getJson<{ components?: PartRow[] }>("/api/setup");
      if (!status?.components) {
        await this.stillRunning();
        await sleep(2000);
        continue;
      }
      const rows = status.components;
      const isIn = (id: string) => !!rows.find((c) => c.id === id)?.installed;
      const missing = withNeeds(wanted, rows).filter((id) => !skipped.has(id) && !isIn(id));
      if (!missing.length) break;
      // Only the parts whose needs are in, a round at a time: core
      // 2026.10.27.3 queues in its own order, which put the renderer
      // packages before the graphics they need, and stopped there with no
      // word (Windows, 2026-10-30).
      const ready = missing.filter((id) => (rows.find((c) => c.id === id)?.needs ?? []).every(isIn));
      if (!ready.length) {
        for (const id of missing) {
          skipped.add(id);
          const label = rows.find((c) => c.id === id)?.label ?? id;
          this.note(`${label} was not installed: a part it needs is missing. Install it later from Settings › Setup.`);
        }
        break;
      }
      const queued = await postJson<{ queue: string[] }>("/api/setup/queue", { components: ready });
      const stop = queued
        ? await this.follow(ready, withNeeds(wanted, rows).filter((id) => !skipped.has(id)))
        : { id: ready[0], label: rows.find((c) => c.id === ready[0])?.label ?? ready[0], why: "VidLift's setup did not take the list" };
      if (!stop) continue;
      const n = (tries.get(stop.id) ?? 0) + 1;
      tries.set(stop.id, n);
      if (!needed(rows).has(stop.id) && n >= 3) {
        for (const id of [stop.id, ...needing(stop.id, rows)]) {
          if (!skipped.has(id) && wanted.includes(id)) {
            skipped.add(id);
            const label = rows.find((c) => c.id === id)?.label ?? id;
            this.note(
              id === stop.id
                ? `${label} was not installed (${stop.why}). Install it later from Settings › Setup.`
                : `${label} was not installed: it needs ${stop.label}. Install it later from Settings › Setup.`,
            );
          }
        }
        continue;
      }
      await this.wait(`${stop.label}: ${stop.why}`, Math.min(120, 10 * 2 ** Math.min(n - 1, 4)), n);
    }
    this.finished("parts");
  }

  /** Follow the queue until every part in `ids` is in (null), or one stops:
   * its error (core 2026.10.30 on), or on older cores an emptied queue with
   * nothing running and parts left (the Mac's "Installed 0 of 10",
   * 2026-10-30: a part's job leaves the status the moment it ends). */
  private async follow(ids: string[], all: string[] = ids): Promise<{ id: string; label: string; why: string } | null> {
    let lastLine = "";
    let idle = 0;
    for (;;) {
      await sleep(2000);
      const s = await getJson<{ queue?: string[]; components: PartRow[] }>("/api/setup");
      if (!s?.components) {
        // A restart in between: the API comes back. Unless boot.py itself ended.
        await this.stillRunning();
        continue;
      }
      const queue = s.queue ?? [];
      const mine = s.components.filter((c) => ids.includes(c.id));
      const done = mine.filter((c) => c.installed).length;
      if (done === mine.length) return null;
      const busy = mine.find((c) => c.job?.status === "running");
      const left = mine.filter((c) => !c.installed);
      const failed = left.find(
        (c) => c.job?.status !== "running" && !queue.includes(c.id) && (c.error || c.job?.status === "failed"),
      );
      idle = !busy && !queue.length ? idle + 1 : 0;
      if (failed || idle >= 3) {
        const w = failed ?? left[0];
        return { id: w.id, label: w.label ?? w.id, why: failed?.error ?? failed?.job?.error ?? "it stopped without saying why" };
      }
      const line = busy ? `${busy.label ?? busy.id}: ${busy.job?.step ?? "installing"}` : "";
      if (line && line !== lastLine) {
        this.log(line);
        lastLine = line;
      }
      // Counted over every part the member gets, not only this round's.
      const every = s.components.filter((c) => all.includes(c.id));
      const doneAll = every.filter((c) => c.installed).length;
      this.report({
        message: busy ? `${busy.label ?? busy.id} — ${busy.job?.step ?? "installing"}` : `Installed ${doneAll} of ${every.length}`,
        fraction: every.length ? (doneAll + (busy?.job?.progress ?? 0)) / every.length : null,
      });
    }
  }

  private async packs(ids: string[]): Promise<void> {
    if (!ids.length) {
      this.finished("packs");
      return;
    }
    this.begin("packs", "Downloading the media packs");
    for (const id of ids) {
      const job = await postJson<{ id: string }>(`/api/setup/assets/${id}`, {});
      if (!job?.id) {
        this.note(`The ${id} pack could not start. Install it later from Settings › Setup.`);
        continue;
      }
      for (;;) {
        await sleep(2000);
        const j = await getJson<{ status: string; step?: string; progress?: number | null; error?: string | null }>(`/api/setup/jobs/${job.id}`);
        if (!j) {
          await this.stillRunning();
          continue;
        }
        this.report({ message: `${id[0].toUpperCase()}${id.slice(1)} pack — ${j.step ?? ""}`, fraction: j.progress ?? null });
        if (j.status === "done") break;
        if (j.status === "failed") {
          this.note(`The ${id} pack was not installed (${j.error ?? "no reason given"}). Install it later from Settings › Setup.`);
          break;
        }
      }
    }
    this.finished("packs");
  }

  /** Throws when VidLift's Python side has ended and stays down for a minute,
   * so the install stops with a reason instead of waiting for hours. */
  private silentSince: number | null = null;
  private async stillRunning(): Promise<void> {
    if (this.supervisor.running || (await getJson("/api/health")) !== null) {
      this.silentSince = null;
      return;
    }
    this.silentSince ??= Date.now();
    if (Date.now() - this.silentSince > 60_000) {
      const last = this.supervisor.lastLines().slice(-6).join("\n");
      throw new Error(`VidLift stopped while installing.${last ? `\n${last}` : ""}`);
    }
  }

  /** New tools (Node, FFmpeg) are picked up by restarting the services, as the
   * setup page does after an install. */
  private async restartServices(): Promise<void> {
    await postJson("/api/setup/restart", {});
    await sleep(3000);
    // Fifteen minutes: the first start after the AI pack loads files the
    // antivirus has not seen, and five stopped a slow PC's install with "took
    // too long to start" and nothing else wrong (2026-11-03).
    await this.supervisor.waitHealthy(15 * 60_000);
  }
}

// --- small helpers -------------------------------------------------------------

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(file: string, data: unknown, mode?: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data), { encoding: "utf-8", mode });
}

/** Add keys to the member's .env without touching the lines already there. */
async function mergeEnv(file: string, keys: Record<string, string>): Promise<void> {
  let text = "";
  try {
    text = await fs.readFile(file, "utf-8");
  } catch {
    /* new file */
  }
  const lines = text.split(/\r?\n/);
  for (const [k, v] of Object.entries(keys)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k) || !v.trim()) continue;
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    const line = `${k}=${v.trim()}`;
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  await fs.writeFile(file, lines.filter((l, i) => l || i < lines.length - 1).join("\n") + "\n", { encoding: "utf-8", mode: 0o600 });
}

async function readChannel(userDir: string): Promise<string> {
  try {
    const c = JSON.parse(await fs.readFile(path.join(userDir, "data", "update-channel.json"), "utf-8"));
    return c.channel === "beta" ? "beta" : "stable";
  } catch {
    return "stable";
  }
}

export async function getJson<T>(route: string): Promise<T | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${API_PORT}${route}`, { signal: AbortSignal.timeout(15_000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function postJson<T>(route: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${API_PORT}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function sha256Text(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** `ids` and every part they need, directly or through another. */
function withNeeds(ids: string[], rows: PartRow[]): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (out.includes(id)) return;
    out.push(id);
    for (const n of rows.find((c) => c.id === id)?.needs ?? []) add(n);
  };
  ids.forEach(add);
  return out;
}

/** The parts VidLift cannot run without, with all they need. */
function needed(rows: PartRow[]): Set<string> {
  const out = new Set<string>();
  const add = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const n of rows.find((c) => c.id === id)?.needs ?? []) add(n);
  };
  REQUIRED_PARTS.forEach(add);
  return out;
}

/** The parts that need `id`, directly or through another. */
function needing(id: string, rows: PartRow[]): string[] {
  const out: string[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of rows) {
      if (out.includes(c.id) || c.id === id) continue;
      if ((c.needs ?? []).some((n) => n === id || out.includes(n))) {
        out.push(c.id);
        grew = true;
      }
    }
  }
  return out;
}
