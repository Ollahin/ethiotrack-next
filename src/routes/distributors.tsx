import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteDistributor, upsertDistributor, useDistributors } from "@/lib/db";
import { Trash2, Plus } from "lucide-react";
import {
  AIRTIME_FORM_LABEL,
  TELECOM_LABEL,
  DISTRIBUTOR_FORMAT_LABEL,
  type AirtimeForm,
  type Telecom,
  type DistributorStatementFormat,
} from "@/lib/types";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/distributors")({
  head: () => ({
    meta: [
      { title: "Distributors · EthioTrack" },
      { name: "description", content: "Upstream telecom distributors who supply airtime." },
      { property: "og:title", content: "Distributors · EthioTrack" },
      { property: "og:description", content: "Manage upstream distributor accounts for statement imports." },
    ],
  }),
  component: DistPage,
});

function DistPage() {
  const list = useDistributors();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [telecoms, setTelecoms] = useState<Telecom[]>(["ethiotelecom"]);
  const [forms, setForms] = useState<AirtimeForm[]>(["evd"]);
  const [statementFormat, setStatementFormat] = useState<DistributorStatementFormat>("generic");

  function toggle<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Distributors</h1>
        <p className="text-sm text-ink-soft">Upstream telecom partners who supply your airtime.</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ethio Telecom EVD" /></div>
          <div><Label>Contact</Label><Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone / email" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Telecom(s) supplied</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {(Object.keys(TELECOM_LABEL) as Telecom[]).map((t) => (
                <label key={t} className={`px-3 py-1.5 rounded-md border text-xs cursor-pointer ${telecoms.includes(t) ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>
                  <input type="checkbox" className="sr-only" checked={telecoms.includes(t)} onChange={() => setTelecoms((s) => toggle(s, t))} />
                  {TELECOM_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>Airtime form(s)</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {(Object.keys(AIRTIME_FORM_LABEL) as AirtimeForm[]).map((f) => (
                <label key={f} className={`px-3 py-1.5 rounded-md border text-xs cursor-pointer ${forms.includes(f) ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>
                  <input type="checkbox" className="sr-only" checked={forms.includes(f)} onChange={() => setForms((s) => toggle(s, f))} />
                  {AIRTIME_FORM_LABEL[f]}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div>
          <Label>Statement format</Label>
          <Select value={statementFormat} onValueChange={(v) => setStatementFormat(v as DistributorStatementFormat)}>
            <SelectTrigger className="w-full h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(DISTRIBUTOR_FORMAT_LABEL) as DistributorStatementFormat[]).map((f) => (
                <SelectItem key={f} value={f}>{DISTRIBUTOR_FORMAT_LABEL[f]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-[11px] text-ink-soft mt-1">Drives which parser is used for imported statements/screenshots.</div>
        </div>
        <Button onClick={async () => {
          if (!name.trim()) return toast.error("Name required");
          if (!telecoms.length) return toast.error("Pick at least one telecom");
          if (!forms.length) return toast.error("Pick at least one airtime form");
          await upsertDistributor({ name, contact, telecoms, forms, statementFormat });
          setName(""); setContact("");
          setTelecoms(["ethiotelecom"]); setForms(["evd"]);
          setStatementFormat("generic");
          toast.success("Added");
        }}><Plus className="h-4 w-4 mr-1" /> Add distributor</Button>
      </div>
      <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
        {list.map((d) => (
          <li key={d.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="font-semibold">{d.name}</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {(d.telecoms ?? []).map((t) => (
                  <span key={t} className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary">{TELECOM_LABEL[t]}</span>
                ))}
                {(d.forms ?? []).map((f) => (
                  <span key={f} className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-ink-soft">{AIRTIME_FORM_LABEL[f]}</span>
                ))}
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-airtime/10 text-airtime">
                  {DISTRIBUTOR_FORMAT_LABEL[d.statementFormat ?? "generic"]}
                </span>
              </div>
              {d.contact && <div className="text-xs text-ink-soft">{d.contact}</div>}
              <div className="mt-2">
                <Select
                  value={d.statementFormat ?? "generic"}
                  onValueChange={async (v) => {
                    await upsertDistributor({ ...d, statementFormat: v as DistributorStatementFormat });
                    toast.success("Format updated");
                  }}
                >
                  <SelectTrigger className="w-40 h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DISTRIBUTOR_FORMAT_LABEL) as DistributorStatementFormat[]).map((f) => (
                      <SelectItem key={f} value={f}>{DISTRIBUTOR_FORMAT_LABEL[f]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={async () => { await deleteDistributor(d.id); toast.success("Deleted"); }}>
              <Trash2 className="h-4 w-4 text-money-out" />
            </Button>
          </li>
        ))}
        {!list.length && <li className="p-6 text-center text-sm text-ink-soft">No distributors yet.</li>}
      </ul>
    </div>
  );
}