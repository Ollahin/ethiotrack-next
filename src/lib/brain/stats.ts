import type { Agent, Transaction } from "../types";

export interface AgentStats {
  agentId: string;
  totalOutSantim: number;
  totalInSantim: number;
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
        (t.type === "airtime_evd" || t.type === "airtime_float") &&
        t.isSettled,
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return credits.map((c) => {
    const settledAt = c.settledAt ?? c.date;
    return Math.max(
      0,
      Math.round(
        (new Date(settledAt).getTime() - new Date(c.date).getTime()) /
          86_400_000,
      ),
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
  return Math.sqrt(
    xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1),
  );
}

export function computeAgentStats(
  agent: Agent,
  txns: Transaction[],
): AgentStats {
  const mine = txns.filter((t) => t.partyId === agent.id);
  let totalOut = 0, totalIn = 0, openCredit = 0, unsettled = 0;
  let last: string | null = null;
  const distributionAmounts: number[] = [];
  for (const t of mine) {
    if (!last || t.date > last) last = t.date;
    if (t.type === "in") totalIn += t.amountSantim;
    if (t.type === "airtime_evd" || t.type === "airtime_float") {
      totalOut += t.amountSantim;
      distributionAmounts.push(t.amountSantim);
      if (!t.isSettled) { openCredit += t.amountSantim; unsettled++; }
    }
  }
  const payDays = paymentDaysFor(agent.id, txns);
  const openCredits = mine.filter(
    (t) =>
      (t.type === "airtime_evd" || t.type === "airtime_float") && !t.isSettled,
  );
  const oldest = openCredits.map((t) => new Date(t.date).getTime()).sort((a, b) => a - b)[0];
  const oldestDays = oldest ? Math.round((Date.now() - oldest) / 86_400_000) : null;
  return {
    agentId: agent.id,
    totalOutSantim: totalOut,
    totalInSantim: totalIn,
    openCreditSantim: openCredit,
    unsettledCount: unsettled,
    txnCount: mine.length,
    avgPaymentDays: mean(payDays),
    paymentDaysStddev: stddev(payDays),
    avgDistributionSantim: mean(distributionAmounts),
    distributionStddev: stddev(distributionAmounts),
    lastActivity: last,
    oldestOpenCreditDays: oldestDays,
  };
}