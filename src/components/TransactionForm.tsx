import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHANNELS, type TxnType } from "@/lib/types";
import { parseEtbToSantim } from "@/lib/format";
import { addTransaction } from "@/lib/db";
import { toast } from "sonner";

const TYPES: { value: TxnType; label: string; color: string }[] = [
  { value: "in", label: "Money In", color: "bg-money-in" },
  { value: "out", label: "Money Out", color: "bg-money-out" },
  { value: "airtime", label: "Airtime", color: "bg-airtime" },
  { value: "credit", label: "Credit", color: "bg-credit" },
];

export function TransactionForm() {
  const [type, setType] = useState<TxnType>("out");
  const [amount, setAmount] = useState("");
  const [party, setParty] = useState("");
  const [channel, setChannel] = useState<string>("Telebirr");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const santim = parseEtbToSantim(amount);
    if (!santim) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!party.trim()) {
      toast.error("Counterparty / agent is required");
      return;
    }
    setSaving(true);
    try {
      await addTransaction({
        type,
        amountSantim: santim,
        party: party.trim(),
        channel,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        date: new Date(date).toISOString(),
      });
      toast.success("Transaction saved");
      setAmount("");
      setParty("");
      setReference("");
      setNote("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">New transaction</h2>
      </div>

      {/* Type pills */}
      <div className="grid grid-cols-4 gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className={
              "text-[11px] font-bold py-2 rounded-md border transition-colors " +
              (type === t.value
                ? `${t.color} text-white border-transparent`
                : "bg-secondary text-ink-soft border-border hover:bg-accent")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="amount" className="text-xs">
            Amount (ETB)
          </Label>
          <Input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="font-semibold tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Channel</Label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="party" className="text-xs">
          {type === "in" ? "From (agent / sender)" : "To (agent / recipient)"}
        </Label>
        <Input
          id="party"
          value={party}
          onChange={(e) => setParty(e.target.value)}
          placeholder="e.g. Alemu Kebede"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="reference" className="text-xs">
            Reference
          </Label>
          <Input
            id="reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="date" className="text-xs">
            Date
          </Label>
          <Input
            id="date"
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="note" className="text-xs">
          Note
        </Label>
        <Textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
          rows={2}
        />
      </div>

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Saving…" : "Save transaction"}
      </Button>
    </form>
  );
}