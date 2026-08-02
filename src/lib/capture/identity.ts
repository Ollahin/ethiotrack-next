// Deterministic SMS identity.
//
// Every captured message gets ONE stable identity. When the source stated a
// reference number that reference (with its channel) is the identity, because
// it is the only thing the bank itself guarantees to be unique. Without a
// reference the identity is a canonical fingerprint of the message: source,
// direction, account tails, amount, date, party and the normalized raw text.
//
// The point of this module is that the operator is never asked a routine
// "is this a duplicate?" question. A confirmation is only ever raised when two
// identities genuinely collide.

export interface SmsIdentityInput {
  /** Bank/wallet/channel the message came from. */
  source?: string;
  /** "in" | "out" | airtime family — whatever the parser resolved. */
  direction?: string;
  accountTail?: string;
  counterpartyAccountTail?: string;
  amountSantim: number;
  /** Resolved transaction date; only the calendar day takes part. */
  dateIso?: string;
  party?: string;
  reference?: string;
  /** The message exactly as captured. */
  raw: string;
}

/** Lowercase, strip every non-alphanumeric character, collapse whitespace. */
export function normalizeSmsText(raw: string | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u1200-\u137f]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function dayOf(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function key(parts: Array<string | number | undefined>): string {
  return parts.map((p) => (p === undefined || p === null ? "" : String(p))).join("|");
}

/** The reference-based identity, when the source gave a reference number. */
export function referenceIdentity(source: string | undefined, reference: string): string {
  return `ref:${key([normalizeSmsText(source), normalizeSmsText(reference)])}`;
}

/**
 * One identity per message. Reference when present, canonical fingerprint
 * otherwise. Same message twice → same identity. Two genuinely different
 * messages never collide, because the normalized raw text is part of the key.
 */
export function smsIdentity(i: SmsIdentityInput): string {
  if (i.reference && i.reference.trim()) return referenceIdentity(i.source, i.reference);
  return (
    "fp:" +
    key([
      normalizeSmsText(i.source),
      i.direction ?? "",
      i.accountTail ?? "",
      i.counterpartyAccountTail ?? "",
      i.amountSantim,
      dayOf(i.dateIso),
      normalizeSmsText(i.party),
      normalizeSmsText(i.raw),
    ])
  );
}

/**
 * Identity of a transaction that is already stored. Rows written by the inbox
 * carry their identity in `captureKey`; older rows are matched on their
 * reference, which is the only identity they can be given after the fact.
 */
export function transactionIdentity(t: {
  captureKey?: string;
  channel?: string;
  reference?: string;
}): string | null {
  if (t.captureKey && t.captureKey.trim()) return t.captureKey;
  if (t.reference && t.reference.trim()) return referenceIdentity(t.channel, t.reference);
  return null;
}

/** Every identity already present in the ledger. */
export function existingIdentities(
  txns: Array<{ captureKey?: string; channel?: string; reference?: string }>,
): Set<string> {
  const out = new Set<string>();
  for (const t of txns) {
    const id = transactionIdentity(t);
    if (id) out.add(id);
  }
  return out;
}

/** True only for a genuine collision — never for "this row has no reference". */
export function isDuplicateIdentity(identity: string, existing: Set<string>): boolean {
  return existing.has(identity);
}