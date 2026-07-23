import type { Transaction } from "@/lib/types";
import { formatEtb } from "@/lib/format";

function todayKey() { return new Date().toISOString().slice(0, 10); }

export function DashboardTiles({ txns, openCredit, cashVariance }: {
  txns: Transaction[];
  openCredit: number;
  cashVariance: number | null;
}) {
  const today = todayKey();
  const t = txns.filter((x) => x.date.slice(0, 10) === today && !x.isPersonal);
  const sum = (type: Transaction["type"]) =>
    t.filter((x) => x.type === type).reduce((s, x) => s + x.amountSantim, 0);
  const salesToday = sum("airtime_evd") + sum("airtime_float");
  const receiptsToday = sum("in");

  const tiles = [
    { label: "Today's Sales", value: salesToday, color: "text-airtime", bar: "bg-airtime" },
    { label: "Today's Receipts", value: receiptsToday, color: "text-money-in", bar: "bg-money-in" },
    { label: "Open Credits", value: openCredit, color: "text-credit", bar: "bg-credit" },
    {
      label: "Cash Variance",
      value: cashVariance ?? 0,
      color: cashVariance === null ? "text-ink-soft" : cashVariance === 0 ? "text-foreground" : "text-money-out",
      bar: cashVariance === null ? "bg-muted" : cashVariance === 0 ? "bg-foreground/20" : "bg-money-out",
      hint: cashVariance === null ? "Day not closed" : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl bg-card border border-border p-3 shadow-sm relative overflow-hidden">
          <div className={"absolute top-0 left-0 h-1 w-full " + t.bar} />
          <div className="text-[11px] uppercase tracking-wide text-ink-soft font-semibold mt-1">
            {t.label}
          </div>
          <div className={"mt-1 text-lg md:text-xl font-bold tabular-nums " + t.color}>
            {formatEtb(t.value)}
          </div>
          {t.hint && <div className="text-[10px] text-ink-soft mt-0.5">{t.hint}</div>}
        </div>
      ))}
    </div>
  );
}