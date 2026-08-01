import { airtimeMovementKind } from "../airtime-movement";
import type { Transaction } from "../types";

/**
 * Open (unsettled) credits for an agent, oldest first. Only ordinary sends
 * create a receivable — a reversal gives airtime back and is never a credit.
 */
export function openCreditsFor(agentId: string, txns: Transaction[]): Transaction[] {
  return txns
    .filter((t) => t.partyId === agentId && airtimeMovementKind(t) === "sent" && !t.isSettled)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function totalOpenCredit(agentId: string, txns: Transaction[]): number {
  return openCreditsFor(agentId, txns).reduce((s, t) => s + t.amountSantim, 0);
}

/**
 * FIFO-apply a payment amount across a list of open credits.
 * Returns which credit ids get fully settled, and any leftover overpayment.
 */
export function planFifoSettlement(
  paymentSantim: number,
  openCredits: Transaction[],
): { settled: string[]; leftover: number } {
  let remaining = paymentSantim;
  const settled: string[] = [];
  for (const c of openCredits) {
    if (remaining <= 0) break;
    if (remaining >= c.amountSantim) {
      settled.push(c.id);
      remaining -= c.amountSantim;
    } else break;
  }
  return { settled, leftover: remaining };
}
