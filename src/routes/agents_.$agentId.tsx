import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, UserRound } from "lucide-react";
import { getWeekStart, useAgents, useDistributors, useTransactions } from "@/lib/db";
import { agentLedger, agentTransactions } from "@/lib/agent-ledger";
import { shiftWeekStart, weekEndOf, weekRangeOf } from "@/lib/distributor-ledger";
import { formatEtb, formatDateTime } from "@/lib/format";
import type { Transaction } from "@/lib/types";

export const Route = createFileRoute("/agents_/$agentId")({
  head: () => ({
    meta: [
      { title: "Agent history · EthioTrack" },
      {
        name: "description",
        content: "Weekly airtime delivered, cash received and open credit for one sales agent.",
      },
      { property: "og:title", content: "Agent history · EthioTrack" },
      {
        property: "og:description",
        content: "Read-only record of every airtime credit and payment for a sales agent.",
      },
    ],
  }),
  component: AgentHistoryPage,
});

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-soft">{label}</div>
      <div className={"mt-1 text-sm font-bold tabular-nums " + (tone ?? "")}>{value}</div>
    </div>
  );
}

function TxnRow({ t, distributorName }: { t: Transaction; distributorName?: string }) {
  const isPayment = t.type === "in";
  const kind = isPayment ? "Payment" : t.type === "airtime_evd" ? "EVD" : "Float";
  const reversal = t.isReversal === true;
  const action = isPayment ? "Payment" : reversal ? "Reversal" : "Sent";
  return (
    <li className="px-4 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={
              "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded " +
              (isPayment
                ? "bg-money-in/10 text-money-in"
                : t.type === "airtime_evd"
                  ? "bg-airtime/10 text-airtime"
                  : "bg-credit/10 text-credit")
            }
          >
            {kind}
          </span>
          <span
            className={
              "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded " +
              (reversal ? "bg-amber-500/15 text-amber-500" : "bg-muted text-ink-soft")
            }
          >
            {action}
          </span>
          {reversal && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-ink-soft">
              Returned · reduces delivered
            </span>
          )}
          {t.isSettled && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-money-in/10 text-money-in">
              Settled
            </span>
          )}
          {t.needsReview && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">
              Review
            </span>
          )}
        </div>
        <div className="text-[11px] text-ink-soft mt-1 truncate">
          {formatDateTime(t.date)}
          {distributorName ? ` · ${distributorName}` : ""}
          {t.reference ? ` · ${t.reference}` : ""} · {t.source}
        </div>
      </div>
      <div
        className={
          "tabular-nums text-sm font-semibold shrink-0 " +
          (isPayment ? "text-money-in" : "text-money-out")
        }
      >
        {isPayment ? "+" : "−"}
        {formatEtb(t.amountSantim)}
      </div>
    </li>
  );
}

function AgentHistoryPage() {
  const { agentId } = Route.useParams();
  const agents = useAgents();
  const distributors = useDistributors();
  const txns = useTransactions();
  const [weekStart, setWeekStart] = useState(() => getWeekStart());
  const [allRecent, setAllRecent] = useState(false);
  const thisWeekStart = getWeekStart();
  const weekEnd = weekEndOf(weekStart);

  const agent = agents.find((a) => a.id === agentId);
  const range = allRecent ? undefined : weekRangeOf(weekStart);

  const ledger = useMemo(
    () => agentLedger(txns, agentId, range),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txns, agentId, allRecent, weekStart],
  );
  const rows = useMemo(
    () =>
      agentTransactions(txns, agentId, range)
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txns, agentId, allRecent, weekStart],
  );

  const distributorName = (id?: string) =>
    id ? distributors.find((d) => d.id === id)?.name : undefined;

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <Link
        to="/agents"
        className="inline-flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All agents
      </Link>

      <header>
        <div className="flex items-center gap-2">
          <UserRound className="h-5 w-5 text-credit" aria-hidden />
          <h1 className="text-xl md:text-2xl font-bold">{agent?.name ?? "Unknown agent"}</h1>
        </div>
        <p className="text-xs text-ink-soft mt-1">
          {agent
            ? [
                agent.phone || null,
                agent.creditLimitSantim
                  ? `Credit limit ${formatEtb(agent.creditLimitSantim)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "No phone or credit limit recorded."
            : "This agent no longer exists. Any linked transactions are shown below."}
        </p>
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
        {allRecent ? "All recent activity" : `Mon ${weekStart} – Sun ${weekEnd}`} · {ledger.count}{" "}
        txn{ledger.count === 1 ? "" : "s"}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="EVD sent" value={formatEtb(ledger.evdSent)} tone="text-airtime" />
        <Stat label="Float sent" value={formatEtb(ledger.floatSent)} tone="text-credit" />
        <Stat label="Cash received" value={formatEtb(ledger.cashIn)} tone="text-money-in" />
        <Stat
          label={`Open credit · ${ledger.unsettledCount} unsettled`}
          value={formatEtb(ledger.openCredit)}
          tone={ledger.openCredit > 0 ? "text-money-out" : "text-ink-soft"}
        />
      </div>

      <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
        {rows.map((t) => (
          <TxnRow key={t.id} t={t} distributorName={distributorName(t.distributorId)} />
        ))}
        {rows.length === 0 && (
          <li className="p-6 text-center text-sm text-ink-soft">
            No activity recorded for this agent in this period.
          </li>
        )}
      </ul>
    </div>
  );
}
