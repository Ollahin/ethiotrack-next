// EVD purchase fulfilment queue.
//
// Presentation only: every number and status comes from the pure helpers in
// `@/lib/purchase-fulfillment`. Recording a receipt or an exception appends an
// immutable entry — nothing is ever rewritten or deleted here.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  appendFulfillmentEntry,
  useDistributors,
  useFulfillmentEntries,
  useTransactions,
  updateTransaction,
} from "@/lib/db";
import { makeId } from "@/lib/ids";
import { formatEtb, formatDateTime, parseEtbToSantim } from "@/lib/format";
import {
  buildFulfillmentQueue,
  elapsedLabel,
  makeExceptionEntry,
  makeReceiptEntry,
  validateException,
  validateReceipt,
  type PurchaseIntent,
} from "@/lib/purchase-fulfillment";
import {
  PURCHASE_STATUS_LABEL,
  SURPLUS_LABEL,
  type FulfillmentExceptionAction,
  type SurplusClassification,
} from "@/lib/types";

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-muted text-ink-soft",
  partially_fulfilled: "bg-credit/15 text-credit",
  fulfilled: "bg-money-in/15 text-money-in",
  overdue: "bg-money-out/15 text-money-out",
  disputed: "bg-money-out/15 text-money-out",
  cancelled: "bg-muted text-ink-soft",
  personal: "bg-muted text-ink-soft",
};

export function FulfillmentQueue() {
  const txns = useTransactions();
  const distributors = useDistributors();
  const entries = useFulfillmentEntries();
  const [openId, setOpenId] = useState<string | null>(null);

  const now = Date.now();
  const queue = useMemo(
    () => buildFulfillmentQueue(txns, distributors, entries, now),
    // `now` intentionally read per render — statuses are time-derived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txns, distributors, entries],
  );

  return (
    <section className="rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)] overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <PackageCheck className="h-4 w-4 text-airtime" aria-hidden />
        <h2 className="text-sm font-semibold">EVD purchase fulfilment</h2>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-soft">
          {queue.length} intent{queue.length === 1 ? "" : "s"}
        </span>
      </header>
      {queue.length === 0 ? (
        <p className="p-6 text-center text-xs text-ink-soft">
          No distributor payments yet. Payments to a configured distributor appear here
          automatically.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-ink-soft">
              <tr className="border-b border-border/60">
                <th className="text-left px-4 py-2">Distributor</th>
                <th className="text-left px-2 py-2">Paid</th>
                <th className="text-right px-2 py-2">Expected EVD</th>
                <th className="text-right px-2 py-2">Final debit</th>
                <th className="text-right px-2 py-2">Fulfilled</th>
                <th className="text-right px-2 py-2">Outstanding</th>
                <th className="text-left px-2 py-2">Status</th>
                <th className="text-left px-2 py-2">Elapsed</th>
                <th className="text-right px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((intent) => (
                <FulfillmentRow
                  key={intent.txnId}
                  intent={intent}
                  open={openId === intent.txnId}
                  onToggle={() => setOpenId((id) => (id === intent.txnId ? null : intent.txnId))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FulfillmentRow({
  intent,
  open,
  onToggle,
}: {
  intent: PurchaseIntent;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-border/40">
        <td className="px-4 py-2">
          <Link
            to="/distributors/$distributorId"
            params={{ distributorId: intent.distributorId }}
            className="font-semibold hover:text-primary hover:underline"
          >
            {intent.distributorName}
          </Link>
          {intent.reference && (
            <div className="text-[10px] text-ink-soft">ref {intent.reference}</div>
          )}
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          {intent.timeKnown ? formatDateTime(intent.paidAt) : intent.paidAt.slice(0, 10)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums font-semibold">
          {formatEtb(intent.expectedSantim)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums text-ink-soft">
          {formatEtb(intent.finalDebitSantim)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums text-money-in">
          {formatEtb(intent.fulfilledSantim)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums text-money-out">
          {formatEtb(intent.outstandingSantim)}
        </td>
        <td className="px-2 py-2">
          <span
            className={
              "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold " +
              (STATUS_CLASS[intent.status] ?? "bg-muted text-ink-soft")
            }
          >
            {PURCHASE_STATUS_LABEL[intent.status]}
          </span>
        </td>
        <td className="px-2 py-2 text-ink-soft whitespace-nowrap">{elapsedLabel(intent)}</td>
        <td className="px-4 py-2 text-right">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onToggle}>
            {open ? "Close" : "Manage"}
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/60 bg-muted/20">
          <td colSpan={9} className="px-4 py-3">
            <IntentPanel intent={intent} />
          </td>
        </tr>
      )}
    </>
  );
}

function IntentPanel({ intent }: { intent: PurchaseIntent }) {
  const [amount, setAmount] = useState("");
  const [surplus, setSurplus] = useState<SurplusClassification | "">("");
  const [note, setNote] = useState("");

  async function recordReceipt() {
    const santim = parseEtbToSantim(amount);
    if (santim === null) return toast.error("Enter a valid received amount.");
    const draft = {
      amountSantim: santim,
      surplusClassification: surplus || undefined,
      note,
    };
    const check = validateReceipt(intent, draft);
    if (!check.ok) return toast.error(check.error);
    await appendFulfillmentEntry(
      makeReceiptEntry(intent, draft, check.surplusSantim, makeId(), new Date().toISOString()),
    );
    setAmount("");
    setSurplus("");
    setNote("");
    toast.success("Receipt recorded");
  }

  async function recordException(action: FulfillmentExceptionAction) {
    const check = validateException(intent, action, note, Date.now());
    if (!check.ok) return toast.error(check.error);
    await appendFulfillmentEntry(
      makeExceptionEntry(intent, action, note, makeId(), new Date().toISOString()),
    );
    if (action === "personal") {
      const { db } = await import("@/lib/db");
      const txn = await db().transactions.get(intent.txnId);
      if (txn) await updateTransaction({ ...txn, isPersonal: true });
    }
    setNote("");
    toast.success(`Marked ${action}`);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label className="text-[10px]">Received EVD (ETB)</Label>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8"
            placeholder="0.00"
          />
        </div>
        <div>
          <Label className="text-[10px]">Excess classification</Label>
          <Select
            value={surplus || undefined}
            onValueChange={(v) => setSurplus(v as SurplusClassification)}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Only if above expected" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SURPLUS_LABEL) as SurplusClassification[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {SURPLUS_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label className="text-[10px]">Note</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8"
            placeholder="Required for exceptions after 15 minutes"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={recordReceipt}>
          Record receipt
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => recordException("disputed")}
        >
          Mark disputed
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => recordException("cancelled")}
        >
          Cancelled / refunded
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => recordException("personal")}
        >
          Change to personal
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => recordException("correction")}
        >
          Log correction
        </Button>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-ink-soft mb-1">
          Fulfilment history (immutable)
        </div>
        {intent.entries.length === 0 ? (
          <p className="text-xs text-ink-soft">No entries yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {intent.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2">
                <span className="text-ink-soft">{formatDateTime(e.recordedAt)}</span>
                <span className="font-semibold">{e.action ?? e.kind}</span>
                {e.kind !== "exception" && (
                  <span className="tabular-nums">{formatEtb(e.amountSantim)}</span>
                )}
                {e.surplusClassification && (
                  <span className="text-credit">
                    {SURPLUS_LABEL[e.surplusClassification]} {formatEtb(e.surplusSantim ?? 0)}
                  </span>
                )}
                {e.note && <span className="text-ink-soft">— {e.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
