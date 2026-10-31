// VidLift's desktop app: the window, the tray and the install wizard. The
// Python side (tools/boot.py -> tools/vidlift.py) does the work; this process
// starts it, shows the dashboard it serves, and stops it on Quit.
//
//   setup not done (or app/tools/boot.py missing)  -> the wizard (index.html)
//   setup done                                       -> waiting.html, then the dashboard
//
// Closing the main window hides it: VidLift keeps running from the tray, and a
// video being made goes on. Quit (tray, Cmd+Q, the dashboard) stops it.

import {
  app,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  clipboard,
  crashReporter,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  nativeImage,
  type NativeImage,
  Notification,
  screen,
  shell,
  Tray,
  type WebContents,
} from "electron";
import { appendFileSync, existsSync, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { Installer, layout } from "./bootstrap";
import { fetchCatalog, NoAccess } from "./catalog";
import { API_PORT, SKIP_LICENSE, UI_PORT } from "./constants";
import { devicePoll, deviceStart } from "./github";
import { normalizeKey } from "./key";
import { testKey } from "./keycheck";
import { activate } from "./license";
import * as state from "./state";
import { apiHealthy, dashboardUrl, Supervisor } from "./supervisor";
import { ShellUpdater } from "./updater";
import type {
  DevicePoll,
  FolderCheck,
  InstallPlan,
  InstallProgress,
  LicenseResult,
  ShellInfo,
  ShellState,
  ShellStatus,
} from "../shared/types";

// --- before ready ---------------------------------------------------------------

// On a Mac the payload's default home is ~/Library/Application Support/VidLift,
// which is also Electron's default userData for productName "VidLift": the
// shell keeps its own small files apart.
app.setPath("userData", path.join(app.getPath("appData"), "VidLift Desktop"));
// No Mac keychain (2026-10-31): Chromium keeps its own "VidLift Safe Storage"
// key there, and an app without an Apple certificate is a new one to the
// keychain after every update, so it asked for the login password.
if (process.platform === "darwin") app.commandLine.appendSwitch("use-mock-keychain");
crashReporter.start({ uploadToServer: false });
if (process.platform === "win32") app.setAppUserModelId("io.vidlift.app");

const RENDERER = path.join(__dirname, "..", "renderer");
const PRELOAD = path.join(__dirname, "..", "preload", "preload.js");
const ASSETS = path.join(app.getAppPath(), "build");
const BACKGROUND = "#0b0b0b";
const GB = 1024 ** 3;

let wizardWin: BrowserWindow | null = null;
let mainWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let supervisor: Supervisor | null = null;
let supervisorDir: string | null = null;
/** The GitHub token between wizard steps (also kept encrypted by state.ts). */
let token: string | null = null;
let installing = false;
/** The install in progress, the page following it and its last report. A
 *  reload of the wizard (Cmd+R, 2026-10-30) follows the same install rather
 *  than being refused with "Setup is already running". */
let installRun: Promise<void> | null = null;
let installSender: WebContents | null = null;
let installProgress: InstallProgress | null = null;
let quitting = false;
let readyToExit = false;
/** Bumped whenever a new start-up wait begins, so an older one stops. */
let startToken = 0;
let status: ShellStatus = { mode: "starting", message: "Starting VidLift", log: [] };
let onWaiting = false;
/** A window saved as maximized and not shown yet (start at login, hidden). */
let pendingMaximize = false;
/** The app's own updates (updater.ts): checked once the dashboard shows, put in place at quit. */
let updater: ShellUpdater | null = null;

if (!app.requestSingleInstanceLock()) {
  // Another VidLift is open: it shows its window (second-instance), this one ends.
  readyToExit = true;
  app.exit(0);
} else {
  app.on("second-instance", (_e, argv) => {
    if (argv.includes("--hidden")) return;
    showFront();
  });
  app.whenReady().then(ready, (e) => fatal(e));
}

// --- start ------------------------------------------------------------------------

async function ready(): Promise<void> {
  setMenu();
  registerIpc();
  token = await state.loadToken();
  let st = state.load();
  const installed = !!st.installDir && existsSync(path.join(st.installDir, "app", "tools", "boot.py"));
  if (st.setupDone && installed) {
    createTray();
    createMain(startedHidden());
    void startVidLift();
    return;
  }
  if (st.setupDone && !installed) {
    // The app folder is gone: the wizard installs it again from the start.
    st = await state.save({ setupDone: false, step: "welcome" });
  }
  // The icon from the first page (2026-10-30, the owner: the VidLift icon in
  // the Mac's menu bar and the Windows tray on close): a wizard closed while
  // it installs goes there and carries on.
  createTray();
  openWizard();
}

function startedHidden(): boolean {
  if (process.argv.includes("--hidden")) return true;
  if (process.platform === "darwin") {
    // Electron 45 has no "open as hidden" on the Mac: a start at login is one.
    return app.getLoginItemSettings().wasOpenedAtLogin;
  }
  return false;
}

function fatal(e: unknown): void {
  const msg = e instanceof Error ? e.stack || e.message : String(e);
  logLine(`fatal: ${msg}`);
  dialog.showErrorBox("VidLift", `VidLift could not start.\n\n${msg}`);
  app.exit(1);
}

// --- menus ------------------------------------------------------------------------

function setMenu(): void {
  if (process.platform !== "darwin") {
    // No menu bar. Copy and paste in text fields still work: Chromium handles
    // Ctrl+C / Ctrl+V itself on Windows and Linux.
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] },
      { role: "windowMenu" },
    ]),
  );
}

// --- windows ----------------------------------------------------------------------

function windowDefaults(): BrowserWindowConstructorOptions {
  return {
    backgroundColor: BACKGROUND,
    show: false,
    title: "VidLift",
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  };
}

/** Windows: the main window has no title bar strip. Its page fills the window
 * and the three window buttons are drawn over the page's top right. Only the
 * shell knows this, so old dashboards work too and a browser never sees it. */
const OWN_TITLE_BAR = process.platform === "win32";
const BAR_HEIGHT = 48;
const BAR_SYMBOL = { dark: "#e8e8e8", light: "#141413" };
/** Every page of that window, with its top bar or without one. Regions ignore
 * stacking, so anything drawn over the bar has to give the clicks back. */
const WINDOW_CSS = `
.topbar-inner { -webkit-app-region: drag; padding-right: 140px !important; }
.topbar-inner :is(button, a, input, select, textarea, label, summary, [role="button"], [tabindex]) { -webkit-app-region: no-drag; }
html:not(:has(.topbar-inner))::before {
  content: ""; position: fixed; top: 0; left: 0; right: 140px; height: ${BAR_HEIGHT}px;
  -webkit-app-region: drag; z-index: 2147483647;
}
dialog, [role="dialog"], .panel-backdrop { -webkit-app-region: no-drag; }
`;

function mainWindowFrame(): BrowserWindowConstructorOptions {
  if (!OWN_TITLE_BAR) return {};
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: BAR_SYMBOL.dark, height: BAR_HEIGHT },
  };
}

function page(name: "index" | "waiting"): string | null {
  const f = path.join(RENDERER, `${name}.html`);
  return existsSync(f) ? f : null;
}

function fallbackPage(text: string, detail: string, followStatus = false): string {
  const follow = followStatus
    ? "<script>window.vidlift&&window.vidlift.onShellStatus(function(s){document.getElementById('m').textContent=s.message;" +
      "document.getElementById('d').textContent=s.log.slice(-12).join('\\n')})</script>"
    : "";
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>VidLift</title></head>` +
    `<body style="margin:0;height:100vh;display:grid;place-items:center;background:${BACKGROUND};color:#e8e8e8;font:15px system-ui,sans-serif">` +
    `<div style="text-align:center;max-width:80vw"><p id="m">${text}</p>` +
    `<pre id="d" style="opacity:.6;white-space:pre-wrap;text-align:left;font-size:12px">${detail}</pre></div>${follow}</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function openWizard(): void {
  const win = new BrowserWindow({
    ...windowDefaults(),
    width: 980,
    height: 660,
    minWidth: 900,
    minHeight: 600,
    maximizable: false,
    fullscreenable: false,
  });
  wizardWin = win;
  watchPage(win.webContents, false);
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (quitting || !installing) return;
    // Installing: the window goes to the tray and the install carries on.
    e.preventDefault();
    win.hide();
    void stillRunningNotice(true);
  });
  win.on("closed", () => {
    if (wizardWin === win) wizardWin = null;
  });
  const f = page("index");
  const loaded = f
    ? win.loadFile(f)
    : win.loadURL(fallbackPage("The setup wizard is not built.", "Run npm run build:renderer in apps/desktop."));
  loaded.catch((e) => logLine(`wizard did not load: ${String(e)}`));
}

function createMain(hidden: boolean): void {
  const st = state.load();
  const b = placeWindow(st.windowBounds ?? null);
  pendingMaximize = !!st.windowBounds?.maximized;
  const win = new BrowserWindow({ ...windowDefaults(), ...mainWindowFrame(), ...b, minWidth: 1100, minHeight: 700 });
  mainWin = win;
  watchPage(win.webContents, true);
  win.once("ready-to-show", () => {
    if (!hidden) showMain();
  });
  let timer: NodeJS.Timeout | null = null;
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(saveBounds, 600);
  };
  win.on("resize", later);
  win.on("move", later);
  win.on("close", (e) => {
    saveBounds();
    if (quitting) return;
    e.preventDefault();
    win.hide();
    void stillRunningNotice();
  });
  win.on("closed", () => {
    if (mainWin === win) mainWin = null;
  });
}

/** The first time the window is closed, say where VidLift went: a member
 * who closes it and sees nothing may think it quit, or start it again. */
async function stillRunningNotice(installingNow = false): Promise<void> {
  if (!Notification.isSupported()) return;
  if (!installingNow) {
    if (state.load().trayNoticeShown) return;
    await state.save({ trayNoticeShown: true });
  }
  const where = process.platform === "darwin" ? "in the menu bar" : "by the clock";
  const n = new Notification(
    installingNow
      ? { title: "VidLift is still installing", body: `Click the VidLift icon ${where} to watch it.` }
      : {
          title: "VidLift is still running",
          body: `Videos carry on. Click the VidLift icon ${where} to open it again, or right-click it to quit.`,
        },
  );
  n.on("click", () => showFront());
  n.show();
}

/** The saved size and place, if a screen still shows it; else the default
 * size, centred, and never larger than the screen. */
function placeWindow(saved: ShellState["windowBounds"] | null): { x?: number; y?: number; width: number; height: number } {
  const width = saved?.width ?? 1440;
  const height = saved?.height ?? 900;
  const displays = screen.getAllDisplays();
  if (saved && saved.x !== undefined && saved.y !== undefined) {
    const { x, y } = saved;
    const visible = displays.some(({ workArea: a }) => x + 120 > a.x && x + 120 < a.x + a.width && y + 20 >= a.y && y + 20 < a.y + a.height);
    if (visible) return { x, y, width, height };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return { width: Math.min(width, area.width), height: Math.min(height, area.height) };
}

function saveBounds(): void {
  const win = mainWin;
  if (!win || win.isDestroyed()) return;
  const nb = win.getNormalBounds();
  const maximized = pendingMaximize || win.isMaximized();
  void state.save({ windowBounds: { x: nb.x, y: nb.y, width: nb.width, height: nb.height, maximized } }).catch(() => undefined);
}

function showMain(): void {
  const win = mainWin;
  if (!win || win.isDestroyed()) return;
  if (pendingMaximize) {
    pendingMaximize = false;
    win.maximize();
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function showFront(): void {
  if (mainWin) return showMain();
  if (wizardWin) {
    if (wizardWin.isMinimized()) wizardWin.restore();
    wizardWin.show();
    wizardWin.focus();
  }
}

// --- tray -------------------------------------------------------------------------

function trayImage(): NativeImage {
  let small = nativeImage.createFromPath(path.join(ASSETS, "tray.png")); // 32 px
  const large = nativeImage.createFromPath(path.join(ASSETS, "tray@2x.png")); // 64 px
  if (small.isEmpty()) {
    // An empty image is an invisible icon: the app's own icon instead.
    logLine("tray.png did not load; using the app icon");
    small = nativeImage.createFromPath(path.join(ASSETS, "icon.png")).resize({ height: 32, quality: "best" });
    if (small.isEmpty()) return small;
  }
  const img = nativeImage.createEmpty();
  // 16 points high: 16 px on a normal screen, 32 on a Retina / 200 % one.
  img.addRepresentation({ scaleFactor: 1, buffer: small.resize({ height: 16, quality: "best" }).toPNG() });
  img.addRepresentation({ scaleFactor: 2, buffer: small.toPNG() });
  if (!large.isEmpty() && process.platform !== "darwin") img.addRepresentation({ scaleFactor: 4, buffer: large.toPNG() });
  return img;
}

function createTray(): void {
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip("VidLift");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open VidLift", click: () => showFront() },
      { type: "separator" },
      { label: "Quit VidLift", click: () => trayQuit() },
    ]),
  );
  if (process.platform === "win32") tray.on("click", () => showFront());
}

/** Quit from the tray. While installing, ask first: the window may be hidden. */
function trayQuit(): void {
  if (installing) {
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      title: "VidLift",
      message: "Setup is still running. Quit now? It carries on from where it stopped next time.",
      buttons: ["Quit", "Keep installing"],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice !== 0) return;
  }
  app.quit();
}

// --- VidLift's Python side --------------------------------------------------------

function getSupervisor(installDir: string): Supervisor {
  if (supervisor && supervisorDir === installDir) return supervisor;
  const s = Supervisor.at(installDir);
  s.onUnexpectedExit = (code, tail) => void onSupervisorExit(code, tail);
  supervisor = s;
  supervisorDir = installDir;
  return s;
}

function setStatus(next: Partial<ShellStatus>): void {
  status = { ...status, ...next };
  sendStatus();
}

let statusTimer: NodeJS.Timeout | null = null;
function sendStatus(soon = false): void {
  if (soon) {
    statusTimer ??= setTimeout(() => {
      statusTimer = null;
      sendStatus();
    }, 250);
    return;
  }
  const wc = mainWin?.webContents;
  if (wc && !wc.isDestroyed() && onWaiting) wc.send("shell-status", status);
}

async function showWaiting(): Promise<void> {
  const win = mainWin;
  if (!win || win.isDestroyed()) return;
  if (onWaiting) {
    sendStatus();
    return;
  }
  onWaiting = true;
  const f = page("waiting");
  try {
    if (f) await win.loadFile(f);
    else await win.loadURL(fallbackPage(status.message, "", true));
  } catch (e) {
    logLine(`waiting page did not load: ${String(e)}`);
  }
  sendStatus();
}

async function loadDashboard(): Promise<void> {
  const win = mainWin;
  if (!win || win.isDestroyed()) return;
  const url = await dashboardUrl();
  onWaiting = false;
  // A failed load shows waiting.html again (did-fail-load, below).
  await win.loadURL(url).catch(() => undefined);
  getUpdater()?.dashboardLoaded();
}

/** The updater, in a packaged app only (a dev run's electron.exe has nothing
 * to update; VIDLIFT_SHELL_UPDATE_TEST=1 tries it anyway). */
function getUpdater(): ShellUpdater | null {
  if (updater) return updater;
  if (!app.isPackaged && process.env.VIDLIFT_SHELL_UPDATE_TEST !== "1") return null;
  updater = new ShellUpdater({
    version: app.getVersion(),
    dir: path.join(app.getPath("userData"), "updates"),
    installDir: () => state.load().installDir,
    exePath: app.getPath("exe"),
    fallbackToken: async () => (token ??= await state.loadToken()),
    log: logLine,
  });
  return updater;
}

/** Start VidLift (or find it running), show the start-up page, then the dashboard. */
async function startVidLift(): Promise<void> {
  const st = state.load();
  if (!st.installDir || !mainWin) return;
  const my = ++startToken;
  status = { mode: "starting", message: "Starting VidLift", log: [] };
  await showWaiting();
  const sup = getSupervisor(st.installDir);
  try {
    await sup.start((line) => {
      status.log = [...status.log, line].slice(-80);
      sendStatus(true);
    });
    await waitAndLoad(sup, my, 45 * 60_000);
  } catch (e) {
    if (my !== startToken) return;
    setStatus({ mode: "error", message: e instanceof Error ? e.message : String(e), log: sup.lastLines() });
  }
}

/** boot.py's own page answers while it puts an update in place (tools/boot.py
 * StatusPage): `/api/updates/progress` with `boot: true`. */
async function updateProgress(): Promise<{ message?: string } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${API_PORT}/api/updates/progress`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { boot?: boolean; message?: string };
    return j?.boot ? j : null;
  } catch {
    return null;
  }
}

/** Wait until the API answers, then load the dashboard. Shows "updating"
 * while boot.py applies an update; throws when VidLift has stopped. */
async function waitAndLoad(sup: Supervisor, my: number, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  let silentSince: number | null = null;
  while (my === startToken && !quitting) {
    if (await apiHealthy()) {
      if (my === startToken) await loadDashboard();
      return;
    }
    const upd = await updateProgress();
    if (upd) {
      silentSince = null;
      if (my === startToken) setStatus({ mode: "updating", message: upd.message || "Putting the update in place" });
    } else if (!sup.running) {
      silentSince ??= Date.now();
      if (Date.now() - silentSince > 5000) {
        const last = sup.lastLines().slice(-6).join("\n");
        throw new Error(`VidLift stopped while starting.${last ? `\n${last}` : ""}`);
      }
    } else {
      silentSince = null;
      if (status.mode === "updating") setStatus({ mode: "starting", message: "Starting VidLift" });
    }
    if (Date.now() > until) throw new Error("VidLift took too long to start.");
    await sleep(2000);
  }
}

async function onSupervisorExit(code: number | null, tail: string[]): Promise<void> {
  if (quitting || !mainWin) return; // during the wizard the installer reports it
  const my = ++startToken;
  logLine(`boot.py ended (code ${code})`);
  if (code === 0) {
    // Another start of this install is putting an update in place: wait for it.
    if (await updateProgress()) {
      setStatus({ mode: "updating", message: "Putting the update in place", log: tail });
      await showWaiting();
      const sup = supervisor!;
      await waitAndLoad(sup, my, 45 * 60_000).catch((e) => {
        if (my === startToken) setStatus({ mode: "error", message: e instanceof Error ? e.message : String(e), log: tail });
      });
      return;
    }
    // The member quit from the dashboard: VidLift has already stopped.
    void shutdown(false);
    return;
  }
  setStatus({ mode: "error", message: "VidLift stopped unexpectedly.", log: tail });
  await showWaiting();
}

/** The dashboard did not load (VidLift restarting, an update): show the
 * start-up page and come back when the API answers. */
async function recoverDashboard(): Promise<void> {
  if (quitting || !mainWin || !supervisor) return;
  const my = ++startToken;
  status = { mode: "starting", message: "Reconnecting to VidLift", log: supervisor.lastLines() };
  await showWaiting();
  await waitAndLoad(supervisor, my, 45 * 60_000).catch((e) => {
    if (my === startToken) setStatus({ mode: "error", message: e instanceof Error ? e.message : String(e), log: supervisor?.lastLines() ?? [] });
  });
}

// --- pages: links, crashes, failed loads ------------------------------------------

function isLocal(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

function isDashboard(url: string): boolean {
  try {
    const u = new URL(url);
    return isLocal(url) && [String(API_PORT), String(UI_PORT)].includes(u.port);
  } catch {
    return false;
  }
}

function openOutside(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") void shell.openExternal(u.toString());
  } catch {
    /* not a URL */
  }
}

/** Every page: local links open in another VidLift window, the rest in the browser. */
app.on("web-contents-created", (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (isLocal(url)) return { action: "allow", overrideBrowserWindowOptions: { ...windowDefaults(), show: true, width: 1200, height: 800 } };
    openOutside(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (isLocal(url) || url.startsWith("file:") || url.startsWith("data:")) return;
    e.preventDefault();
    openOutside(url);
  });
});

app.on("child-process-gone", (_e, d) => {
  logLine(`child process gone: ${d.type} ${d.reason} (exit ${d.exitCode})${d.name ? ` ${d.name}` : ""}`);
});

function watchPage(wc: WebContents, isMain: boolean): void {
  let crashes: number[] = [];
  wc.on("render-process-gone", (_e, d) => {
    logLine(`${isMain ? "main" : "wizard"} window's page gone: ${d.reason} (exit ${d.exitCode})`);
    if (quitting || d.reason === "clean-exit") return;
    crashes = [...crashes.filter((t) => Date.now() - t < 60_000), Date.now()];
    if (isMain && crashes.length > 3) {
      startToken++;
      onWaiting = false;
      status = { mode: "error", message: "VidLift's window keeps closing.", log: [] };
      void showWaiting();
      return;
    }
    setTimeout(() => {
      if (!wc.isDestroyed()) wc.reload();
    }, 1000);
  });
  if (!isMain) return;
  if (OWN_TITLE_BAR) {
    wc.on("dom-ready", () => {
      wc.insertCSS(WINDOW_CSS).catch((e) => logLine(`window style: ${String(e)}`));
    });
  }
  wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ERR_ABORTED: a newer load */ || !isDashboard(url)) return;
    logLine(`dashboard did not load: ${desc} (${code})`);
    void recoverDashboard();
  });
  wc.on("did-finish-load", () => {
    if (onWaiting) sendStatus();
  });
}

// --- quit -------------------------------------------------------------------------

app.on("before-quit", (e) => {
  if (readyToExit) return;
  e.preventDefault();
  if (quitting) return;
  void shutdown(true);
});

app.on("window-all-closed", () => {
  // The main window only hides; this is the wizard closing.
  if (!mainWin) app.quit();
});

app.on("activate", () => showFront());

async function shutdown(stopVidLift: boolean): Promise<void> {
  if (readyToExit) return;
  quitting = true;
  startToken++;
  saveBounds();
  for (const w of BrowserWindow.getAllWindows()) w.hide();
  tray?.setToolTip("VidLift is stopping");
  if (stopVidLift && supervisor) {
    try {
      if (supervisor.running || (await apiHealthy())) await supervisor.stop();
    } catch (e) {
      logLine(`stop: ${String(e)}`);
    }
  }
  // VidLift's Python side has stopped (or was never ours): a downloaded
  // update of this app goes in now, never while it runs.
  if (updater && (!supervisor || !supervisor.running)) {
    updater.stop();
    await updater.applyAtQuit().catch((e) => logLine(`updater: ${String(e)}`));
  }
  readyToExit = true;
  tray?.destroy();
  app.exit(0);
}

// --- what the pages ask for -------------------------------------------------------

function senderAllowed(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? "";
  return url.startsWith("file:") || url.startsWith("data:") || isLocal(url);
}

function handle(name: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(`vidlift:${name}`, async (e, ...args) => {
    if (!senderAllowed(e)) throw new Error("not allowed");
    return fn(e, ...args);
  });
}

function registerIpc(): void {
  handle("info", (): ShellInfo => ({
    platform: process.platform as ShellInfo["platform"],
    arch: process.arch,
    version: app.getVersion(),
    defaultInstallDir: state.defaultInstallDir(),
    state: { ...state.load() },
  }));

  handle("saveState", (_e, patch: Partial<ShellState>) => state.save(patch ?? {}));

  // The window buttons follow the page's theme, which can differ from the OS's.
  handle("windowTheme", (e, theme: string) => {
    if (!OWN_TITLE_BAR || !mainWin || BrowserWindow.fromWebContents(e.sender) !== mainWin) return;
    mainWin.setTitleBarOverlay({ symbolColor: theme === "light" ? BAR_SYMBOL.light : BAR_SYMBOL.dark });
  });

  handle("githubStart", () => deviceStart());

  handle("githubPoll", async (_e, deviceCode: string): Promise<DevicePoll> => {
    const r = await devicePoll(String(deviceCode));
    if (r.status === "ok" && r.token) {
      token = r.token;
      await state.saveToken(token);
      await state.save({ githubLogin: r.login });
      return { status: "ok", login: r.login };
    }
    const { token: _drop, ...rest } = r;
    return rest as DevicePoll;
  });

  handle("activateLicense", (_e, key: string) => activateLicense(String(key ?? "")));

  handle("chooseFolder", async (e, title: string, start?: string): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = {
      title: String(title || "Choose a folder"),
      defaultPath: start || undefined,
      properties: ["openDirectory", "createDirectory"],
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });

  handle("checkFolder", (_e, p: string) => checkFolder(String(p ?? "")));

  handle("install", (e, plan: InstallPlan) => install(e.sender, plan));

  handle("finish", (_e, opts: { crashReports: boolean; openAtLogin: boolean }) => finish(opts));

  // The key is checked here and forgotten: never logged, never saved.
  handle("testKey", (_e, env: string, value: string) => {
    const name = String(env ?? "");
    const key = String(value ?? "");
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name) || key.length > 512) return { state: "unchecked" };
    return testKey(name, key);
  });

  handle("openExternal", (_e, url: string) => openOutside(String(url)));
  handle("copy", (_e, text: string) => clipboard.writeText(String(text ?? "")));

  handle("retryStart", async () => {
    if (mainWin) await startVidLift();
  });

  handle("openLogs", async () => {
    const dir = state.load().installDir;
    if (!dir) return;
    const logs = path.join(dir, "user", "data", "logs");
    await fs.mkdir(logs, { recursive: true }).catch(() => undefined);
    const err = await shell.openPath(logs);
    if (err) logLine(`open logs: ${err}`);
  });

  handle("quit", () => {
    app.quit();
  });
}

async function activateLicense(raw: string): Promise<LicenseResult> {
  const key = normalizeKey(raw);
  if (!key) {
    return { ok: false, error: "bad_request", message: "That isn't a licence key. It looks like VL-XXXX-XXXX-XXXX-XXXX." };
  }
  token ??= await state.loadToken();
  if (!token) return { ok: false, error: "no_token", message: "Sign in with GitHub first." };
  let result: LicenseResult;
  if (SKIP_LICENSE) {
    // Development runs only (constants.ts): no licence server; GitHub access is still checked below.
    result = { ok: true, status: "active", name: state.load().githubLogin ?? undefined };
  } else {
    result = await activate(key, token, null);
  }
  if (!result.ok) return result;
  try {
    await fetchCatalog(token);
  } catch (e) {
    if (e instanceof NoAccess) return { ok: false, error: "no_release_access", message: e.message };
    return { ok: false, error: "unreachable", message: e instanceof Error ? e.message : String(e) };
  }
  await state.save({ licenseKey: key });
  return result;
}

async function install(sender: WebContents, plan: InstallPlan): Promise<void> {
  installSender = sender;
  if (installRun) {
    if (installProgress) sender.send("progress", installProgress);
    return installRun;
  }
  installProgress = null;
  token ??= await state.loadToken();
  if (!token) throw new Error("Sign in with GitHub first.");
  const before = state.load();
  const dir = before.installDir || state.defaultInstallDir();
  // The API keys go to the install's .env only, never into shell.json.
  const st = await state.save({
    installDir: dir,
    parts: plan.parts,
    packs: plan.packs,
    voice: plan.voice ?? null,
    step: "install",
  });
  const sup = getSupervisor(dir);
  const installer = new Installer(layout(dir), token, st.licenseKey ?? "", sup, (p) => {
    installProgress = p;
    const to = installSender;
    if (to && !to.isDestroyed()) to.send("progress", p);
  });
  installing = true;
  installRun = installer
    .run({
      parts: plan.parts ?? [],
      packs: plan.packs ?? [],
      keys: plan.keys ?? {},
      voice: plan.voice ?? { mode: "local" },
    })
    .finally(() => {
      installing = false;
      installRun = null;
    });
  return installRun;
}

async function finish(opts: { crashReports: boolean; openAtLogin: boolean }): Promise<void> {
  const crashReports = !!opts?.crashReports;
  const openAtLogin = !!opts?.openAtLogin;
  const st = await state.save({ setupDone: true, step: "done", crashReports, openAtLogin });
  if (st.installDir) {
    const f = path.join(st.installDir, "user", "data", "crash-reports.json");
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, JSON.stringify({ enabled: crashReports }), "utf-8");
  }
  applyLoginItem(openAtLogin);
  createTray();
  if (!mainWin) createMain(false);
  void startVidLift();
  const w = wizardWin;
  wizardWin = null;
  // After this call's answer has gone back to the page.
  if (w) setImmediate(() => !w.isDestroyed() && w.close());
}

function applyLoginItem(openAtLogin: boolean): void {
  if (!app.isPackaged) return; // a dev run would register electron.exe
  // Mac: macOS 13+ login items (SMAppService) take no arguments and no
  // "hidden" flag; startedHidden() reads wasOpenedAtLogin instead.
  if (process.platform === "darwin") app.setLoginItemSettings({ openAtLogin });
  else app.setLoginItemSettings({ openAtLogin, args: ["--hidden"] });
}

// --- folder checks ----------------------------------------------------------------

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p).replace(/[\\/]+$/, "");
    return process.platform === "linux" ? r : r.toLowerCase();
  };
  return norm(a) === norm(b);
}

/** What a VidLift install folder holds, and what may already be there: the
 *  old launcher's `install.json` (tools/vidlift.py record_install writes it
 *  to %LOCALAPPDATA%\VidLift, the default) and the system's own files. */
const OURS = new Set([
  "app",
  "runtime",
  "user",
  "install.json",
  "agents.md",
  "claude.md",
  "gemini.md",
  "license.txt",
  "notice.md",
  ".ds_store",
  "desktop.ini",
  "thumbs.db",
]);

async function checkFolder(p: string): Promise<FolderCheck> {
  const dir = p ? path.resolve(p) : "";
  if (!p || !path.isAbsolute(p)) return { path: dir, ok: false, freeGb: null, message: "Pick a folder." };
  if ((await exists(dir)) && !(await isDir(dir))) {
    return { path: dir, ok: false, freeGb: null, message: "That is a file, not a folder. Pick a folder." };
  }
  // Only an empty folder or a VidLift install: the install replaces `app` and
  // writes beside it, so a folder of other things is refused.
  if (await isDir(dir)) {
    const foreign = (await fs.readdir(dir)).filter((n) => !OURS.has(n.toLowerCase()) && !n.startsWith(".unpack-"));
    if (foreign.length) {
      return {
        path: dir,
        ok: false,
        freeGb: null,
        message: "This folder already has other files in it. Pick an empty folder, or a new one.",
      };
    }
  }
  // The folder itself, or the nearest one above it that exists yet.
  let probe = dir;
  while (!(await isDir(probe))) {
    const up = path.dirname(probe);
    if (up === probe) return { path: dir, ok: false, freeGb: null, message: "That drive isn't available. Pick another folder." };
    probe = up;
  }
  const test = path.join(probe, `.vidlift-write-test-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(test, "ok");
    await fs.rm(test, { force: true });
  } catch {
    return { path: dir, ok: false, freeGb: null, message: "VidLift can't write to this folder. Pick another one." };
  }
  let freeGb: number | null = null;
  try {
    const s = await fs.statfs(probe);
    freeGb = round1((Number(s.bavail) * Number(s.bsize)) / GB);
  } catch {
    /* unknown */
  }
  const message = freeGb !== null && freeGb < 20 ? "Less than 20 GB free on this drive" : null;
  return { path: dir, ok: true, freeGb, message };
}

/** One line in <install>/user/data/logs/shell.log (or the shell's own folder
 * before VidLift is installed). */
function logLine(text: string): void {
  try {
    const dir = state.load().installDir;
    const logs = dir ? path.join(dir, "user", "data", "logs") : app.getPath("userData");
    mkdirSync(logs, { recursive: true });
    appendFileSync(path.join(logs, "shell.log"), `[${new Date().toISOString()}] shell: ${text}\n`, "utf-8");
  } catch {
    /* logging never stops anything */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
