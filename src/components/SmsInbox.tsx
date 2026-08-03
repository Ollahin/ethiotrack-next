// The SMS Inbox — the single place pasted, clipboard and shared messages are
// reviewed. A row shows only what a human must decide: how much moved, where
// it came from, when, what it was for and who it belongs to. Everything the
// parser knows is available, but folded away under "Details".

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { type ParsedRow } from "@/lib/parser";
import { parseSourceRecords } from "@/lib/capture/parse-records";
import { fingerprintSource } from "@/lib/capture/source-fingerprint";
import { ingestSmsDrafts, sortInboxRows } from "@/lib/capture/inbox-ingest";
import {
  canonicalDate,
  dayFromIso,
  formatDayShort,
  storageIso,
  timeFromIso,
  todayDay,
  yesterdayDay,
  type CanonicalDate,
} from "@/lib/capture/date";
import { autoBank, autoPurpose } from "@/lib/capture/defaults";
import { existingIdentities, smsIdentity } from "@/lib/capture/identity";
import {
  PURPOSE_LABEL,
  purposeOptions,
  requiresAgent,
  requiresDistributor,
  settlesAgentCredits,
  isPersonal as isPersonalPurpose,
  type BusinessPurpose,
} from "@/lib/capture/purpose";
import { evaluateRow, importableCount, type ReadinessInput } from "@/lib/capture/readiness";
import {
  addSmsInboxRows,
  deleteSharedInput,
  importInboxSms,
  setInboxDecision,
  setInboxDecisions,
  setSharedInputStatus,
  useAgents,
  useBanks,
  useDistributors,
  useSharedInputs,
  useTransactions,
} from "@/lib/db";
import { normalizeLabel } from "@/lib/approved-mappings";
import { matchDistributorForPayment } from "@/lib/purchase-fulfillment";
import { isAirtimeTransaction } from "@/lib/airtime-movement";
import { formatEtb, formatTxnDate } from "@/lib/format";
import type { Agent, Bank, Distributor, SharedInput, Transaction } from "@/lib/types";

const NONE = "__none__";

function isAirtimeRow(row: ParsedRow): boolean {
  return row.ok && (row.type === "airtime_evd" || (row.type as string) === "airtime_float");
}

function directionOf(row: ParsedRow): "in" | "out" | "unknown" {
  if (!row.ok) return "unknown";
  if (row.type === "in") return "in";
  return "out";
}

function exactAgent(label: string | undefined, agents: Agent[]): Agent | null {
  if (!label) return null;
  const key = normalizeLabel(label);
  if (!key) return null;
  return agents.find((a) => normalizeLabel(a.name) === key) ?? null;
}

export interface SmsInboxProps {
  /** Text handed over by the share target, ingested exactly like a paste. */
  initialText?: string;
}

export function SmsInbox({ initialText }: SmsInboxProps = {}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [batchDay, setBatchDay] = useState("");
  const [busy, setBusy] = useState(false);

  const items = useSharedInputs();
  const agents = useAgents();
  const banks = useBanks();
  const distributors = useDistributors();
  const txns = useTransactions();

  const identities = useMemo(() => existingIdentities(txns), [txns]);

  const pending = useMemo(
    () => sortInboxRows(items.filter((i) => i.status === "pending" && i.kind === "text")),
    [items],
  );

  async function ingest(value: string, origin: "paste" | "clipboard" | "share") {
    const drafts = ingestSmsDrafts(value, { origin });
    if (!drafts.length) {
      setNote("Nothing to add — the capture was empty.");
      return;
    }
    const n = await addSmsInboxRows(drafts);
    setText("");
    setNote(`${n} message${n > 1 ? "s" : ""} added to the inbox.`);
  }

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        setNote("The clipboard is empty.");
        return;
      }
      await ingest(clip, "clipboard");
    } catch {
      setNote("This browser blocked clipboard access — paste into the box instead.");
    }
  }

  // Every shared message takes the identical path as a paste.
  const [ingestedShare, setIngestedShare] = useState<string | null>(null);
  if (initialText && initialText.trim() && ingestedShare !== initialText) {
    setIngestedShare(initialText);
    void ingest(initialText, "share");
  }

  interface Review {
    item: SharedInput;
    row: ParsedRow;
    bank: Bank | null;
    agent: Agent | null;
    distributor: Distributor | null;
    purpose: BusinessPurpose;
    date: CanonicalDate;
    identity: string | null;
    duplicate: boolean;
    input: ReadinessInput;
  }

  const reviews: Review[] = useMemo(() => {
    return pending.map((item) => {
      // Every operator decision is read back from the inbox record itself, so
      // a refresh, a lock or a share hand-over never loses review work.
      const dec = item.decisions ?? {};
      const pickOf = (v: string | null | undefined): string | undefined =>
        v === null ? NONE : (v ?? undefined);
      const row = parseSourceRecords(item.text ?? "")[0] ?? {
        ok: false as const,
        raw: item.text ?? "",
        reason: "No transaction found in this message.",
      };
      const airtime = isAirtimeRow(row);
      const direction = directionOf(row);

      // ---- account: an exact tail selects the configured bank by itself
      const pickedBank = pickOf(dec.bankId);
      const bank =
        pickedBank && pickedBank !== NONE
          ? (banks.find((b) => b.id === pickedBank) ?? null)
          : row.ok
            ? autoBank(row, banks)
            : null;

      // ---- agent: exact name only, or the operator's choice
      const pickedAgent = pickOf(dec.agentId);
      const agent =
        pickedAgent === NONE
          ? null
          : pickedAgent
            ? (agents.find((a) => a.id === pickedAgent) ?? null)
            : row.ok
              ? exactAgent(row.party, agents)
              : null;

      // ---- distributor: exact match on name, alias or configured account
      const pickedDist = pickOf(dec.distributorId);
      const autoDist =
        row.ok && direction === "out"
          ? matchDistributorForPayment(
              { partyName: row.party ?? "", note: row.note, reference: row.reference },
              distributors,
            )
          : null;
      const distributor =
        pickedDist === NONE
          ? null
          : pickedDist
            ? (distributors.find((d) => d.id === pickedDist) ?? null)
            : autoDist;

      // ---- purpose follows from the links unless the operator overrode it
      const purpose =
        (dec.purpose as BusinessPurpose | undefined) ??
        autoPurpose({
          direction,
          agentLinked: Boolean(agent),
          distributorLinked: Boolean(distributor),
        });

      // ---- date: one canonical model, days handled as plain strings
      const sourceIso = row.ok ? (row as { date?: string }).date : undefined;
      const date = canonicalDate({
        sourceDate: dayFromIso(sourceIso),
        sourceTime: timeFromIso(sourceIso, row.ok ? row.dateIsDayOnly : true),
        batchDate: dec.day,
        reviewerDateOverride: dec.correctedDay,
        reviewerTimeOverride: dec.time,
        correctionConfirmed: dec.correctionConfirmed,
      });
      const dateIso = date.effectiveDate
        ? storageIso(date.effectiveDate, date.effectiveTime)
        : null;

      const identity = row.ok
        ? smsIdentity({
            source: row.channel,
            direction: row.type,
            accountTail: row.accountTail,
            counterpartyAccountTail: row.counterpartyAccountTail,
            amountSantim: row.amountSantim,
            dateIso: dateIso ?? undefined,
            party: row.party,
            reference: row.reference,
            raw: item.text ?? "",
          })
        : null;
      const duplicate = Boolean(identity && identities.has(identity));

      const fp = row.ok ? fingerprintSource(row.raw) : null;
      const needsAgent = requiresAgent(purpose);
      const needsDistributor = requiresDistributor(purpose);
      // A linked agent whose name is not the name the message stated is
      // surfaced by name, never as a vague "needs attention".
      const partyKey = normalizeLabel(row.ok ? (row.party ?? "") : "");
      const recipientMismatch = Boolean(
        needsAgent && agent && partyKey && normalizeLabel(agent.name) !== partyKey,
      );
      const input: ReadinessInput = {
        sourceResolved: Boolean(
          row.ok && (fp?.resolved || (row.channel && row.channel !== "Other")),
        ),
        familyResolved: row.ok,
        financialBlockers: row.ok ? (row.blockingIssues?.length ?? 0) : 0,
        hasDate: dateIso !== null,
        dateConflict: date.conflict,
        sourceDay: date.sourceDate ? formatDayShort(date.sourceDate) : undefined,
        correctedDay: date.reviewerDateOverride
          ? formatDayShort(date.reviewerDateOverride)
          : undefined,
        accountSelected: airtime || !row.ok || Boolean(bank),
        purposeResolved: purpose !== "unresolved",
        requiresLink: needsAgent || needsDistributor,
        linkSatisfied: needsAgent ? Boolean(agent) : needsDistributor ? Boolean(distributor) : true,
        linkCertain: true,
        linkKind: needsDistributor && !needsAgent ? "distributor" : "agent",
        recipientMismatch: recipientMismatch && !dec.recipientConfirmed,
        messageParty: row.ok ? row.party : undefined,
        linkedParty: agent?.name,
        needsReview: Boolean(row.ok && row.needsReview),
        // Only an actual identity collision asks the operator anything.
        duplicateRisk: duplicate,
        duplicateRiskAcknowledged: Boolean(dec.duplicateAcknowledged),
      };

      return {
        item,
        row,
        bank,
        agent,
        distributor,
        purpose,
        date,
        identity,
        duplicate,
        input,
      };
    });
  }, [pending, agents, banks, distributors, identities]);

  const readyCount = importableCount(reviews.map((r) => r.input));
  const selectedIds = reviews.filter((r) => selected[r.item.id]).map((r) => r.item.id);
  const allSelected = reviews.length > 0 && selectedIds.length === reviews.length;

  /**
   * One tap dates every selected message that stated no date of its own. A
   * genuine source date is never overwritten, and the operator is told exactly
   * how many rows were changed and how many were left alone.
   */
  async function applyDay(day: string) {
    if (!day) return;
    const scope = reviews.filter((r) => selected[r.item.id] || selectedIds.length === 0);
    const targets = scope.filter((r) => !r.date.hasGenuineDate);
    const skipped = scope.length - targets.length;
    if (!targets.length) {
      setNote(
        `No dates changed — ${skipped} message(s) already carry their own date, which is kept.`,
      );
      return;
    }
    await setInboxDecisions(
      targets.map((t) => t.item.id),
      { day },
    );
    setNote(
      `${formatDayShort(day)} applied to ${targets.length} undated message(s)` +
        (skipped ? `; ${skipped} kept their own date.` : "."),
    );
  }

  async function importReady() {
    const ready = reviews.filter((r) => evaluateRow(r.input).canImport);
    if (!ready.length) {
      toast.error("Nothing is ready to import yet");
      return;
    }
    setBusy(true);
    let saved = 0;
    let dupes = 0;
    try {
      for (const r of ready) {
        if (!r.row.ok) continue;
        const row = r.row;
        const agentId = requiresAgent(r.purpose) ? r.agent?.id : undefined;
        const distributorId =
          requiresDistributor(r.purpose) || isAirtimeRow(row) ? r.distributor?.id : undefined;
        const partyId = agentId ?? distributorId;
        const partyType: Transaction["partyType"] | undefined = agentId
          ? "agent"
          : distributorId
            ? "distributor"
            : undefined;
        const input: Omit<Transaction, "id" | "createdAt"> = {
          type: row.type,
          amountSantim: row.amountSantim,
          principalSantim: row.principalSantim,
          dateIsDayOnly: !r.date.effectiveTime,
          airtimeDirection: isAirtimeTransaction({ type: row.type }) ? "sent" : undefined,
          partyName: row.party ?? "Unknown",
          partyId,
          partyType,
          channel: row.channel ?? "Other",
          bankId: r.bank?.id,
          distributorId,
          reference: row.reference,
          note: row.note ?? row.raw,
          date: storageIso(r.date.effectiveDate!, r.date.effectiveTime),
          isPersonal: isPersonalPurpose(r.purpose),
          needsReview: row.needsReview,
          captureKey: r.identity ?? r.item.id,
          source: "paste_parse",
        };
        const res = await importInboxSms(input, {
          inboxId: r.item.id,
          settleAgentId: settlesAgentCredits(r.purpose) && agentId ? agentId : undefined,
        });
        if (res.duplicate) dupes++;
        else saved++;
      }
      toast.success(
        `Imported ${saved}` + (dupes ? `, skipped ${dupes} already-saved message(s)` : ""),
      );
      setNote(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <div>
          <div className="font-semibold">Add messages</div>
          <div className="text-xs text-ink-soft">
            Paste one message or a hundred. Each one is kept in the inbox until you import or
            dismiss it.
          </div>
        </div>
        <Textarea
          rows={4}
          placeholder="Paste bank or airtime messages here"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void ingest(text, "paste")} disabled={!text.trim()}>
            Add to inbox
          </Button>
          <Button size="sm" variant="outline" onClick={() => void pasteFromClipboard()}>
            Paste from clipboard
          </Button>
          {note && <span className="text-xs text-ink-soft">{note}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Checkbox
          id="select-all"
          checked={allSelected}
          onCheckedChange={(v) =>
            setSelected(v ? Object.fromEntries(reviews.map((r) => [r.item.id, true])) : {})
          }
        />
        <label htmlFor="select-all" className="text-ink-soft">
          Select all
        </label>
        <span className="text-ink-soft">
          {reviews.length} waiting · {readyCount} ready
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => applyDay(todayDay())}>
            Today
          </Button>
          <Button size="sm" variant="secondary" onClick={() => applyDay(yesterdayDay())}>
            Yesterday
          </Button>
          <Input
            type="date"
            className="h-8 w-auto text-xs"
            value={batchDay}
            onChange={(e) => setBatchDay(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!batchDay}
            onClick={() => applyDay(batchDay)}
          >
            Apply date
          </Button>
          <Button size="sm" onClick={() => void importReady()} disabled={busy || readyCount === 0}>
            Import {readyCount}
          </Button>
        </div>
      </div>

      {reviews.length === 0 && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-ink-soft">
          The inbox is empty. Paste a message above, or share one to EthioTrack from your phone.
        </div>
      )}

      <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
        {reviews.map((r) => (
          <InboxSmsRow
            key={r.item.id}
            review={r}
            agents={agents}
            banks={banks}
            distributors={distributors}
            selected={Boolean(selected[r.item.id])}
            onSelect={(v) => setSelected((s) => ({ ...s, [r.item.id]: v }))}
            onAgent={(v) => void setInboxDecision(r.item.id, { agentId: v === NONE ? null : v })}
            onDistributor={(v) =>
              void setInboxDecision(r.item.id, { distributorId: v === NONE ? null : v })
            }
            onBank={(v) => void setInboxDecision(r.item.id, { bankId: v === NONE ? null : v })}
            onPurpose={(v) => void setInboxDecision(r.item.id, { purpose: v })}
            onDate={(v) => void setInboxDecision(r.item.id, { day: v })}
            onCorrectDate={(v) => void setInboxDecision(r.item.id, { correctedDay: v })}
            onConfirmCorrection={(v) =>
              void setInboxDecision(r.item.id, { correctionConfirmed: v })
            }
            onConfirmRecipient={(v) => void setInboxDecision(r.item.id, { recipientConfirmed: v })}
            onDupOk={(v) => void setInboxDecision(r.item.id, { duplicateAcknowledged: v })}
            onDismiss={() => void setSharedInputStatus(r.item.id, "dismissed")}
            onDelete={() => void deleteSharedInput(r.item.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function InboxSmsRow({
  review,
  agents,
  banks,
  distributors,
  selected,
  onSelect,
  onAgent,
  onDistributor,
  onBank,
  onPurpose,
  onDate,
  onCorrectDate,
  onConfirmCorrection,
  onConfirmRecipient,
  onDupOk,
  onDismiss,
  onDelete,
}: {
  review: {
    item: SharedInput;
    row: ParsedRow;
    bank: Bank | null;
    agent: Agent | null;
    distributor: Distributor | null;
    purpose: BusinessPurpose;
    date: CanonicalDate;
    duplicate: boolean;
    identity: string | null;
    input: ReadinessInput;
  };
  agents: Agent[];
  banks: Bank[];
  distributors: Distributor[];
  selected: boolean;
  onSelect: (v: boolean) => void;
  onAgent: (v: string) => void;
  onDistributor: (v: string) => void;
  onBank: (v: string) => void;
  onPurpose: (v: BusinessPurpose) => void;
  onDate: (v: string) => void;
  onCorrectDate: (v: string) => void;
  onConfirmCorrection: (v: boolean) => void;
  onConfirmRecipient: (v: boolean) => void;
  onDupOk: (v: boolean) => void;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const { item, row, bank, agent, distributor, purpose, date } = review;
  const evaluation = evaluateRow(review.input);
  const [correcting, setCorrecting] = useState(false);
  const direction = directionOf(row);
  const airtime = isAirtimeRow(row);
  const fp = row.ok ? fingerprintSource(row.raw) : null;
  const showAgent = requiresAgent(purpose) || direction === "in";
  const showDistributor = requiresDistributor(purpose) || airtime;

  return (
    <li className={"p-3 space-y-2 " + (row.ok ? "" : "bg-money-out/5")}>
      <div className="flex items-center gap-2 flex-wrap">
        <Checkbox checked={selected} onCheckedChange={(v) => onSelect(Boolean(v))} />
        {row.ok ? (
          <span
            className={
              "font-bold tabular-nums " + (row.type === "in" ? "text-money-in" : "text-money-out")
            }
          >
            {row.type === "in" ? "+" : "−"} {formatEtb(row.amountSantim)}
          </span>
        ) : (
          <span className="font-semibold text-money-out">Unreadable message</span>
        )}
        <span className="text-xs text-ink-soft">{row.ok ? (row.channel ?? "Unknown") : "—"}</span>
        <span className="text-xs text-ink-soft">
          {dateIso ? formatTxnDate(dateIso, !review.dateIsDayOnly) : "no date"}
        </span>
        <span
          className={
            "ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold " +
            (evaluation.state === "READY"
              ? "bg-money-in/10 text-money-in"
              : evaluation.state === "NEEDS_ATTENTION"
                ? "bg-airtime/15 text-airtime"
                : "bg-money-out/10 text-money-out")
          }
        >
          {evaluation.state === "READY" ? "Ready" : evaluation.blocker}
        </span>
      </div>

      {row.ok && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select value={purpose} onValueChange={(v) => onPurpose(v as BusinessPurpose)}>
            <SelectTrigger className="h-8 w-auto min-w-[10rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {purposeOptions(direction).map((p) => (
                <SelectItem key={p} value={p}>
                  {PURPOSE_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {showAgent && (
            <Select value={agent?.id ?? NONE} onValueChange={onAgent}>
              <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No agent</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {showDistributor && (
            <Select value={distributor?.id ?? NONE} onValueChange={onDistributor}>
              <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
                <SelectValue placeholder="Distributor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No distributor</SelectItem>
                {distributors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {!airtime && (
            <Select value={bank?.id ?? NONE} onValueChange={onBank}>
              <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
                <SelectValue placeholder="Account" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No account</SelectItem>
                {banks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {!review.dateFromMessage && (
            <Input
              type="date"
              className="h-8 w-auto text-xs"
              onChange={(e) => onDate(e.target.value)}
            />
          )}
        </div>
      )}

      {review.duplicate && (
        <label className="flex items-center gap-2 text-xs text-airtime">
          <Checkbox
            checked={Boolean(review.input.duplicateRiskAcknowledged)}
            onCheckedChange={(v) => onDupOk(Boolean(v))}
          />
          This matches a message already saved. Tick to import it anyway.
        </label>
      )}

      <details className="text-xs text-ink-soft">
        <summary className="cursor-pointer">Details</summary>
        <div className="pt-1 space-y-1">
          {row.ok && (
            <div>
              source: {fp?.resolved ? fp.source : "unresolved"}
              {row.accountTail ? ` · ···${row.accountTail}` : ""}
              {row.reference ? ` · ref ${row.reference}` : " · no reference"}
              {row.party ? ` · ${row.party}` : ""}
            </div>
          )}
          {!row.ok && <div className="text-money-out">{row.reason}</div>}
          <pre className="whitespace-pre-wrap break-words">{item.text}</pre>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </div>
      </details>
    </li>
  );
}
