// Readiness state machine.
//
// Four states, no others. The import button counts READY rows only, so every
// gate that stands between a capture and a saved transaction lives here and is
// tested, instead of being scattered across JSX conditions.

export type ReadinessState = "READY" | "NEEDS_ATTENTION" | "INCOMPLETE" | "INVALID";

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
  /** Parser flagged something for a human to look at. */
  needsReview?: boolean;
  /**
   * The source gave no reference number, so duplicate detection can only fall
   * back on a heuristic. The reviewer must acknowledge that risk explicitly.
   */
  duplicateRisk?: boolean;
  /** The reviewer acknowledged that duplicate risk. */
  duplicateRiskAcknowledged?: boolean;
}

export function rowReadiness(i: ReadinessInput): ReadinessState {
  if (i.financialBlockers > 0) return "INVALID";
  if (!i.sourceResolved || !i.familyResolved) return "INCOMPLETE";
  if (!i.hasDate) return "INCOMPLETE";
  if (!i.accountSelected) return "INCOMPLETE";
  if (!i.purposeResolved) return "INCOMPLETE";
  if (i.requiresLink && !i.linkSatisfied) return "INCOMPLETE";
  if (i.duplicateRisk && !i.duplicateRiskAcknowledged) return "NEEDS_ATTENTION";
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
