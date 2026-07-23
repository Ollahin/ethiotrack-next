import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAgents, useAllPeriodClosings, useTransactions, getWeekStart, getWeekEnd } from "@/lib/db";
import { generateRangeReport, generateMonthlyReport } from "@/lib/report";
import { formatEtb } from "@/lib/format";
import { FileText, CalendarRange, Calendar } from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports · EthioTrack" },
      { name: "description", content: "Weekly and monthly PDF summaries of airtime distributed, cash collected and aged receivables." },
      { property: "og:title", content: "Reports · EthioTrack" },
      { property: "og:description", content: "Auto-generated weekly and monthly performance summaries." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const agents = useAgents();
  const txns = useTransactions();
  const closings = useAllPeriodClosings();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);

  function downloadCurrentWeek() {
    const blob = generateRangeReport(agents, txns, new Date(weekStart), new Date(weekEnd + "T23:59:59"), "EthioTrack — Weekly Report");
    trigger(blob, `ethiotrack-week-${weekStart}.pdf`);
  }
  function downloadMonth() {
    const blob = generateMonthlyReport(agents, txns, year, month);
    trigger(blob, `ethiotrack-month-${year}-${String(month).padStart(2, "0")}.pdf`);
  }
  function downloadPastWeek(ws: string, we: string) {
    const blob = generateRangeReport(agents, txns, new Date(ws), new Date(we + "T23:59:59"), "EthioTrack — Weekly Report");
    trigger(blob, `ethiotrack-week-${ws}.pdf`);
  }

  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({ v: i + 1, label: new Date(2000, i, 1).toLocaleDateString(undefined, { month: "long" }) })),
    [],
  );
  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y];
  }, [now]);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Reports</h1>
        <p className="text-sm text-ink-soft">Weekly & monthly PDFs — generated in your browser.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <CalendarRange className="h-6 w-6 text-primary" />
          <div className="mt-2 font-semibold">Current week</div>
          <div className="text-xs text-ink-soft">{weekStart} → {weekEnd}</div>
          <Button className="mt-4 w-full" onClick={downloadCurrentWeek}>Download weekly PDF</Button>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <Calendar className="h-6 w-6 text-primary" />
          <div className="mt-2 font-semibold">Monthly report</div>
          <div className="text-xs text-ink-soft">Aggregated analytics for a full month.</div>
          <div className="mt-3 flex gap-2">
            <select className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {months.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
            <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <Button className="mt-3 w-full" onClick={downloadMonth}>Download monthly PDF</Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-primary" />
          <div className="font-semibold">Closed weeks</div>
        </div>
        {closings.length === 0 ? (
          <div className="text-xs text-ink-soft">No closed weeks yet. Close a week from the Close Week screen.</div>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {closings.map((c) => (
              <li key={c.id} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{c.weekStart} → {c.weekEnd}</div>
                  <div className="text-xs text-ink-soft">
                    Actual {formatEtb(c.actualCashSantim)} · Variance {formatEtb(c.varianceSantim)}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => downloadPastWeek(c.weekStart, c.weekEnd)}>PDF</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function trigger(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}