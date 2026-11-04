/// <reference lib="dom" />
// window.vidlift: the wizard's and the start-up page's way to the main
// process (src/shared/types.ts VidLiftApi). The page runs sandboxed with
// context isolation, so this file may only require "electron" -- no other
// module of this app (types are erased at compile time).

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { InstallProgress, ShellStatus, VidLiftApi } from "../shared/types";

/** A failed call rejects with the main process's own message, without
 * Electron's "Error invoking remote method ..." in front of it. */
const call = (method: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(`vidlift:${method}`, ...args).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, ""));
  });

/** The newest message on a channel, kept from page load on: a page that
 * subscribes a moment after the main process spoke still gets it. */
function channel<T>(name: string): (cb: (value: T) => void) => () => void {
  let last: T | undefined;
  const listeners = new Set<(value: T) => void>();
  ipcRenderer.on(name, (_e: IpcRendererEvent, value: T) => {
    last = value;
    for (const cb of listeners) cb(value);
  });
  return (cb) => {
    listeners.add(cb);
    if (last !== undefined) cb(last);
    return () => {
      listeners.delete(cb);
    };
  };
}

const onProgress = channel<InstallProgress>("progress");
const onShellStatus = channel<ShellStatus>("shell-status");

const api: VidLiftApi = {
  info: () => call("info"),
  saveState: (patch) => call("saveState", patch),
  githubStart: () => call("githubStart"),
  githubPoll: (deviceCode) => call("githubPoll", deviceCode),
  activateLicense: (key) => call("activateLicense", key),
  chooseFolder: (title, start) => call("chooseFolder", title, start),
  checkFolder: (path) => call("checkFolder", path),
  install: (plan) => call("install", plan),
  saveKeys: (keys) => call("saveKeys", keys),
  onProgress,
  finish: (opts) => call("finish", opts),
  testKey: (env, value) => call("testKey", env, value),
  openExternal: (url) => call("openExternal", url),
  copy: (text) => call("copy", text),
  onShellStatus,
  retryStart: () => call("retryStart"),
  openLogs: () => call("openLogs"),
  quit: () => call("quit"),
};

contextBridge.exposeInMainWorld("vidlift", api);

// The shell's window buttons sit on the page, so they follow its theme.
addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  const send = () => void call("windowTheme", root.dataset.theme === "light" ? "light" : "dark").catch(() => undefined);
  send();
  new MutationObserver(send).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
});
