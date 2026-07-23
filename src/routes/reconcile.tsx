import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useBanks, useTransactions } from "@/lib/db";
import { formatEtb, formatDateTime } from "@/lib/format";
import type { Bank, Transaction } from "@/lib/types";

export const Route = createFileRoute("/reconcile")({
  head: () => ({
    meta: [
      { title: "Reconcile · EthioTrack" },
      { name: "description", content: "Per-account bank flows with running balance." },
      { property: "og:title", content: "Bank Reconciliation · EthioTrack" },
      { property: "og:description", content: "See running balances across every bank account." },
    ],
  }),
  component: ReconcilePage,
});

function ReconcilePage() {
  const banks = useBanks();
  const txns = useTransactions();
  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Bank reconciliation</h1>
        <p className="text-sm text-ink-soft">Running balance per bank channel.</p>
      </div>
      {banks.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-ink-soft">
          Add banks first to reconcile.
        </div>
      )}
      {banks.map((b) => <BankBook key={b.id} bank={b} txns={txns} />)}
    </div>
  );
}

function BankBook({ bank, txns }: { bank: Bank; txns: Transaction[] }) {
  const rows = useMemo(() => {
    const filtered = txns
      .filter((t) => t.channel === bank.channel && !t.isPersonal)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    let bal = bank.openingBalanceSantim;
    return filtered.map((t) => {
      const delta = t.type === "in" ? t.amountSantim : -t.amountSantim;
      bal += delta;
      return { t, delta, bal };
    }).reverse();
  }, [bank, txns]);
  const finalBal = rows[0]?.bal ?? bank.openingBalanceSantim;
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="p-3 flex items-baseline justify-between border-b border-border">
        <div>
          <div className="font-semibold">{bank.name}</div>
          <div className="text-[11px] text-ink-soft">{bank.channel}{bank.accountNumber ? ` · ${bank.accountNumber}` : ""}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-ink-soft font-semibold">Balance</div>
          <div className="font-bold tabular-nums">{formatEtb(finalBal)}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-center text-xs text-ink-soft">No activity on this channel yet.</div>
      ) : (
        <ul className="divide-y divide-border max-h-80 overflow-y-auto">
          {rows.map(({ t, delta, bal }) => (
            <li key={t.id} className="p-2 flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{t.partyName}</div>
                <div className="text-[11px] text-ink-soft">{formatDateTime(t.date)} · {t.type}</div>
              </div>
              <div className={"font-bold tabular-nums " + (delta > 0 ? "text-money-in" : "text-money-out")}>
                {delta > 0 ? "+" : "−"} {formatEtb(Math.abs(delta))}
              </div>
              <div className="w-24 text-right text-xs tabular-nums text-ink-soft">{formatEtb(bal)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}