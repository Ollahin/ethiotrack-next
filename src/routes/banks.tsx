import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { deleteBank, upsertBank, useBanks } from "@/lib/db";
import { CHANNELS } from "@/lib/types";
import { parseEtbToSantim, formatEtb } from "@/lib/format";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/banks")({
  head: () => ({
    meta: [
      { title: "Banks · EthioTrack" },
      { name: "description", content: "Your own bank accounts and mobile money wallets." },
      { property: "og:title", content: "Banks · EthioTrack" },
      { property: "og:description", content: "Manage bank accounts and starting balances." },
    ],
  }),
  component: BanksPage,
});

function BanksPage() {
  const list = useBanks();
  const [name, setName] = useState("");
  const [acct, setAcct] = useState("");
  const [channel, setChannel] = useState<string>("CBE");
  const [opening, setOpening] = useState("");
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Banks</h1>
        <p className="text-sm text-ink-soft">Your own accounts and wallets used to receive/pay money.</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CBE main" /></div>
          <div><Label>Account #</Label><Input value={acct} onChange={(e) => setAcct(e.target.value)} /></div>
          <div>
            <Label>Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Opening balance (ETB)</Label><Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
        </div>
        <Button onClick={async () => {
          if (!name.trim()) return toast.error("Name required");
          await upsertBank({ name, accountNumber: acct, channel, openingBalanceSantim: parseEtbToSantim(opening) ?? 0 });
          setName(""); setAcct(""); setOpening("");
          toast.success("Added");
        }}><Plus className="h-4 w-4 mr-1" /> Add bank</Button>
      </div>
      <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
        {list.map((b) => (
          <li key={b.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="font-semibold">{b.name}</div>
              <div className="text-xs text-ink-soft">{b.channel}{b.accountNumber ? ` · ${b.accountNumber}` : ""} · opening {formatEtb(b.openingBalanceSantim)}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={async () => { await deleteBank(b.id); toast.success("Deleted"); }}>
              <Trash2 className="h-4 w-4 text-money-out" />
            </Button>
          </li>
        ))}
        {!list.length && <li className="p-6 text-center text-sm text-ink-soft">No banks yet.</li>}
      </ul>
    </div>
  );
}