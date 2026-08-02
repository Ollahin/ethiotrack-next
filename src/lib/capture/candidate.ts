// Canonical capture candidate.
//
// Every parser in the app funnels into ONE structure. Downstream review,
// readiness and persistence read this shape only, so a new source family can
// never introduce its own private field conventions.

import { parseOne, type ParsedOk } from "../parser";
import { parseFloatEvdSms } from "../float-evd-sms-parser";
import { fingerprintSource, type CaptureSource, type SourceFingerprint } from "./source-fingerprint";
import { segmentSourceRecords, type SourceRecord } from "./segmentation";
import { defaultPurpose, type BusinessPurpose, type MoneyDirection } from "./purpose";

export type TransactionFamily =
  | "bank_credit"
  | "bank_debit"
  | "wallet_in"
  | "wallet_out"
  | "airtime_received"
  | "airtime_sent"
  | "unknown";

export const FAMILY_LABEL: Record<TransactionFamily, string> = {
  bank_credit: "Bank credit",
  bank_debit: "Bank debit",
  wallet_in: "Wallet money received",
  wallet_out: "Wallet money sent",
  airtime_received: "Airtime received",
  airtime_sent: "Airtime sent",
  unknown: "Unresolved",
};

export type DatePrecision = "minute" | "day" | "none";

export interface CaptureCandidate {
  index: number;
  source: CaptureSource;
  channel?: string;
  sourceConfidence: SourceFingerprint["confidence"];
  sourceEvidence: string[];
  sourceConflicts: string[];
  sourceResolved: boolean;

  direction: MoneyDirection;
  family: TransactionFamily;

  /** Amount actually transferred, before charges. */
  principalSantim?: number;
  /** What the account was finally debited/credited. Stated or fully composed. */
  finalAmountSantim?: number;
  feeSantim?: number;
  vatSantim?: number;
  otherChargesSantim?: number;

  party?: string;
  accountTail?: string;
  counterpartyTail?: string;
  counterpartyPhone?: string;
  reference?: string;

  occurredAt?: string;
  datePrecision: DatePrecision;

  /** Full source text, footers included. */
  raw: string;
  attachments: string[];

  missingFields: string[];
  conflictingFields: string[];
  blockingIssues: string[];
  needsReview: boolean;
  purpose: BusinessPurpose;
  template?: string;
}

function bankFamily(direction: MoneyDirection): TransactionFamily {
  return direction === "in" ? "bank_credit" : direction === "out" ? "bank_debit" : "unknown";
}

function walletFamily(direction: MoneyDirection): TransactionFamily {
  return direction === "in" ? "wallet_in" : direction === "out" ? "wallet_out" : "unknown";
}

/**
 * The final debit/credit. Stated totals always win. A total is composed only
 * when every component is present; an incomplete set stays unstated.
 */
export function resolveFinalAmount(parts: {
  statedFinalSantim?: number;
  principalSantim?: number;
  feeSantim?: number;
  vatSantim?: number;
  otherChargesSantim?: number;
  hasCharges: boolean;
}): number | undefined {
  if (parts.statedFinalSantim !== undefined) return parts.statedFinalSantim;
  if (parts.principalSantim === undefined) return undefined;
  if (!parts.hasCharges) return parts.principalSantim;
  if (parts.feeSantim === undefined || parts.vatSantim === undefined) return undefined;
  return (
    parts.principalSantim + parts.feeSantim + parts.vatSantim + (parts.otherChargesSantim ?? 0)
  );
}

function fromParsed(
  record: SourceRecord,
  fp: SourceFingerprint,
  parsed: ParsedOk,
): CaptureCandidate {
  const direction: MoneyDirection =
    parsed.type === "in" ? "in" : parsed.type === "out" ? "out" : "in";
  const airtime = parsed.type !== "in" && parsed.type !== "out";
  const family: TransactionFamily = airtime
    ? "airtime_received"
    : fp.kind === "wallet"
      ? walletFamily(direction)
      : bankFamily(direction);

  const principal = parsed.principalSantim ?? parsed.amountSantim;
  const hasCharges = parsed.feeSantim !== undefined || parsed.vatSantim !== undefined;
  const finalAmount = resolveFinalAmount({
    statedFinalSantim: parsed.finalDebitSantim,
    principalSantim: principal,
    feeSantim: parsed.feeSantim,
    vatSantim: parsed.vatSantim,
    otherChargesSantim: parsed.drChargeSantim,
    hasCharges,
  });

  const missing = [...(parsed.missingFields ?? [])];
  if (finalAmount === undefined) missing.push("final debit/credit");

  return {
    index: record.index,
    source: fp.source,
    channel: parsed.channel ?? fp.channel,
    sourceConfidence: fp.confidence,
    sourceEvidence: fp.evidence,
    sourceConflicts: fp.conflicts,
    sourceResolved: fp.resolved,
    direction,
    family,
    principalSantim: principal,
    finalAmountSantim: finalAmount,
    feeSantim: parsed.feeSantim,
    vatSantim: parsed.vatSantim,
    otherChargesSantim: parsed.drChargeSantim,
    party: parsed.party,
    accountTail: parsed.accountTail,
    counterpartyTail: parsed.counterpartyAccountTail,
    counterpartyPhone: parsed.counterpartyPhone,
    reference: parsed.reference,
    occurredAt: parsed.date,
    datePrecision: parsed.date ? (parsed.dateIsDayOnly ? "day" : "minute") : "none",
    raw: record.raw,
    attachments: record.attachments,
    missingFields: missing,
    conflictingFields: [],
    blockingIssues: parsed.blockingIssues ?? [],
    needsReview: Boolean(parsed.needsReview) || !fp.resolved,
    purpose: defaultPurpose(),
    template: parsed.template,
  };
}

function fromAirtimeSms(record: SourceRecord, fp: SourceFingerprint): CaptureCandidate | null {
  let res;
  try {
    res = parseFloatEvdSms(record.raw);
  } catch {
    return null;
  }
  const event = res.events[0];
  if (!event) return null;
  const outbound = event.direction === "outbound";
  return {
    index: record.index,
    source: fp.source,
    channel: fp.channel,
    sourceConfidence: fp.confidence,
    sourceEvidence: fp.evidence,
    sourceConflicts: fp.conflicts,
    sourceResolved: fp.resolved,
    direction: outbound ? "out" : "in",
    family: outbound ? "airtime_sent" : "airtime_received",
    principalSantim: Math.abs(event.amountMinor),
    finalAmountSantim: Math.abs(event.amountMinor),
    party: event.counterpartyLabel ?? undefined,
    reference: event.transactionReference ?? undefined,
    occurredAt: event.occurredAt ?? undefined,
    datePrecision:
      event.datePrecision === "minute" ? "minute" : event.datePrecision === "date" ? "day" : "none",
    raw: record.raw,
    attachments: record.attachments,
    missingFields: event.occurredAt ? [] : ["date"],
    conflictingFields: [],
    blockingIssues: [],
    needsReview: res.reviewRows.length > 0,
    purpose: defaultPurpose(),
    template: event.eventKind,
  };
}

function unresolvedCandidate(record: SourceRecord, fp: SourceFingerprint): CaptureCandidate {
  return {
    index: record.index,
    source: fp.source,
    channel: fp.channel,
    sourceConfidence: fp.confidence,
    sourceEvidence: fp.evidence,
    sourceConflicts: fp.conflicts,
    sourceResolved: fp.resolved,
    direction: "unknown",
    family: "unknown",
    raw: record.raw,
    attachments: record.attachments,
    datePrecision: "none",
    missingFields: ["amount", "direction", "date"],
    conflictingFields: fp.conflicts,
    blockingIssues: [],
    needsReview: true,
    purpose: defaultPurpose(),
  };
}

/** Build one candidate from one already-segmented source record. */
export function buildCandidate(record: SourceRecord): CaptureCandidate {
  const fp = fingerprintSource(record.raw);
  if (fp.source === "float" || fp.source === "evd") {
    const airtime = fromAirtimeSms(record, fp);
    if (airtime) return airtime;
  }
  const parsed = parseOne(record.raw);
  if (parsed.ok) return fromParsed(record, fp, parsed);
  return unresolvedCandidate(record, fp);
}

/** Full pipeline: raw text → source records → canonical candidates. */
export function buildCandidates(text: string): CaptureCandidate[] {
  return segmentSourceRecords(text).map(buildCandidate);
}
