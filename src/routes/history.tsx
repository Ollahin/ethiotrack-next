import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { deleteTransaction, useTransactions } from "@/lib/db";
import { formatDateTime, formatEtb } from "@/lib/format";
import { CHANNELS, TYPE_LABEL, type TxnType } from "@/lib/types";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History · EthioTrack" },
      { name: "description", content: "Every transaction you have logged, with filters and search." },
      { property: "og:title", content: "Transaction history · EthioTrack" },
      { property: "og:description", content: "Filter, search and audit every recorded transaction." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const transactions = useTransactions();
  const [q, setQ] = useState("");
  const [type, setType] = useState<TxnType | "all">("all");
  const [channel, setChannel] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return transactions.filter((t) => {
      if (type !== "all" && t.type !== type) return false;
      if (channel !== "all" && t.channel !== channel) return false;
      if (needle) {
        const hay =
          `${t.partyName} ${t.reference ?? ""} ${t.note ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [transactions, q, type, channel]);

  const totals = useMemo(() => {
    let inSum = 0,
      outSum = 0;
    for (const t of filtered) {
      if (t.type === "in") inSum += t.amountSantim;
      else outSum += t.amountSantim;
    }
    return { inSum, outSum, count: filtered.length };
  }, [filtered]);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input
            placeholder="Search party, ref, note…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="md:col-span-2"
          />
          <Select value={type} onValueChange={(v) => setType(v as TxnType | "all")}>
            <SelectTrigger>
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="in">Money In</SelectItem>
              <SelectItem value="out">Money Out</SelectItem>
              <SelectItem value="airtime_evd">Airtime · EVD</SelectItem>
              <SelectItem value="airtime_float">Airtime · Float</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger>
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-ink-soft">
            {totals.count} transaction{totals.count === 1 ? "" : "s"}
          </span>
          <span className="text-money-in font-semibold tabular-nums">
            + {formatEtb(totals.inSum)}
          </span>
          <span className="text-money-out font-semibold tabular-nums">
            − {formatEtb(totals.outSum)}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-ink-soft">
            No transactions match.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <li
                key={t.id}
                className="p-3 flex items-center gap-3 hover:bg-muted/40"
              >
                <span
                  className={
                    "w-1.5 self-stretch rounded-full " +
                    (t.type === "in"
                      ? "bg-money-in"
                      : t.type === "out"
                        ? "bg-money-out"
                        : t.type === "airtime_evd"
                          ? "bg-airtime"
                          : t.type === "airtime_float"
                            ? "bg-credit"
                            : t.type === "expense"
                              ? "bg-money-out"
                              : "bg-muted-foreground")
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold truncate">{t.partyName}</span>
                    <span
                      className={
                        "font-bold tabular-nums text-sm " +
                        (t.type === "in" ? "text-money-in" : "text-foreground")
                      }
                    >
                      {t.type === "in" ? "+" : "−"} {formatEtb(t.amountSantim)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-soft mt-0.5">
                    <span className="uppercase font-semibold">
                      {TYPE_LABEL[t.type]}
                    </span>
                    <span>·</span>
                    <span>{t.channel}</span>
                    <span>·</span>
                    <span>{formatDateTime(t.date)}</span>
                    {t.reference && (
                      <>
                        <span>·</span>
                        <span>#{t.reference}</span>
                      </>
                    )}
                    {t.isSettled && (
                      <>
                        <span>·</span>
                        <span className="text-money-in font-semibold">settled</span>
                      </>
                    )}
                  </div>
                  {t.note && (
                    <div className="text-[11px] text-ink-soft mt-1 whitespace-pre-wrap break-words">
                      {t.note}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete"
                  onClick={async () => {
                    await deleteTransaction(t.id);
                    toast.success("Deleted");
                  }}
                >
                  <Trash2 className="h-4 w-4 text-money-out" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}