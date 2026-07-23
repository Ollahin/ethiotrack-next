import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openPeriod, useBanks, useDistributors, getWeekEnd } from "@/lib/db";
import { formatEtb, parseEtbToSantim } from "@/lib/format";
import type { PeriodOpening } from "@/lib/types";
import { toast } from "sonner";

/** Validate a user-entered ETB amount. Empty is treated as 0. */
function parseAmount(input: string): { santim: number; error: string | null } {
  const raw = input.trim();
  if (!raw) return { santim: 0, error: null };
  const santim = parseEtbToSantim(raw);
  if (santim === null) return { santim: 0, error: "Invalid amount" };
  if (santim < 0) return { santim: 0, error: "Must be ≥ 0" };
  if (santim > 1_000_000_000_00) return { santim: 0, error: "Amount too large" };
  return { santim, error: null };
}

export function OpenPeriodModal({
  weekStart,
  open,
  existing,
  onOpened,
  onCancel,
}: {
  weekStart: string;
  open: boolean;
  existing?: PeriodOpening | null;
  onOpened: () => void;
  onCancel?: () => void;
}) {
  const banks = useBanks();
  const distributors = useDistributors();
  const [cash, setCash] = useState(existing ? (existing.cashOnHandSantim / 100).toString() : "");
  const [bankBal, setBankBal] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    if (existing) for (const [k, v] of Object.entries(existing.bankBalances)) o[k] = (v / 100).toString();
    return o;
  });
  const [evdBal, setEvdBal] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    if (existing?.evdStockByDistributor)
      for (const [k, v] of Object.entries(existing.evdStockByDistributor)) o[k] = (v / 100).toString();
    return o;
  });
  const [fltBal, setFltBal] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    if (existing?.floatStockByDistributor)
      for (const [k, v] of Object.entries(existing.floatStockByDistributor)) o[k] = (v / 100).toString();
    return o;
  });
  const [saving, setSaving] = useState(false);
  const weekEnd = getWeekEnd(weekStart);

  const totals = useMemo(() => {
    const cashParsed = parseAmount(cash);
    const errors: string[] = [];
    if (cashParsed.error) errors.push(`Cash: ${cashParsed.error}`);

    const bankParsed: Record<string, { santim: number; error: string | null }> = {};
    let bankTotal = 0;
    for (const b of banks) {
      const p = parseAmount(bankBal[b.id] ?? "");
      bankParsed[b.id] = p;
      bankTotal += p.santim;
      if (p.error) errors.push(`${b.name}: ${p.error}`);
    }

    const evdParsed: Record<string, { santim: number; error: string | null }> = {};
    const fltParsed: Record<string, { santim: number; error: string | null }> = {};
    let evdTotal = 0;
    let fltTotal = 0;
    for (const d of distributors) {
      const e = parseAmount(evdBal[d.id] ?? "");
      const f = parseAmount(fltBal[d.id] ?? "");
      evdParsed[d.id] = e;
      fltParsed[d.id] = f;
      evdTotal += e.santim;
      fltTotal += f.santim;
      if (e.error) errors.push(`${d.name} EVD: ${e.error}`);
      if (f.error) errors.push(`${d.name} Float: ${f.error}`);
    }

    return {
      cashSantim: cashParsed.santim,
      bankParsed,
      evdParsed,
      fltParsed,
      bankTotal,
      evdTotal,
      fltTotal,
      moneyTotal: cashParsed.santim + bankTotal,
      grandTotal: cashParsed.santim + bankTotal + evdTotal + fltTotal,
      errors,
    };
  }, [cash, bankBal, evdBal, fltBal, banks, distributors]);

  const invalid = totals.errors.length > 0;

  async function save() {
    if (invalid) {
      toast.error(totals.errors[0]);
      return;
    }
    setSaving(true);
    try {
      const bankBalances: Record<string, number> = {};
      for (const b of banks) bankBalances[b.id] = totals.bankParsed[b.id].santim;
      const evdStockByDistributor: Record<string, number> = {};
      const floatStockByDistributor: Record<string, number> = {};
      for (const d of distributors) {
        evdStockByDistributor[d.id] = totals.evdParsed[d.id].santim;
        floatStockByDistributor[d.id] = totals.fltParsed[d.id].santim;
      }
      await openPeriod({
        weekStart,
        cashOnHandSantim: totals.cashSantim,
        bankBalances,
        evdStockByDistributor,
        floatStockByDistributor,
        evdStockSantim: totals.evdTotal,
        floatStockSantim: totals.fltTotal,
      });
      toast.success(existing ? "Opening updated" : "Week opened");
      onOpened();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && onCancel) onCancel(); }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Adjust opening balance" : "Open the week"}</DialogTitle>
          <DialogDescription>
            Set starting balances per bank and per airtime distributor for the week of {weekStart} → {weekEnd}. You can adjust this any time before closing the week.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Cash on hand (ETB)</Label>
            <Input
              inputMode="decimal"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              placeholder="0.00"
              aria-invalid={parseAmount(cash).error ? true : undefined}
            />
            {parseAmount(cash).error && (
              <p className="text-[10px] text-destructive mt-1">{parseAmount(cash).error}</p>
            )}
          </div>
          {banks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs uppercase tracking-wide text-ink-soft">Bank / wallet balances</Label>
                <span className="text-[10px] text-ink-soft tabular-nums">
                  Subtotal <span className="font-semibold text-foreground">{formatEtb(totals.bankTotal)}</span>
                </span>
              </div>
              {banks.map((b) => {
                const p = totals.bankParsed[b.id];
                return (
                  <div key={b.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="text-xs w-28 truncate">{b.name}</div>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={bankBal[b.id] ?? ""}
                        onChange={(e) => setBankBal((s) => ({ ...s, [b.id]: e.target.value }))}
                        aria-invalid={p?.error ? true : undefined}
                      />
                    </div>
                    {p?.error && <p className="text-[10px] text-destructive ml-[7.5rem]">{p.error}</p>}
                  </div>
                );
              })}
            </div>
          )}
          {distributors.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs uppercase tracking-wide text-ink-soft">Airtime stock by distributor</Label>
                <span className="text-[10px] text-ink-soft tabular-nums">
                  EVD <span className="font-semibold text-foreground">{formatEtb(totals.evdTotal)}</span>
                  {" · "}
                  Float <span className="font-semibold text-foreground">{formatEtb(totals.fltTotal)}</span>
                </span>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] uppercase tracking-wide text-ink-soft">
                <div>Distributor</div><div>EVD</div><div>Float</div>
              </div>
              {distributors.map((d) => {
                const e = totals.evdParsed[d.id];
                const f = totals.fltParsed[d.id];
                return (
                  <div key={d.id} className="space-y-1">
                    <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center">
                      <div className="text-xs truncate">
                        <div>{d.name}</div>
                        <div className="text-[10px] text-ink-soft tabular-nums">
                          {formatEtb((e?.santim ?? 0) + (f?.santim ?? 0))}
                        </div>
                      </div>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={evdBal[d.id] ?? ""}
                        onChange={(ev) => setEvdBal((s) => ({ ...s, [d.id]: ev.target.value }))}
                        aria-invalid={e?.error ? true : undefined}
                      />
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={fltBal[d.id] ?? ""}
                        onChange={(ev) => setFltBal((s) => ({ ...s, [d.id]: ev.target.value }))}
                        aria-invalid={f?.error ? true : undefined}
                      />
                    </div>
                    {(e?.error || f?.error) && (
                      <p className="text-[10px] text-destructive">{e?.error ?? f?.error}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-ink-soft">
              Add distributors first to record per-distributor EVD/Float opening stock.
            </p>
          )}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-ink-soft">Money on hand (cash + banks)</span>
              <span className="tabular-nums font-semibold">{formatEtb(totals.moneyTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-soft">Airtime stock (EVD + Float)</span>
              <span className="tabular-nums font-semibold">{formatEtb(totals.evdTotal + totals.fltTotal)}</span>
            </div>
            <div className="flex justify-between border-t border-border/60 pt-1 mt-1">
              <span className="font-semibold">Weekly opening total</span>
              <span className="tabular-nums font-bold text-primary">{formatEtb(totals.grandTotal)}</span>
            </div>
          </div>
          {invalid && (
            <p className="text-[11px] text-destructive" role="alert">
              Fix {totals.errors.length} field{totals.errors.length === 1 ? "" : "s"} before saving.
            </p>
          )}
          <Button className="w-full" onClick={save} disabled={saving || invalid}>
            {saving ? "Saving…" : existing ? "Save opening" : "Open week"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}