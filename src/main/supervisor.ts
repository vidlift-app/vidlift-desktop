// Starts and stops VidLift's Python side. The shell runs `tools/boot.py` the
// way the old Start files did (uv's own Python 3.12), with --no-open: boot.py
// keeps the core venv in step, applies staged updates and runs the supervisor
// (tools/vidlift.py) in a loop; this app only owns the window and the tray.

import { app } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import { createWriteStream, promises as fs, WriteStream } from "node:fs";
import path from "node:path";
import { API_PORT, UI_PORT } from "./constants";
import { exists, layout, Layout, sleep, uvPath } from "./bootstrap";

export async function healthy(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

export const apiHealthy = (): Promise<boolean> => healthy(`http://127.0.0.1:${API_PORT}/api/health`);

/** Whether VidLift answers at this address, not merely something. :5173 is
 * Vite's default, so a member's own web project opened in VidLift's window
 * (2026-11-03). Only VidLift's health route, through the dashboard's proxy,
 * says where its data is; a site's catch-all page answers with HTML. */
export async function isVidlift(base: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await r.json()) as { data_dir?: unknown };
    return r.ok && typeof body.data_dir === "string";
  } catch {
    return false;
  }
}

/** The user folder of the VidLift answering at `base` (its /api/setup), or
 * null when nothing answers or it does not say (an older core). */
export async function userDirAt(base: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const r = await fetch(`${base}/api/setup`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const v = (await r.json()) as { user_dir?: unknown };
    return typeof v.user_dir === "string" && v.user_dir ? v.user_dir : null;
  } catch {
    return null;
  }
}

/** Two folders the same, as Windows and a Mac compare names (any case). */
export function sameDir(a: string, b: string, platform: string = process.platform): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p).replace(/[\\/]+$/, "");
    return platform === "linux" ? r : r.toLowerCase();
  };
  return norm(a) === norm(b);
}

/** Another VidLift holds the port: an older install left running in the
 * background, or a developer's copy (2026-11-04). Taking it for this one sent
 * the install's parts to it and opened its dashboard, whose settings have
 * none of what the wizard just saved here. */
export class OtherVidLift extends Error {
  constructor(public readonly userDir: string) {
    // An install's user folder is <install>/user; a developer's copy is itself.
    const where = path.basename(userDir).toLowerCase() === "user" ? path.dirname(userDir) : userDir;
    super(
      `Another VidLift is already running, from ${where}. ` +
        "Quit it from its icon by the clock (on a Mac, in the menu bar), and this one starts.",
    );
  }
}

/** The dashboard's address: vite on :5173 when VidLift's own runs there
 * (members' installs run `vite preview`), else the API serves the built
 * dashboard itself. Same as tools/vidlift.py's `url`. */
export async function dashboardUrl(): Promise<string> {
  if (await isVidlift(`http://127.0.0.1:${UI_PORT}`)) return `http://localhost:${UI_PORT}/?window=app&shell=electron`;
  return `http://127.0.0.1:${API_PORT}/?window=app&shell=electron`;
}

export class Supervisor {
  private child: ChildProcess | null = null;
  private logFile: WriteStream | null = null;
  private stopping = false;
  /** Called when boot.py ends without being asked to (a crash, a failed start). */
  onUnexpectedExit: ((code: number | null, tail: string[]) => void) | null = null;
  private tail: string[] = [];

  constructor(private readonly l: Layout) {}

  static at(installDir: string): Supervisor {
    return new Supervisor(layout(installDir));
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /** Put back the previous version when an update stopped half way and left
   * no app folder (as the Start files did). */
  private async restoreInterrupted(): Promise<void> {
    if (await exists(path.join(this.l.app, "tools", "boot.py"))) return;
    const backups = path.join(this.l.install, "backups");
    let names: string[] = [];
    try {
      names = (await fs.readdir(backups)).filter((n) => n.startsWith("core-")).sort().reverse();
    } catch {
      return;
    }
    for (const n of names) {
      const d = path.join(backups, n);
      if (await exists(path.join(d, "tools", "boot.py"))) {
        if (await exists(this.l.app)) await fs.rename(this.l.app, path.join(backups, `app-broken-${process.pid}`));
        await fs.rename(d, this.l.app);
        return;
      }
    }
  }

  async start(log?: (line: string) => void): Promise<void> {
    if (this.running) return;
    if (await apiHealthy()) {
      // Already up: a previous shell left it running, if it is this install.
      const theirs = await userDirAt(`http://127.0.0.1:${API_PORT}`);
      if (theirs && !sameDir(theirs, this.l.user)) throw new OtherVidLift(theirs);
      return;
    }
    await this.restoreInterrupted();
    const runtime = this.l.runtime;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VIDLIFT_SHELL: "electron",
      VIDLIFT_SHELL_VERSION: app.getVersion(), // Settings › Updates shows it
      UV_PYTHON_INSTALL_DIR: path.join(runtime, "python"),
      UV_CACHE_DIR: path.join(runtime, "cache", "uv"),
      UV_PYTHON_PREFERENCE: "only-managed",
      PYTHONUTF8: "1",
      PYTHONUNBUFFERED: "1",
    };
    // Electron's own variable would make every Python-started Node act as Electron.
    delete env.ELECTRON_RUN_AS_NODE;
    const logs = path.join(this.l.user, "data", "logs");
    await fs.mkdir(logs, { recursive: true });
    this.logFile = createWriteStream(path.join(logs, "shell.log"), { flags: "a" });
    this.logFile.write(`--- VidLift starting from the app, ${new Date().toISOString()} ---\n`);
    this.stopping = false;
    this.tail = [];
    const child = spawn(
      uvPath(this.l),
      ["run", "--no-project", "--python", "3.12", path.join(this.l.app, "tools", "boot.py"), "--no-open"],
      { cwd: this.l.install, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child = child;
    const onData = (buf: Buffer) => {
      const text = buf.toString("utf-8");
      this.logFile?.write(text);
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.tail = [...this.tail, line].slice(-80);
        log?.(line.replace(/\x1b\[[0-9;]*m/g, ""));
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      this.logFile?.write(`--- boot.py ended (code ${code}) ---\n`);
      this.logFile?.end();
      this.logFile = null;
      this.child = null;
      if (!this.stopping) this.onUnexpectedExit?.(code, this.tail);
    });
  }

  lastLines(): string[] {
    return [...this.tail];
  }

  async waitHealthy(timeoutMs: number): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await apiHealthy()) return;
      if (!this.running && !(await apiHealthy())) {
        // boot.py ended before VidLift answered: say why.
        const last = this.tail.slice(-6).join("\n");
        throw new Error(`VidLift stopped while starting.\n${last}`);
      }
      await sleep(1500);
    }
    throw new Error("VidLift took too long to start.");
  }

  /** Ask VidLift to stop (a video being made pauses and carries on at the next
   * start), then wait for boot.py to end; end it if it will not. */
  async stop(timeoutMs = 45_000): Promise<void> {
    this.stopping = true;
    try {
      await fetch(`http://127.0.0.1:${API_PORT}/api/desktop/quit`, { method: "POST", signal: AbortSignal.timeout(5000) });
    } catch {
      /* not answering: fall through to the stop file */
    }
    // The supervisor also watches this file (tools/vidlift.py STOP_REQUEST).
    await fs.mkdir(path.join(this.l.user, "data"), { recursive: true }).catch(() => undefined);
    await fs.writeFile(path.join(this.l.user, "data", "supervisor.stop"), "stop", "utf-8").catch(() => undefined);
    const until = Date.now() + timeoutMs;
    while (this.running && Date.now() < until) await sleep(500);
    if (this.running && this.child?.pid) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        this.child.kill("SIGTERM");
      }
    }
  }
}
