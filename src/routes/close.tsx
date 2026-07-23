import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  closePeriod,
  usePeriodClosing,
  usePeriodOpening,
  useTransactions,
  useAgents,
  getWeekStart,
  getWeekEnd,
} from "@/lib/db";
import { formatEtb, parseEtbToSantim } from "@/lib/format";
import { generateRangeReport } from "@/lib/report";
import { toast } from "sonner";

export const Route = createFileRoute("/close")({
  head: () => ({
    meta: [
      { title: "Close Week · EthioTrack" },
      { name: "description", content: "Reconcile expected vs actual cash and close the week." },
      { property: "og:title", content: "Weekly Close · EthioTrack" },
      { property: "og:description", content: "End-of-week cash reconciliation with variance explanation and auto weekly report." },
    ],
  }),
  component: ClosePage,
});

function ClosePage() {
  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);
  const opening = usePeriodOpening(weekStart);
  const closing = usePeriodClosing(weekStart);
  const txns = useTransactions();
  const agents = useAgents();
  const [actual, setActual] = useState("");
  const [notes, setNotes] = useState("");

  const inRange = useMemo(
    () => txns.filter((t) => {
      const d = t.date.slice(0, 10);
      return d >= weekStart && d <= weekEnd && !t.isPersonal;
    }),
    [txns, weekStart, weekEnd],
  );
  const cashIn = inRange.filter((t) => t.type === "in" && t.channel === "Cash").reduce((s, t) => s + t.amountSantim, 0);
  const cashOut = inRange
    .filter((t) => (t.type === "out" || t.type === "expense") && t.channel === "Cash")
    .reduce((s, t) => s + t.amountSantim, 0);
  const expected = (opening?.cashOnHandSantim ?? 0) + cashIn - cashOut;
  const actualSantim = parseEtbToSantim(actual) ?? 0;
  const variance = actualSantim - expected;

  if (opening === undefined) return null;
  if (opening === null) {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6">
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-ink-soft">
          Open this week first from the dashboard.
        </div>
      </div>
    );
  }
  if (closing) {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
        <h1 className="text-xl md:text-2xl font-bold">Week closed</h1>
        <p className="text-sm text-ink-soft">{weekStart} → {weekEnd}</p>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-2">
          <Row k="Actual cash" v={formatEtb(closing.actualCashSantim)} />
          <Row k="Variance" v={formatEtb(closing.varianceSantim)} />
          {closing.notes && <div className="text-xs text-ink-soft pt-2 border-t border-border">{closing.notes}</div>}
        </div>
        <Button variant="outline" onClick={() => downloadWeekly(weekStart, weekEnd)}>Re-download weekly PDF</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Close this week</h1>
        <p className="text-sm text-ink-soft">
          {weekStart} → {weekEnd}. Count your cash. Explain any variance before closing.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-2">
        <Row k="Opening cash" v={formatEtb(opening.cashOnHandSantim)} />
        <Row k="+ Cash received this week" v={formatEtb(cashIn)} />
        <Row k="− Cash paid this week" v={formatEtb(cashOut)} />
        <Row k="Expected cash" v={formatEtb(expected)} bold />
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <div>
          <Label>Actual cash counted</Label>
          <Input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="0.00" />
        </div>
        <Row k="Variance" v={formatEtb(variance)} bold className={variance === 0 ? "text-foreground" : "text-money-out"} />
        <div>
          <Label>Notes {variance !== 0 && <span className="text-money-out">(required)</span>}</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain the difference…" />
        </div>
        <Button className="w-full" onClick={async () => {
          if (!actual) return toast.error("Enter actual cash");
          if (variance !== 0 && !notes.trim()) return toast.error("Explain the variance");
          await closePeriod({ weekStart, openingId: opening.id, actualCashSantim: actualSantim, varianceSantim: variance, notes });
          toast.success("Week closed — downloading weekly report");
          const blob = generateRangeReport(agents, txns, new Date(weekStart), new Date(weekEnd + "T23:59:59"), `EthioTrack — Weekly Report`);
          triggerDownload(blob, `ethiotrack-week-${weekStart}.pdf`);
        }}>Close week</Button>
      </div>
    </div>
  );

  function downloadWeekly(ws: string, we: string) {
    const blob = generateRangeReport(agents, txns, new Date(ws), new Date(we + "T23:59:59"), `EthioTrack — Weekly Report`);
    triggerDownload(blob, `ethiotrack-week-${ws}.pdf`);
  }
}

function triggerDownload(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function Row({ k, v, bold, className = "" }: { k: string; v: string; bold?: boolean; className?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-soft">{k}</span>
      <span className={"tabular-nums " + (bold ? "font-bold " : "") + className}>{v}</span>
    </div>
  );
}