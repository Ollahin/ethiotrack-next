// Pure agent (downstream buyer) ledger helpers.
//
// Agent linkage is strictly by `Transaction.partyId`. Names, phone numbers,
// spelling similarity and fuzzy matching are never used — an unlinked row is
// simply not part of an agent's history. Only airtime that left the business
// towards the agent ("sent", including legacy direction-less rows) counts as
// delivered; incoming distributor receipts never do. Visible rows are never
// merged or deduplicated.

import { airtimeDirectionOf, airtimeMovementKind, isAirtimeTransaction } from "./airtime-movement";
import { isInRange, type DateRange } from "./distributor-ledger";
import type { Transaction } from "./types";

export interface AgentLedger {
  /** Every transaction linked to the agent in range. */
  count: number;
  /** EVD airtime delivered to the agent, net of reversals, in santim. */
  evdSent: number;
  /** Float airtime delivered to the agent, net of reversals, in santim. */
  floatSent: number;
  /** Airtime taken back from the agent by reversal rows, in santim. */
  reversed: number;
  /** Cash received from the agent (type "in"), in santim. */
  cashIn: number;
  /** Unsettled airtime credit still owed by the agent, in santim. */
  openCredit: number;
  /** How many airtime credits remain unsettled. */
  unsettledCount: number;
}

const EMPTY: AgentLedger = {
  count: 0,
  evdSent: 0,
  floatSent: 0,
  reversed: 0,
  cashIn: 0,
  openCredit: 0,
  unsettledCount: 0,
};

/** Whether an airtime row moved stock towards the agent (reversals included). */
export function isAirtimeSentToAgent(t: Transaction): boolean {
  return isAirtimeTransaction(t) && airtimeDirectionOf(t) === "sent";
}

/**
 * Transactions linked to one agent by id, optionally limited to a date range.
 * Input order is preserved; nothing is merged.
 */
export function agentTransactions(
  txns: Transaction[],
  agentId: string,
  range?: DateRange,
): Transaction[] {
  if (!agentId) return [];
  return txns.filter((t) => t.partyId === agentId && (!range || isInRange(t, range)));
}

/** Totals for one agent over an optional date range. */
export function agentLedger(txns: Transaction[], agentId: string, range?: DateRange): AgentLedger {
  const rows = agentTransactions(txns, agentId, range);
  if (rows.length === 0) return { ...EMPTY };
  const led: AgentLedger = { ...EMPTY, count: rows.length };
  for (const t of rows) {
    if (t.type === "in") {
      led.cashIn += t.amountSantim;
      continue;
    }
    if (!isAirtimeSentToAgent(t)) continue;
    const reversal = airtimeMovementKind(t) === "sent_reversal";
    const signed = reversal ? -t.amountSantim : t.amountSantim;
    if (t.type === "airtime_evd") led.evdSent += signed;
    else led.floatSent += signed;
    if (reversal) {
      // A reversal takes airtime back: it reduces what the agent owes.
      led.reversed += t.amountSantim;
      led.openCredit -= t.amountSantim;
      continue;
    }
    if (!t.isSettled) {
      led.openCredit += t.amountSantim;
      led.unsettledCount += 1;
    }
  }
  return led;
}
