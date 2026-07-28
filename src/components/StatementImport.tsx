import { useState } from "react";
import { Button } from "@/components/ui/button";
import { extractPdfText } from "@/lib/pdf-parser";
import { extractImageText, OCR_LOW_CONFIDENCE } from "@/lib/ocr";
import {
  detectStatementTemplate,
  type StatementRow,
  type TemplateMatch,
} from "@/lib/distributor-parser";
import {
  addTransactionsBulk,
  recordStatementImport,
  upsertAgent,
  useAgents,
  useDistributors,
} from "@/lib/db";
import { matchAgent } from "@/lib/brain/fuzzy";
import { formatEtb } from "@/lib/format";
import type { Agent, Transaction, DistributorStatementFormat } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadCloud, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

type SourceKind = "pdf" | "image";

export function StatementImport() {
  const agents = useAgents();
  const distributors = useDistributors();
  const [distributorId, setDistributorId] = useState<string>("");
  const [rows, setRows] = useState<
    Array<{ row: StatementRow; agent: Agent | null; overrideAgentId?: string }>
  >([]);
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [match, setMatch] = useState<TemplateMatch | null>(null);

  const selectedDistributor = distributors.find((d) => d.id === distributorId);
  const activeFormat: DistributorStatementFormat =
    selectedDistributor?.statementFormat ?? "generic";

  async function handleFile(file: File) {
    setBusy(true);
    setShowRaw(false);
    try {
      const kind: SourceKind = file.type.startsWith("image/") ? "image" : "pdf";
      let text = "";
      let confidence: number | null = null;
      if (kind === "image") {
        const res = await extractImageText(file);
        text = res.text;
        confidence = res.confidence;
      } else {
        text = await extractPdfText(file);
      }
      setSourceKind(kind);
      setOcrConfidence(confidence);
      setRawText(text);
      setFileName(file.name);
      const detected = detectStatementTemplate(text, activeFormat);
      setMatch(detected);
      const parsed = detected.rows.filter((row) => row.ok);
      setRows(
        parsed.map((row) => ({
          row,
          agent: matchAgent(row.agentName, agents) ?? matchAgent(row.phone, agents),
        })),
      );
      if (confidence !== null && confidence < OCR_LOW_CONFIDENCE) {
        toast.warning("Low OCR confidence — check the extracted text below before committing.");
      }
    } catch (e) {
      toast.error("Couldn't read file");
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  const okRows = rows.filter((r) => r.row.ok);
  const linked = okRows.filter((r) => r.agent || r.overrideAgentId);
  const flagged = okRows.length - linked.length;
  const reviewCount = okRows.filter((r) => r.row.needsReview).length;
  const total = okRows.reduce((s, r) => s + (r.row.amountSantim ?? 0), 0);

  async function commit() {
    if (!okRows.length) return;
    const importRec = await recordStatementImport({
      distributorId: distributorId || undefined,
      fileName,
      rowCount: okRows.length,
      totalSantim: total,
      rawText: rawText.slice(0, 40_000),
      sourceKind: sourceKind ?? undefined,
      ocrConfidence: ocrConfidence ?? undefined,
    });
    // Auto-register any agent name that OCR discovered but the user hasn't
    // linked yet — mirrors the auto-register-bank behaviour on paste import.
    // Only names that pass the strict alphabetic guard are eligible.
    const NAME_OK = /^[A-Za-z\u1200-\u137F][A-Za-z\u1200-\u137F\s'.-]{1,58}$/;
    const created: Record<string, string> = {}; // normalized name -> agent id
    const resolvedIds = new Map<number, string | undefined>();
    let autoCreated = 0;
    for (let i = 0; i < okRows.length; i++) {
      const { row, agent, overrideAgentId } = okRows[i];
      let id = overrideAgentId || agent?.id;
      if (!id && row.agentName && NAME_OK.test(row.agentName)) {
        const key = row.agentName.trim().toLowerCase();
        if (created[key]) {
          id = created[key];
        } else {
          const rec = await upsertAgent({ name: row.agentName.trim() });
          created[key] = rec.id;
          id = rec.id;
          autoCreated++;
        }
      }
      resolvedIds.set(i, id);
    }
    const inputs: Array<Omit<Transaction, "id" | "createdAt">> = okRows.map(({ row }, i) => {
      const linkedId = resolvedIds.get(i);
      return {
        type: row.airtimeType!,
        amountSantim: row.amountSantim!,
        partyName: row.agentName ?? "Unknown",
        partyId: linkedId,
        partyType: linkedId ? "agent" : undefined,
        channel: "Distributor",
        // Fix from prior audit: distributorId belongs on each transaction too,
        // not only on the batch record — otherwise per-distributor stock reports
        // silently miss imported rows.
        distributorId: distributorId || undefined,
        reference: row.reference,
        note: row.raw,
        date: new Date().toISOString(),
        isSettled: false,
        needsReview: row.needsReview,
        source: sourceKind === "image" ? "screenshot_import" : "pdf_import",
        statementImportId: importRec.id,
      };
    });
    const res = await addTransactionsBulk(inputs);
    toast.success(
      `Imported ${res.inserted} rows` +
        (res.skipped ? `, skipped ${res.skipped}` : "") +
        (autoCreated ? ` · added ${autoCreated} new agent${autoCreated === 1 ? "" : "s"}` : ""),
    );
    setRows([]);
    setRawText("");
    setFileName("");
    setSourceKind(null);
    setOcrConfidence(null);
    setMatch(null);
  }

  const confidencePct = ocrConfidence !== null ? Math.round(ocrConfidence * 100) : null;
  const lowConfidence = ocrConfidence !== null && ocrConfidence < OCR_LOW_CONFIDENCE;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="font-semibold">Import distributor statement</div>
          <div className="text-xs text-ink-soft">
            PDF or screenshot. Runs entirely in your browser.
          </div>
        </div>
        {distributors.length > 0 && (
          <Select value={distributorId} onValueChange={setDistributorId}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Distributor" />
            </SelectTrigger>
            <SelectContent>
              {distributors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
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
          {busy ? "Reading file…" : fileName || "Drop PDF or screenshot here, or click to browse"}
        </div>
        <input
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </label>

      {match && (
        <div className="rounded-md border border-border bg-muted/30 p-2 text-xs flex items-center gap-2 flex-wrap">
          <span className="font-semibold">Matched:</span>
          <span
            className={`px-1.5 py-0.5 rounded font-semibold ${match.kind === "generic" ? "bg-money-out/10 text-money-out" : "bg-money-in/10 text-money-in"}`}
          >
            {match.label}
          </span>
          {match.forced && (
            <span className="text-[10px] uppercase font-semibold text-ink-soft px-1 py-0.5 rounded bg-muted">
              forced
            </span>
          )}
          <span className="text-ink-soft">· {match.reason}</span>
          <span className="ml-auto tabular-nums font-semibold">
            {Math.round(match.confidence * 100)}%
          </span>
        </div>
      )}

      {rawText && (
        <div className="rounded-md border border-border">
          <button
            type="button"
            onClick={() => setShowRaw((s) => !s)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs"
          >
            <span className="flex items-center gap-2">
              {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Extracted text ({sourceKind === "image" ? "OCR" : "PDF"})
            </span>
            {confidencePct !== null && (
              <span
                className={`px-1.5 py-0.5 rounded font-semibold ${lowConfidence ? "bg-money-out/10 text-money-out" : "bg-money-in/10 text-money-in"}`}
              >
                {lowConfidence && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                {confidencePct}%
              </span>
            )}
          </button>
          {showRaw && (
            <pre className="px-3 pb-3 text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto text-ink-soft">
              {rawText}
            </pre>
          )}
        </div>
      )}

      {okRows.length > 0 && (
        <>
          <div className="rounded-md border border-border bg-money-in/5 p-3 text-sm">
            <div className="font-semibold">Import summary</div>
            <div className="text-xs text-ink-soft mt-0.5">
              {okRows.length} rows parsed · {linked.length} auto-linked · {flagged} need agent
              {reviewCount > 0 && ` · ${reviewCount} flagged for review`}
            </div>
            <div className="text-xs mt-0.5">
              Total: <span className="font-semibold">{formatEtb(total)}</span>
            </div>
          </div>
          <ul className="text-sm divide-y divide-border rounded-md border border-border max-h-80 overflow-y-auto">
            {okRows.map(({ row, agent, overrideAgentId }, i) => (
              <li key={i} className="p-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{row.agentName}</span>
                  <span className="text-xs text-ink-soft">{row.phone ?? ""}</span>
                  {row.needsReview && (
                    <span className="text-[10px] uppercase font-semibold px-1 py-0.5 rounded bg-money-out/10 text-money-out">
                      Review
                    </span>
                  )}
                  <span className="ml-auto font-bold tabular-nums text-airtime">
                    {formatEtb(row.amountSantim!)}
                  </span>
                  <span className="text-[10px] uppercase font-semibold text-ink-soft">
                    {row.airtimeType === "airtime_evd" ? "EVD" : "FLOAT"}
                  </span>
                  {agent ? (
                    <span className="w-full text-xs text-money-in">→ {agent.name}</span>
                  ) : (
                    <Select
                      value={overrideAgentId ?? ""}
                      onValueChange={(v) =>
                        setRows((s) =>
                          s.map((x, j) => (j === i ? { ...x, overrideAgentId: v } : x)),
                        )
                      }
                    >
                      <SelectTrigger className="w-full h-7 text-xs mt-1">
                        <SelectValue placeholder="Link to agent…" />
                      </SelectTrigger>
                      <SelectContent>
                        {agents.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Button onClick={commit} className="w-full">
            Commit import
          </Button>
        </>
      )}
    </div>
  );
}
