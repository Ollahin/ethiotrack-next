// Shared text helpers for SMS/notification parsing.
// Kept dependency-free so both the generic parser and the dedicated bank
// parsers can use them without import cycles.

/** Replace exotic Unicode spaces with plain spaces and trim. */
export function normalizeSms(raw: string): string {
  return raw
    .replace(/[\u00A0\u1680\u180E\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, " ")
    .trim();
}

/** Collapse wrapped lines so a multiline SMS reads as one sentence. */
export function flattenSms(raw: string): string {
  return normalizeSms(raw)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ");
}

/** Last four digits of an account/wallet string, or undefined. */
export function last4(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const digits = s.replace(/\D+/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}
