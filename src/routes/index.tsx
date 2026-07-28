import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DashboardTiles } from "@/components/DashboardTiles";
import { OpenPeriodModal } from "@/components/OpenPeriodModal";
import { WeekBreakdown } from "@/components/WeekBreakdown";
import { GlobalSearchTrigger } from "@/components/GlobalSearch";
import { Button } from "@/components/ui/button";
import {
  useAgents,
  usePeriodClosing,
  usePeriodOpening,
  useTransactions,
  getWeekStart,
  getWeekEnd,
} from "@/lib/db";
import { computeAgentStats } from "@/lib/brain/stats";
import { Zap, Users, ShieldAlert, FileText, Pencil, Wifi } from "lucide-react";
import { formatEtb } from "@/lib/format";
import { firstName, useUserName } from "@/lib/user";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard · EthioTrack" },
      {
        name: "description",
        content: "Today's sales, receipts, open credits and cash variance at a glance.",
      },
      { property: "og:title", content: "EthioTrack — Subdistributor Dashboard" },
      {
        property: "og:description",
        content: "Local-first financial dashboard for Ethiopian telecom subdistributors.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);
  const opening = usePeriodOpening(weekStart);
  const closing = usePeriodClosing(weekStart);
  const txns = useTransactions();
  const agents = useAgents();
  const [manualOpen, setManualOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const userName = useUserName();
  const first = firstName(userName);

  const loading = opening === undefined;
  const needsOpen = opening === null && !dismissed;
  const modalOpen = needsOpen || manualOpen;

  const openCredit = useMemo(() => {
    return agents.reduce((sum, a) => sum + computeAgentStats(a, txns).openCreditSantim, 0);
  }, [agents, txns]);

  const cashVariance = closing ? closing.varianceSantim : null;

  const weekNet = useMemo(() => {
    const inRange = txns.filter((t) => {
      const d = t.date.slice(0, 10);
      return d >= weekStart && d <= weekEnd && !t.isPersonal;
    });
    const inSum = inRange.filter((t) => t.type === "in").reduce((s, t) => s + t.amountSantim, 0);
    const outSum = inRange
      .filter((t) => t.type === "out" || t.type === "expense")
      .reduce((s, t) => s + t.amountSantim, 0);
    return inSum - outSum;
  }, [txns, weekStart, weekEnd]);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
      {first && (
        <div className="hidden md:block">
          <h1 className="text-2xl font-bold tracking-tight">
            {greetingPrefix()}, <span className="text-primary">{first}</span>
          </h1>
          <p className="text-sm text-muted-foreground">Here's your week at a glance.</p>
        </div>
      )}
      <GlobalSearchTrigger />
      {/* Hero week card */}
      <div
        className="relative overflow-hidden rounded-2xl p-5 md:p-6 text-white shadow-[var(--shadow-glow)]"
        style={{ backgroundImage: "var(--gradient-hero)" }}
      >
        {/* faint dot texture */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.12] pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)",
            backgroundSize: "16px 16px",
          }}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/85 font-semibold">
              This week
            </div>
            <div className="mt-1 text-sm text-white/90">
              {weekStart} → {weekEnd}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={
                "inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider " +
                (closing ? "text-white" : "text-white")
              }
            >
              <span
                className={"h-1.5 w-1.5 rounded-full " + (closing ? "bg-white/70" : "bg-money-in")}
              />
              {closing ? "Closed" : opening ? "Open" : "Not opened"}
            </span>
            <Wifi className="h-4 w-4 text-white/60" aria-hidden />
          </div>
        </div>
        <div className="relative mt-5">
          <div className="text-4xl md:text-5xl font-bold tabular-nums tracking-tight">
            {formatEtb(weekNet)}
          </div>
          <div className="text-xs text-white/85 mt-1">Net cash flow this week</div>
        </div>
        {opening && !closing && (
          <div className="relative mt-5 flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setManualOpen(true)}
              className="bg-white/15 hover:bg-white/25 text-white border-0 backdrop-blur"
            >
              <Pencil className="h-3.5 w-3.5 mr-1" /> Adjust opening
            </Button>
            <Link
              to="/close"
              className="inline-flex items-center rounded-md bg-white text-primary px-3 h-8 text-xs font-semibold hover:bg-white/90 transition-colors"
            >
              Close week
            </Link>
          </div>
        )}
        {!opening && !closing && dismissed && (
          <div className="relative mt-5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setManualOpen(true)}
              className="bg-white/15 hover:bg-white/25 text-white border-0 backdrop-blur"
            >
              <Pencil className="h-3.5 w-3.5 mr-1" /> Open the week
            </Button>
          </div>
        )}
      </div>

      <DashboardTiles txns={txns} openCredit={openCredit} cashVariance={cashVariance} />

      <WeekBreakdown />

      {/* Circular quick actions */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { to: "/capture", label: "Capture", icon: Zap },
          { to: "/agents", label: "Agents", icon: Users },
          { to: "/alerts", label: "Alerts", icon: ShieldAlert },
          { to: "/reports", label: "Reports", icon: FileText },
        ].map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className="flex flex-col items-center gap-2 group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="grid place-items-center h-14 w-14 rounded-full bg-card border border-border/60 text-foreground group-hover:border-primary/60 group-hover:text-primary transition-colors">
              <q.icon className="h-5 w-5" />
            </span>
            <span className="text-[11px] font-semibold text-muted-foreground group-hover:text-foreground">
              {q.label}
            </span>
          </Link>
        ))}
      </div>

      {!loading && (
        <OpenPeriodModal
          weekStart={weekStart}
          open={modalOpen}
          existing={manualOpen ? (opening ?? null) : null}
          onOpened={() => {
            setManualOpen(false);
            setDismissed(false);
          }}
          onCancel={() => {
            setManualOpen(false);
            setDismissed(true);
          }}
        />
      )}
    </div>
  );
}

function greetingPrefix() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
