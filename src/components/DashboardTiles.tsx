import { formatEtb } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import {
  ArrowDownRight,
  ArrowUpRight,
  Phone,
  Wallet,
} from "lucide-react";

function isToday(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

export function DashboardTiles({ txns }: { txns: Transaction[] }) {
  const today = txns.filter((t) => isToday(t.date));
  const moneyIn = today
    .filter((t) => t.type === "in")
    .reduce((a, t) => a + t.amountSantim, 0);
  const moneyOut = today
    .filter((t) => t.type === "out")
    .reduce((a, t) => a + t.amountSantim, 0);
  const airtime = today
    .filter((t) => t.type === "airtime")
    .reduce((a, t) => a + t.amountSantim, 0);
  const credit = txns
    .filter((t) => t.type === "credit" && !t.settled)
    .reduce((a, t) => a + t.amountSantim, 0);

  const tiles = [
    {
      label: "Money In",
      value: moneyIn,
      sub: "today",
      color: "bg-money-in",
      Icon: ArrowDownRight,
    },
    {
      label: "Money Out",
      value: moneyOut,
      sub: "today",
      color: "bg-money-out",
      Icon: ArrowUpRight,
    },
    {
      label: "Airtime",
      value: airtime,
      sub: "today",
      color: "bg-airtime",
      Icon: Phone,
    },
    {
      label: "Credit open",
      value: credit,
      sub: "outstanding",
      color: "bg-credit",
      Icon: Wallet,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map(({ label, value, sub, color, Icon }) => (
        <div
          key={label}
          className="relative overflow-hidden rounded-xl bg-card border border-border shadow-sm p-3 flex gap-3"
        >
          <div
            className={`${color} w-1 -my-3 -ml-3 rounded-l-xl`}
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {label}
              </span>
              <Icon className="h-3.5 w-3.5 text-ink-soft" />
            </div>
            <div className="mt-1 text-lg font-extrabold tabular-nums truncate">
              {formatEtb(value, false)}
            </div>
            <div className="text-[10px] text-ink-soft uppercase tracking-wide">
              ETB · {sub}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}