import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openDay, useBanks } from "@/lib/db";
import { parseEtbToSantim } from "@/lib/format";
import { toast } from "sonner";

export function OpenDayModal({
  date,
  open,
  onOpened,
}: {
  date: string;
  open: boolean;
  onOpened: () => void;
}) {
  const banks = useBanks();
  const [cash, setCash] = useState("");
  const [evd, setEvd] = useState("");
  const [flt, setFlt] = useState("");
  const [bankBal, setBankBal] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const bankBalances: Record<string, number> = {};
      for (const b of banks) {
        const v = parseEtbToSantim(bankBal[b.id] ?? "") ?? 0;
        bankBalances[b.id] = v;
      }
      await openDay({
        date,
        cashOnHandSantim: parseEtbToSantim(cash) ?? 0,
        bankBalances,
        evdStockSantim: parseEtbToSantim(evd) ?? 0,
        floatStockSantim: parseEtbToSantim(flt) ?? 0,
      });
      toast.success("Day opened");
      onOpened();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Open the day</DialogTitle>
          <DialogDescription>
            Record starting balances for {date}. You can't log transactions until the day is opened.
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
            {saving ? "Opening…" : "Open day"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}