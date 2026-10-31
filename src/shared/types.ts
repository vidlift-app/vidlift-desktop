// What the wizard (renderer) and the main process say to each other.

export type Platform = "win32" | "darwin" | "linux";

export interface ShellInfo {
  platform: Platform;
  arch: string;
  version: string;
  defaultInstallDir: string;
  state: ShellState;
}

/** Kept in Electron's userData folder (shell.json): where VidLift is installed
 * and how far the wizard got, so closing it half way resumes at that step. */
export interface ShellState {
  installDir: string | null;
  setupDone: boolean;
  step: WizardStep;
  licenseKey: string | null;
  githubLogin: string | null;
  parts: string[] | null;
  packs: string[] | null;
  /** The narrator the member chose on "Set up AI" (not secret, so kept). */
  voice: VoicePlan | null;
  crashReports: boolean;
  openAtLogin: boolean;
  windowBounds?: { x?: number; y?: number; width: number; height: number; maximized?: boolean } | null;
}

export type WizardStep =
  | "welcome"
  | "license"
  | "github"
  | "location"
  | "ai"
  | "parts"
  | "install"
  | "done";

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

export type DevicePoll =
  | { status: "pending" | "slow_down" }
  | { status: "ok"; login: string }
  | { status: "denied" | "expired" | "error"; message: string };

export interface LicenseResult {
  ok: boolean;
  status?: "active" | "ended";
  name?: string;
  skool?: string;
  updatesUntil?: string | null;
  /** Server codes (contracts.md §2), plus the shell's own: "no_token" (sign in
   * first), "unreachable", "bad_signature", "no_release_access" (the GitHub
   * invite is not accepted yet). */
  error?: string;
  message?: string;
}

/** What the start-up window shows while VidLift's Python side starts. */
export interface ShellStatus {
  mode: "starting" | "updating" | "error";
  message: string;
  /** Last lines of output, shown under "Show details" (error mode). */
  log: string[];
}

export interface FolderCheck {
  path: string;
  ok: boolean;
  freeGb: number | null;
  message: string | null;
}

export type VoiceEngine = "elevenlabs" | "fish" | "minimax" | "ai33";

/** Who narrates new videos: Kokoro on this computer, or the member's own
 * account with a voice provider. Written to user/data/voice-default.json. */
export interface VoicePlan {
  mode: "local" | "online";
  engine?: VoiceEngine;
}

export interface InstallPlan {
  parts: string[];
  packs: string[];
  keys: Record<string, string>;
  voice: VoicePlan;
}

/** A key's check on "Set up AI": works, refused (with the provider's short
 * reason), or not checked (no check for it, or no answer now). */
export interface KeyCheck {
  state: "ok" | "bad" | "unchecked";
  message?: string;
}

export interface InstallProgress {
  /** One of the steps in INSTALL_STEPS, in order. */
  step: string;
  /** What is happening now, in plain words. */
  message: string;
  /** 0..1 for the current step, or null when it can't be measured. */
  fraction: number | null;
  /** Steps already finished. */
  done: string[];
  /** The last lines of output, for the "Show details" box. */
  log: string[];
  error: string | null;
  hardware: string | null;
  /** What could not be done and was left for later (a part, a pack), shown
   *  on the install page as it happens. */
  notes: string[];
}

export interface VidLiftApi {
  info(): Promise<ShellInfo>;
  saveState(patch: Partial<ShellState>): Promise<ShellState>;
  githubStart(): Promise<DeviceCode>;
  githubPoll(deviceCode: string): Promise<DevicePoll>;
  activateLicense(key: string): Promise<LicenseResult>;
  chooseFolder(title: string, start?: string): Promise<string | null>;
  checkFolder(path: string): Promise<FolderCheck>;
  install(plan: InstallPlan): Promise<void>;
  onProgress(cb: (p: InstallProgress) => void): () => void;
  finish(opts: { crashReports: boolean; openAtLogin: boolean }): Promise<void>;
  /** Ask the key's provider whether it works. Never rejects for a bad key. */
  testKey(env: string, value: string): Promise<KeyCheck>;
  openExternal(url: string): Promise<void>;
  copy(text: string): Promise<void>;
  /** waiting.html: follow the start-up, retry it, open the logs folder, quit. */
  onShellStatus(cb: (s: ShellStatus) => void): () => void;
  retryStart(): Promise<void>;
  openLogs(): Promise<void>;
  quit(): Promise<void>;
}
