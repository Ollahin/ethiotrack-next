// Pure agent-settlement allocation rules.
//
// A cash settlement is applied FIFO against the agent's oldest open airtime
// credits. Allocation is explicit and partial-aware: a 15,000 payment against
// a 50,000 credit allocates 15,000 and leaves 35,000 outstanding, instead of
// silently doing nothing. Nothing here touches storage.

import type { SettlementAllocation, Transaction } from "./types";
import { airtimeMovementKind } from "./airtime-movement";

/** Airtime credits an agent still owes on, oldest first. */
export function agentCredits(agentId: string, txns: Transaction[]): Transaction[] {
  return txns
    .filter((t) => t.partyId === agentId && airtimeMovementKind(t) === "sent")
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

/** How much of one credit has already been settled by allocations. */
export function allocatedAgainst(creditTxnId: string, allocs: SettlementAllocation[]): number {
  let sum = 0;
  for (const a of allocs) if (a.creditTxnId === creditTxnId) sum += a.amountSantim;
  return sum;
}

/** Remaining, never negative, receivable on one credit row. */
export function outstandingOf(credit: Transaction, allocs: SettlementAllocation[]): number {
  if (credit.isSettled) return 0;
  return Math.max(0, credit.amountSantim - allocatedAgainst(credit.id, allocs));
}

export interface PlannedAllocation {
  creditTxnId: string;
  amountSantim: number;
  /** True when this allocation closes the credit completely. */
  closes: boolean;
}

export interface AllocationPlan {
  allocations: PlannedAllocation[];
  /** Payment money beyond every open credit — never allocated, never lost. */
  leftoverSantim: number;
}

/**
 * FIFO-allocate a payment across open credits. Partial allocations are
 * produced when the payment is smaller than the oldest credit.
 */
export function planAllocations(
  paymentSantim: number,
  credits: Transaction[],
  existing: SettlementAllocation[] = [],
): AllocationPlan {
  let remaining = Math.max(0, paymentSantim);
  const allocations: PlannedAllocation[] = [];
  for (const c of credits) {
    if (remaining <= 0) break;
    const open = outstandingOf(c, existing);
    if (open <= 0) continue;
    const take = Math.min(open, remaining);
    allocations.push({ creditTxnId: c.id, amountSantim: take, closes: take === open });
    remaining -= take;
  }
  return { allocations, leftoverSantim: remaining };
}

/** Allocations already recorded for one payment — used to make retry a no-op. */
export function allocationsForPayment(
  paymentTxnId: string,
  allocs: SettlementAllocation[],
): SettlementAllocation[] {
  return allocs.filter((a) => a.paymentTxnId === paymentTxnId);
}

/** Total still owed by an agent, allocation-aware. */
export function agentOutstanding(
  agentId: string,
  txns: Transaction[],
  allocs: SettlementAllocation[],
): { openCredit: number; unsettledCount: number } {
  let openCredit = 0;
  let unsettledCount = 0;
  for (const c of agentCredits(agentId, txns)) {
    const open = outstandingOf(c, allocs);
    if (open > 0) {
      openCredit += open;
      unsettledCount += 1;
    }
  }
  return { openCredit, unsettledCount };
}
