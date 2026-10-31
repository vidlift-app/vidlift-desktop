import type { VoiceEngine, WizardStep } from "../shared/types";

export const WIZARD_STEPS: { id: WizardStep; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "license", label: "Licence" },
  { id: "github", label: "GitHub" },
  { id: "location", label: "Location" },
  { id: "ai", label: "Set up AI" },
  { id: "parts", label: "Parts" },
  { id: "install", label: "Install" },
  { id: "done", label: "Done" },
];

export const stepIndex = (s: WizardStep) => WIZARD_STEPS.findIndex((x) => x.id === s);

/** The main process's install steps (src/main/bootstrap.ts STEPS), in order. */
export const INSTALL_STEPS: { id: string; label: string }[] = [
  { id: "prepare", label: "Folders" },
  { id: "uv", label: "Python installer" },
  { id: "core", label: "VidLift" },
  { id: "python", label: "Python and core packages" },
  { id: "parts", label: "Parts" },
  { id: "packs", label: "Media packs" },
  { id: "finish", label: "Finishing" },
];

export interface PartRow {
  id: string;
  name: string;
  desc?: string;
  /** What the row shows. */
  size: string;
  /** Upper estimate in GB, for the download total. */
  gb: number;
}

export const ALWAYS: PartRow[] = [
  { id: "ffmpeg", name: "FFmpeg", size: "about 100 MB", gb: 0.1 },
  { id: "node", name: "Node.js", size: "about 40 MB", gb: 0.04 },
  { id: "renderer", name: "Renderer packages", size: "about 700 MB", gb: 0.7 },
  { id: "graphics", name: "Graphics", size: "about 30 MB", gb: 0.03 },
];

export const PART_GROUPS: { title: string; kind: "parts" | "packs"; rows: PartRow[] }[] = [
  {
    title: "AI and voice",
    kind: "parts",
    rows: [
      { id: "ai", name: "AI pack", desc: "Caption timing, cut-outs and depth, on your GPU", size: "0.5–3 GB", gb: 3 },
      { id: "tts", name: "Local voice (Kokoro)", desc: "Free narration on this computer", size: "about 400 MB", gb: 0.4 },
    ],
  },
  {
    title: "Footage and pictures",
    kind: "parts",
    rows: [
      { id: "ytdlp-pro", name: "YouTube footage", size: "about 80 MB", gb: 0.08 },
      { id: "image-scraper", name: "Image search", size: "about 400 MB", gb: 0.4 },
      { id: "flow-bridge", name: "Google Flow images", size: "about 60 MB", gb: 0.06 },
      { id: "browser", name: "Web capture", desc: "Real news pages for headline graphics", size: "about 150 MB", gb: 0.15 },
    ],
  },
  {
    title: "Media packs",
    kind: "packs",
    rows: [
      { id: "audio", name: "Music and sound effects", size: "about 300 MB", gb: 0.3 },
      // The overlays pack zip is 250 MB (dist/release, 2026-10-24).
      { id: "overlays", name: "Overlays", size: "about 250 MB", gb: 0.25 },
      { id: "backgrounds", name: "Backgrounds", size: "about 260 MB", gb: 0.26 },
      { id: "3d", name: "3D Studio", desc: "Characters and scene sounds for 3D films", size: "about 50 MB", gb: 0.05 },
    ],
  },
];

export const ALL_PARTS = PART_GROUPS.filter((g) => g.kind === "parts").flatMap((g) => g.rows.map((r) => r.id));
export const ALL_PACKS = PART_GROUPS.filter((g) => g.kind === "packs").flatMap((g) => g.rows.map((r) => r.id));

/** A key on "Set up AI": its variable in user/.env, the label and signup
 * link Settings › API keys shows (apps/worker/inventory.py CREDENTIALS). */
export interface KeyRow {
  env: string;
  label: string;
  url: string;
}

export const WRITING_KEY: KeyRow = { env: "GEMINI_API_KEY", label: "Gemini", url: "https://aistudio.google.com/apikey" };

/** Behind "Use another provider". */
export const WRITING_OTHER: KeyRow[] = [
  { env: "ANTHROPIC_API_KEY", label: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
  { env: "KIE_API_KEY", label: "Kie.ai", url: "https://kie.ai/api-key" },
  { env: "MODELFLARE_API_KEY", label: "Modelflare", url: "https://modelflare.dev/keys" },
  { env: "PORTIX_API_KEY", label: "Portix", url: "https://www.portixapi.com/console/token" },
];

/** The online voices, each on the member's own key (apps/worker/voicehouses.py, tts.py). */
export const VOICE_ENGINES: { id: VoiceEngine; label: string; key: KeyRow }[] = [
  { id: "elevenlabs", label: "ElevenLabs", key: { env: "ELEVENLABS_API_KEY", label: "ElevenLabs", url: "https://elevenlabs.io/app/settings/api-keys" } },
  { id: "fish", label: "Fish Audio", key: { env: "FISH_AUDIO_API_KEY", label: "Fish Audio", url: "https://fish.audio/app/api-keys/" } },
  {
    id: "minimax",
    label: "MiniMax",
    key: { env: "MINIMAX_API_KEY", label: "MiniMax", url: "https://www.minimax.io/platform/user-center/basic-information/interface-key" },
  },
  { id: "ai33", label: "ai33", key: { env: "AI33_API_KEY", label: "ai33 (TTS)", url: "https://ai33.pro/app/api-document" } },
];

export const FOOTAGE_KEYS: (KeyRow & { fact?: string })[] = [
  {
    env: "YOUTUBE_API_KEY",
    label: "YouTube Data API",
    url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    fact: "Faster research and exact numbers. Without it, VidLift reads YouTube's pages, slower.",
  },
  { env: "PIXABAY_API_KEY", label: "Pixabay", url: "https://pixabay.com/api/docs/" },
];

/** The Parts page's pre-selection for a voice choice: Kokoro (and the AI
 * pack it needs) for the local voice; no Kokoro by default for an online one. */
export function partsForVoice(parts: string[], mode: "local" | "online"): string[] {
  const next = new Set(parts);
  if (mode === "local") {
    next.add("tts");
    next.add("ai");
  } else {
    next.delete("tts");
  }
  return ALL_PARTS.filter((id) => next.has(id)).concat([...next].filter((id) => !ALL_PARTS.includes(id)));
}

export const URLS = {
  skool: "https://www.skool.com/yta-insiders",
  invite: "https://github.com/vidlift-app/vidlift-releases/invitations",
};

/** Licence keys: VL-XXXX-XXXX-XXXX-XXXX over an alphabet with no 0/O/1/I. */
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function formatKey(raw: string): string {
  const up = raw.toUpperCase().trim();
  let body = up.replace(/[^A-Z0-9]/g, "");
  // Typing the prefix by hand: keep "V", "VL", "VL-" as they are until the body starts.
  if (body === "V" && !up.includes("-")) return "V";
  if (body === "VL") return up === "VL" ? "VL" : "VL-";
  // The field always shows "VL-…", so an edit or a pasted key starts with it.
  if (/^VL[-\s]/.test(up) || (body.startsWith("VL") && body.length !== 16)) body = body.slice(2);
  body = [...body].filter((c) => KEY_ALPHABET.includes(c)).join("").slice(0, 16);
  if (!body) return "";
  return "VL-" + (body.match(/.{1,4}/g) ?? []).join("-");
}

export const keyComplete = (k: string) => /^VL-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(k);

export function gb(n: number): string {
  return n >= 100 ? `${Math.round(n)} GB` : `${n.toFixed(1)} GB`;
}
