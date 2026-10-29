// The narrator the member chose on "Set up AI", as the core reads it from
// user/data/voice-default.json (apps/worker/voicedefault.py).

import type { VoiceEngine, VoicePlan } from "../shared/types";

const ENGINES: readonly VoiceEngine[] = ["elevenlabs", "fish", "minimax", "ai33"];

/** A clean copy of `plan`: anything unknown reads as the local voice. */
export function voiceDefault(plan: Partial<VoicePlan> | null | undefined): VoicePlan {
  if (plan?.mode === "online" && plan.engine && ENGINES.includes(plan.engine)) {
    return { mode: "online", engine: plan.engine };
  }
  return { mode: "local" };
}
