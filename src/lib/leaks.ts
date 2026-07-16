import type { LeakFinding, Transaction } from "./types";

const DAY_MS = 86_400_000;

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function detectLeaks(all: Transaction[]): LeakFinding[] {
  const out: LeakFinding[] = [];
  const now = Date.now();

  // 1) Duplicates: same type + amount + party + channel within 10 minutes
  const seen = new Map<string, Transaction[]>();
  for (const t of all) {
    const key = `${t.type}|${t.amountSantim}|${t.party.toLowerCase()}|${t.channel}`;
    seen.set(key, [...(seen.get(key) ?? []), t]);
  }
  for (const group of seen.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const dt =
        new Date(sorted[i].date).getTime() -
        new Date(sorted[i - 1].date).getTime();
      if (dt <= 10 * 60_000) {
        out.push({
          id: `dup:${sorted[i - 1].id}:${sorted[i].id}`,
          severity: "medium",
          kind: "duplicate",
          title: "Possible duplicate transaction",
          reason: `Same ${sorted[i].type} of the same amount to "${sorted[i].party}" via ${sorted[i].channel} within 10 minutes.`,
          txnIds: [sorted[i - 1].id, sorted[i].id],
        });
      }
    }
  }

  // 2) Large outflow: > 3× median of last 30 days of outflows
  const recentOut = all.filter(
    (t) =>
      t.type === "out" && now - new Date(t.date).getTime() < 30 * DAY_MS,
  );
  const med = median(recentOut.map((t) => t.amountSantim));
  if (med > 0) {
    for (const t of recentOut) {
      if (t.amountSantim > med * 3) {
        out.push({
          id: `large:${t.id}`,
          severity: "high",
          kind: "large_outflow",
          title: "Unusually large outflow",
          reason: `More than 3× your 30-day median outflow.`,
          txnIds: [t.id],
        });
      }
    }
  }

  // 3) Airtime spike: single-day airtime > 3× daily average
  const airtime = all.filter((t) => t.type === "airtime");
  if (airtime.length > 3) {
    const byDay = new Map<string, number>();
    for (const t of airtime) {
      const d = t.date.slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + t.amountSantim);
    }
    const avg =
      [...byDay.values()].reduce((a, b) => a + b, 0) / byDay.size;
    for (const [day, total] of byDay) {
      if (total > avg * 3 && total > 5000) {
        const ids = airtime
          .filter((t) => t.date.startsWith(day))
          .map((t) => t.id);
        out.push({
          id: `airspike:${day}`,
          severity: "medium",
          kind: "airtime_spike",
          title: `Airtime spike on ${day}`,
          reason: `Airtime that day is more than 3× your daily average.`,
          txnIds: ids,
        });
      }
    }
  }

  // 4) Aging open credits: unsettled credit > 30 days old
  for (const t of all) {
    if (t.type === "credit" && !t.settled) {
      const age = now - new Date(t.date).getTime();
      if (age > 30 * DAY_MS) {
        out.push({
          id: `aging:${t.id}`,
          severity: age > 60 * DAY_MS ? "high" : "medium",
          kind: "aging_credit",
          title: `Open credit ${Math.floor(age / DAY_MS)}d old`,
          reason: `Credit to "${t.party}" hasn't been marked settled.`,
          txnIds: [t.id],
        });
      }
    }
  }

  // 5) Round-number "test" txn immediately before a large one to same party
  const outs = all
    .filter((t) => t.type === "out")
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < outs.length; i++) {
    const prev = outs[i - 1];
    const cur = outs[i];
    const dt = new Date(cur.date).getTime() - new Date(prev.date).getTime();
    if (
      dt < 30 * 60_000 &&
      prev.party === cur.party &&
      prev.amountSantim <= 10_000 && // <= 100 ETB
      prev.amountSantim % 100_000 === 0 && // round hundred ETB? no — santim
      cur.amountSantim > prev.amountSantim * 20
    ) {
      out.push({
        id: `test:${prev.id}:${cur.id}`,
        severity: "low",
        kind: "test_before_large",
        title: "Small test transfer before a large one",
        reason: `A tiny round transfer to "${cur.party}" was followed by a much larger one within 30 minutes.`,
        txnIds: [prev.id, cur.id],
      });
    }
  }

  return out;
}