import { useMemo, useState } from "react";
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
  /** Called once the operator hands the text to a reviewer. */
  onReviewed?: () => void;
}

/**
 * One capture box. The operator pastes anything; the app decides which frozen
 * parser owns it, states the evidence, and hands the text to that parser's
 * review list. Nothing is saved without going through that review.
 */
export function SmartCapture({ initialText, onReviewed }: SmartCaptureProps = {}) {
  const [text, setText] = useState(initialText ?? "");
  const [handed, setHanded] = useState<{ text: string; family: CaptureFamily } | null>(null);
  const [override, setOverride] = useState<CaptureFamily | null>(null);

  const classification = useMemo(() => classifyCapturedText(text), [text]);
  const chosen: CaptureFamily = override ?? classification.family;
  const canReview = text.trim().length > 0 && chosen !== "unknown";

  function review() {
    if (!canReview) return;
    setHanded({ text, family: chosen });
    onReviewed?.();
  }

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
          setHanded(null);
        }}
      />

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

          {classification.candidates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ink-soft">Not right?</span>
              <Select
                value={chosen}
                onValueChange={(v) => {
                  setOverride(v as CaptureFamily);
                  setHanded(null);
                }}
              >
                <SelectTrigger className="h-7 w-auto min-w-[12rem] text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {classification.candidates.map((c) => (
                    <SelectItem key={c.family} value={c.family}>
                      {CAPTURE_FAMILY_LABEL[c.family]} · {c.evidence}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {chosen === "distributor_statement" && (
            <div className="text-airtime">
              This looks like a distributor statement. Upload the original screenshot below so the
              image is kept as evidence with the rows.
            </div>
          )}

          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!canReview || chosen === "distributor_statement"}
              onClick={review}
            >
              Review {text.trim() ? "this capture" : ""}
            </Button>
          </div>
        </div>
      )}

      {handed?.family === "bank_message" && <PasteImport embedded initialText={handed.text} />}
      {handed?.family === "airtime_sms" && (
        <div className="space-y-2">
          <div className="font-semibold text-sm">Float / EVD messages</div>
          <SmsFloatEvdImport initialText={handed.text} />
        </div>
      )}
    </div>
  );
}
