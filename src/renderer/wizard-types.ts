import type { LicenseResult, ShellInfo, VoicePlan, WizardStep } from "../shared/types";

/** Everything the steps fill in. Keys stay in memory only (never in shell.json). */
export interface Draft {
  licenseKey: string;
  githubLogin: string | null;
  license: LicenseResult | null;
  installDir: string;
  oldChoice: "first" | "old" | null;
  oldFolder: string | null;
  parts: string[];
  packs: string[];
  keys: Record<string, string>;
  voice: VoicePlan;
  crashReports: boolean;
  openAtLogin: boolean;
}

export interface StepProps {
  info: ShellInfo;
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  /** Move to a step, saving progress first. */
  go: (step: WizardStep, patch?: Partial<Draft>) => void;
  back: () => void;
}
