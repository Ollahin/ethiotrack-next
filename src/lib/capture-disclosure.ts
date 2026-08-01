// Progressive disclosure rules for the capture review list.
//
// Pure predicates, so "the dropdown disappears when the match is certain" is a
// tested rule and not an accident of JSX. A control is shown only when the
// operator actually has a decision to make.

export type RowReadiness = "ready" | "needs_attention" | "incomplete";

export interface RowDecisionInput {
  /** Parser recovered every field it needs to persist this row. */
  parsedOk: boolean;
  /** Hard financial blockers (bad arithmetic, malformed money). */
  blockers: number;
  /** A date is available (from the source or supplied by the reviewer). */
  hasDate: boolean;
  /** The row requires a counterparty link before it can be saved. */
  requiresCounterparty: boolean;
  /** A counterparty is linked (matched exactly or chosen by the operator). */
  counterpartyLinked: boolean;
  /** Link came from an exact/strict match rather than a guess. */
  counterpartyCertain: boolean;
  /** Parser flagged the row for human review. */
  needsReview: boolean;
}

/** Three-way readiness used for both the per-row badge and the batch summary. */
export function rowReadiness(input: RowDecisionInput): RowReadiness {
  if (!input.parsedOk || input.blockers > 0) return "incomplete";
  if (!input.hasDate) return "incomplete";
  if (input.requiresCounterparty && !input.counterpartyLinked) return "incomplete";
  if (input.needsReview || (input.requiresCounterparty && !input.counterpartyCertain))
    return "needs_attention";
  return "ready";
}

/** Only ready rows are pre-ticked. Everything else needs a human decision. */
export function defaultChecked(input: RowDecisionInput): boolean {
  return rowReadiness(input) === "ready";
}

/**
 * The counterparty picker is collapsed to a chip when the link is both present
 * and certain; the operator can still expand it explicitly.
 */
export function showCounterpartyPicker(
  input: Pick<
    RowDecisionInput,
    "requiresCounterparty" | "counterpartyLinked" | "counterpartyCertain"
  >,
  expanded = false,
): boolean {
  if (!input.requiresCounterparty) return false;
  if (expanded) return true;
  return !(input.counterpartyLinked && input.counterpartyCertain);
}

/**
 * A bank payment to a distributor is never an agent credit, so the agent
 * selector must never appear on it — showing it invites a wrong link.
 */
export function showAgentPicker(row: {
  isBankTransfer: boolean;
  airtimeDirection?: "sent" | "received";
  isAirtime: boolean;
}): boolean {
  if (row.isBankTransfer) return false;
  if (!row.isAirtime) return true;
  return (row.airtimeDirection ?? "sent") === "sent";
}

export interface BatchSummary {
  total: number;
  ready: number;
  needsAttention: number;
  incomplete: number;
}

export function summarizeReadiness(rows: RowDecisionInput[]): BatchSummary {
  const summary: BatchSummary = { total: rows.length, ready: 0, needsAttention: 0, incomplete: 0 };
  for (const r of rows) {
    const state = rowReadiness(r);
    if (state === "ready") summary.ready++;
    else if (state === "needs_attention") summary.needsAttention++;
    else summary.incomplete++;
  }
  return summary;
}
