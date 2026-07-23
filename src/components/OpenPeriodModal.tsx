import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openPeriod, useBanks, useDistributors, getWeekEnd } from "@/lib/db";
import { parseEtbToSantim } from "@/lib/format";
import type { PeriodOpening } from "@/lib/types";
import { toast } from "sonner";

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

  async function save() {
    setSaving(true);
    try {
      const bankBalances: Record<string, number> = {};
      for (const b of banks) {
        bankBalances[b.id] = parseEtbToSantim(bankBal[b.id] ?? "") ?? 0;
      }
      const evdStockByDistributor: Record<string, number> = {};
      const floatStockByDistributor: Record<string, number> = {};
      for (const d of distributors) {
        evdStockByDistributor[d.id] = parseEtbToSantim(evdBal[d.id] ?? "") ?? 0;
        floatStockByDistributor[d.id] = parseEtbToSantim(fltBal[d.id] ?? "") ?? 0;
      }
      const evdTotal = Object.values(evdStockByDistributor).reduce((a, b) => a + b, 0);
      const fltTotal = Object.values(floatStockByDistributor).reduce((a, b) => a + b, 0);
      await openPeriod({
        weekStart,
        cashOnHandSantim: parseEtbToSantim(cash) ?? 0,
        bankBalances,
        evdStockByDistributor,
        floatStockByDistributor,
        evdStockSantim: evdTotal,
        floatStockSantim: fltTotal,
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
            <Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" />
          </div>
          {banks.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-ink-soft">Bank / wallet balances</Label>
              {banks.map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <div className="text-xs w-28 truncate">{b.name}</div>
                  <Input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={bankBal[b.id] ?? ""}
                    onChange={(e) => setBankBal((s) => ({ ...s, [b.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
          {distributors.length > 0 ? (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-ink-soft">Airtime stock by distributor</Label>
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] uppercase tracking-wide text-ink-soft">
                <div>Distributor</div><div>EVD</div><div>Float</div>
              </div>
              {distributors.map((d) => (
                <div key={d.id} className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center">
                  <div className="text-xs truncate">{d.name}</div>
                  <Input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={evdBal[d.id] ?? ""}
                    onChange={(e) => setEvdBal((s) => ({ ...s, [d.id]: e.target.value }))}
                  />
                  <Input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={fltBal[d.id] ?? ""}
                    onChange={(e) => setFltBal((s) => ({ ...s, [d.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-soft">
              Add distributors first to record per-distributor EVD/Float opening stock.
            </p>
          )}
          <Button className="w-full" onClick={save} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save opening" : "Open week"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}