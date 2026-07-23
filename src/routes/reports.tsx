import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAgents, useAllPeriodClosings, useDistributors, useTransactions, getWeekStart, getWeekEnd } from "@/lib/db";
import { generateRangeReport, generateMonthlyReport } from "@/lib/report";
import { formatEtb } from "@/lib/format";
import { FileText, CalendarRange, Calendar } from "lucide-react";
import { computeTelecomFlow, type BucketKey } from "@/lib/brain/telecomFlow";
import { TELECOM_LABEL, AIRTIME_FORM_LABEL, type Telecom, type AirtimeForm } from "@/lib/types";

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
  const distributors = useDistributors();
  const closings = useAllPeriodClosings();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summaryRange, setSummaryRange] = useState<"week" | "month" | "active">("week");

  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);

  const flow = useMemo(() => {
    const ws = new Date(weekStart).getTime();
    const we = new Date(weekEnd + "T23:59:59").getTime();
    const scoped = txns.filter((t) => {
      const d = new Date(t.date).getTime();
      return d >= ws && d <= we;
    });
    return computeTelecomFlow(scoped, distributors);
  }, [txns, distributors, weekStart, weekEnd]);

  const TELECOMS: Telecom[] = ["ethiotelecom", "safaricom"];
  const FORMS: AirtimeForm[] = ["evd", "float"];

  const summary = useMemo(() => {
    let from = 0;
    let to = Date.now();
    if (summaryRange === "week") {
      from = new Date(weekStart).getTime();
      to = new Date(weekEnd + "T23:59:59").getTime();
    } else if (summaryRange === "month") {
      const d = new Date();
      from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      to = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).getTime();
    }
    const scoped = txns.filter((t) => {
      if (t.isPersonal) return false;
      if (t.type !== "airtime_evd" && t.type !== "airtime_float") return false;
      const ts = new Date(t.date).getTime();
      return ts >= from && ts <= to;
    });
    const distMap = new Map(distributors.map((d) => [d.id, d]));
    const byTelecom: Record<Telecom, number> = { ethiotelecom: 0, safaricom: 0 };
    const byForm: Record<AirtimeForm, number> = { evd: 0, float: 0 };
    const matrix: Record<`${Telecom}:${AirtimeForm}`, number> = {
      "ethiotelecom:evd": 0, "ethiotelecom:float": 0,
      "safaricom:evd": 0, "safaricom:float": 0,
    };
    let untagged = 0;
    let count = 0;
    let total = 0;
    for (const t of scoped) {
      count++;
      total += t.amountSantim;
      const form: AirtimeForm = t.type === "airtime_evd" ? "evd" : "float";
      byForm[form] += t.amountSantim;
      const d = t.distributorId ? distMap.get(t.distributorId) : undefined;
      const telecoms = d?.telecoms;
      if (!telecoms || !telecoms.length) { untagged += t.amountSantim; continue; }
      const share = Math.floor(t.amountSantim / telecoms.length);
      const remainder = t.amountSantim - share * telecoms.length;
      telecoms.forEach((tel, i) => {
        const portion = share + (i === 0 ? remainder : 0);
        byTelecom[tel] += portion;
        matrix[`${tel}:${form}` as `${Telecom}:${AirtimeForm}`] += portion;
      });
    }
    return { byTelecom, byForm, matrix, untagged, count, total };
  }, [txns, distributors, summaryRange, weekStart, weekEnd]);

  async function downloadCurrentWeek() {
    const blob = await generateRangeReport(agents, txns, new Date(weekStart), new Date(weekEnd + "T23:59:59"), "EthioTrack — Weekly Report");
    trigger(blob, `ethiotrack-week-${weekStart}.pdf`);
  }
  async function downloadMonth() {
    const blob = await generateMonthlyReport(agents, txns, year, month);
    trigger(blob, `ethiotrack-month-${year}-${String(month).padStart(2, "0")}.pdf`);
  }
  async function downloadPastWeek(ws: string, we: string) {
    const blob = await generateRangeReport(agents, txns, new Date(ws), new Date(we + "T23:59:59"), "EthioTrack — Weekly Report");
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

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <CalendarRange className="h-5 w-5 text-primary" />
          <div className="font-semibold">Airtime flow — this week</div>
        </div>
        <p className="text-xs text-ink-soft mb-3">
          Purchases (money out to distributors) vs sales (airtime to agents), matched by distributor telecom and form tags.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="text-left py-1.5 pr-3">Bucket</th>
                <th className="text-right py-1.5 pr-3">Bought</th>
                <th className="text-right py-1.5 pr-3">Sold</th>
                <th className="text-right py-1.5">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {TELECOMS.flatMap((t) =>
                FORMS.map((f) => {
                  const b = flow.buckets[`${t}:${f}` as BucketKey];
                  return (
                    <tr key={`${t}:${f}`}>
                      <td className="py-1.5 pr-3">{TELECOM_LABEL[t]} · {AIRTIME_FORM_LABEL[f]}</td>
                      <td className="py-1.5 pr-3 text-right">{formatEtb(b.purchasedSantim)}</td>
                      <td className="py-1.5 pr-3 text-right">{formatEtb(b.soldSantim)}</td>
                      <td className={`py-1.5 text-right ${b.netSantim < 0 ? "text-money-out" : ""}`}>
                        {formatEtb(b.netSantim)}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
        {(flow.unmatchedPurchases.length > 0 || flow.unmatchedSales.length > 0) && (
          <div className="mt-3 text-xs text-ink-soft">
            Untagged: {flow.unmatchedPurchases.length} purchase(s), {flow.unmatchedSales.length} sale(s).
            Add telecom / form tags on Distributors to include them.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <FileText className="h-5 w-5 text-primary" />
          <div className="font-semibold flex-1">Airtime summary — by telecom & form</div>
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            {(["week", "month", "active"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setSummaryRange(r)}
                className={`px-2.5 py-1 ${summaryRange === r ? "bg-primary text-primary-foreground" : "bg-background text-ink-soft"}`}
              >
                {r === "week" ? "This week" : r === "month" ? "This month" : "Active (90d)"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-soft mb-3">
          Airtime distributed to agents, rolled up by telecom company and airtime form.
          {summary.untagged > 0 && ` · ${formatEtb(summary.untagged)} untagged (distributor missing telecom).`}
        </p>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs uppercase tracking-wide text-ink-soft mb-2">By telecom</div>
            <ul className="divide-y divide-border text-sm">
              {TELECOMS.map((t) => (
                <li key={t} className="py-1.5 flex justify-between">
                  <span>{TELECOM_LABEL[t]}</span>
                  <span className="font-medium">{formatEtb(summary.byTelecom[t])}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs uppercase tracking-wide text-ink-soft mb-2">By form</div>
            <ul className="divide-y divide-border text-sm">
              {FORMS.map((f) => (
                <li key={f} className="py-1.5 flex justify-between">
                  <span>{AIRTIME_FORM_LABEL[f]}</span>
                  <span className="font-medium">{formatEtb(summary.byForm[f])}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="text-left py-1.5 pr-3">Telecom \ Form</th>
                {FORMS.map((f) => (
                  <th key={f} className="text-right py-1.5 pr-3">{AIRTIME_FORM_LABEL[f]}</th>
                ))}
                <th className="text-right py-1.5">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {TELECOMS.map((t) => {
                const rowTotal = FORMS.reduce((s, f) => s + summary.matrix[`${t}:${f}`], 0);
                return (
                  <tr key={t}>
                    <td className="py-1.5 pr-3">{TELECOM_LABEL[t]}</td>
                    {FORMS.map((f) => (
                      <td key={f} className="py-1.5 pr-3 text-right">{formatEtb(summary.matrix[`${t}:${f}`])}</td>
                    ))}
                    <td className="py-1.5 text-right font-medium">{formatEtb(rowTotal)}</td>
                  </tr>
                );
              })}
              <tr className="font-medium">
                <td className="py-1.5 pr-3">Total</td>
                {FORMS.map((f) => (
                  <td key={f} className="py-1.5 pr-3 text-right">{formatEtb(summary.byForm[f])}</td>
                ))}
                <td className="py-1.5 text-right">{formatEtb(summary.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-ink-soft">{summary.count} airtime transaction(s) in range.</div>
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