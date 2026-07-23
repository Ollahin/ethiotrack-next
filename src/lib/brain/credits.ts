import type { Transaction } from "../types";

/** Open (unsettled) credits for an agent, oldest first. */
export function openCreditsFor(
  agentId: string,
  txns: Transaction[],
): Transaction[] {
  return txns
    .filter(
      (t) =>
        t.partyId === agentId &&
        (t.type === "airtime_evd" || t.type === "airtime_float") &&
        !t.isSettled,
    )
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