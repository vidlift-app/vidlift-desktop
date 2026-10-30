// Where VidLift's releases, sign-in and licence live. The release key and the
// GitHub App id are the same ones `app/requirements/release.json` carries; the
// licence key is the licence server's (docs/desktop/contracts.md in the core).

export const RELEASES_REPO = "vidlift-app/vidlift-releases";
export const CATALOG = "catalog.json";
/** Verifies catalog.json (Ed25519). tools/release.py signs with the private
 * half, which never leaves the publisher's PC. */
export const RELEASE_PUBLIC_KEY = "zuGX+tuqk/8HbcN9Ez7NK0Zr45j0iQQr4V6h/WrXx1Q=";
/** The VidLift Updater GitHub App members sign in with (device flow; no
 * secret ships). */
export const GITHUB_CLIENT_ID = "Iv23liJQbS4wqBXJEMDe";
export const GITHUB_API = "https://api.github.com";

/** A development run (`electron .`, or Node for the tests), never a shipped
 *  app (2026-10-31): only there may the environment point the licence check
 *  at another server or key, or skip it. In a member's app those variables
 *  would let anyone stand up their own licence server. */
export const DEV_RUN = !process.versions.electron || !!(process as { defaultApp?: boolean }).defaultApp;
const devEnv = (name: string): string | undefined => (DEV_RUN ? process.env[name] : undefined);

export const LICENSE_SERVER = devEnv("VIDLIFT_LICENSE_SERVER") || "https://license.vidlift.io";
/** The licence server's public key (`GET /api/license/public-key`, key id
 * lic-2026-10). Its private half lives only on the licence server's VM. */
export const LICENSE_PUBLIC_KEY = devEnv("VIDLIFT_LICENSE_PUBLIC_KEY") || "Nb9dA42PmGueE2tBbg7JT2jBunyuyoRh69ORMF3hKPM=";
/** Development only: skip the licence server (GitHub access is still checked). */
export const SKIP_LICENSE = devEnv("VIDLIFT_SKIP_LICENSE") === "1";

export const SKOOL_URL = "https://www.skool.com/yta-insiders";
export const SUPPORT_URL = "https://status.vidlift.io";

export const API_PORT = 8791;
export const UI_PORT = 5173;

/** uv, the Python installer every install starts from: the same pinned
 * version and checksums as the old Start files (tools/release/launchers). */
export const UV_VERSION = "0.12.19";
export const UV_ASSETS: Record<string, { file: string; sha256: string }> = {
  "win32-x64": {
    file: "uv-x86_64-pc-windows-msvc.zip",
    sha256: "6dbb02d79e419522f1c500f0adb1cddcff0cda7d59b0d66ea7f5e3b4a1b2f5f0",
  },
  "win32-arm64": {
    file: "uv-aarch64-pc-windows-msvc.zip",
    sha256: "115b54cb823bc48260670f5782001add6067ac8d98d18c8263a833704e287de9",
  },
  "darwin-arm64": {
    file: "uv-aarch64-apple-darwin.tar.gz",
    sha256: "a9a8df1eedeb192f2e47e40e2faabfb387db4b850209118786d42f89dde3e0ba",
  },
  "darwin-x64": {
    file: "uv-x86_64-apple-darwin.tar.gz",
    sha256: "cb5fa57bafe68fc0fb94b17f06bee0b0b9a7feb94ccbd110445afa0696e39273",
  },
  "linux-x64": {
    file: "uv-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "23bf5552d220e0842b65c862097b2ebaeba0064b74eda5e565e77fd25969d8c8",
  },
  "linux-arm64": {
    file: "uv-aarch64-unknown-linux-gnu.tar.gz",
    sha256: "0804e9b164c64b6914182d5920c08551958a095986f10a3731056df701126436",
  },
};

/** Parts every install needs, installed whatever the member picks
 * (apps/worker/installer.py COMPONENTS + the graphics module). */
export const REQUIRED_PARTS = ["ffmpeg", "node", "graphics", "packages"];
