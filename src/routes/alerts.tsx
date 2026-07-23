import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAgents, useStatementImports, useTransactions } from "@/lib/db";
import { computeAlerts } from "@/lib/brain/alerts";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts · EthioTrack" },
      { name: "description", content: "Brain-generated risk, anomaly and hygiene alerts." },
      { property: "og:title", content: "Brain Alerts · EthioTrack" },
      { property: "og:description", content: "Overdue credits, distribution anomalies, missing imports." },
    ],
  }),
  component: AlertsPage,
});

const SEV_COLOR = {
  high: "border-money-out/40 bg-money-out/5 text-money-out",
  medium: "border-airtime/40 bg-airtime/5 text-airtime",
  low: "border-border bg-muted/30 text-ink-soft",
} as const;

function AlertsPage() {
  const agents = useAgents();
  const txns = useTransactions();
  const imports = useStatementImports();
  const alerts = useMemo(() => computeAlerts(agents, txns, imports), [agents, txns, imports]);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-airtime" /> Brain Alerts
        </h1>
        <p className="text-sm text-ink-soft">Overdue credits, distribution anomalies, missing imports.</p>
      </div>
      {alerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-ink-soft">
          Nothing to worry about. The Brain sees no issues right now.
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className={"rounded-lg border p-3 " + SEV_COLOR[a.severity]}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-semibold text-sm text-foreground">{a.title}</div>
                <div className="text-[10px] uppercase font-bold">{a.severity}</div>
              </div>
              <div className="text-xs text-ink-soft mt-1">{a.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}