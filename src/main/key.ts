// The licence key's shape (docs/desktop/contracts.md §1). Kept apart from
// license.ts so it can be tested without Electron.

export const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** "vl abcd-efgh jklm npqr" -> "VL-ABCD-EFGH-JKLM-NPQR", or null if it can't be a key. */
export function normalizeKey(input: string): string | null {
  let s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("VL") && s.length === 18) s = s.slice(2);
  if (s.length !== 16 || [...s].some((c) => !KEY_ALPHABET.includes(c))) return null;
  return `VL-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}
