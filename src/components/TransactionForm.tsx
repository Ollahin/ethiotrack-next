import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { addTransaction, useAgents, useBanks, useDistributors } from "@/lib/db";
import { parseEtbToSantim } from "@/lib/format";
import { CHANNELS, TYPE_LABEL, type PartyType, type TxnType } from "@/lib/types";
import { toast } from "sonner";

const TYPES: TxnType[] = ["in", "out", "airtime_evd", "airtime_float", "expense", "personal"];

export function TransactionForm() {
  const agents = useAgents();
  const distributors = useDistributors();
  const banks = useBanks();
  const [type, setType] = useState<TxnType>("in");
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState<string>("Cash");
  const [partyType, setPartyType] = useState<PartyType>("agent");
  const [partyId, setPartyId] = useState<string>("");
  const [partyName, setPartyName] = useState("");
  const [bankId, setBankId] = useState<string>("");
  const [distributorId, setDistributorId] = useState<string>("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const partyOptions =
    partyType === "agent" ? agents.map((a) => ({ id: a.id, name: a.name }))
    : partyType === "distributor" ? distributors.map((d) => ({ id: d.id, name: d.name }))
    : partyType === "bank" ? banks.map((b) => ({ id: b.id, name: b.name }))
    : [];

  const isAirtime = type === "airtime_evd" || type === "airtime_float";
  const isMoney = type === "in" || type === "out" || type === "expense" || type === "personal";
  const needsBank = isMoney && channel !== "Cash";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const santim = parseEtbToSantim(amount);
    if (!santim) return toast.error("Enter an amount");
    const resolvedName = partyOptions.find((p) => p.id === partyId)?.name || partyName.trim();
    if (!resolvedName) return toast.error("Choose or type a party");
    if (isAirtime && !distributorId) return toast.error("Pick the airtime distributor");
    if (needsBank && !bankId) return toast.error("Pick the bank / wallet used");
    await addTransaction({
      type,
      amountSantim: santim,
      partyName: resolvedName,
      partyId: partyId || undefined,
      partyType: partyId ? partyType : undefined,
      channel,
      bankId: needsBank ? bankId : undefined,
      distributorId: isAirtime ? distributorId : undefined,
      reference: reference || undefined,
      note: note || undefined,
      date: new Date().toISOString(),
      isPersonal: type === "personal" ? true : undefined,
      source: "manual",
    });
    toast.success("Saved");
    setAmount(""); setReference(""); setNote(""); setPartyName(""); setPartyId("");
  }

  function onBankChange(id: string) {
    setBankId(id);
    const b = banks.find((x) => x.id === id);
    if (b?.channel) setChannel(b.channel);
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="font-semibold">Manual entry</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as TxnType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Amount (ETB)</Label>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>Party type</Label>
          <Select value={partyType} onValueChange={(v) => { setPartyType(v as PartyType); setPartyId(""); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="distributor">Distributor</SelectItem>
              <SelectItem value="bank">Bank</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Party</Label>
          {partyOptions.length && partyType !== "other" ? (
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {partyOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Name" />
          )}
        </div>
        <div>
          <Label>Channel</Label>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Reference</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        {isMoney && (
          <div className="col-span-2">
            <Label>Bank / wallet {needsBank && <span className="text-money-out">*</span>}</Label>
            {banks.length ? (
              <Select value={bankId} onValueChange={onBankChange}>
                <SelectTrigger><SelectValue placeholder={channel === "Cash" ? "None (cash)" : "Select account…"} /></SelectTrigger>
                <SelectContent>
                  {banks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name} · {b.channel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-ink-soft">Add a bank / wallet in Banks to attribute this transaction.</p>
            )}
          </div>
        )}
        {isAirtime && (
          <div className="col-span-2">
            <Label>Airtime distributor <span className="text-money-out">*</span></Label>
            {distributors.length ? (
              <Select value={distributorId} onValueChange={setDistributorId}>
                <SelectTrigger><SelectValue placeholder="Select distributor…" /></SelectTrigger>
                <SelectContent>
                  {distributors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-ink-soft">Add a distributor in Distributors to record airtime stock.</p>
            )}
          </div>
        )}
      </div>
      <div>
        <Label>Note</Label>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button type="submit" className="w-full">Save transaction</Button>
    </form>
  );
}