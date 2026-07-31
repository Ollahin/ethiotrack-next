// Distributor payments as trackable EVD purchase intents.
//
// Everything in this module is pure. A purchase intent is *derived* from an
// existing outgoing bank transaction — no transaction is ever copied, mutated
// or deleted here. Fulfilment history lives in append-only `FulfillmentEntry`
// records; corrections append adjustments instead of rewriting entries.
//
// Money rules (non-negotiable):
//   expected EVD  = principal amount        (Transaction.principalSantim ?? amountSantim)
//   bank cash-out = final debit incl. VAT   (Transaction.amountSantim)
// The final debit is never substituted for the expected EVD.

import type {
  Distributor,
  FulfillmentEntry,
  FulfillmentExceptionAction,
  PurchaseIntentStatus,
  SurplusClassification,
  Transaction,
} from "./types";

/** Outstanding intents become overdue 15 minutes after the bank payment. */
export const OVERDUE_AFTER_MS = 15 * 60_000;

/** After this much time, exception actions must carry an explanatory note. */
export const NOTE_REQUIRED_AFTER_MS = 15 * 60_000;

// -- matching ----------------------------------------------------------------

/** Case- and whitespace-insensitive only. No fuzzy matching, ever. */
export function normalizeName(value: string | undefined | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeTail(value: string | undefined | null): string {
  return (value ?? "").replace(/\D+/g, "");
}

/** Digit runs of 4+ characters found in the payment's own text fields. */
export function accountTailsOf(t: Pick<Transaction, "partyName" | "note" | "reference">): string[] {
  const text = [t.partyName, t.note, t.reference].filter(Boolean).join(" ");
  return text.match(/\d{4,}/g) ?? [];
}

function tailMatches(configured: string, candidates: string[]): boolean {
  const tail = normalizeTail(configured);
  if (tail.length < 4) return false;
  return candidates.some((c) => c === tail || c.endsWith(tail));
}

/**
 * The configured distributor a payment strictly belongs to, or null.
 * Matches an exact normalized name, an exact normalized alias, or a configured
 * account tail appearing in the payment text.
 */
export function matchDistributorForPayment(
  t: Pick<Transaction, "partyName" | "note" | "reference" | "partyId">,
  distributors: Distributor[],
): Distributor | null {
  if (t.partyId) {
    const linked = distributors.find((d) => d.id === t.partyId);
    if (linked) return linked;
  }
  const party = normalizeName(t.partyName);
  const tails = accountTailsOf(t);
  for (const d of distributors) {
    if (party && normalizeName(d.name) === party) return d;
    if (party && (d.aliases ?? []).some((a) => normalizeName(a) === party)) return d;
  }
  if (tails.length) {
    for (const d of distributors) {
      if ((d.accountTails ?? []).some((tail) => tailMatches(tail, tails))) return d;
    }
  }
  return null;
}

/** Outgoing money that is not personal. Airtime/credit rows never qualify. */
export function isOutgoingBankPayment(t: Transaction): boolean {
  return t.type === "out" && !t.isPersonal;
}

/** Whether this transaction should appear in the fulfilment queue at all. */
export function isPurchaseIntent(t: Transaction, distributors: Distributor[]): boolean {
  if (t.type !== "out") return false;
  if (t.isPersonal) return false;
  return matchDistributorForPayment(t, distributors) !== null;
}

// -- money -------------------------------------------------------------------

/** Expected EVD to receive: the principal, never the final debit. */
export function expectedEvdSantim(
  t: Pick<Transaction, "principalSantim" | "amountSantim">,
): number {
  const p = t.principalSantim;
  return typeof p === "number" && p >= 0 ? p : t.amountSantim;
}

/** Actual cash that left the bank, including charges and VAT. */
export function finalDebitSantim(t: Pick<Transaction, "amountSantim">): number {
  return t.amountSantim;
}

/** Charges + VAT implied by the pair, never negative. */
export function chargesSantim(t: Pick<Transaction, "principalSantim" | "amountSantim">): number {
  return Math.max(0, finalDebitSantim(t) - expectedEvdSantim(t));
}

// -- time --------------------------------------------------------------------

/** A payment has a usable clock time only when the source recorded one. */
export function paymentTimeKnown(t: Pick<Transaction, "date" | "dateIsDayOnly">): boolean {
  if (t.dateIsDayOnly) return false;
  const d = t.date ?? "";
  if (!d.includes("T")) return false;
  return true;
}

/** Milliseconds since the bank payment, or null when no time is known. */
export function elapsedSincePayment(
  t: Pick<Transaction, "date" | "dateIsDayOnly">,
  now: number,
): number | null {
  if (!paymentTimeKnown(t)) return null;
  const ts = new Date(t.date).getTime();
  if (!Number.isFinite(ts)) return null;
  return now - ts;
}

// -- entries -----------------------------------------------------------------

/** Entries belonging to one intent, in recorded order. Nothing is merged. */
export function entriesForIntent(
  entries: FulfillmentEntry[],
  intentTxnId: string,
): FulfillmentEntry[] {
  return entries
    .filter((e) => e.intentTxnId === intentTxnId)
    .slice()
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
}

/** Sum of receipts and adjustments. Exceptions never move money. */
export function fulfilledSantim(entries: FulfillmentEntry[]): number {
  return entries.reduce((s, e) => (e.kind === "exception" ? s : s + e.amountSantim), 0);
}

/** Latest exception action of a given kind, if any. */
function latestException(entries: FulfillmentEntry[]): FulfillmentEntry | undefined {
  let found: FulfillmentEntry | undefined;
  for (const e of entries) {
    if (e.kind !== "exception") continue;
    if (e.action === "disputed" || e.action === "cancelled") found = e;
  }
  return found;
}

// -- intent ------------------------------------------------------------------

export interface PurchaseIntent {
  /** Identity is the bank transaction — one payment, one intent. */
  txnId: string;
  distributorId: string;
  distributorName: string;
  /** ISO timestamp exactly as stored on the transaction. Never fabricated. */
  paidAt: string;
  timeKnown: boolean;
  elapsedMs: number | null;
  expectedSantim: number;
  finalDebitSantim: number;
  chargesSantim: number;
  fulfilledSantim: number;
  outstandingSantim: number;
  surplusSantim: number;
  status: PurchaseIntentStatus;
  /** True when part — but not all — of the expected EVD has arrived. */
  partial: boolean;
  reference?: string;
  entries: FulfillmentEntry[];
}

/** Derive one purchase intent from a matched payment plus its entry history. */
export function buildPurchaseIntent(
  txn: Transaction,
  distributor: Distributor,
  allEntries: FulfillmentEntry[],
  now: number,
): PurchaseIntent {
  const entries = entriesForIntent(allEntries, txn.id);
  const expected = expectedEvdSantim(txn);
  const fulfilled = fulfilledSantim(entries);
  const outstanding = Math.max(0, expected - fulfilled);
  const surplus = Math.max(0, fulfilled - expected);
  const elapsedMs = elapsedSincePayment(txn, now);
  const exception = latestException(entries);

  let status: PurchaseIntentStatus;
  if (txn.isPersonal) status = "personal";
  else if (exception?.action === "cancelled") status = "cancelled";
  else if (exception?.action === "disputed") status = "disputed";
  else if (outstanding === 0) status = "fulfilled";
  else if (elapsedMs !== null && elapsedMs > OVERDUE_AFTER_MS) status = "overdue";
  else if (fulfilled > 0) status = "partially_fulfilled";
  else status = "pending";

  return {
    txnId: txn.id,
    distributorId: distributor.id,
    distributorName: distributor.name,
    paidAt: txn.date,
    timeKnown: paymentTimeKnown(txn),
    elapsedMs,
    expectedSantim: expected,
    finalDebitSantim: finalDebitSantim(txn),
    chargesSantim: chargesSantim(txn),
    fulfilledSantim: fulfilled,
    outstandingSantim: outstanding,
    surplusSantim: surplus,
    status,
    partial: fulfilled > 0 && outstanding > 0,
    reference: txn.reference,
    entries,
  };
}

/**
 * The full fulfilment queue, newest payment first. Personal payments drop out
 * of the active queue but keep their transaction and entry history intact.
 */
export function buildFulfillmentQueue(
  txns: Transaction[],
  distributors: Distributor[],
  entries: FulfillmentEntry[],
  now: number,
  opts: { includePersonal?: boolean } = {},
): PurchaseIntent[] {
  const out: PurchaseIntent[] = [];
  const seen = new Set<string>();
  for (const t of txns) {
    if (t.type !== "out") continue;
    if (seen.has(t.id)) continue;
    if (t.isPersonal && !opts.includePersonal) continue;
    const dist = matchDistributorForPayment(t, distributors);
    if (!dist) continue;
    seen.add(t.id);
    out.push(buildPurchaseIntent(t, dist, entries, now));
  }
  out.sort((a, b) => (a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0));
  return out;
}

// -- recording receipts ------------------------------------------------------

export interface ReceiptDraft {
  amountSantim: number;
  surplusClassification?: SurplusClassification;
  note?: string;
}

export type ValidationResult = { ok: true; surplusSantim: number } | { ok: false; error: string };

/**
 * Validate a received-EVD amount against an intent. Any total above the
 * expected amount requires an explicit surplus classification — a receipt can
 * never silently exceed what was paid for.
 */
export function validateReceipt(intent: PurchaseIntent, draft: ReceiptDraft): ValidationResult {
  if (!Number.isFinite(draft.amountSantim) || draft.amountSantim <= 0) {
    return { ok: false, error: "Enter a received amount greater than zero." };
  }
  if (intent.status === "cancelled") {
    return { ok: false, error: "This payment is cancelled/refunded." };
  }
  if (intent.status === "personal") {
    return { ok: false, error: "Personal payments are not fulfilled." };
  }
  const total = intent.fulfilledSantim + draft.amountSantim;
  const surplusSantim = Math.max(0, total - intent.expectedSantim);
  if (surplusSantim > 0 && !draft.surplusClassification) {
    return {
      ok: false,
      error: "Received total exceeds the expected EVD. Classify the excess to continue.",
    };
  }
  return { ok: true, surplusSantim };
}

/** Build the immutable receipt entry for an already-validated draft. */
export function makeReceiptEntry(
  intent: PurchaseIntent,
  draft: ReceiptDraft,
  surplusSantim: number,
  id: string,
  recordedAt: string,
): FulfillmentEntry {
  return {
    id,
    intentTxnId: intent.txnId,
    kind: "receipt",
    amountSantim: draft.amountSantim,
    ...(surplusSantim > 0
      ? { surplusSantim, surplusClassification: draft.surplusClassification }
      : {}),
    ...(draft.note?.trim() ? { note: draft.note.trim() } : {}),
    recordedAt,
  };
}

/** A correction never rewrites history — it appends a signed adjustment. */
export function makeAdjustmentEntry(
  intent: PurchaseIntent,
  deltaSantim: number,
  note: string,
  id: string,
  recordedAt: string,
  correctsEntryId?: string,
): FulfillmentEntry {
  return {
    id,
    intentTxnId: intent.txnId,
    kind: "adjustment",
    amountSantim: deltaSantim,
    note: note.trim() || undefined,
    correctsEntryId,
    recordedAt,
  };
}

// -- exceptions --------------------------------------------------------------

/** Exception actions taken more than 15 minutes after payment need a note. */
export function exceptionNoteRequired(intent: PurchaseIntent, now: number): boolean {
  void now;
  const elapsed = intent.elapsedMs;
  if (elapsed === null) return true; // no reliable clock → always explain
  return elapsed > NOTE_REQUIRED_AFTER_MS;
}

export function validateException(
  intent: PurchaseIntent,
  action: FulfillmentExceptionAction,
  note: string | undefined,
  now: number,
): { ok: true } | { ok: false; error: string } {
  if (exceptionNoteRequired(intent, now) && !note?.trim()) {
    return { ok: false, error: `A note is required to mark this payment ${action}.` };
  }
  return { ok: true };
}

export function makeExceptionEntry(
  intent: PurchaseIntent,
  action: FulfillmentExceptionAction,
  note: string | undefined,
  id: string,
  recordedAt: string,
): FulfillmentEntry {
  return {
    id,
    intentTxnId: intent.txnId,
    kind: "exception",
    amountSantim: 0,
    action,
    note: note?.trim() || undefined,
    recordedAt,
  };
}

// -- presentation helpers ----------------------------------------------------

/** Human elapsed label; date-only payments never fabricate a clock. */
export function elapsedLabel(intent: PurchaseIntent): string {
  if (intent.elapsedMs === null) return "date only";
  const mins = Math.floor(intent.elapsedMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ${mins % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}
