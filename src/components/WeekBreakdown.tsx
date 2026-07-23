import { useMemo } from "react";
import { Landmark, Radio } from "lucide-react";
import { useBanks, useDistributors, usePeriodOpening, useTransactions, getWeekStart, getWeekEnd } from "@/lib/db";
import { formatEtb } from "@/lib/format";
import type { Bank, Distributor, Transaction } from "@/lib/types";

function inWeek(t: Transaction, start: string, end: string): boolean {
  const d = t.date.slice(0, 10);
  return d >= start && d <= end && !t.isPersonal;
}

function bankRow(bank: Bank, opening: number, txns: Transaction[]) {
  let inSum = 0, outSum = 0;
  for (const t of txns) {
    if (t.bankId !== bank.id) continue;
    if (t.type === "in") inSum += t.amountSantim;
    else if (t.type === "out" || t.type === "expense") outSum += t.amountSantim;
  }
  return { opening, inSum, outSum, closing: opening + inSum - outSum, count: txns.filter((t) => t.bankId === bank.id).length };
}

function distRow(d: Distributor, evdOpen: number, fltOpen: number, txns: Transaction[]) {
  let evd = 0, flt = 0;
  for (const t of txns) {
    if (t.distributorId !== d.id) continue;
    if (t.type === "airtime_evd") evd += t.amountSantim;
    else if (t.type === "airtime_float") flt += t.amountSantim;
  }
  return {
    evdOpen, fltOpen, evd, flt,
    evdClosing: evdOpen - evd, // stock consumed as it is sold to agents
    fltClosing: fltOpen - flt,
    count: txns.filter((t) => t.distributorId === d.id).length,
  };
}

export function WeekBreakdown() {
  const banks = useBanks();
  const distributors = useDistributors();
  const txns = useTransactions();
  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);
  const opening = usePeriodOpening(weekStart);

  const weekTxns = useMemo(() => txns.filter((t) => inWeek(t, weekStart, weekEnd)), [txns, weekStart, weekEnd]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section className="rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
          <Landmark className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">Banks & wallets this week</h3>
        </header>
        {banks.length === 0 ? (
          <p className="p-4 text-xs text-ink-soft">No banks configured. Add accounts under Banks.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-ink-soft">
                <tr className="border-b border-border/60">
                  <th className="text-left px-4 py-2">Account</th>
                  <th className="text-right px-2 py-2">Opening</th>
                  <th className="text-right px-2 py-2">In</th>
                  <th className="text-right px-2 py-2">Out</th>
                  <th className="text-right px-4 py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {banks.map((b) => {
                  const row = bankRow(b, opening?.bankBalances?.[b.id] ?? 0, weekTxns);
                  return (
                    <tr key={b.id} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-2">
                        <div className="font-semibold truncate">{b.name}</div>
                        <div className="text-[10px] text-ink-soft">{b.channel} · {row.count} txn{row.count === 1 ? "" : "s"}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatEtb(row.opening)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-money-in">+{formatEtb(row.inSum)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-money-out">−{formatEtb(row.outSum)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatEtb(row.closing)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)] overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
          <Radio className="h-4 w-4 text-airtime" aria-hidden />
          <h3 className="text-sm font-semibold">Airtime distributors this week</h3>
        </header>
        {distributors.length === 0 ? (
          <p className="p-4 text-xs text-ink-soft">No distributors configured. Add them under Distributors.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-ink-soft">
                <tr className="border-b border-border/60">
                  <th className="text-left px-4 py-2">Distributor</th>
                  <th className="text-right px-2 py-2">EVD open</th>
                  <th className="text-right px-2 py-2">EVD sold</th>
                  <th className="text-right px-2 py-2">Float open</th>
                  <th className="text-right px-4 py-2">Float sold</th>
                </tr>
              </thead>
              <tbody>
                {distributors.map((d) => {
                  const row = distRow(
                    d,
                    opening?.evdStockByDistributor?.[d.id] ?? 0,
                    opening?.floatStockByDistributor?.[d.id] ?? 0,
                    weekTxns,
                  );
                  return (
                    <tr key={d.id} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-2">
                        <div className="font-semibold truncate">{d.name}</div>
                        <div className="text-[10px] text-ink-soft">{row.count} txn{row.count === 1 ? "" : "s"} · stock left EVD {formatEtb(row.evdClosing)}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatEtb(row.evdOpen)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-airtime">{formatEtb(row.evd)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatEtb(row.fltOpen)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-credit">{formatEtb(row.flt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}