// Pure adapter: resolved Float/EVD SMS events → production transaction inputs.
//
// The adapter never invents a distributor, agent, amount, reference or date.
// An event that cannot be persisted safely is returned as a blocked row with a
// deterministic reason so the review UI can show it instead of guessing.

import type { SmsEventKind, SmsResolvedEvent } from "./float-evd-sms-parser";
import type { AirtimeDirection, AirtimeForm, Telecom, Transaction, TxnType } from "./types";
import { TELECOM_LABEL } from "./types";

export type SmsAdaptBlockReason = "missing_date" | "missing_distributor";

export interface SmsEventMapping {
  type: Extract<TxnType, "airtime_evd" | "airtime_float">;
  airtimeDirection: AirtimeDirection;
  telecom: Telecom;
}

/** Fixed, evidence-driven mapping. No inference, no defaults. */
export const SMS_EVENT_MAPPING: Record<SmsEventKind, SmsEventMapping> = {
  float_sent_to_agent: {
    type: "airtime_float",
    airtimeDirection: "sent",
    telecom: "safaricom",
  },
  evd_received_from_distributor: {
    type: "airtime_evd",
    airtimeDirection: "received",
    telecom: "ethiotelecom",
  },
  float_received_from_distributor: {
    type: "airtime_float",
    airtimeDirection: "received",
    telecom: "safaricom",
  },
};

export interface SmsEventSelection {
  /** Explicitly selected distributor. Required for every persisted event. */
  distributorId?: string;
  distributorName?: string;
  /** Declared metadata of the selected distributor, used for compatibility. */
  distributorForms?: AirtimeForm[];
  distributorTelecoms?: Telecom[];
  /** Optional for outbound events only. Never guessed. */
  agentId?: string;
  agentName?: string;
  /** Source-local date (YYYY-MM-DD) chosen by the user for undated messages. */
  userSelectedDate?: string;
  /** Import batch this row belongs to. */
  statementImportId?: string;
  isPersonal?: boolean;
}

export type TransactionInput = Omit<Transaction, "id" | "createdAt">;

export type SmsAdaptResult =
  | { ok: true; input: TransactionInput }
  | { ok: false; reason: SmsAdaptBlockReason };

/** Case/whitespace-normalized comparison only. No fuzzy matching. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The airtime form an event kind moves. */
export function formForEventKind(kind: SmsEventKind): AirtimeForm {
  return SMS_EVENT_MAPPING[kind].type === "airtime_evd" ? "evd" : "float";
}

export interface DistributorCompatibilityInput {
  forms?: AirtimeForm[] | null;
  telecoms?: Telecom[] | null;
  /** Exact, operator-configured labels that also identify this distributor. */
  aliases?: string[] | null;
}

/**
 * Whether a distributor may carry an event of this kind. Absent or empty
 * declared metadata stays backward-compatible (treated as unrestricted).
 * No fuzzy matching, no inference.
 */
export function isDistributorCompatible(
  kind: SmsEventKind,
  distributor: DistributorCompatibilityInput | null | undefined,
): boolean {
  if (!distributor) return false;
  const map = SMS_EVENT_MAPPING[kind];
  const form = formForEventKind(kind);
  const forms = distributor.forms ?? [];
  const telecoms = distributor.telecoms ?? [];
  if (forms.length > 0 && !forms.includes(form)) return false;
  if (telecoms.length > 0 && !telecoms.includes(map.telecom)) return false;
  return true;
}

/**
 * Exact normalized-name match against known distributors, or null. Used to
 * preselect a distributor; never to link one automatically at import time.
 * When an event kind is given, incompatible distributors never preselect.
 */
export function matchDistributorByLabel<
  T extends { id: string; name: string } & DistributorCompatibilityInput,
>(label: string | null, distributors: T[], kind?: SmsEventKind): T | null {
  if (!label || !label.trim()) return null;
  const key = normalizeName(label);
  const pool = kind ? distributors.filter((d) => isDistributorCompatible(kind, d)) : distributors;

  const byName = pool.filter((d) => normalizeName(d.name) === key);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return null;

  // Exact configured aliases. Same normalization, same single-hit requirement.
  const byAlias = pool.filter((d) =>
    (d.aliases ?? []).some((a) => typeof a === "string" && normalizeName(a) === key),
  );
  return byAlias.length === 1 ? byAlias[0] : null;
}

/**
 * Resolve the distributor for one event, trying the counterparty label first
 * and then the shop label. Exact matching only; never fuzzy, never creating.
 */
export function matchDistributorForEvent<
  T extends { id: string; name: string } & DistributorCompatibilityInput,
>(
  event: Pick<SmsResolvedEvent, "counterpartyLabel" | "shopLabel" | "eventKind">,
  distributors: T[],
): T | null {
  return (
    matchDistributorByLabel(event.counterpartyLabel, distributors, event.eventKind) ??
    matchDistributorByLabel(event.shopLabel, distributors, event.eventKind)
  );
}

/** The source-local date string this event may be persisted with, or null. */
export function resolveSmsDate(
  event: Pick<SmsResolvedEvent, "occurredAt">,
  userSelectedDate?: string,
): string | null {
  if (event.occurredAt && event.occurredAt.trim()) return event.occurredAt;
  if (userSelectedDate && userSelectedDate.trim()) return userSelectedDate.trim();
  return null;
}

/** Adapt one resolved event into a transaction input, or report why it cannot be. */
export function adaptSmsEvent(
  event: SmsResolvedEvent,
  selection: SmsEventSelection = {},
): SmsAdaptResult {
  const map = SMS_EVENT_MAPPING[event.eventKind];
  const date = resolveSmsDate(event, selection.userSelectedDate);
  if (date === null) return { ok: false, reason: "missing_date" };
  if (!selection.distributorId) return { ok: false, reason: "missing_distributor" };
  // An incompatible distributor is treated as if none had been selected.
  if (
    !isDistributorCompatible(event.eventKind, {
      forms: selection.distributorForms,
      telecoms: selection.distributorTelecoms,
    })
  ) {
    return { ok: false, reason: "missing_distributor" };
  }

  const outbound = map.airtimeDirection === "sent";
  const agentLinked = outbound && Boolean(selection.agentId);

  const partyName = outbound
    ? selection.agentName?.trim() ||
      event.recipientCode ||
      event.counterpartyLabel ||
      "Unassigned agent"
    : selection.distributorName?.trim() || event.counterpartyLabel || "Distributor";

  // Incoming receipts are complete on their own: they never require bilingual
  // pairing. Only outbound distribution depends on pairing and agent linkage.
  const needsReview =
    event.transactionReference === null ||
    (outbound && (event.pairingStatus === "pending" || !agentLinked));

  const input: TransactionInput = {
    type: map.type,
    airtimeDirection: map.airtimeDirection,
    telecom: map.telecom,
    // Stored amounts are always absolute; direction carries the sign.
    amountSantim: Math.abs(event.amountMinor),
    partyName,
    partyId: outbound ? selection.agentId : selection.distributorId,
    partyType: outbound ? (selection.agentId ? "agent" : undefined) : "distributor",
    channel: TELECOM_LABEL[map.telecom],
    distributorId: selection.distributorId,
    reference: event.transactionReference ?? undefined,
    note: event.amharicEvidenceText ?? event.rawAmountText,
    date,
    isPersonal: selection.isPersonal ?? false,
    needsReview,
    source: "sms_import",
    statementImportId: selection.statementImportId,
  };
  return { ok: true, input };
}

export interface SmsAdaptBatchItem {
  event: SmsResolvedEvent;
  selection?: SmsEventSelection;
}

export interface SmsAdaptBatch {
  inputs: TransactionInput[];
  blocked: Array<{ sourceOrder: number; reason: SmsAdaptBlockReason }>;
}

/** Adapt a selected batch, preserving source order and reporting blocked rows. */
export function adaptSmsEvents(items: SmsAdaptBatchItem[]): SmsAdaptBatch {
  const inputs: TransactionInput[] = [];
  const blocked: SmsAdaptBatch["blocked"] = [];
  for (const item of items) {
    const res = adaptSmsEvent(item.event, item.selection ?? {});
    if (res.ok) inputs.push(res.input);
    else blocked.push({ sourceOrder: item.event.sourceOrder, reason: res.reason });
  }
  return { inputs, blocked };
}
