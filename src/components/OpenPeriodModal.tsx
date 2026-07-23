import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openPeriod, useBanks, getWeekEnd } from "@/lib/db";
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
  const [cash, setCash] = useState(existing ? (existing.cashOnHandSantim / 100).toString() : "");
  const [evd, setEvd] = useState(existing ? (existing.evdStockSantim / 100).toString() : "");
  const [flt, setFlt] = useState(existing ? (existing.floatStockSantim / 100).toString() : "");
  const [bankBal, setBankBal] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    if (existing) for (const [k, v] of Object.entries(existing.bankBalances)) o[k] = (v / 100).toString();
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
      await openPeriod({
        weekStart,
        cashOnHandSantim: parseEtbToSantim(cash) ?? 0,
        bankBalances,
        evdStockSantim: parseEtbToSantim(evd) ?? 0,
        floatStockSantim: parseEtbToSantim(flt) ?? 0,
      });
      toast.success(existing ? "Opening updated" : "Week opened");
      onOpened();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && onCancel) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Adjust opening balance" : "Open the week"}</DialogTitle>
          <DialogDescription>
            Set starting balances for the week of {weekStart} → {weekEnd}. You can adjust this any time before closing the week.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Cash on hand (ETB)</Label>
            <Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>EVD stock</Label>
              <Input inputMode="decimal" value={evd} onChange={(e) => setEvd(e.target.value)} />
            </div>
            <div>
              <Label>Float stock</Label>
              <Input inputMode="decimal" value={flt} onChange={(e) => setFlt(e.target.value)} />
            </div>
          </div>
          {banks.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-ink-soft">Bank balances</Label>
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
          <Button className="w-full" onClick={save} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save opening" : "Open week"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}