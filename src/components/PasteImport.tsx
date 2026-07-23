import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { parseMany, type ParsedRow } from "@/lib/parser";
import { addTransactionsBulk, updateTransaction, useAgents, useBanks, useTransactions } from "@/lib/db";
import { matchAgent } from "@/lib/brain/fuzzy";
import { openCreditsFor, planFifoSettlement } from "@/lib/brain/credits";
import { formatEtb } from "@/lib/format";
import type { Bank, Transaction } from "@/lib/types";
import { toast } from "sonner";

export function PasteImport() {
  const [text, setText] = useState("");
  const [isPersonal, setPersonal] = useState(false);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const agents = useAgents();
  const banks = useBanks();
  const txns = useTransactions();

  function matchBank(row: ParsedRow): Bank | null {
    if (!row.ok) return null;
    // 1) Exact match by account tail (most reliable).
    if (row.accountTail) {
      const hit = banks.find((b) => {
        const digits = (b.accountNumber ?? "").replace(/\D+/g, "");
        return digits.length >= 4 && digits.slice(-4) === row.accountTail;
      });
      if (hit) return hit;
    }
    // 2) Fall back to matching by channel name (e.g. "Telebirr" wallet).
    if (row.channel) {
      const hit = banks.find(
        (b) => b.channel.toLowerCase() === row.channel!.toLowerCase(),
      );
      if (hit) return hit;
    }
    return null;
  }

  const enriched = useMemo(() => {
    return (rows ?? []).map((r) => {
      const match = r.ok && r.party ? matchAgent(r.party, agents) : null;
      const bank = matchBank(r);
      return { row: r, agent: match, bank };
    });
  }, [rows, agents, banks]);

  function detect() {
    if (!text.trim()) return;
    setRows(parseMany(text));
  }

  async function importAll() {
    const ok = enriched.filter((e) => e.row.ok);
    if (!ok.length) { toast.error("Nothing to import"); return; }
    const inputs: Array<Omit<Transaction, "id" | "createdAt">> = ok.map(({ row, agent, bank }) => ({
      type: row.type!,
      amountSantim: row.amountSantim!,
      partyName: row.party ?? "Unknown",
      partyId: agent?.id,
      partyType: agent ? "agent" : undefined,
      channel: row.channel ?? "Other",
      bankId: bank?.id,
      reference: row.reference,
      note: row.note ?? row.raw,
      date: row.date ?? new Date().toISOString(),
      isPersonal,
      source: "paste_parse",
    }));
    const res = await addTransactionsBulk(inputs);

    // FIFO settle: for each new 'in' payment linked to an agent, settle oldest credits.
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (inp.type !== "in" || !inp.partyId) continue;
      const open = openCreditsFor(inp.partyId, txns);
      if (!open.length) continue;
      const plan = planFifoSettlement(inp.amountSantim, open);
      for (const cid of plan.settled) {
        const c = txns.find((t) => t.id === cid);
        if (c) await updateTransaction({ ...c, isSettled: true, settledAt: new Date().toISOString() });
      }
    }

    toast.success(`Imported ${res.inserted}${res.skipped ? `, skipped ${res.skipped} duplicate(s)` : ""}`);
    setText(""); setRows(null);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="font-semibold">Paste bank SMS</div>
          <div className="text-xs text-ink-soft">The Brain auto-links agents and settles oldest credit first.</div>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="personal" className="text-xs text-ink-soft">Mark as personal</Label>
          <Switch id="personal" checked={isPersonal} onCheckedChange={setPersonal} />
        </div>
      </div>
      <Textarea
        rows={4}
        placeholder='e.g. "You have received ETB 500 from Alemu Kebede via CBE. Ref: CBE789456"'
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        <Button onClick={detect} variant="secondary">Detect</Button>
        {enriched.length > 0 && (
          <Button onClick={importAll} className="ml-auto">
            Import {enriched.filter((e) => e.row.ok).length}
          </Button>
        )}
      </div>
      {enriched.length > 0 && (
        <ul className="text-sm divide-y divide-border rounded-md border border-border overflow-hidden">
          {enriched.map(({ row, agent, bank }, i) => (
            <li key={i} className={"p-2 " + (row.ok ? "" : "bg-money-out/5")}>
              {row.ok ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className={"font-bold tabular-nums " + (row.type === "in" ? "text-money-in" : "text-money-out")}>
                      {row.type === "in" ? "+" : "−"} {formatEtb(row.amountSantim!)}
                    </span>
                    <span className="flex items-center gap-1 text-xs">
                      <span className="uppercase font-semibold text-ink-soft">{row.channel}</span>
                      {row.accountTail && (
                        <span className="rounded bg-muted text-ink-soft px-1.5 py-0.5 tabular-nums">···{row.accountTail}</span>
                      )}
                    </span>
                  </div>
                  <div className="text-xs">
                    <span className="font-medium">{row.party}</span>
                    {row.counterpartyPhone && (
                      <span className="text-ink-soft"> · {row.counterpartyPhone}</span>
                    )}
                    {agent && <span className="text-money-in font-semibold"> · linked → {agent.name}</span>}
                    {!agent && row.party && row.party !== "Unknown" && (
                      <span className="text-ink-soft"> · no agent match</span>
                    )}
                    {bank ? (
                      <span className="text-money-in font-semibold"> · account → {bank.name}</span>
                    ) : row.accountTail ? (
                      <span className="text-airtime"> · no bank match (···{row.accountTail})</span>
                    ) : null}
                    {row.needsReview && (
                      <span className="ml-1 inline-flex items-center rounded bg-airtime/15 text-airtime text-[10px] font-semibold px-1.5 py-0.5">review</span>
                    )}
                    {row.template && (
                      <span className="ml-1 inline-flex items-center rounded bg-money-in/10 text-money-in text-[10px] font-semibold px-1.5 py-0.5">{row.template}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-ink-soft whitespace-pre-wrap break-words">{row.note}</div>
                </div>
              ) : (
                <div className="text-xs text-money-out">
                  Couldn't parse: <span className="text-ink-soft">{row.raw}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}