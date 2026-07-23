import { useState } from "react";
import { Button } from "@/components/ui/button";
import { extractPdfText, parseStatementText, type StatementRow } from "@/lib/pdf-parser";
import { addTransactionsBulk, recordStatementImport, useAgents, useDistributors } from "@/lib/db";
import { matchAgent } from "@/lib/brain/fuzzy";
import { formatEtb } from "@/lib/format";
import type { Agent, Transaction } from "@/lib/types";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UploadCloud } from "lucide-react";
import { toast } from "sonner";

export function PdfImport() {
  const agents = useAgents();
  const distributors = useDistributors();
  const [distributorId, setDistributorId] = useState<string>("");
  const [rows, setRows] = useState<Array<{ row: StatementRow; agent: Agent | null; overrideAgentId?: string }>>([]);
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const text = await extractPdfText(file);
      setRawText(text);
      setFileName(file.name);
      const parsed = parseStatementText(text);
      setRows(parsed.map((row) => ({
        row,
        agent: row.ok ? matchAgent(row.agentName, agents) ?? matchAgent(row.phone, agents) : null,
      })));
    } catch (e) {
      toast.error("Couldn't read PDF");
      console.error(e);
    } finally { setBusy(false); }
  }

  const okRows = rows.filter((r) => r.row.ok);
  const linked = okRows.filter((r) => r.agent || r.overrideAgentId);
  const flagged = okRows.length - linked.length;
  const total = okRows.reduce((s, r) => s + (r.row.amountSantim ?? 0), 0);

  async function commit() {
    if (!okRows.length) return;
    const importRec = await recordStatementImport({
      distributorId: distributorId || undefined,
      fileName,
      rowCount: okRows.length,
      totalSantim: total,
      rawText: rawText.slice(0, 40_000),
    });
    const inputs: Array<Omit<Transaction, "id" | "createdAt">> = okRows.map(({ row, agent, overrideAgentId }) => {
      const linkedId = overrideAgentId || agent?.id;
      return {
        type: row.airtimeType!,
        amountSantim: row.amountSantim!,
        partyName: row.agentName ?? "Unknown",
        partyId: linkedId,
        partyType: linkedId ? "agent" : undefined,
        channel: "Distributor",
        reference: row.reference,
        note: row.raw,
        date: new Date().toISOString(),
        isSettled: false,
        source: "pdf_import",
        statementImportId: importRec.id,
      };
    });
    const res = await addTransactionsBulk(inputs);
    toast.success(`Imported ${res.inserted} rows${res.skipped ? `, skipped ${res.skipped}` : ""}`);
    setRows([]); setRawText(""); setFileName("");
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="font-semibold">Import distributor statement (PDF)</div>
          <div className="text-xs text-ink-soft">Runs entirely in your browser. Auto-links agents by name/phone.</div>
        </div>
        {distributors.length > 0 && (
          <Select value={distributorId} onValueChange={setDistributorId}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Distributor" /></SelectTrigger>
            <SelectContent>
              {distributors.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <label
        className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:bg-muted/40"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void handleFile(f);
        }}
      >
        <UploadCloud className="h-6 w-6 text-ink-soft" />
        <div className="text-sm">
          {busy ? "Reading PDF…" : fileName || "Drop PDF here or click to browse"}
        </div>
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
        />
      </label>

      {okRows.length > 0 && (
        <>
          <div className="rounded-md border border-border bg-money-in/5 p-3 text-sm">
            <div className="font-semibold">Import summary</div>
            <div className="text-xs text-ink-soft mt-0.5">
              {okRows.length} rows parsed · {linked.length} auto-linked · {flagged} need agent
            </div>
            <div className="text-xs mt-0.5">Total: <span className="font-semibold">{formatEtb(total)}</span></div>
          </div>
          <ul className="text-sm divide-y divide-border rounded-md border border-border max-h-80 overflow-y-auto">
            {rows.map(({ row, agent, overrideAgentId }, i) => (
              <li key={i} className="p-2">
                {row.ok ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{row.agentName}</span>
                    <span className="text-xs text-ink-soft">{row.phone ?? ""}</span>
                    <span className="ml-auto font-bold tabular-nums text-airtime">
                      {formatEtb(row.amountSantim!)}
                    </span>
                    <span className="text-[10px] uppercase font-semibold text-ink-soft">
                      {row.airtimeType === "airtime_evd" ? "EVD" : "FLOAT"}
                    </span>
                    {agent ? (
                      <span className="w-full text-xs text-money-in">→ {agent.name}</span>
                    ) : (
                      <Select value={overrideAgentId ?? ""} onValueChange={(v) =>
                        setRows((s) => s.map((x, j) => j === i ? { ...x, overrideAgentId: v } : x))
                      }>
                        <SelectTrigger className="w-full h-7 text-xs mt-1"><SelectValue placeholder="Link to agent…" /></SelectTrigger>
                        <SelectContent>
                          {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-ink-soft">Skipped: {row.raw}</div>
                )}
              </li>
            ))}
          </ul>
          <Button onClick={commit} className="w-full">Commit import</Button>
        </>
      )}
    </div>
  );
}