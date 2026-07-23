import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { closeDay, useDailyClosing, useDailyOpening, useTransactions } from "@/lib/db";
import { formatEtb, parseEtbToSantim } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/close")({
  head: () => ({
    meta: [
      { title: "Close Day · EthioTrack" },
      { name: "description", content: "Reconcile expected vs actual cash before closing the day." },
      { property: "og:title", content: "Daily Close · EthioTrack" },
      { property: "og:description", content: "End-of-day cash reconciliation with variance explanation." },
    ],
  }),
  component: ClosePage,
});

function todayKey() { return new Date().toISOString().slice(0, 10); }

function ClosePage() {
  const date = todayKey();
  const opening = useDailyOpening(date);
  const closing = useDailyClosing(date);
  const txns = useTransactions();
  const [actual, setActual] = useState("");
  const [notes, setNotes] = useState("");

  const today = useMemo(() => txns.filter((t) => t.date.slice(0, 10) === date && !t.isPersonal), [txns, date]);
  const cashIn = today.filter((t) => t.type === "in" && t.channel === "Cash").reduce((s, t) => s + t.amountSantim, 0);
  const cashOut = today
    .filter((t) => (t.type === "out" || t.type === "expense") && t.channel === "Cash")
    .reduce((s, t) => s + t.amountSantim, 0);
  const expected = (opening?.cashOnHandSantim ?? 0) + cashIn - cashOut;
  const actualSantim = parseEtbToSantim(actual) ?? 0;
  const variance = actualSantim - expected;

  if (!opening) {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6">
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-ink-soft">
          Open today first from the dashboard.
        </div>
      </div>
    );
  }
  if (closing) {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
        <h1 className="text-xl md:text-2xl font-bold">Day closed</h1>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-2">
          <Row k="Actual cash" v={formatEtb(closing.actualCashSantim)} />
          <Row k="Variance" v={formatEtb(closing.varianceSantim)} />
          {closing.notes && <div className="text-xs text-ink-soft pt-2 border-t border-border">{closing.notes}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Close today</h1>
        <p className="text-sm text-ink-soft">Count your cash. Explain any variance before closing.</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-2">
        <Row k="Opening cash" v={formatEtb(opening.cashOnHandSantim)} />
        <Row k="+ Cash received today" v={formatEtb(cashIn)} />
        <Row k="− Cash paid today" v={formatEtb(cashOut)} />
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
          await closeDay({ date, openingId: opening.id, actualCashSantim: actualSantim, varianceSantim: variance, notes });
          toast.success("Day closed");
        }}>Close day</Button>
      </div>
    </div>
  );
}

function Row({ k, v, bold, className = "" }: { k: string; v: string; bold?: boolean; className?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-soft">{k}</span>
      <span className={"tabular-nums " + (bold ? "font-bold " : "") + className}>{v}</span>
    </div>
  );
}