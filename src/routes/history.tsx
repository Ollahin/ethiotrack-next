import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  activeCutoffISO,
  deleteTransaction,
  useArchivedCount,
  useArchivedTransactions,
  useBanks,
  useDistributors,
  useTransactions,
} from "@/lib/db";
import { formatDateTime, formatEtb } from "@/lib/format";
import { CHANNELS, TYPE_LABEL, type TxnType } from "@/lib/types";
import { Trash2, X } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  type: fallback(z.string(), "all").default("all"),
  channel: fallback(z.string(), "all").default("all"),
  bankId: fallback(z.string(), "all").default("all"),
  distributorId: fallback(z.string(), "all").default("all"),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  archive: fallback(z.boolean(), false).default(false),
  review: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History · EthioTrack" },
      {
        name: "description",
        content: "Every transaction you have logged, with filters and search.",
      },
      { property: "og:title", content: "Transaction history · EthioTrack" },
      {
        property: "og:description",
        content: "Filter, search and audit every recorded transaction.",
      },
    ],
  }),
  validateSearch: zodValidator(searchSchema),
  component: HistoryPage,
});

function HistoryPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { q, type, channel, bankId, distributorId, from, to, archive, review } = search;

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({
      search: (prev: typeof search) => ({ ...prev, ...patch }),
      replace: true,
    });

  const active = useTransactions();
  const archived = useArchivedTransactions();
  const archivedCount = useArchivedCount();
  // Auto-load archive when a filter demands data older than the active window.
  const activeCutoffDate = useMemo(() => activeCutoffISO().slice(0, 10), []);
  const needsArchive =
    archive || (!!from && from < activeCutoffDate) || (!!to && to < activeCutoffDate);
  useEffect(() => {
    if (needsArchive && !archive) setSearch({ archive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsArchive]);
  const transactions = useMemo(
    () => (needsArchive ? [...active, ...archived] : active),
    [active, archived, needsArchive],
  );
  const banks = useBanks();
  const distributors = useDistributors();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromIso = from ? from + "T00:00:00" : "";
    const toIso = to ? to + "T23:59:59" : "";
    return transactions.filter((t) => {
      if (type !== "all" && t.type !== type) return false;
      if (channel !== "all" && t.channel !== channel) return false;
      if (bankId !== "all" && t.bankId !== bankId) return false;
      if (distributorId !== "all" && t.distributorId !== distributorId) return false;
      if (review && !t.needsReview) return false;
      if (fromIso && t.date < fromIso) return false;
      if (toIso && t.date > toIso) return false;
      if (needle) {
        const hay = `${t.partyName} ${t.reference ?? ""} ${t.note ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [transactions, q, type, channel, bankId, distributorId, from, to, review]);

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
            onChange={(e) => setSearch({ q: e.target.value })}
            className="md:col-span-2"
          />
          <Select value={type} onValueChange={(v) => setSearch({ type: v })}>
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
          <Select value={channel} onValueChange={(v) => setSearch({ channel: v })}>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Select value={bankId} onValueChange={(v) => setSearch({ bankId: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Bank / wallet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All banks / wallets</SelectItem>
              {banks.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name} · {b.channel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={distributorId} onValueChange={(v) => setSearch({ distributorId: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Distributor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All distributors</SelectItem>
              {distributors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={from}
            onChange={(e) => setSearch({ from: e.target.value })}
            aria-label="From date"
          />
          <Input
            type="date"
            value={to}
            onChange={(e) => setSearch({ to: e.target.value })}
            aria-label="To date"
          />
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
          <Button
            size="sm"
            variant={review ? "secondary" : "outline"}
            className="h-6 px-2 text-xs"
            onClick={() => setSearch({ review: !review })}
          >
            {review ? "✓ Needs review" : "Needs review"}
          </Button>
          {(q ||
            type !== "all" ||
            channel !== "all" ||
            bankId !== "all" ||
            distributorId !== "all" ||
            from ||
            to ||
            review) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() =>
                setSearch({
                  q: "",
                  type: "all",
                  channel: "all",
                  bankId: "all",
                  distributorId: "all",
                  from: "",
                  to: "",
                  archive: false,
                  review: false,
                })
              }
            >
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-ink-soft">
              Showing {needsArchive ? "last 6 months" : "last 3 months"}
              {archivedCount > 0 && (
                <span className="ml-1 opacity-70">({archivedCount} in archive)</span>
              )}
            </span>
            <Button
              size="sm"
              variant={archive ? "secondary" : "outline"}
              onClick={() => setSearch({ archive: !archive })}
              disabled={needsArchive && !archive}
            >
              {archive ? "Hide archive" : "Load archive (3–6 mo)"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-ink-soft">No transactions match.</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <li key={t.id} className="p-3 flex items-center gap-3 hover:bg-muted/40">
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
                    <span className="uppercase font-semibold">{TYPE_LABEL[t.type]}</span>
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
                    {t.needsReview && (
                      <>
                        <span>·</span>
                        <span className="text-airtime font-semibold uppercase">review</span>
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
