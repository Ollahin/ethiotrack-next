import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { DashboardTiles } from "@/components/DashboardTiles";
import { OpenDayModal } from "@/components/OpenDayModal";
import {
  useAgents,
  useDailyClosing,
  useDailyOpening,
  useTransactions,
} from "@/lib/db";
import { computeAgentStats } from "@/lib/brain/stats";
import { Zap, Users, ShieldAlert, FileText } from "lucide-react";

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

function todayKey() { return new Date().toISOString().slice(0, 10); }

function DashboardPage() {
  const date = todayKey();
  const opening = useDailyOpening(date);
  const closing = useDailyClosing(date);
  const txns = useTransactions();
  const agents = useAgents();
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    // Show the modal only after we've confirmed there is no opening today.
    if (opening === undefined) return; // still loading
    setModalOpen(opening === null || opening === undefined ? opening === null || opening === undefined : false);
    // opening will be `undefined` while loading, `undefined` again if none; we
    // detect "none" by waiting one microtask; simpler: rely on the effect
    // running after live-query settles.
  }, [opening]);

  // A cleaner rule: if the live query has run (opening is not the initial
  // undefined), and there's still no record, open the modal.
  const noOpening = opening === undefined ? false : !opening;
  useEffect(() => { setModalOpen(noOpening); }, [noOpening]);

  const openCredit = useMemo(() => {
    return agents.reduce((sum, a) => sum + computeAgentStats(a, txns).openCreditSantim, 0);
  }, [agents, txns]);

  const cashVariance = closing ? closing.varianceSantim : null;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-ink-soft">Local ledger for Ethiopian telecom subdistributors.</p>
      </div>
      <DashboardTiles txns={txns} openCredit={openCredit} cashVariance={cashVariance} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: "/capture", label: "Quick capture", desc: "Paste SMS or drop a PDF", icon: Zap },
          { to: "/agents", label: "Agent Book", desc: "Balances & credit", icon: Users },
          { to: "/alerts", label: "Brain alerts", desc: "Risks & anomalies", icon: ShieldAlert },
          { to: "/reports", label: "Reports", desc: "Weekly PDF", icon: FileText },
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

      <OpenDayModal date={date} open={modalOpen} onOpened={() => setModalOpen(false)} />
    </div>
  );
}
