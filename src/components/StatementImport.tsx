import { useState } from "react";
import { Button } from "@/components/ui/button";
import { extractPdfText } from "@/lib/pdf-parser";
import { extractImageTextAt, OCR_LOW_CONFIDENCE } from "@/lib/ocr";
import { detectStatementTemplate, type StatementRow } from "@/lib/distributor-parser";
import {
  addTransactionsBulk,
  recordStatementImport,
  updateStatementImport,
  useAgents,
  useDistributors,
  useTransactions,
} from "@/lib/db";
import { agentDeliveredBalanceForDistributor } from "@/lib/agent-ledger";
import {
  failedOutcome,
  isRowComplete,
  isScreenshotDistributorCompatible,
  outcomeFrom,
  reversalOverrun,
  rowDateIso,
  rowDateParts,
  runOrientedOcr,
  scoreCandidate,
  type Orientation,
  type ScreenshotOutcome,
} from "@/lib/screenshot-import";
import { formatEtb } from "@/lib/format";
import type { Agent, Transaction, DistributorStatementFormat } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UploadCloud,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RotateCw,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

type SourceKind = "pdf" | "image";

interface Job {
  key: string;
  file: File;
  kind: SourceKind;
  importId?: string;
  busy: boolean;
  saved: boolean;
  outcome: ScreenshotOutcome | null;
  overrides: Record<number, string>;
  /** Reviewer-entered fallback timestamp for rows whose date wasn't captured. */
  manualDate: string;
  showRaw: boolean;
  /** Row indexes whose reversal exceeds the agent's recorded delivered balance. */
  overrunRows: number[];
  /** Reviewer's written explanation for saving those reversals anyway. */
  overrideReason: string;
  /** Second explicit confirmation for the override. */
  overrideConfirmed: boolean;
}

/** Exact, case/whitespace-normalized agent match only — never fuzzy. */
function exactAgent(name: string | undefined, agents: Agent[]): Agent | null {
  if (!name) return null;
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  return agents.find((a) => a.name.trim().toLowerCase().replace(/\s+/g, " ") === key) ?? null;
}

export function StatementImport() {
  const agents = useAgents();
  const distributors = useDistributors();
  const txns = useTransactions();
  const [distributorId, setDistributorId] = useState<string>("");
  const [jobs, setJobs] = useState<Job[]>([]);

  const selectedDistributor = distributors.find((d) => d.id === distributorId);
  const activeFormat: DistributorStatementFormat =
    selectedDistributor?.statementFormat ?? "generic";

  function patchJob(key: string, patch: Partial<Job>) {
    setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...patch } : j)));
  }

  /** Persist the raw file FIRST, so a later OCR failure never loses the capture. */
  async function ensureImportRecord(job: Job): Promise<string> {
    if (job.importId) return job.importId;
    const rec = await recordStatementImport({
      distributorId: distributorId || undefined,
      fileName: job.file.name,
      rowCount: 0,
      totalSantim: 0,
      rawText: "",
      sourceKind: job.kind,
      status: "pending",
      rawImage: job.kind === "image" ? job.file : undefined,
    });
    patchJob(job.key, { importId: rec.id });
    return rec.id;
  }

  async function processJob(job: Job) {
    patchJob(job.key, { busy: true });
    let importId: string | undefined;
    try {
      importId = await ensureImportRecord(job);
      let outcome: ScreenshotOutcome;
      if (job.kind === "image") {
        const { best } = await runOrientedOcr(async (orientation: Orientation) => {
          const res = await extractImageTextAt(job.file, orientation);
          return { orientation, text: res.text, confidence: res.confidence };
        }, activeFormat);
        outcome = outcomeFrom(best);
      } else {
        const text = await extractPdfText(job.file);
        outcome = outcomeFrom(
          scoreCandidate({ orientation: 0, text, confidence: 1 }, activeFormat),
        );
      }
      await updateStatementImport(importId, {
        rawText: outcome.text.slice(0, 40_000),
        status: outcome.status,
        orientation: outcome.orientation ?? undefined,
        layout: outcome.match?.kind,
        ocrConfidence: job.kind === "image" ? (outcome.confidence ?? undefined) : undefined,
        parseError: undefined,
      });
      patchJob(job.key, { outcome, busy: false });
      if (outcome.confidence !== null && outcome.confidence < OCR_LOW_CONFIDENCE) {
        toast.warning(`${job.file.name}: low OCR confidence — review the extracted text.`);
      }
      if (outcome.status === "empty") {
        toast.warning(`${job.file.name}: no complete rows found — image kept for retry.`);
      }
    } catch (e) {
      console.error(e);
      const outcome = failedOutcome(e);
      if (importId) {
        await updateStatementImport(importId, { status: "failed", parseError: outcome.error });
      }
      patchJob(job.key, { outcome, busy: false });
      toast.error(`${job.file.name}: couldn't read file — image kept, you can retry.`);
    }
  }

  async function handleFiles(files: File[]) {
    const next: Job[] = files.map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      kind: file.type.startsWith("image/") ? "image" : "pdf",
      busy: true,
      saved: false,
      outcome: null,
      overrides: {},
      manualDate: "",
      showRaw: false,
      overrunRows: [],
      overrideReason: "",
      overrideConfirmed: false,
    }));
    setJobs((js) => [...js, ...next]);
    // Each screenshot is processed independently: one failure never discards
    // results already parsed from the other files.
    for (const job of next) {
      await processJob(job).catch((e) => console.error(e));
    }
  }

  function toggleRow(key: string, index: number) {
    setJobs((js) =>
      js.map((j) =>
        j.key === key && j.outcome
          ? {
              ...j,
              outcome: {
                ...j.outcome,
                selected: j.outcome.selected.map((s, i) => (i === index ? !s : s)),
              },
            }
          : j,
      ),
    );
  }

  async function saveJob(job: Job) {
    const outcome = job.outcome;
    if (!outcome) return;
    // Every screenshot row is booked against an explicitly chosen distributor.
    if (!distributorId || !selectedDistributor) {
      toast.error("Choose the distributor these rows came from before saving.");
      return;
    }
    const picked = outcome.rows
      .map((row, i) => ({ row, i }))
      .filter(({ row, i }) => outcome.selected[i] && isRowComplete(row));
    if (!picked.length) {
      toast.error("Nothing selected to save.");
      return;
    }
    const incompatible = picked.filter(
      ({ row }) => !isScreenshotDistributorCompatible(row.airtimeType, selectedDistributor),
    );
    if (incompatible.length) {
      toast.error(`${selectedDistributor.name} does not supply the airtime form in these rows.`);
      return;
    }
    // Strict linking: an agent is used only when the OCR name matches an
    // existing agent exactly, or the reviewer picked one. Never auto-create.
    const unlinked = picked.filter(
      ({ row, i }) => !(job.overrides[i] || exactAgent(row.agentName, agents)?.id),
    );
    if (unlinked.length) {
      toast.error(
        `Link ${unlinked.length} row${unlinked.length === 1 ? "" : "s"} to an agent before saving.`,
      );
      return;
    }
    // Never invent a timestamp: use the captured date, else the reviewer's.
    const manualIso = job.manualDate ? new Date(job.manualDate).toISOString() : null;
    const undated = picked.filter(({ row }) => !rowDateIso(row.dateText) && !manualIso);
    if (undated.length) {
      toast.error(
        `${undated.length} selected row${undated.length === 1 ? " has" : "s have"} no date — enter the capture date below.`,
      );
      return;
    }
    const inputs: Array<Omit<Transaction, "id" | "createdAt">> = [];
    // Reversal override safety: a reversal larger than what the books say was
    // delivered to that agent by this distributor is never saved silently.
    const deliveredLeft = new Map<string, number>();
    const overrun: number[] = [];
    for (const { row, i } of picked) {
      if (!row.isReversal) continue;
      const agentId = job.overrides[i] || exactAgent(row.agentName, agents)?.id;
      if (!agentId) continue;
      const left =
        deliveredLeft.get(agentId) ??
        agentDeliveredBalanceForDistributor(txns, agentId, distributorId);
      if (reversalOverrun(row.amountSantim!, left) > 0) overrun.push(i);
      deliveredLeft.set(agentId, left - row.amountSantim!);
    }
    const reasonOk = job.overrideReason.trim().length >= 5;
    if (overrun.length && !(job.overrideConfirmed && reasonOk)) {
      patchJob(job.key, { overrunRows: overrun });
      toast.error(
        !reasonOk
          ? "Explain why this larger-than-recorded reversal is correct."
          : "Confirm the excess reversal before saving.",
      );
      return;
    }
    for (const { row, i } of picked) {
      const id: string | undefined = job.overrides[i] || exactAgent(row.agentName, agents)?.id;
      const captured = rowDateParts(row.dateText);
      const iso = captured?.iso ?? manualIso!;
      inputs.push({
        type: row.airtimeType!,
        amountSantim: row.amountSantim!,
        // The row keeps the direction of the screen it came from. A reversal
        // is flagged as such and handled by the reversal-aware stock rules —
        // it is never recorded as a distributor receipt.
        airtimeDirection: "sent",
        ...(row.isReversal ? { isReversal: true as const } : {}),
        partyName: row.agentName ?? "Unknown",
        partyId: id,
        partyType: id ? "agent" : undefined,
        channel: "Distributor",
        distributorId,
        reference: row.reference,
        note: row.raw,
        ...(overrun.includes(i) ? { overrideReason: job.overrideReason.trim() } : {}),
        date: iso,
        dateIsDayOnly: captured?.dayOnly ?? true,
        isSettled: false,
        needsReview: row.needsReview || row.isReversal || overrun.includes(i),
        source: job.kind === "image" ? "screenshot_import" : "pdf_import",
        statementImportId: job.importId,
      });
    }
    const res = await addTransactionsBulk(inputs);
    if (job.importId) {
      await updateStatementImport(job.importId, {
        rowCount: inputs.length,
        totalSantim: inputs.reduce((s, t) => s + t.amountSantim, 0),
        status: "parsed",
        ...(overrun.length
          ? { parseError: `Excess reversal override: ${job.overrideReason.trim()}` }
          : {}),
      });
    }
    patchJob(job.key, { saved: true });
    toast.success(
      `${job.file.name}: saved ${res.inserted} rows` +
        (res.skipped ? `, skipped ${res.skipped} duplicate` : ""),
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="font-semibold">Import distributor statement</div>
          <div className="text-xs text-ink-soft">
            PDF or screenshot. Runs entirely in your browser.
          </div>
        </div>
        {distributors.length > 0 ? (
          <Select value={distributorId} onValueChange={setDistributorId}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Distributor (required)" />
            </SelectTrigger>
            <SelectContent>
              {distributors.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-money-out">Add a distributor first</span>
        )}
      </div>

      {!distributorId && (
        <div className="text-xs text-money-out">
          Choose the distributor these screenshots came from — rows cannot be saved without one.
        </div>
      )}

      <label
        className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:bg-muted/40"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const fs = Array.from(e.dataTransfer.files);
          if (fs.length) void handleFiles(fs);
        }}
      >
        <UploadCloud className="h-6 w-6 text-ink-soft" />
        <div className="text-sm">Drop PDFs or screenshots here, or click to browse</div>
        <div className="text-[11px] text-ink-soft">
          Multiple screenshots supported · rotation is detected automatically
        </div>
        <input
          type="file"
          multiple
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) void handleFiles(fs);
            e.target.value = "";
          }}
        />
      </label>

      {jobs.map((job) => {
        const o = job.outcome;
        const confPct = o?.confidence != null ? Math.round(o.confidence * 100) : null;
        const low = o?.confidence != null && o.confidence < OCR_LOW_CONFIDENCE;
        return (
          <div key={job.key} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="font-semibold truncate max-w-[14rem]">{job.file.name}</span>
              {job.busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-soft" />}
              {o && (
                <span
                  className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                    o.status === "parsed"
                      ? "bg-money-in/10 text-money-in"
                      : "bg-money-out/10 text-money-out"
                  }`}
                >
                  {job.saved ? "saved" : o.status}
                </span>
              )}
              {o?.match && <span className="text-xs text-ink-soft">{o.match.label}</span>}
              {o?.orientation != null && job.kind === "image" && (
                <span className="text-[10px] text-ink-soft flex items-center gap-1">
                  <RotateCw className="h-3 w-3" />
                  {o.orientation}°
                </span>
              )}
              {confPct !== null && (
                <span
                  className={`ml-auto text-[11px] px-1.5 py-0.5 rounded font-semibold ${low ? "bg-money-out/10 text-money-out" : "bg-muted text-ink-soft"}`}
                >
                  {low && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                  {confPct}%
                </span>
              )}
            </div>

            {o?.error && <div className="text-xs text-money-out">{o.error}</div>}

            {o && (
              <div className="text-xs text-ink-soft">
                {o.summary.complete} complete · {o.summary.incomplete} incomplete ·{" "}
                {o.summary.reversals} reversal{o.summary.reversals === 1 ? "" : "s"} · total{" "}
                <span className="font-semibold text-foreground">
                  {formatEtb(o.summary.totalSantim)}
                </span>
              </div>
            )}

            {o && o.rows.length > 0 && (
              <ul className="text-sm divide-y divide-border rounded-md border border-border max-h-72 overflow-y-auto">
                {o.rows.map((row, i) => {
                  const complete = isRowComplete(row);
                  const agent = exactAgent(row.agentName, agents);
                  return (
                    <li key={i} className="p-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="checkbox"
                          checked={!!o.selected[i]}
                          disabled={!complete || job.saved}
                          onChange={() => toggleRow(job.key, i)}
                        />
                        <span className="font-medium">{row.agentName ?? "—"}</span>
                        {!complete && (
                          <span className="text-[10px] uppercase font-semibold px-1 py-0.5 rounded bg-muted text-ink-soft">
                            Incomplete
                          </span>
                        )}
                        {row.isReversal && (
                          <span className="text-[10px] uppercase font-semibold px-1 py-0.5 rounded bg-money-out/10 text-money-out">
                            Reversal
                          </span>
                        )}
                        {row.needsReview && (
                          <span className="text-[10px] uppercase font-semibold px-1 py-0.5 rounded bg-money-out/10 text-money-out">
                            Review
                          </span>
                        )}
                        <span className="ml-auto font-bold tabular-nums text-airtime">
                          {row.amountSantim != null ? formatEtb(row.amountSantim) : "—"}
                        </span>
                        <span className="text-[10px] uppercase font-semibold text-ink-soft">
                          {row.airtimeType === "airtime_evd" ? "EVD" : "FLOAT"}
                        </span>
                        {agent ? (
                          <span className="w-full text-xs text-money-in">→ {agent.name}</span>
                        ) : (
                          complete &&
                          !job.saved && (
                            <Select
                              value={job.overrides[i] ?? ""}
                              onValueChange={(v) =>
                                patchJob(job.key, { overrides: { ...job.overrides, [i]: v } })
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
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {o?.text && (
              <>
                {!job.saved && o.rows.some((r, i) => o.selected[i] && !rowDateIso(r.dateText)) && (
                  <label className="flex items-center gap-2 text-xs text-ink-soft">
                    <span className="shrink-0">Capture date for undated rows</span>
                    <input
                      type="datetime-local"
                      value={job.manualDate}
                      onChange={(e) => patchJob(job.key, { manualDate: e.target.value })}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                    />
                  </label>
                )}
              </>
            )}

            {o?.text && (
              <div className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => patchJob(job.key, { showRaw: !job.showRaw })}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs"
                >
                  {job.showRaw ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Extracted text ({job.kind === "image" ? "OCR" : "PDF"})
                </button>
                {job.showRaw && (
                  <pre className="px-3 pb-3 text-[11px] whitespace-pre-wrap max-h-48 overflow-y-auto text-ink-soft">
                    {o.text}
                  </pre>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={job.busy}
                onClick={() => void processJob(job)}
              >
                Retry
              </Button>
              <Button
                className="flex-1"
                disabled={job.busy || job.saved || !o || o.summary.complete === 0 || !distributorId}
                onClick={() => void saveJob(job)}
              >
                {job.saved ? "Saved" : "Save rows"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setJobs((js) => js.filter((j) => j.key !== job.key))}
              >
                Dismiss
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
