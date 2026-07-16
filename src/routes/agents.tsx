import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTransactions } from "@/lib/db";
import { formatEtb, formatDate } from "@/lib/format";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Agents · EthioTrack" },
      {
        name: "description",
        content: "Totals by counterparty — see who you pay and who pays you.",
      },
    ],
  }),
  component: AgentsPage,
});

interface Row {
  party: string;
  in: number;
  out: number;
  credit: number;
  count: number;
  last: string;
}

function AgentsPage() {
  const { transactions } = useTransactions();

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    for (const t of transactions) {
      const key = t.party.trim() || "Unknown";
      const row = map.get(key) ?? {
        party: key,
        in: 0,
        out: 0,
        credit: 0,
        count: 0,
        last: t.date,
      };
      row.count++;
      if (t.date > row.last) row.last = t.date;
      if (t.type === "in") row.in += t.amountSantim;
      else if (t.type === "credit" && !t.settled) row.credit += t.amountSantim;
      else row.out += t.amountSantim;
      map.set(key, row);
    }
    return [...map.values()].sort(
      (a, b) => b.in + b.out + b.credit - (a.in + a.out + a.credit),
    );
  }, [transactions]);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-ink-soft">
            No agents yet. Log a transaction to get started.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const net = r.in - r.out;
              return (
                <li key={r.party} className="p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold truncate">{r.party}</span>
                    <span
                      className={
                        "font-bold tabular-nums " +
                        (net >= 0 ? "text-money-in" : "text-money-out")
                      }
                    >
                      {net >= 0 ? "+" : "−"} {formatEtb(Math.abs(net))}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-4 gap-2 text-[11px]">
                    <div>
                      <div className="text-ink-soft uppercase font-semibold">In</div>
                      <div className="tabular-nums text-money-in">
                        {formatEtb(r.in, false)}
                      </div>
                    </div>
                    <div>
                      <div className="text-ink-soft uppercase font-semibold">Out</div>
                      <div className="tabular-nums text-money-out">
                        {formatEtb(r.out, false)}
                      </div>
                    </div>
                    <div>
                      <div className="text-ink-soft uppercase font-semibold">
                        Credit
                      </div>
                      <div className="tabular-nums text-credit">
                        {formatEtb(r.credit, false)}
                      </div>
                    </div>
                    <div>
                      <div className="text-ink-soft uppercase font-semibold">
                        Last
                      </div>
                      <div className="text-ink-soft">{formatDate(r.last)}</div>
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-ink-soft uppercase">
                    {r.count} txn · ETB
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}