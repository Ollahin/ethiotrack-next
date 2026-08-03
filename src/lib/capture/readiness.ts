// Readiness state machine.
//
// Four states, no others. The import button counts READY rows only, so every
// gate that stands between a capture and a saved transaction lives here and is
// tested, instead of being scattered across JSX conditions.

export type ReadinessState = "READY" | "NEEDS_ATTENTION" | "INCOMPLETE" | "INVALID";

/** Machine-readable reasons. Every row shows the exact reason it is held. */
export type BlockerCode =
  | "invalid_amounts"
  | "unreadable_message"
  | "choose_source"
  | "choose_date"
  | "date_conflict"
  | "choose_account"
  | "choose_purpose"
  | "choose_agent"
  | "choose_distributor"
  | "duplicate_collision"
  | "recipient_mismatch"
  | "needs_review";

export interface Blocker {
  code: BlockerCode;
  message: string;
}

export interface ReadinessInput {
  /** Issuer/channel resolved (fingerprint or operator choice). */
  sourceResolved: boolean;
  /** Transaction family resolved. */
  familyResolved: boolean;
  /** Hard financial failures: malformed money, arithmetic mismatch. */
  financialBlockers: number;
  /** A date is available, from the source or supplied by the reviewer. */
  hasDate: boolean;
  /** A bank/wallet account is selected for the money leg. */
  accountSelected: boolean;
  /** A business purpose other than "unresolved" has been chosen. */
  purposeResolved: boolean;
  /** The purpose needs an explicit agent/distributor link. */
  requiresLink: boolean;
  /** That link has been made explicitly by the operator. */
  linkSatisfied: boolean;
  /** The link was an exact match rather than an operator override/guess. */
  linkCertain?: boolean;
  /** The link needed is a distributor rather than an agent. */
  linkKind?: "agent" | "distributor";
  /** A confirmed correction disagrees with the day the message stated. */
  dateConflict?: boolean;
  /** The day the message itself stated — used to spell out a conflict. */
  sourceDay?: string;
  /** The day the reviewer's correction proposes. */
  correctedDay?: string;
  /** The linked party's name does not match the name in the message. */
  recipientMismatch?: boolean;
  /** Name in the message, used to spell out a recipient mismatch. */
  messageParty?: string;
  /** Name of the party the operator linked. */
  linkedParty?: string;
  /** Parser flagged something for a human to look at. */
  needsReview?: boolean;
  /**
   * A genuine identity collision was detected with a row that already exists.
   * This is never set merely because a message carried no reference number.
   */
  duplicateRisk?: boolean;
  /** The reviewer confirmed the collision is not actually a repeat. */
  duplicateRiskAcknowledged?: boolean;
}

export function rowReadiness(i: ReadinessInput): ReadinessState {
  if (i.financialBlockers > 0) return "INVALID";
  if (!i.sourceResolved || !i.familyResolved) return "INCOMPLETE";
  if (!i.hasDate) return "INCOMPLETE";
  if (i.dateConflict) return "NEEDS_ATTENTION";
  if (!i.accountSelected) return "INCOMPLETE";
  if (!i.purposeResolved) return "INCOMPLETE";
  if (i.requiresLink && !i.linkSatisfied) return "INCOMPLETE";
  if (i.duplicateRisk && !i.duplicateRiskAcknowledged) return "NEEDS_ATTENTION";
  if (i.recipientMismatch) return "NEEDS_ATTENTION";
  if (i.needsReview) return "NEEDS_ATTENTION";
  if (i.requiresLink && i.linkCertain === false) return "NEEDS_ATTENTION";
  return "READY";
}

export function isReady(i: ReadinessInput): boolean {
  return rowReadiness(i) === "READY";
}

export interface ReadinessSummary {
  total: number;
  ready: number;
  needsAttention: number;
  incomplete: number;
  invalid: number;
}

export function summarizeReadinessStates(rows: ReadinessInput[]): ReadinessSummary {
  const s: ReadinessSummary = {
    total: rows.length,
    ready: 0,
    needsAttention: 0,
    incomplete: 0,
    invalid: 0,
  };
  for (const r of rows) {
    const state = rowReadiness(r);
    if (state === "READY") s.ready++;
    else if (state === "NEEDS_ATTENTION") s.needsAttention++;
    else if (state === "INCOMPLETE") s.incomplete++;
    else s.invalid++;
  }
  return s;
}

export const READINESS_LABEL: Record<ReadinessState, string> = {
  READY: "ready",
  NEEDS_ATTENTION: "needs attention",
  INCOMPLETE: "incomplete",
  INVALID: "invalid",
};

/**
 * The single concise blocker shown on a row. One engine decides the status,
 * the sentence and whether the row may be imported, so the badge, the message
 * and the Import count can never disagree.
 */
export function rowBlocker(i: ReadinessInput): string | null {
  if (i.financialBlockers > 0) return "Amounts do not add up";
  if (!i.familyResolved) return "Could not read this message";
  if (!i.sourceResolved) return "Choose source";
  if (!i.hasDate) return "Choose date";
  if (!i.accountSelected) return "Choose account";
  if (!i.purposeResolved) return "Choose purpose";
  if (i.requiresLink && !i.linkSatisfied) return "Choose agent";
  if (i.duplicateRisk && !i.duplicateRiskAcknowledged) return "Confirm possible duplicate";
  if (i.needsReview) return "Check this message";
  if (i.requiresLink && i.linkCertain === false) return "Confirm the link";
  return null;
}

export interface RowEvaluation {
  state: ReadinessState;
  blocker: string | null;
  canImport: boolean;
}

export function evaluateRow(i: ReadinessInput): RowEvaluation {
  const state = rowReadiness(i);
  return { state, blocker: rowBlocker(i), canImport: state === "READY" };
}

/** How many rows the Import button will actually write. */
export function importableCount(rows: ReadinessInput[]): number {
  return rows.reduce((n, r) => n + (rowReadiness(r) === "READY" ? 1 : 0), 0);
}
