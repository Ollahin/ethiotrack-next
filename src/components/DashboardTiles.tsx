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
      color: cashVariance === null ? "text-muted-foreground" : cashVariance === 0 ? "text-foreground" : "text-money-out",
      bar: cashVariance === null ? "bg-muted-foreground/40" : cashVariance === 0 ? "bg-foreground/30" : "bg-money-out",
      hint: cashVariance === null ? "Day not closed" : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="relative rounded-2xl bg-card border border-border/60 p-4 overflow-hidden shadow-[var(--shadow-card)]"
        >
          <div className={"absolute inset-y-3 left-0 w-[3px] rounded-r-full " + t.bar} />
          <div className="flex items-center gap-2">
            <span className={"h-1.5 w-1.5 rounded-full " + t.bar} />
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {t.label}
            </div>
          </div>
          <div className={"mt-2 text-lg md:text-xl lg:text-2xl font-bold tabular-nums whitespace-nowrap " + t.color}>
            {formatEtb(t.value)}
          </div>
          {t.hint && <div className="text-[10px] text-muted-foreground mt-1">{t.hint}</div>}
        </div>
      ))}
    </div>
  );
}