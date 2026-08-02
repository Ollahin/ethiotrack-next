// Intelligent defaults for inbox review.
//
// These are the answers the app is allowed to fill in by itself, because they
// follow from an exact match or from a decision the operator already made.
// Nothing here is fuzzy and nothing here creates an entity.

import type { BusinessPurpose } from "./purpose";

export interface BankLike {
  id: string;
  channel: string;
  accountNumber?: string;
}

function tailOf(account: string | undefined): string | undefined {
  const digits = (account ?? "").replace(/\D+/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

/**
 * Exact account tail wins: if the message named an account whose last four
 * digits match a configured bank, that bank is selected automatically.
 * Channel is only a fallback, and only when it is unambiguous.
 */
export function autoBank<T extends BankLike>(
  row: { accountTail?: string; channel?: string },
  banks: T[],
): T | null {
  if (row.accountTail) {
    const hit = banks.find((b) => tailOf(b.accountNumber) === row.accountTail);
    if (hit) return hit;
  }
  if (row.channel) {
    const matches = banks.filter((b) => b.channel.toLowerCase() === row.channel!.toLowerCase());
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export interface PurposeSignals {
  direction: "in" | "out" | "unknown";
  /** An agent is linked to this row (matched exactly or chosen by the operator). */
  agentLinked?: boolean;
  /** A distributor is linked to this row. */
  distributorLinked?: boolean;
}

/**
 * The purpose that follows from the links: incoming money from an agent is an
 * agent settlement, outgoing money to a matched distributor is a distributor
 * payment. With no link there is nothing to infer and the purpose stays
 * unresolved — the app never guesses what money was for.
 */
export function autoPurpose(s: PurposeSignals): BusinessPurpose {
  if (s.direction === "in" && s.agentLinked) return "agent_settlement";
  if (s.direction === "out" && s.distributorLinked) return "distributor_payment";
  return "unresolved";
}