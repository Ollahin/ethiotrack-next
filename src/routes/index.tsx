import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DashboardTiles } from "@/components/DashboardTiles";
import { OpenPeriodModal } from "@/components/OpenPeriodModal";
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
import { Zap, Users, ShieldAlert, FileText, Pencil } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard · EthioTrack" },
      { name: "description", content: "Today's sales, receipts, open credits and cash variance at a glance." },
      { property: "og:title", content: "EthioTrack — Subdistributor Dashboard" },
      { property: "og:description", content: "Local-first financial dashboard for Ethiopian telecom subdistributors." },
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

  const loading = opening === undefined;
  const needsOpen = opening === null;
  const modalOpen = needsOpen || manualOpen;

  const openCredit = useMemo(() => {
    return agents.reduce((sum, a) => sum + computeAgentStats(a, txns).openCreditSantim, 0);
  }, [agents, txns]);

  const cashVariance = closing ? closing.varianceSantim : null;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-ink-soft">
            Week of <span className="font-medium text-foreground">{weekStart} → {weekEnd}</span>
            {closing ? " · closed" : opening ? " · open" : ""}
          </p>
        </div>
        {opening && !closing && (
          <Button variant="outline" size="sm" onClick={() => setManualOpen(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Adjust opening
          </Button>
        )}
      </div>
      <DashboardTiles txns={txns} openCredit={openCredit} cashVariance={cashVariance} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: "/capture", label: "Quick capture", desc: "Paste SMS or drop a PDF", icon: Zap },
          { to: "/agents", label: "Agent Book", desc: "Balances & credit", icon: Users },
          { to: "/alerts", label: "Brain alerts", desc: "Risks & anomalies", icon: ShieldAlert },
          { to: "/reports", label: "Reports", desc: "Weekly & monthly PDF", icon: FileText },
        ].map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className="rounded-xl border border-border bg-card p-4 shadow-sm hover:border-primary/50 transition-colors group"
          >
            <q.icon className="h-5 w-5 text-primary" />
            <div className="mt-2 font-semibold text-sm group-hover:text-primary">{q.label}</div>
            <div className="text-xs text-ink-soft">{q.desc}</div>
          </Link>
        ))}
      </div>

      {!loading && (
        <OpenPeriodModal
          weekStart={weekStart}
          open={modalOpen}
          existing={manualOpen ? opening ?? null : null}
          onOpened={() => setManualOpen(false)}
          onCancel={() => setManualOpen(false)}
        />
      )}
    </div>
  );
}
