import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { parseMany, type ParsedRow } from "@/lib/parser";
import { addTransactionsBulk } from "@/lib/db";
import { formatEtb } from "@/lib/format";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";

export function PasteImport() {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);

  function runParse() {
    const rows = parseMany(text);
    setParsed(rows);
    const sel = new Set<number>();
    rows.forEach((r, i) => {
      if (r.ok) sel.add(i);
    });
    setSelected(sel);
    const okCount = rows.filter((r) => r.ok).length;
    if (!okCount) toast.error("No transactions detected");
    else toast.success(`${okCount} transaction${okCount === 1 ? "" : "s"} detected`);
  }

  const okCount = useMemo(() => parsed.filter((r) => r.ok).length, [parsed]);

  async function doImport() {
    const rows = [...selected]
      .map((i) => parsed[i])
      .filter((r) => r && r.ok);
    if (!rows.length) return;
    setImporting(true);
    try {
      const { inserted, skipped } = await addTransactionsBulk(
        rows.map((r) => ({
          type: r.type!,
          amountSantim: r.amountSantim!,
          party: r.party ?? "Unknown",
          channel: r.channel ?? "Other",
          reference: r.reference,
          note: r.note,
          date: r.date ?? new Date().toISOString(),
        })),
      );
      const msg =
        skipped > 0
          ? `Imported ${inserted}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}`
          : `Imported ${inserted} transaction${inserted === 1 ? "" : "s"}`;
      toast.success(msg);
      setText("");
      setParsed([]);
      setSelected(new Set());
    } finally {
      setImporting(false);
    }
  }

  function toggle(i: number) {
    const s = new Set(selected);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    setSelected(s);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Paste bank alerts
          </h2>
          <p className="text-[11px] text-ink-soft mt-0.5">
            Paste one or many SMS / notification messages. Blank line between
            messages, or one per line.
          </p>
        </div>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="You have received ETB 500.00 from Alemu Kebede via Telebirr. Ref: TB123456"
        className="text-xs font-mono"
      />

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={runParse}
          disabled={!text.trim()}
        >
          Detect transactions
        </Button>
        {okCount > 0 && (
          <Button type="button" onClick={doImport} disabled={importing || !selected.size}>
            Import {selected.size}
          </Button>
        )}
      </div>

      {parsed.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
          {parsed.map((r, i) => (
            <li
              key={i}
              className={
                "flex items-start gap-2 p-2.5 text-xs " +
                (r.ok ? "bg-card" : "bg-muted/40")
              }
            >
              {r.ok ? (
                <Checkbox
                  checked={selected.has(i)}
                  onCheckedChange={() => toggle(i)}
                  className="mt-0.5"
                />
              ) : (
                <AlertTriangle className="h-4 w-4 text-money-out shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                {r.ok ? (
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={
                        "inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded text-white " +
                        (r.type === "in"
                          ? "bg-money-in"
                          : r.type === "out"
                            ? "bg-money-out"
                            : r.type === "airtime"
                              ? "bg-airtime"
                              : "bg-credit")
                      }
                    >
                      {r.type}
                    </span>
                    <span className="font-bold tabular-nums">
                      {formatEtb(r.amountSantim ?? 0)}
                    </span>
                    <span className="text-ink-soft">·</span>
                    <span>{r.party}</span>
                    <span className="text-ink-soft">via {r.channel}</span>
                    {r.reference && (
                      <span className="text-ink-soft">#{r.reference}</span>
                    )}
                    {r.needsReview && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-airtime">
                        <AlertTriangle className="h-3 w-3" />
                        review
                      </span>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="font-semibold text-money-out">
                      Could not parse
                    </div>
                    <div className="text-ink-soft truncate">{r.raw}</div>
                  </div>
                )}
                {r.ok && (
                  <CheckCircle2 className="hidden" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}