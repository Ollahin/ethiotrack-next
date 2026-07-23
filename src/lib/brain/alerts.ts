import type { Agent, BrainAlert, StatementImport, Transaction } from "../types";
import { computeAgentStats } from "./stats";

const DAY_MS = 86_400_000;

export function computeAlerts(
  agents: Agent[],
  txns: Transaction[],
  imports: StatementImport[],
): BrainAlert[] {
  const out: BrainAlert[] = [];

  for (const a of agents) {
    const s = computeAgentStats(a, txns);
    if (a.creditLimitSantim && s.openCreditSantim > a.creditLimitSantim) {
      out.push({
        id: `overlimit-${a.id}`,
        severity: "high",
        kind: "over_credit_limit",
        title: `${a.name} is over credit limit`,
        reason: "Open credit is above the set limit.",
        agentId: a.id,
      });
    }
    if (s.oldestOpenCreditDays && s.oldestOpenCreditDays > 30) {
      out.push({
        id: `aging-${a.id}`,
        severity: s.oldestOpenCreditDays > 60 ? "high" : "medium",
        kind: "aging_credit",
        title: `${a.name} — credit ${s.oldestOpenCreditDays}d old`,
        reason: "Oldest unsettled credit exceeds 30 days.",
        agentId: a.id,
      });
    }
    if (
      s.avgPaymentDays !== null &&
      s.oldestOpenCreditDays !== null &&
      s.oldestOpenCreditDays > s.avgPaymentDays + 3
    ) {
      out.push({
        id: `overdue-${a.id}`,
        severity: "medium",
        kind: "overdue_credit",
        title: `${a.name} — overdue vs usual`,
        reason: `Usually pays in ~${s.avgPaymentDays.toFixed(1)}d, currently ${s.oldestOpenCreditDays}d.`,
        agentId: a.id,
      });
    }
    if (
      s.avgDistributionSantim !== null &&
      s.distributionStddev !== null &&
      s.distributionStddev > 0
    ) {
      const latest = txns
        .filter(
          (t) =>
            t.partyId === a.id &&
            (t.type === "airtime_evd" || t.type === "airtime_float"),
        )
        .sort((x, y) => (x.date < y.date ? 1 : -1))[0];
      if (latest) {
        const z = (latest.amountSantim - s.avgDistributionSantim) / s.distributionStddev;
        if (z > 3) {
          out.push({
            id: `anom-${a.id}-${latest.id}`,
            severity: "high",
            kind: "distribution_anomaly",
            title: `${a.name} — unusually large distribution`,
            reason: `Latest distribution is ${z.toFixed(1)}σ above their average.`,
            agentId: a.id,
            txnIds: [latest.id],
          });
        }
      }
    }
  }

  const now = Date.now();
  const importedDays = new Set(imports.map((i) => i.importedAt.slice(0, 10)));
  for (let d = 1; d <= 7; d++) {
    const day = new Date(now - d * DAY_MS);
    const wd = day.getDay();
    if (wd === 0 || wd === 6) continue;
    const key = day.toISOString().slice(0, 10);
    if (!importedDays.has(key)) {
      out.push({
        id: `missing-${key}`,
        severity: "low",
        kind: "missing_statement",
        title: `No distributor statement imported on ${key}`,
        reason: "Working day passed with no PDF import.",
      });
    }
  }

  const byKey = new Map<string, Transaction[]>();
  for (const t of txns) {
    const k = `${t.type}|${t.amountSantim}|${t.partyName.toLowerCase()}|${t.channel}`;
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  for (const [, list] of byKey) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < list.length; i++) {
      const dt = new Date(list[i].date).getTime() - new Date(list[i - 1].date).getTime();
      if (dt <= 10 * 60_000) {
        out.push({
          id: `dup-${list[i - 1].id}-${list[i].id}`,
          severity: "medium",
          kind: "duplicate",
          title: `Duplicate: ${list[i].partyName}`,
          reason: "Two identical transactions within 10 minutes.",
          txnIds: [list[i - 1].id, list[i].id],
        });
      }
    }
  }
  return out;
}