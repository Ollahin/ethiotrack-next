import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PasteImport } from "@/components/PasteImport";
import { SmsFloatEvdImport } from "@/components/SmsFloatEvdImport";
import {
  CAPTURE_FAMILY_LABEL,
  classifyCapturedText,
  type CaptureFamily,
} from "@/lib/smart-capture";

export interface SmartCaptureProps {
  /** Text pre-loaded from the shared inbox. */
  initialText?: string;
  /** Fired only after rows were actually saved from this capture. */
  onSaved?: () => void;
}

/**
 * One capture box. The operator pastes anything; the app decides which frozen
 * parser owns it, states the evidence, and hands the text to that parser's
 * review list. Nothing is saved without going through that review.
 */
export function SmartCapture({ initialText, onSaved }: SmartCaptureProps = {}) {
  const [text, setText] = useState(initialText ?? "");
  const [handed, setHanded] = useState<{ text: string; family: CaptureFamily } | null>(null);
  const [override, setOverride] = useState<CaptureFamily | null>(null);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const classification = useMemo(() => classifyCapturedText(text), [text]);
  const chosen: CaptureFamily = override ?? classification.family;
  const canReview = text.trim().length > 0 && chosen !== "unknown";

  /**
   * Review opens by itself. As soon as exactly one defensible family owns the
   * text, the batch is handed to that family's review list — no extra click.
   * An ambiguous capture waits for the operator to pick a type, and that
   * choice opens review immediately too.
   */
  useEffect(() => {
    if (!text.trim() || chosen === "unknown" || chosen === "distributor_statement") {
      setHanded(null);
      return;
    }
    setHanded((h) => (h && h.text === text && h.family === chosen ? h : { text, family: chosen }));
  }, [text, chosen]);

  async function pasteFromClipboard() {
    setClipboardError(null);
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        setClipboardError("The clipboard is empty.");
        return;
      }
      setText(clip);
      setOverride(null);
      setHanded(null);
    } catch {
      setClipboardError("This browser blocked clipboard access — paste into the box instead.");
    }
  }

  /** Every family the operator may hand the text to by hand. */
  const MANUAL_FAMILIES: CaptureFamily[] = ["bank_message", "airtime_sms", "distributor_statement"];

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
      <div>
        <div className="font-semibold">Smart Capture</div>
        <div className="text-xs text-ink-soft">
          Paste a bank alert, a Float/EVD message, or share one from your phone. The type is
          detected from the text itself — you can always override it.
        </div>
      </div>

      <Textarea
        rows={4}
        placeholder="Paste any message here"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOverride(null);
        }}
      />

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void pasteFromClipboard()}>
          Paste from clipboard
        </Button>
        {text.trim().length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setText("");
              setOverride(null);
              setHanded(null);
            }}
          >
            Clear
          </Button>
        )}
      </div>
      {clipboardError && <div className="text-xs text-money-out">{clipboardError}</div>}

      {text.trim().length > 0 && (
        <div className="rounded-md border border-border bg-muted/40 p-2 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-soft">Detected:</span>
            <span
              className={
                "rounded px-2 py-0.5 font-semibold " +
                (chosen === "unknown"
                  ? "bg-money-out/10 text-money-out"
                  : "bg-money-in/10 text-money-in")
              }
            >
              {CAPTURE_FAMILY_LABEL[chosen]}
            </span>
            <span className="text-ink-soft">{classification.evidence}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-soft">
              {classification.candidates.length > 0
                ? "Not right?"
                : "Nothing was recognised — choose the type yourself:"}
            </span>
            <Select
              value={chosen === "unknown" ? "" : chosen}
              onValueChange={(v) => {
                setOverride(v as CaptureFamily);
                setCollapsed(false);
              }}
            >
              <SelectTrigger className="h-7 w-auto min-w-[12rem] text-[11px]">
                <SelectValue placeholder="Pick a capture type…" />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_FAMILIES.map((family) => {
                  const candidate = classification.candidates.find((c) => c.family === family);
                  return (
                    <SelectItem key={family} value={family}>
                      {CAPTURE_FAMILY_LABEL[family]}
                      {candidate ? ` · ${candidate.evidence}` : " · reviewed by hand"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {chosen === "distributor_statement" && (
            <div className="text-airtime">
              This looks like a distributor statement. Upload the original screenshot below so the
              image is kept as evidence with the rows.
            </div>
          )}

          {canReview && chosen !== "distributor_statement" && (
            <div className="flex items-center gap-2">
              <span className="text-money-in font-semibold">Review opened automatically.</span>
              <Button size="sm" variant="ghost" onClick={() => setCollapsed((c) => !c)}>
                {collapsed ? "Show review" : "Hide review"}
              </Button>
            </div>
          )}
        </div>
      )}

      {!collapsed && handed?.family === "bank_message" && (
        <PasteImport embedded initialText={handed.text} onSaved={onSaved} />
      )}
      {!collapsed && handed?.family === "airtime_sms" && (
        <div className="space-y-2">
          <div className="font-semibold text-sm">Float / EVD messages</div>
          <SmsFloatEvdImport initialText={handed.text} onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}
