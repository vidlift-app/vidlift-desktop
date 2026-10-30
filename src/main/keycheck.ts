// The wizard's "Set up AI" step: whether a key works, before VidLift's own
// Python side exists to ask. One cheap, key-checked call per provider, the
// same ones the core's Settings › API keys test makes (apps/worker/keytest.py,
// preflight.py, voicehouses.check_key, portix.check_key), so the two never
// disagree. The key is never logged and never part of a message.

import type { KeyCheck } from "../shared/types";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;
const UNREACHABLE = "Couldn't check right now";
const YOUTUBE_TEST_VIDEO = "jNQXAC9IVRw"; // "Me at the zoo": public since 2005

const GATEWAY_BASE: Record<string, string> = {
  KIE_API_KEY: "https://api.kie.ai",
  MODELFLARE_API_KEY: "https://modelflare.dev",
};
const PORTIX_BASE = "https://www.portixapi.com";
const AI33_BASE = "https://api.ai33.pro";
const FISH_BASE = "https://api.fish.audio";
const MINIMAX_BASE = "https://api.minimax.io";

/** The providers this file can really ask; any other key is only saved. */
export const CHECKED = [
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "YOUTUBE_API_KEY",
  "KIE_API_KEY",
  "MODELFLARE_API_KEY",
  "PORTIX_API_KEY",
  "AI33_API_KEY",
  "ELEVENLABS_API_KEY",
  "FISH_AUDIO_API_KEY",
  "MINIMAX_API_KEY",
  "PIXABAY_API_KEY",
] as const;

/** A provider's own words, short, with the key taken out. */
function scrub(text: string, key: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (key.length >= 6) t = t.split(key).join("***");
  return t.length > 160 ? `${t.slice(0, 157)}...` : t;
}

async function body(r: Response): Promise<{ json: any; text: string }> {
  let text = "";
  try {
    text = await r.text();
  } catch {
    /* no body */
  }
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { json, text };
}

/** What a JSON error body says, in the shapes these providers use. */
function said(json: any, text: string): string {
  if (json && typeof json === "object") {
    const e = json.error ?? json.detail ?? json.message ?? json.base_resp;
    if (typeof e === "string") return e;
    if (e && typeof e === "object") return String(e.message ?? e.msg ?? e.status_msg ?? e.status ?? "");
  }
  return text.trim().startsWith("<") ? "" : text;
}

/** The usual reading of an answer: works, refused, or not known now. */
function byStatus(r: Response, b: { json: any; text: string }, key: string, ok = "Works"): KeyCheck {
  if (r.status < 400) return { state: "ok", message: ok };
  if (r.status === 401 || r.status === 403) {
    const why = scrub(said(b.json, b.text), key);
    return { state: "bad", message: why || `Refused (${r.status})` };
  }
  if (r.status === 429) return { state: "unchecked", message: "Busy right now. Couldn't check" };
  if (r.status >= 500) return { state: "unchecked", message: `${UNREACHABLE} (the service answered ${r.status})` };
  return { state: "unchecked", message: `${UNREACHABLE} (answer ${r.status})` };
}

async function get(f: FetchLike, url: string, headers: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> {
  // A network failure or the timeout throws: testKey reads it as "couldn't check".
  return f(url, { method: "GET", ...init, headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function gemini(f: FetchLike, key: string): Promise<KeyCheck> {
  const r = await get(f, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": key });
  const b = await body(r);
  // Google answers a malformed or unknown key with 400 ("API key not valid").
  if (r.status === 400) return { state: "bad", message: scrub(said(b.json, b.text), key) || "The key was refused" };
  return byStatus(r, b, key);
}

async function anthropic(f: FetchLike, key: string): Promise<KeyCheck> {
  const r = await get(f, "https://api.anthropic.com/v1/models?limit=1", { "x-api-key": key, "anthropic-version": "2023-06-01" });
  return byStatus(r, await body(r), key);
}

async function youtube(f: FetchLike, key: string): Promise<KeyCheck> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=id&id=${YOUTUBE_TEST_VIDEO}&key=${encodeURIComponent(key)}`;
  const r = await get(f, url);
  const b = await body(r);
  const t = b.text.toLowerCase();
  if (r.status === 200) return { state: "ok", message: "Works" };
  if (t.includes("accessnotconfigured") || t.includes("has not been used") || t.includes("is disabled")) {
    return { state: "bad", message: "The YouTube Data API is not turned on for this key's Google Cloud project" };
  }
  if (t.includes("quotaexceeded") || t.includes("dailylimitexceeded")) {
    return { state: "ok", message: "Works. Today's quota is used up; it resets at midnight Pacific time" };
  }
  if ((r.status === 400 || r.status === 403) && (t.includes("keyinvalid") || t.includes("api key not valid"))) {
    return { state: "bad", message: "The key was refused" };
  }
  return byStatus(r, b, key);
}

/** Kie.ai and Modelflare: their model list, as keytest's gateway check. */
async function gateway(f: FetchLike, base: string, key: string): Promise<KeyCheck> {
  const r = await get(f, `${base}/v1/models`, { Authorization: `Bearer ${key}` });
  const b = await body(r);
  if (r.status === 401 || r.status === 403 || r.status >= 500) return byStatus(r, b, key);
  return { state: "ok", message: "Works" };
}

async function portix(f: FetchLike, key: string): Promise<KeyCheck> {
  const r = await get(f, `${PORTIX_BASE}/v1/models`, { Authorization: `Bearer ${key}` });
  return byStatus(r, await body(r), key);
}

async function ai33(f: FetchLike, key: string): Promise<KeyCheck> {
  const r = await get(f, `${AI33_BASE}/v1/credits`, { "xi-api-key": key });
  const b = await body(r);
  const out = byStatus(r, b, key);
  const credits = out.state === "ok" ? b.json?.credits : undefined;
  if (typeof credits === "number") {
    if (credits <= 0) return { state: "ok", message: "Works, but no credits are left" };
    return { state: "ok", message: `Works, ${Math.round(credits).toLocaleString("en-US")} credits left` };
  }
  return out;
}

async function elevenlabs(f: FetchLike, key: string): Promise<KeyCheck> {
  const r = await get(f, "https://api.elevenlabs.io/v1/user", { "xi-api-key": key });
  const b = await body(r);
  const detail = b.json?.detail;
  // A restricted key without "User: read" is a working key that can't read the account.
  if (r.status === 401 && detail?.status === "missing_permissions") return { state: "ok", message: "Works" };
  // ElevenLabs answers a malformed key with 400 and says why.
  if (r.status === 400 && /authentication|api_key|api key/i.test(b.text)) {
    return { state: "bad", message: scrub(said(b.json, b.text), key) || "The key was refused" };
  }
  if (r.status < 400) {
    const sub = b.json?.subscription;
    const left = sub && Number(sub.character_limit) - Number(sub.character_count);
    if (Number.isFinite(left)) return { state: "ok", message: `Works, ${Math.max(0, left).toLocaleString("en-US")} characters left this month` };
  }
  return byStatus(r, b, key);
}

async function fishAudio(f: FetchLike, key: string): Promise<KeyCheck> {
  const auth = { Authorization: `Bearer ${key}` };
  let r = await get(f, `${FISH_BASE}/wallet/self/api-credit`, auth);
  if (r.status === 404) r = await get(f, `${FISH_BASE}/model?page_size=1&self=true`, auth);
  const b = await body(r);
  const credit = r.status < 400 ? Number(b.json?.credit) : NaN;
  if (Number.isFinite(credit)) return { state: "ok", message: `Works, $${credit.toFixed(2)} of credit` };
  return byStatus(r, b, key);
}

/** MiniMax's voice list: read-only; it answers 200 with its own status code. */
async function minimax(f: FetchLike, key: string): Promise<KeyCheck> {
  const r = await get(
    f,
    `${MINIMAX_BASE}/v1/get_voice`,
    { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    { method: "POST", body: JSON.stringify({ voice_type: "system" }) },
  );
  const b = await body(r);
  if (r.status >= 400) return byStatus(r, b, key);
  const status = Number(b.json?.base_resp?.status_code ?? 0);
  if (!status) return { state: "ok", message: "Works" };
  const msg = scrub(String(b.json?.base_resp?.status_msg ?? ""), key);
  // A bad minute at MiniMax's end (unknown, timeout, rate limits): not the key's fault.
  if ([1000, 1001, 1002, 1039].includes(status)) return { state: "unchecked", message: UNREACHABLE };
  return { state: "bad", message: msg || `Refused (${status})` };
}

async function pixabay(f: FetchLike, key: string): Promise<KeyCheck> {
  const r = await get(f, `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=nature&per_page=3`);
  const b = await body(r);
  // "[ERROR 400] Invalid or missing API key"
  if (r.status === 400) return { state: "bad", message: "The key was refused" };
  return byStatus(r, b, key);
}

/** Ask `env`'s provider whether `value` works. Never throws. */
export async function testKey(env: string, value: string, f: FetchLike = fetch): Promise<KeyCheck> {
  const key = String(value ?? "").trim();
  if (!key) return { state: "unchecked" };
  try {
    switch (env) {
      case "GEMINI_API_KEY":
        return await gemini(f, key);
      case "ANTHROPIC_API_KEY":
        return await anthropic(f, key);
      case "YOUTUBE_API_KEY":
        return await youtube(f, key);
      case "KIE_API_KEY":
      case "MODELFLARE_API_KEY":
        return await gateway(f, GATEWAY_BASE[env], key);
      case "PORTIX_API_KEY":
        return await portix(f, key);
      case "AI33_API_KEY":
        return await ai33(f, key);
      case "ELEVENLABS_API_KEY":
        return await elevenlabs(f, key);
      case "FISH_AUDIO_API_KEY":
        return await fishAudio(f, key);
      case "MINIMAX_API_KEY":
        return await minimax(f, key);
      case "PIXABAY_API_KEY":
        return await pixabay(f, key);
      default:
        return { state: "unchecked" };
    }
  } catch {
    return { state: "unchecked", message: UNREACHABLE };
  }
}
