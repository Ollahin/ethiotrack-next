import { airtimeMovementKind, isAirtimeTransaction } from "../airtime-movement";
import { agentLedger } from "../agent-ledger";
import type { Agent, Transaction } from "../types";

export interface AgentStats {
  agentId: string;
  /** Net airtime delivered: ordinary sends minus reversals, in santim. */
  totalOutSantim: number;
  totalInSantim: number;
  /** Airtime taken back by reversal rows, in santim. */
  reversedSantim: number;
  /** Reversal value beyond recorded delivered airtime — a review condition. */
  excessReversalSantim: number;
  openCreditSantim: number;
  unsettledCount: number;
  txnCount: number;
  avgPaymentDays: number | null;
  paymentDaysStddev: number | null;
  avgDistributionSantim: number | null;
  distributionStddev: number | null;
  lastActivity: string | null;
  oldestOpenCreditDays: number | null;
}

function paymentDaysFor(agentId: string, txns: Transaction[]): number[] {
  const credits = txns
    .filter(
      (t) =>
        t.partyId === agentId &&
        isAirtimeTransaction(t) &&
        airtimeMovementKind(t) === "sent" &&
        t.isSettled,
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return credits.map((c) => {
    const settledAt = c.settledAt ?? c.date;
    return Math.max(
      0,
      Math.round((new Date(settledAt).getTime() - new Date(c.date).getTime()) / 86_400_000),
    );
  });
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

export function computeAgentStats(agent: Agent, txns: Transaction[]): AgentStats {
  const mine = txns.filter((t) => t.partyId === agent.id);
  // Reversal-aware totals come from the same ledger Agent History renders.
  const led = agentLedger(txns, agent.id);
  let last: string | null = null;
  const distributionAmounts: number[] = [];
  for (const t of mine) {
    if (!last || t.date > last) last = t.date;
    // Reversals are never sampled as distribution sizes.
    if (airtimeMovementKind(t) === "sent") distributionAmounts.push(t.amountSantim);
  }
  const payDays = paymentDaysFor(agent.id, txns);
  const openCredits = mine.filter(
    (t) => airtimeMovementKind(t) === "sent" && !t.isSettled,
  );
  const oldest = openCredits.map((t) => new Date(t.date).getTime()).sort((a, b) => a - b)[0];
  const oldestDays = oldest ? Math.round((Date.now() - oldest) / 86_400_000) : null;
  return {
    agentId: agent.id,
    totalOutSantim: led.evdSent + led.floatSent,
    totalInSantim: led.cashIn,
    reversedSantim: led.reversed,
    excessReversalSantim: led.excessReversal,
    openCreditSantim: led.openCredit,
    unsettledCount: led.unsettledCount,
    txnCount: mine.length,
    avgPaymentDays: mean(payDays),
    paymentDaysStddev: stddev(payDays),
    avgDistributionSantim: mean(distributionAmounts),
    distributionStddev: stddev(distributionAmounts),
    lastActivity: last,
    oldestOpenCreditDays: oldestDays,
  };
}
