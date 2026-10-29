// GitHub sign-in with the VidLift Updater app's device flow: the member types a
// short code at github.com/login/device. The same flow and token file as the
// core's apps/worker/updates.py (device_start / device_poll / _save_token).

import { GITHUB_API, GITHUB_CLIENT_ID } from "./constants";
import type { DeviceCode, DevicePoll } from "../shared/types";

export function headers(token: string | null, accept = "application/vnd.github+json"): Record<string, string> {
  const h: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "VidLift-Desktop",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function deviceStart(): Promise<DeviceCode> {
  const r = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID }),
  });
  if (!r.ok) throw new Error(`GitHub did not answer the sign-in request (${r.status})`);
  return (await r.json()) as DeviceCode;
}

export interface Signed {
  token: string;
  login: string;
}

/** One poll. On success returns the token too (kept by the caller). */
export async function devicePoll(deviceCode: string): Promise<DevicePoll & { token?: string }> {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const body = (await r.json()) as Record<string, string>;
  if (!body.access_token) {
    switch (body.error) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        return { status: "slow_down" };
      case "expired_token":
        return { status: "expired", message: "The code expired. Ask for a new one." };
      case "access_denied":
        return { status: "denied", message: "The sign-in was cancelled on GitHub." };
      default:
        return { status: "error", message: body.error_description || body.error || "GitHub refused the sign-in." };
    }
  }
  const login = await whoAmI(body.access_token);
  if (!login) return { status: "error", message: "Signed in, but GitHub did not say which account." };
  return { status: "ok", login, token: body.access_token };
}

export async function whoAmI(token: string): Promise<string | null> {
  const who = await fetch(`${GITHUB_API}/user`, { headers: headers(token) });
  if (!who.ok) return null;
  return ((await who.json()) as { login?: string }).login ?? null;
}
