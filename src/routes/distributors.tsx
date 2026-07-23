import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteDistributor, upsertDistributor, useDistributors } from "@/lib/db";
import { Trash2, Plus } from "lucide-react";
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
        <Button onClick={async () => {
          if (!name.trim()) return toast.error("Name required");
          await upsertDistributor({ name, contact });
          setName(""); setContact("");
          toast.success("Added");
        }}><Plus className="h-4 w-4 mr-1" /> Add distributor</Button>
      </div>
      <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
        {list.map((d) => (
          <li key={d.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="font-semibold">{d.name}</div>
              {d.contact && <div className="text-xs text-ink-soft">{d.contact}</div>}
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