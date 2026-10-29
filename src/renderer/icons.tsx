// VidLift's own line icons (16px grid, 1.6 stroke). No icon library.
import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...p }: P & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      {children}
    </svg>
  );
}

export const IconKey = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="10.5" r="3" />
    <path d="M7.7 8.3 13.5 2.5M11.5 4.5l1.6 1.6M10 6l1.2 1.2" />
  </Svg>
);

export const IconGithub = (p: P) => (
  <Svg {...p}>
    <path d="M6 13.4c-2.6.8-2.6-1.3-3.6-1.6M9.9 14.5v-2.1c0-.7.1-1-.3-1.4 1.9-.2 3.8-.9 3.8-4.1a3.2 3.2 0 0 0-.9-2.2 3 3 0 0 0-.1-2.2s-.7-.2-2.3.9a7.9 7.9 0 0 0-4.1 0C4.4 2.3 3.7 2.5 3.7 2.5a3 3 0 0 0-.1 2.2 3.2 3.2 0 0 0-.9 2.2c0 3.2 1.9 3.9 3.8 4.1-.4.4-.4.8-.3 1.4v2.1" />
  </Svg>
);

export const IconDrive = (p: P) => (
  <Svg {...p}>
    <rect x="1.8" y="4" width="12.4" height="8" rx="2" />
    <path d="M4.5 9.5h.01M7 9.5h4.5" />
  </Svg>
);

export const IconArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
);

export const IconArrowLeft = (p: P) => (
  <Svg {...p}>
    <path d="M13 8H3M7 4 3 8l4 4" />
  </Svg>
);

export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" />
    <path d="M10.5 5.5V3.6c0-.6-.5-1.1-1.1-1.1H3.6c-.6 0-1.1.5-1.1 1.1v5.8c0 .6.5 1.1 1.1 1.1h1.9" />
  </Svg>
);

export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3c0 .6-.5 1-1 1H3.5c-.6 0-1-.4-1-1V5c0-.6.4-1 1-1h3" />
  </Svg>
);

export const IconFolder = (p: P) => (
  <Svg {...p}>
    <path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.5 1.6H13c.7 0 1.2.5 1.2 1.2v6.2c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" />
  </Svg>
);

export const IconRetry = (p: P) => (
  <Svg {...p}>
    <path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3M13.5 2v3h-3" />
  </Svg>
);

export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
);

export const IconEyeOff = (p: P) => (
  <Svg {...p}>
    <path d="M6.6 3.7A6.6 6.6 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.7 2.2M4.2 4.9C2.5 6.1 1.5 8 1.5 8S4 12.5 8 12.5c1.3 0 2.4-.4 3.4-1M6.6 6.6a2 2 0 0 0 2.8 2.8M2 2l12 12" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 8.3 6.6 11.3 12.5 4.8" />
  </Svg>
);

export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Svg>
);

export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.8 14.6 13.5H1.4z" />
    <path d="M8 6.3v3M8 11.4h.01" />
  </Svg>
);

export const IconCross = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.3" />
    <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
  </Svg>
);

export const IconChip = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="8" height="8" rx="1.4" />
    <path d="M6.5 1.8V4M9.5 1.8V4M6.5 12v2.2M9.5 12v2.2M1.8 6.5H4M1.8 9.5H4M12 6.5h2.2M12 9.5h2.2" />
  </Svg>
);

export const IconFile = (p: P) => (
  <Svg {...p}>
    <path d="M9 1.8H4.3c-.6 0-1 .4-1 1v10.4c0 .6.4 1 1 1h7.4c.6 0 1-.4 1-1V5.5z" />
    <path d="M9 1.8v3.7h3.7M5.8 8.5h4.4M5.8 11h3" />
  </Svg>
);

export const IconPower = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.8v5.4M4.4 4a5.2 5.2 0 1 0 7.2 0" />
  </Svg>
);

export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M5 3.2v9.6L12.6 8z" />
  </Svg>
);

/** Status glyphs, 20px boxes: step lists in the rail and the install page. */
export function GlyphDone({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--success)" strokeWidth="1.5" />
      <path d="M6.6 10.2 8.9 12.5 13.4 7.6" fill="none" stroke="var(--success)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GlyphCurrent() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="var(--text)" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="4" fill="var(--text)" />
    </svg>
  );
}

export function GlyphPending() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
    </svg>
  );
}

export function GlyphFailed() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--danger)" strokeWidth="1.5" />
      <path d="M7.4 7.4l5.2 5.2M12.6 7.4l-5.2 5.2" stroke="var(--danger)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphRunning() {
  return (
    <span style={{ width: 20, height: 20, display: "grid", placeItems: "center" }} aria-hidden="true">
      <span className="spinner" />
    </span>
  );
}
