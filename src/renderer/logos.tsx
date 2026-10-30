// The providers' and tools' own marks on the wizard (2026-10-30, the owner:
// "include the image for API providers' logos and wherever else it's
// required"): the same marks the dashboard's Settings › API keys draws
// (apps/dashboard/src/components/ProviderLogo.tsx). Files in ./logos are
// the providers' own favicons; the rest are drawn here.

import { useId } from "react";

const FILES = import.meta.glob("./logos/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const png = (name: string): string | null => FILES[`./logos/${name}.png`] ?? null;

/** A provider's own picture. `plain`: a tile of its own, drawn as it is;
 *  otherwise on a white backing, as some are dark on transparent. */
function Img({ name, size, label, plain }: { name: string; size: number; label: string; plain?: boolean }) {
  const src = png(name);
  if (!src) return null;
  return <img className={`plogo${plain ? " plogo-dark" : " plogo-img"}`} src={src} alt="" width={size} height={size} title={label} draggable={false} />;
}

function Gemini({ size }: { size: number }) {
  const id = useId();
  const star = "M12 1.4c.7 5.1 3.4 8.8 9.1 10.1l1.5.5-1.5.5c-5.7 1.3-8.4 5-9.1 10.1-.7-5.1-3.4-8.8-9.1-10.1L1.4 12l1.5-.5C8.6 10.2 11.3 6.5 12 1.4Z";
  return (
    <svg className="plogo" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Gemini">
      <defs>
        <linearGradient id={`${id}-g`} x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F4B400" />
          <stop offset="0.35" stopColor="#E94235" />
          <stop offset="0.62" stopColor="#4285F4" />
          <stop offset="1" stopColor="#34A853" />
        </linearGradient>
        <radialGradient id={`${id}-r`} cx="0.62" cy="0.42" r="0.6">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="1" stopColor="#4285F4" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={star} fill={`url(#${id}-g)`} />
      <path d={star} fill={`url(#${id}-r)`} />
    </svg>
  );
}

const RAYS = [
  [90, 9.4], [120, 8.6], [150, 9.2], [180, 9.6], [210, 8.8], [240, 9.3],
  [270, 9.0], [300, 8.7], [330, 9.5], [0, 9.1], [30, 8.9], [60, 9.4],
] as const;

function Claude({ size }: { size: number }) {
  return (
    <svg className="plogo" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="Anthropic">
      <rect x="1" y="1" width="22" height="22" rx="5.5" fill="#D97757" />
      <g stroke="#F7EFE6" strokeWidth="1.9" strokeLinecap="round">
        {RAYS.map(([deg, len]) => {
          const a = (deg * Math.PI) / 180;
          return <line key={deg} x1={12 + Math.cos(a) * 1.6} y1={12 - Math.sin(a) * 1.6} x2={12 + Math.cos(a) * len} y2={12 - Math.sin(a) * len} />;
        })}
      </g>
    </svg>
  );
}

function ElevenLabs({ size }: { size: number }) {
  return (
    <svg className="plogo plogo-dark" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label="ElevenLabs">
      <rect width="16" height="16" rx="3.5" fill="#0b0b0b" />
      <rect x="5" y="3.5" width="2" height="9" rx="0.5" fill="#fff" />
      <rect x="9" y="3.5" width="2" height="9" rx="0.5" fill="#fff" />
    </svg>
  );
}

function Ai33({ size }: { size: number }) {
  return (
    <svg className="plogo plogo-dark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ai33.pro">
      <rect width="64" height="64" rx="18" fill="#151512" />
      <path d="M44 17.5A19 19 0 1 0 44 46.5" fill="none" stroke="#D7FF56" strokeWidth="5" strokeLinecap="round" />
      <rect x="29" y="25" width="4" height="14" rx="2" fill="#FFFDF7" />
      <rect x="36" y="20" width="4" height="24" rx="2" fill="#BCA8FF" />
      <rect x="43" y="27" width="4" height="10" rx="2" fill="#86DDFF" />
    </svg>
  );
}

/** Kokoro runs on this computer: a chip, in the wizard's own line style. */
function Chip({ size }: { size: number }) {
  return (
    <svg className="plogo plogo-line" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" role="img" aria-label="This computer">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.35" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </svg>
  );
}

/** The mark for a key (its variable in user/.env), or null. */
export function KeyLogo({ env, size = 16 }: { env: string; size?: number }) {
  switch (env) {
    case "GEMINI_API_KEY":
      return <Gemini size={size} />;
    case "ANTHROPIC_API_KEY":
      return <Claude size={size} />;
    case "KIE_API_KEY":
      return <Img name="kie" size={size} label="Kie.ai" />;
    case "MODELFLARE_API_KEY":
      return <Img name="modelflare" size={size} label="Modelflare" plain />;
    case "PORTIX_API_KEY":
      return <Img name="portix" size={size} label="Portix" plain />;
    case "ELEVENLABS_API_KEY":
      return <ElevenLabs size={size} />;
    case "FISH_AUDIO_API_KEY":
      return <Img name="fishaudio" size={size} label="Fish Audio" />;
    case "MINIMAX_API_KEY":
      return <Img name="minimax" size={size} label="MiniMax" plain />;
    case "AI33_API_KEY":
      return <Ai33 size={size} />;
    case "YOUTUBE_API_KEY":
      return <Img name="youtube" size={size} label="YouTube" />;
    case "PIXABAY_API_KEY":
      return <Img name="pixabay" size={size} label="Pixabay" />;
    default:
      return null;
  }
}

/** The mark for a voice engine on "Set up AI". */
export function VoiceLogo({ id, size = 16 }: { id: string; size?: number }) {
  if (id === "local") return <Chip size={size} />;
  const env = { elevenlabs: "ELEVENLABS_API_KEY", fish: "FISH_AUDIO_API_KEY", minimax: "MINIMAX_API_KEY", ai33: "AI33_API_KEY" }[id];
  return env ? <KeyLogo env={env} size={size} /> : null;
}

/** The mark for a part on "Choose what to install", where it has one. */
export function PartLogo({ id, size = 16 }: { id: string; size?: number }) {
  switch (id) {
    case "ytdlp-pro":
      return <Img name="youtube" size={size} label="YouTube" />;
    case "flow-bridge":
      return <Img name="flow" size={size} label="Google Flow" plain />;
    case "image-scraper":
      return <Img name="google" size={size} label="Google Images" />;
    case "graphics":
    case "renderer":
      return <Img name="remotion" size={size} label="Remotion" />;
    case "tts":
      return <Chip size={size} />;
    default:
      return null;
  }
}
