import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAgents, useTransactions } from "@/lib/db";
import { generateWeeklyReport } from "@/lib/report";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports · EthioTrack" },
      { name: "description", content: "Weekly PDF summary of airtime distributed, cash collected and aged receivables." },
      { property: "og:title", content: "Reports · EthioTrack" },
      { property: "og:description", content: "Auto-generated weekly performance summary." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const agents = useAgents();
  const txns = useTransactions();
  function download() {
    const blob = generateWeeklyReport(agents, txns);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ethiotrack-weekly-${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
  }
  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Reports</h1>
        <p className="text-sm text-ink-soft">Weekly PDF summary — generated in your browser.</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm text-center">
        <FileText className="h-8 w-8 text-primary mx-auto" />
        <div className="mt-2 font-semibold">Weekly Report</div>
        <div className="text-xs text-ink-soft">Last 7 days: airtime distributed, cash collected, net P/L, aged receivables.</div>
        <Button className="mt-4" onClick={download}>Download PDF</Button>
      </div>
    </div>
  );
}