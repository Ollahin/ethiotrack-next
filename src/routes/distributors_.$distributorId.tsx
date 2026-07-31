import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Radio } from "lucide-react";
import { getWeekStart, useDistributors, useTransactions } from "@/lib/db";
import {
  distributorLedger,
  distributorTransactions,
  rowDirection,
  shiftWeekStart,
  weekEndOf,
  weekRangeOf,
  type AirtimeMovement,
} from "@/lib/distributor-ledger";
import { formatEtb, formatDateTime } from "@/lib/format";
import {
  AIRTIME_FORM_LABEL,
  DISTRIBUTOR_FORMAT_LABEL,
  TELECOM_LABEL,
  type Transaction,
} from "@/lib/types";

export const Route = createFileRoute("/distributors_/$distributorId")({
  head: () => ({
    meta: [
      { title: "Distributor history · EthioTrack" },
      {
        name: "description",
        content: "Weekly EVD and Float movement history for one upstream distributor.",
      },
      { property: "og:title", content: "Distributor history · EthioTrack" },
      {
        property: "og:description",
        content: "Review every airtime receipt and distribution recorded for a distributor.",
      },
    ],
  }),
  component: DistributorHistoryPage,
});

function MovementCard({ label, movement }: { label: string; movement: AirtimeMovement }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-soft">{label}</div>
      <dl className="mt-1 space-y-0.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-ink-soft">Received</dt>
          <dd className="tabular-nums text-money-in">+{formatEtb(movement.received)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-soft">Sent</dt>
          <dd className="tabular-nums text-money-out">−{formatEtb(movement.sent)}</dd>
        </div>
        <div className="flex justify-between gap-2 font-semibold">
          <dt>Net</dt>
          <dd className="tabular-nums">
            {movement.net >= 0 ? "+" : "−"}
            {formatEtb(Math.abs(movement.net))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function TxnRow({ t }: { t: Transaction }) {
  const dir = rowDirection(t);
  const received = dir === "received";
  return (
    <li className="px-4 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={
              "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded " +
              (t.type === "airtime_evd" ? "bg-airtime/10 text-airtime" : "bg-credit/10 text-credit")
            }
          >
            {t.type === "airtime_evd" ? "EVD" : "Float"}
          </span>
          <span
            className={
              "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded " +
              (received ? "bg-money-in/10 text-money-in" : "bg-money-out/10 text-money-out")
            }
          >
            {received ? "Received" : "Sent"}
          </span>
          {t.needsReview && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">
              Review
            </span>
          )}
        </div>
        <div className="mt-1 text-sm font-semibold truncate">{t.partyName || "—"}</div>
        <div className="text-[11px] text-ink-soft truncate">
          {formatDateTime(t.date)}
          {t.reference ? ` · ${t.reference}` : ""} · {t.source}
        </div>
      </div>
      <div
        className={
          "tabular-nums text-sm font-semibold shrink-0 " +
          (received ? "text-money-in" : "text-money-out")
        }
      >
        {received ? "+" : "−"}
        {formatEtb(t.amountSantim)}
      </div>
    </li>
  );
}

function DistributorHistoryPage() {
  const { distributorId } = Route.useParams();
  const distributors = useDistributors();
  const txns = useTransactions();
  const [weekStart, setWeekStart] = useState(() => getWeekStart());
  const [allRecent, setAllRecent] = useState(false);
  const thisWeekStart = getWeekStart();
  const weekEnd = weekEndOf(weekStart);

  const dist = distributors.find((d) => d.id === distributorId);

  const range = allRecent ? undefined : weekRangeOf(weekStart);
  const ledger = useMemo(
    () => distributorLedger(txns, distributorId, range),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txns, distributorId, allRecent, weekStart],
  );
  const rows = useMemo(
    () => distributorTransactions(txns, distributorId, range),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txns, distributorId, allRecent, weekStart],
  );

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <Link
        to="/distributors"
        className="inline-flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All distributors
      </Link>

      <header>
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-airtime" aria-hidden />
          <h1 className="text-xl md:text-2xl font-bold">{dist?.name ?? "Unknown distributor"}</h1>
        </div>
        {dist && (
          <>
            <div className="flex flex-wrap gap-1 mt-2">
              {(dist.telecoms ?? []).map((t) => (
                <span
                  key={t}
                  className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                >
                  {TELECOM_LABEL[t]}
                </span>
              ))}
              {(dist.forms ?? []).map((f) => (
                <span
                  key={f}
                  className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-ink-soft"
                >
                  {AIRTIME_FORM_LABEL[f]}
                </span>
              ))}
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-airtime/10 text-airtime">
                {DISTRIBUTOR_FORMAT_LABEL[dist.statementFormat ?? "generic"]}
              </span>
            </div>
            {dist.contact && <p className="text-xs text-ink-soft mt-1">{dist.contact}</p>}
          </>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setAllRecent(false);
            setWeekStart((w) => shiftWeekStart(w, -1));
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous week
        </button>
        <button
          type="button"
          onClick={() => {
            setAllRecent(false);
            setWeekStart((w) => shiftWeekStart(w, 1));
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          Next week <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setAllRecent(false);
            setWeekStart(thisWeekStart);
          }}
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          This week
        </button>
        <button
          type="button"
          onClick={() => setAllRecent((v) => !v)}
          className={
            "rounded-lg border px-2.5 py-1.5 text-xs font-semibold " +
            (allRecent
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card hover:bg-muted")
          }
        >
          All recent activity
        </button>
      </div>

      <p className="text-xs text-ink-soft tabular-nums">
        {allRecent ? "Last 3 months of activity" : `Mon ${weekStart} – Sun ${weekEnd}`} ·{" "}
        {ledger.count} txn{ledger.count === 1 ? "" : "s"}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MovementCard label="EVD" movement={ledger.evd} />
        <MovementCard label="Float" movement={ledger.float} />
      </div>

      <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
        {rows.map((t) => (
          <TxnRow key={t.id} t={t} />
        ))}
        {rows.length === 0 && (
          <li className="p-6 text-center text-sm text-ink-soft">
            No airtime activity recorded for this distributor in this period.
          </li>
        )}
      </ul>
    </div>
  );
}
