import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseFloatEvdSms, type SmsParseResult } from "@/lib/float-evd-sms-parser";
import {
  SMS_EVENT_MAPPING,
  adaptSmsEvents,
  isDistributorCompatible,
  matchDistributorForEvent,
  resolveSmsDate,
} from "@/lib/float-evd-sms-adapter";
import {
  addTransactionsBulk,
  approveMapping,
  recordMappingUse,
  recordStatementImport,
  useAgents,
  useApprovedMappings,
  useDistributors,
} from "@/lib/db";
import { findMapping } from "@/lib/approved-mappings";
import { formatEtb } from "@/lib/format";
import { toast } from "sonner";

const KIND_LABEL: Record<keyof typeof SMS_EVENT_MAPPING, string> = {
  float_sent_to_agent: "Float sent → agent",
  evd_received_from_distributor: "EVD received ← distributor",
  float_received_from_distributor: "Float received ← distributor",
};

const REASON_LABEL: Record<string, string> = {
  missing_amount: "no amount evidence",
  ambiguous_direction: "ambiguous direction",
  missing_reference: "reference missing or truncated",
  reference_mismatch: "references do not match",
  missing_date: "no date evidence",
  ambiguous_counterparty: "ambiguous counterparty",
  code_conflict: "conflicting values on one reference",
};

interface RowState {
  selected: boolean;
  distributorId?: string;
  agentId?: string;
}

export interface SmsFloatEvdImportProps {
  /** Text handed over by Smart Capture — reviewed immediately, never saved. */
  initialText?: string;
  /** Fired only after rows were actually written. */
  onSaved?: () => void;
}

export function SmsFloatEvdImport({ initialText, onSaved }: SmsFloatEvdImportProps = {}) {
  const [text, setText] = useState(initialText ?? "");
  const [userDate, setUserDate] = useState("");
  const [result, setResult] = useState<SmsParseResult | null>(
    initialText && initialText.trim() ? parseFloatEvdSms(initialText) : null,
  );
  const [parsedText, setParsedText] = useState(initialText ?? "");
  const [rowState, setRowState] = useState<Record<number, RowState>>({});
  const agents = useAgents();
  const distributors = useDistributors();
  const mappings = useApprovedMappings();
  /** Rows where the operator chose to change an already-confirmed link. */
  const [editing, setEditing] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (initialText === undefined) return;
    setText(initialText);
    setParsedText(initialText);
    setResult(initialText.trim() ? parseFloatEvdSms(initialText) : null);
    setRowState({});
  }, [initialText]);

  const events = useMemo(() => result?.events ?? [], [result]);

  const defaults = useMemo(() => {
    const map: Record<number, RowState> = {};
    for (const ev of events) {
      const preselect = matchDistributorForEvent(ev, distributors);
      // An agent is only pre-selected from a link the operator approved before
      // for this exact label — never inferred from the message text.
      const label = ev.counterpartyLabel ?? undefined;
      const mapped = findMapping(label, "airtime_sms", "agent", mappings);
      const mappedAgent = mapped ? agents.find((a) => a.id === mapped.targetId) : undefined;
      map[ev.sourceOrder] = {
        // Pending events stay unselected until the operator checks them.
        selected: ev.pairingStatus === "complete",
        distributorId: preselect?.id,
        agentId: mappedAgent?.id,
      };
    }
    return map;
  }, [events, distributors, agents, mappings]);

  function stateFor(order: number): RowState {
    return rowState[order] ?? defaults[order] ?? { selected: false };
  }

  function setFor(order: number, patch: Partial<RowState>) {
    setRowState((s) => ({ ...s, [order]: { ...stateFor(order), ...patch } }));
  }

  function parse() {
    if (!text.trim()) return;
    setResult(parseFloatEvdSms(text, userDate ? { userSelectedDate: userDate } : undefined));
    setParsedText(text);
    setRowState({});
  }

  const selected = events.filter((e) => stateFor(e.sourceOrder).selected);
  function compatibleDistributor(ev: (typeof events)[number], id?: string) {
    const d = distributors.find((x) => x.id === id);
    return d && isDistributorCompatible(ev.eventKind, d) ? d : undefined;
  }

  const blocking = selected.filter((e) => {
    const st = stateFor(e.sourceOrder);
    const outbound = SMS_EVENT_MAPPING[e.eventKind].airtimeDirection === "sent";
    return (
      !compatibleDistributor(e, st.distributorId) ||
      // Outbound airtime leaves the books towards someone: it is never saved
      // without an explicitly linked agent.
      (outbound && !st.agentId) ||
      resolveSmsDate(e, userDate || undefined) === null
    );
  });
  const canImport = selected.length > 0 && blocking.length === 0;

  async function importSelected() {
    if (!canImport) return;
    const batch = adaptSmsEvents(
      selected.map((ev) => {
        const st = stateFor(ev.sourceOrder);
        const dist = compatibleDistributor(ev, st.distributorId);
        return {
          event: ev,
          selection: {
            distributorId: dist?.id,
            distributorName: dist?.name,
            distributorForms: dist?.forms,
            distributorTelecoms: dist?.telecoms,
            agentId: st.agentId,
            agentName: agents.find((a) => a.id === st.agentId)?.name,
            userSelectedDate: userDate || undefined,
          },
        };
      }),
    );
    if (batch.blocked.length || !batch.inputs.length) {
      toast.error("Some selected messages are missing a date or a compatible distributor");
      return;
    }
    // The complete pasted text is recorded first so every row can point at it.
    const imp = await recordStatementImport({
      fileName: "Pasted Float/EVD SMS",
      rowCount: batch.inputs.length,
      totalSantim: batch.inputs.reduce((s, i) => s + i.amountSantim, 0),
      rawText: parsedText,
      sourceKind: "sms",
    });
    const res = await addTransactionsBulk(
      batch.inputs.map((i) => ({ ...i, statementImportId: imp.id })),
    );
    toast.success(
      `Imported ${res.inserted}` + (res.skipped ? `, skipped ${res.skipped} duplicate(s)` : ""),
    );
    // Learn the agent links the operator just approved for these exact labels.
    for (const ev of selected) {
      const st = stateFor(ev.sourceOrder);
      const label = ev.counterpartyLabel?.trim();
      if (!label || !st.agentId) continue;
      const agent = agents.find((a) => a.id === st.agentId);
      if (!agent) continue;
      const existing = findMapping(label, "airtime_sms", "agent", mappings);
      if (existing && existing.targetId === agent.id) {
        await recordMappingUse(existing.id);
      } else {
        await approveMapping({
          label,
          sourceFamily: "airtime_sms",
          targetType: "agent",
          targetId: agent.id,
          targetName: agent.name,
        });
      }
    }
    setText("");
    setParsedText("");
    setResult(null);
    setRowState({});
    setEditing({});
    onSaved?.();
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-ink-soft">
        Float and EVD messages are reviewed before saving. Nothing is linked or dated automatically.
      </div>
      <Textarea
        rows={5}
        placeholder="Paste one or more Float / EVD SMS messages"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="sms-date" className="text-[11px] text-ink-soft">
            Date for messages without one
          </Label>
          <Input
            id="sms-date"
            type="date"
            className="h-8 w-[10rem] text-xs"
            value={userDate}
            onChange={(e) => setUserDate(e.target.value)}
          />
        </div>
        <Button onClick={parse} variant="secondary">
          Re-read messages
        </Button>
        {result && (
          <Button className="ml-auto" disabled={!canImport} onClick={importSelected}>
            Import {selected.length}
          </Button>
        )}
      </div>

      {result && events.length === 0 && (
        <div className="text-xs text-money-out">No Float or EVD events were recognised.</div>
      )}

      {events.length > 0 && (
        <ul className="text-sm divide-y divide-border rounded-md border border-border overflow-hidden">
          {events.map((ev) => {
            const st = stateFor(ev.sourceOrder);
            const map = SMS_EVENT_MAPPING[ev.eventKind];
            const outbound = map.airtimeDirection === "sent";
            const date = resolveSmsDate(ev, userDate || undefined);
            const choices = distributors.filter((d) => isDistributorCompatible(ev.eventKind, d));
            return (
              <li key={ev.sourceOrder} className="p-2 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Checkbox
                    checked={st.selected}
                    onCheckedChange={(v) => setFor(ev.sourceOrder, { selected: v === true })}
                    aria-label={`Select message ${ev.sourceOrder + 1}`}
                  />
                  <span
                    className={
                      "font-bold tabular-nums " + (outbound ? "text-money-out" : "text-money-in")
                    }
                  >
                    {outbound ? "−" : "+"} {formatEtb(Math.abs(ev.amountMinor))}
                  </span>
                  <span className="text-xs uppercase font-semibold text-ink-soft">
                    {KIND_LABEL[ev.eventKind]}
                  </span>
                  <span className="ml-auto text-xs tabular-nums text-ink-soft">
                    {date ?? "no date"}
                  </span>
                </div>
                <div className="text-xs text-ink-soft">
                  {ev.counterpartyLabel ?? "no counterparty label"}
                  {ev.transactionReference
                    ? ` · ref ${ev.transactionReference}`
                    : " · no reference"}
                  {ev.pairingStatus === "pending" && " · pairing pending"}
                </div>
                {(!date || ev.pairingStatus === "pending" || !ev.transactionReference) && (
                  <div className="text-[11px] text-airtime">
                    {!date && "Pick a date before importing. "}
                    {!ev.transactionReference && "No reference — saved for review. "}
                    {ev.pairingStatus === "pending" && "Unpaired half — saved for review."}
                  </div>
                )}
                {outbound && !st.agentId && (
                  <div className="text-[11px] text-money-out">
                    Outbound airtime must be linked to an agent before it can be imported.
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {compatibleDistributor(ev, st.distributorId) && !editing[ev.sourceOrder] ? (
                    <div className="flex items-center gap-1.5 text-[11px] bg-money-in/10 text-money-in border border-money-in/30 rounded px-2 py-1">
                      <span>Distributor: {compatibleDistributor(ev, st.distributorId)!.name}</span>
                      <button
                        type="button"
                        className="underline text-ink-soft"
                        onClick={() => setEditing((e) => ({ ...e, [ev.sourceOrder]: true }))}
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] bg-muted/50 border border-border rounded px-2 py-1">
                      <span className="text-ink-soft">Distributor</span>
                      <Select
                        value={compatibleDistributor(ev, st.distributorId)?.id ?? "none"}
                        onValueChange={(v) => {
                          setFor(ev.sourceOrder, { distributorId: v === "none" ? undefined : v });
                          setEditing((e) => ({ ...e, [ev.sourceOrder]: false }));
                        }}
                      >
                        <SelectTrigger className="h-6 w-auto min-w-[10rem] text-[11px]">
                          <SelectValue placeholder="Pick distributor…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not selected</SelectItem>
                          {choices.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {outbound && (
                    <div className="flex items-center gap-1.5 text-[11px] bg-muted/50 border border-border rounded px-2 py-1">
                      <span className={st.agentId ? "text-ink-soft" : "text-money-out"}>
                        Agent (required)
                      </span>
                      <Select
                        value={st.agentId ?? "none"}
                        onValueChange={(v) =>
                          setFor(ev.sourceOrder, { agentId: v === "none" ? undefined : v })
                        }
                      >
                        <SelectTrigger className="h-6 w-auto min-w-[10rem] text-[11px]">
                          <SelectValue placeholder="Link an agent…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not linked</SelectItem>
                          {agents.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {result && result.reviewRows.length > 0 && (
        <div className="rounded-md border border-airtime/40 bg-airtime/5 p-2 space-y-1">
          <div className="text-xs font-semibold text-airtime">
            {result.reviewRows.length} message(s) need review and were not turned into events
          </div>
          <ul className="text-[11px] space-y-1">
            {result.reviewRows.map((r, i) => (
              <li key={i} className="text-ink-soft">
                <span className="font-semibold">{REASON_LABEL[r.reason] ?? r.reason}</span> ·{" "}
                {r.observedText}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
