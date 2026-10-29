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
import { download, fetchCatalog, latest } from "./catalog";
import { API_PORT, REQUIRED_PARTS, UV_ASSETS, UV_VERSION } from "./constants";
import { writeLicense, machineId } from "./license";
import { describeHardware, type SetupStatus } from "./hardware";
import type { Supervisor } from "./supervisor";
import { voiceDefault } from "./voice";
import type { InstallPlan, InstallProgress } from "../shared/types";

const run = promisify(execFile);

export { describeHardware } from "./hardware";

export const STEPS = ["prepare", "import", "uv", "core", "python", "parts", "packs", "finish"] as const;

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
  private progress: InstallProgress = { step: "prepare", message: "", fraction: null, done: [], log: [], error: null, hardware: null };

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

  async run(plan: InstallPlan): Promise<void> {
    try {
      await this.prepare(plan);
      await this.importOld(plan.oldFolder);
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
    // Who narrates new videos (Settings › Preferences shows and changes it).
    await writeJson(path.join(this.l.user, "data", "voice-default.json"), voiceDefault(plan.voice));
    this.finished("prepare");
  }

  private async whoAmI(): Promise<string | null> {
    const { whoAmI } = await import("./github");
    return whoAmI(this.token);
  }

  /** The member's videos, keys and templates from an old zip install. Copied,
   * never moved: the old folder keeps working until they delete it. The
   * runtime is never carried over -- its venvs hold absolute paths. */
  private async importOld(oldFolder: string | null): Promise<void> {
    if (!oldFolder) {
      this.finished("import");
      return;
    }
    this.begin("import", "Copying your videos, keys and templates");
    const from = path.join(oldFolder, "user");
    await fs.cp(from, this.l.user, {
      recursive: true,
      force: false,
      errorOnExist: false,
      // A copy of the old install's GitHub sign-in would replace this one.
      filter: (src) => !/[\\/]data[\\/](github\.json|license\.json|machine-id|supervisor\.[a-z]+)$/.test(src),
    });
    this.finished("import");
  }

  private async uv(): Promise<void> {
    const uv = uvPath(this.l);
    if (await exists(uv)) {
      this.finished("uv");
      return;
    }
    this.begin("uv", "Downloading the Python installer");
    const asset = UV_ASSETS[`${process.platform}-${process.arch}`];
    if (!asset) throw new Error(`This computer (${process.platform} ${process.arch}) is not supported yet.`);
    const dir = path.dirname(uv);
    await fs.mkdir(dir, { recursive: true });
    const archive = path.join(dir, asset.file);
    await download(
      `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset.file}`,
      null,
      archive,
      asset.sha256,
      (f) => this.report({ fraction: f }),
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
    const catalog = await fetchCatalog(this.token);
    const channel = await readChannel(this.l.user);
    const entry = latest(catalog, channel, "core");
    if (!entry) throw new Error("No VidLift release is published yet.");
    this.report({ message: `Downloading VidLift ${String(entry.release_name ?? entry.version)}` });
    const cache = path.join(this.l.runtime, "cache", "downloads");
    const archive = await download(entry.asset, this.token, path.join(cache, entry.name), entry.sha256, (f) =>
      this.report({ fraction: f }),
    );
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
    await this.supervisor.start(this.log);
    await this.supervisor.waitHealthy(30 * 60_000);
    this.report({ hardware: describeHardware(await getJson<SetupStatus>("/api/setup")) });
    this.finished("python");
  }

  private async parts(chosen: string[]): Promise<void> {
    this.begin("parts", "Installing the parts you picked");
    const wanted = [...new Set([...REQUIRED_PARTS, ...chosen])];
    const status = await getJson<{ components: { id: string; installed: boolean }[] }>("/api/setup");
    const missing = wanted.filter((id) => !status?.components?.find((c) => c.id === id)?.installed);
    if (missing.length) {
      const queued = await postJson<{ queue: { id: string }[] }>("/api/setup/queue", { components: missing });
      if (!queued) throw new Error("VidLift's setup did not accept the install list.");
      await this.follow(missing);
    }
    this.finished("parts");
  }

  /** Poll the setup status until every part is installed or one fails. */
  private async follow(ids: string[]): Promise<void> {
    const started = Date.now();
    let lastLine = "";
    for (;;) {
      await sleep(2000);
      const s = await getJson<{
        components: { id: string; label?: string; installed: boolean; job?: { status?: string; step?: string; progress?: number | null; error?: string | null } | null }[];
      }>("/api/setup");
      if (!s) {
        // A restart in between: the API comes back. Unless boot.py itself ended.
        await this.stillRunning();
        continue;
      }
      const mine = s.components.filter((c) => ids.includes(c.id));
      const done = mine.filter((c) => c.installed).length;
      const busy = mine.find((c) => c.job && c.job.status === "running");
      const failed = mine.find((c) => c.job && c.job.status === "failed");
      if (failed) throw new Error(`${failed.label ?? failed.id}: ${failed.job?.error ?? "install failed"}`);
      const line = busy ? `${busy.label ?? busy.id}: ${busy.job?.step ?? "installing"}` : "";
      if (line && line !== lastLine) {
        this.log(line);
        lastLine = line;
      }
      this.report({
        message: busy ? `${busy.label ?? busy.id} — ${busy.job?.step ?? "installing"}` : `Installed ${done} of ${mine.length}`,
        fraction: mine.length ? (done + (busy?.job?.progress ?? 0)) / mine.length : null,
      });
      if (done === mine.length) return;
      if (Date.now() - started > 4 * 3600_000) throw new Error("The parts took too long to install.");
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
        this.log(`! the ${id} pack could not start; install it later from Settings › Setup`);
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
          this.log(`! the ${id} pack failed (${j.error ?? "unknown"}); install it later from Settings › Setup`);
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
    await this.supervisor.waitHealthy(5 * 60_000);
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
