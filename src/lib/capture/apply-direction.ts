// Grammar-driven direction correction.
//
// The frozen SMS templates decide direction from keywords. The direction
// engine decides it from grammatical roles, which is strictly more faithful,
// so its verdict wins for money rows. A conflict is never resolved silently:
// the row is flagged for review instead.

import type { ParsedRow } from "../parser";
import { resolveDirection } from "./direction";

function isMoneyRow(type: string): boolean {
  return type === "in" || type === "out";
}

/**
 * Re-derive direction for one parsed money row from its own grammar.
 * Airtime rows are untouched: their stock semantics are owned elsewhere.
 */
export function applyDirection(row: ParsedRow, raw?: string): ParsedRow {
  if (!row.ok) return row;
  if (!isMoneyRow(row.type)) return row;
  const verdict = resolveDirection(raw ?? row.raw);
  if (verdict.conflicts.length > 0 && verdict.evidence.length > 0) {
    // Opposing roles in one message — keep the parser's read but demand a human.
    return { ...row, needsReview: true, directionEvidence: verdict.evidence };
  }
  if (!verdict.resolved) return row;
  if (verdict.direction === "unknown" || verdict.direction === row.type) {
    return { ...row, directionEvidence: verdict.evidence };
  }
  return {
    ...row,
    type: verdict.direction,
    directionEvidence: verdict.evidence,
  };
}
