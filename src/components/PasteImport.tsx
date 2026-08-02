import { isAirtimeTransaction } from "@/lib/airtime-movement";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ParsedOk, type ParsedRow } from "@/lib/parser";
import { parseSourceRecords } from "@/lib/capture/parse-records";
import { fingerprintSource } from "@/lib/capture/source-fingerprint";
import { resolveFinalAmount } from "@/lib/capture/candidate";
import {
  PURPOSE_LABEL,
  defaultPurpose,
  purposeOptions,
  requiresAgent,
  requiresDistributor,
  settlesAgentCredits,
  isPersonal as isPersonalPurpose,
  type BusinessPurpose,
} from "@/lib/capture/purpose";
import {
  rowReadiness,
  summarizeReadinessStates,
  type ReadinessInput,
} from "@/lib/capture/readiness";
import {
  addTransactionsBulk,
  forceInsertTransactions,
  updateTransaction,
  upsertAgent,
  upsertBank,
  upsertDistributor,
  useAgents,
  useApprovedMappings,
  approveMapping,
  recordMappingUse,
  useBanks,
  useDistributors,
  useTransactions,
} from "@/lib/db";
import { findMapping, normalizeLabel } from "@/lib/approved-mappings";
import { matchDistributorForPayment } from "@/lib/purchase-fulfillment";
import { openCreditsFor, planFifoSettlement } from "@/lib/brain/credits";
import { formatEtb } from "@/lib/format";
import type { Agent, AirtimeForm, Bank, Distributor, Transaction } from "@/lib/types";
import { toast } from "sonner";

// Entities are never created from a capture: the operator links an existing
// agent or distributor, or the row stays unresolved.
type PartyAction =
  | { kind: "none" }
  | { kind: "link"; partyType: "agent" | "distributor"; id: string };

type BankAction = { kind: "auto" } | { kind: "skip" };

type DistributorAction = { kind: "none" } | { kind: "link"; id: string };

function isAirtimeRow(t: ParsedOk["type"]): boolean {
  return t === "airtime_evd" || (t as string) === "airtime_float";
}

/** A parsed CBE outgoing transfer — the bank leg of an EVD purchase. */
function isBankTransferRow(row: ParsedRow): boolean {
  return row.ok && row.template === "cbe.transfer.out";
}

/**
 * Strict distributor match for a bank transfer: exact name, exact alias or a
 * configured account tail. Never fuzzy, never auto-created.
 */
function matchTransferDistributor(row: ParsedRow, distributors: Distributor[]): Distributor | null {
  if (!row.ok || !isBankTransferRow(row)) return null;
  return matchDistributorForPayment(
    { partyName: row.party ?? "", note: row.note, reference: row.reference },
    distributors,
  );
}

function airtimeFormOf(t: ParsedOk["type"]): AirtimeForm | undefined {
  if (t === "airtime_evd") return "evd";
  if ((t as string) === "airtime_float") return "float";
  return undefined;
}

/** Normalize a phone/msisdn for loose comparison — last 9 digits wins. */
function phoneKey(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = s.replace(/\D+/g, "");
  return d.length >= 9 ? d.slice(-9) : d || undefined;
}

function matchDistributor(row: ParsedRow, distributors: Distributor[]): Distributor | null {
  if (!row.ok || !isAirtimeRow(row.type)) return null;
  const form = airtimeFormOf(row.type);
  const phone = phoneKey(row.counterpartyPhone);
  // 1) Contact-phone match wins if the SMS has a phone.
  if (phone) {
    const hit = distributors.find((d) => phoneKey(d.contact) === phone);
    if (hit) return hit;
  }
  // 2) Otherwise: if exactly one distributor supplies this airtime form, use it.
  if (form) {
    const candidates = distributors.filter(
      (d) => !d.forms || d.forms.length === 0 || d.forms.includes(form),
    );
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

/**
 * Party names our templates produce that are generic labels, not real
 * counterparties — never auto-create an agent/distributor from these.
 */
const GENERIC_PARTY_RX =
  /^(Unknown|Deposit|Withdrawal \/ payment|Payment|Bank charge \/ transfer|Self deposit|Airtime|Recharge · |Tax · )/;

function isGenericParty(name: string | undefined): boolean {
  if (!name) return true;
  return GENERIC_PARTY_RX.test(name);
}

/**
 * Exact agent match only: identical name or identical alias after case and
 * whitespace normalization. Never fuzzy — a near-miss stays unresolved so the
 * operator picks the agent by hand.
 */
function exactAgentMatch(label: string | undefined, agents: Agent[]): Agent | null {
  if (!label) return null;
  const key = normalizeLabel(label);
  if (!key) return null;
  return agents.find((a) => normalizeLabel(a.name) === key) ?? null;
}

/** Unprocessed capture text survives a refresh until it is imported. */
const PENDING_TEXT_KEY = "ethiotrack.capture.pending-batch";

function readPendingText(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(PENDING_TEXT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writePendingText(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value.trim()) window.localStorage.setItem(PENDING_TEXT_KEY, value);
    else window.localStorage.removeItem(PENDING_TEXT_KEY);
  } catch {
    /* storage unavailable — the batch simply won't survive a refresh */
  }
}

function suggestBankName(channel: string, accountTail?: string): string {
  if (accountTail) return `${channel} ···${accountTail}`;
  const wallets = ["Telebirr", "M-Pesa", "CoopPay", "eBirr"];
  return wallets.includes(channel) ? `${channel} wallet` : `${channel} account`;
}

export interface PasteImportProps {
  /** Text handed over by Smart Capture — reviewed immediately, never saved. */
  initialText?: string;
  /** Smart Capture already shows the heading, so the card chrome is dropped. */
  embedded?: boolean;
  /** Fired only after rows were actually written. */
  onSaved?: () => void;
}

export function PasteImport({ initialText, embedded = false, onSaved }: PasteImportProps = {}) {
  const [text, setText] = useState(initialText ?? "");
  const [isPersonal, setPersonal] = useState(false);
  const [rows, setRows] = useState<ParsedRow[] | null>(
    initialText && initialText.trim() ? parseSourceRecords(initialText) : null,
  );
  const agents = useAgents();
  const banks = useBanks();
  const distributors = useDistributors();
  const txns = useTransactions();
  const [partyActions, setPartyActions] = useState<Record<number, PartyAction>>({});
  const [bankActions, setBankActions] = useState<Record<number, BankAction>>({});
  const [distActions, setDistActions] = useState<Record<number, DistributorAction>>({});
  /** User-supplied transaction date/time for messages that stated none. */
  const [manualDates, setManualDates] = useState<Record<number, { date: string; time: string }>>(
    {},
  );
  const [purposes, setPurposes] = useState<Record<number, BusinessPurpose>>({});
  /** "Remember this exact sender label" ticks, per row. */
  const [remember, setRemember] = useState<Record<number, boolean>>({});
  const mappings = useApprovedMappings();
  const [skippedInfo, setSkippedInfo] = useState<
    Array<{ input: Omit<Transaction, "id" | "createdAt">; reason: "reference" | "heuristic" }>
  >([]);

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
      const hit = banks.find((b) => b.channel.toLowerCase() === row.channel!.toLowerCase());
      if (hit) return hit;
    }
    return null;
  }

  const enriched = useMemo(() => {
    return (rows ?? []).map((r) => {
      // Exact identity only — a mapping the operator approved earlier, or an
      // identical agent name. Nothing fuzzy ever pre-selects an entity.
      const label = r.ok ? r.party : undefined;
      const mapping = findMapping(label, "bank_message", "agent", mappings);
      const mapped = mapping ? (agents.find((a) => a.id === mapping.targetId) ?? null) : null;
      const match = mapped ?? exactAgentMatch(label, agents);
      const bank = matchBank(r);
      const distributor = matchDistributor(r, distributors);
      const payee = matchTransferDistributor(r, distributors);
      return { row: r, agent: match, agentMapping: mapping, bank, distributor, payee };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, agents, banks, distributors, mappings]);

  function partyActionFor(
    i: number,
    e: (typeof enriched)[number],
    purpose: BusinessPurpose,
  ): PartyAction {
    const override = partyActions[i];
    if (override) return override;
    // The business purpose decides which entity may be linked at all.
    if (requiresAgent(purpose) && e.agent) {
      return { kind: "link", partyType: "agent", id: e.agent.id };
    }
    if (requiresDistributor(purpose) && e.payee) {
      return { kind: "link", partyType: "distributor", id: e.payee.id };
    }
    return { kind: "none" };
  }

  function bankActionFor(i: number, e: (typeof enriched)[number]): BankAction {
    const override = bankActions[i];
    if (override) return override;
    // Already linked to an existing bank — nothing to do.
    if (e.bank) return { kind: "skip" };
    // Only auto-register when we actually know which channel it belongs to.
    if (e.row.ok && e.row.channel && e.row.channel !== "Other") return { kind: "auto" };
    return { kind: "skip" };
  }

  function distActionFor(
    i: number,
    e: (typeof enriched)[number],
    purpose: BusinessPurpose,
  ): DistributorAction {
    const override = distActions[i];
    if (override) return override;
    if (requiresDistributor(purpose) && e.payee) return { kind: "link", id: e.payee.id };
    if (e.row.ok && isAirtimeRow(e.row.type) && e.distributor)
      return { kind: "link", id: e.distributor.id };
    return { kind: "none" };
  }

  /** Hard blockers reported by the parser — malformed money, bad arithmetic. */
  function blockersFor(row: ParsedRow): string[] {
    return row.ok ? (row.blockingIssues ?? []) : [];
  }

  /**
   * The transaction date: the one the message stated, or the one the user
   * typed in review. Never the current clock.
   */
  function resolvedDate(i: number, row: ParsedRow): { iso: string; dayOnly: boolean } | null {
    if (row.ok && row.date) return { iso: row.date, dayOnly: row.dateIsDayOnly ?? false };
    const manual = manualDates[i];
    if (!manual?.date) return null;
    const iso = new Date(`${manual.date}T${manual.time || "00:00"}:00Z`);
    if (isNaN(iso.getTime())) return null;
    return { iso: iso.toISOString(), dayOnly: !manual.time };
  }

  /** Money direction used to offer the right business purposes. */
  function directionOf(row: ParsedRow): "in" | "out" | "unknown" {
    if (!row.ok) return "unknown";
    if (row.type === "in") return "in";
    if (row.type === "out") return "out";
    // Airtime rows move stock out of the operator's float/EVD balance.
    return "out";
  }

  function purposeFor(i: number, row: ParsedRow): BusinessPurpose {
    return purposes[i] ?? defaultPurpose();
  }

  /** A bank/wallet leg must name the account it moved through. */
  function requiresAccount(row: ParsedRow): boolean {
    return row.ok && !isAirtimeRow(row.type);
  }

  /** Everything the state machine needs for one row. */
  function readinessInput(i: number, e: (typeof enriched)[number]): ReadinessInput {
    const { row } = e;
    const purpose = purposeFor(i, row);
    const fp = row.ok ? fingerprintSource(row.raw) : null;
    const bAction = bankActionFor(i, e);
    const pAction = partyActionFor(i, e, purpose);
    const dAction = distActionFor(i, e, purpose);
    const needsAgent = requiresAgent(purpose);
    const needsDistributor = requiresDistributor(purpose);
    return {
      sourceResolved: Boolean(row.ok && (fp?.resolved || (row.channel && row.channel !== "Other"))),
      familyResolved: row.ok,
      financialBlockers: blockersFor(row).length,
      hasDate: resolvedDate(i, row) !== null,
      accountSelected: !requiresAccount(row) || Boolean(e.bank) || bAction.kind === "auto",
      purposeResolved: purpose !== "unresolved",
      requiresLink: needsAgent || needsDistributor,
      linkSatisfied: needsAgent
        ? pAction.kind === "link" && pAction.partyType === "agent"
        : needsDistributor
          ? dAction.kind === "link" ||
            (pAction.kind === "link" && pAction.partyType === "distributor")
          : true,
      // An explicit operator selection is certain by definition; only a
      // pre-selected guess would be uncertain, and none is ever made.
      linkCertain: true,
      needsReview: Boolean(row.ok && row.needsReview),
    };
  }

  /** Only READY rows are counted and imported. */
  function isImportable(i: number, e: (typeof enriched)[number]): boolean {
    return rowReadiness(readinessInput(i, e)) === "READY";
  }

  const importableCount = enriched.filter((e, i) => isImportable(i, e)).length;

  /** Batch readiness, shown before anything can be saved. */
  const readiness = useMemo(
    () => summarizeReadinessStates(enriched.map((e, i) => readinessInput(i, e))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enriched, manualDates, distActions, partyActions, bankActions, purposes],
  );

  // An unprocessed batch survives a refresh: nothing is saved, but the text
  // and its parsed rows come back exactly as they were.
  useEffect(() => {
    if (initialText !== undefined) return;
    const pending = readPendingText();
    if (!pending.trim()) return;
    setText(pending);
    setRows(parseSourceRecords(pending));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initialText !== undefined) return;
    writePendingText(text);
  }, [text, initialText]);

  useEffect(() => {
    if (initialText === undefined) return;
    setText(initialText);
    setRows(initialText.trim() ? parseSourceRecords(initialText) : null);
    setPartyActions({});
    setBankActions({});
    setDistActions({});
    setManualDates({});
    setPurposes({});
    setRemember({});
  }, [initialText]);

  function detect() {
    if (!text.trim()) return;
    setRows(parseSourceRecords(text));
    setPartyActions({});
    setBankActions({});
    setDistActions({});
    setManualDates({});
    setPurposes({});
    setRemember({});
  }

  async function importAll() {
    const ok = enriched.filter((e, i) => isImportable(i, e));
    if (!ok.length) {
      toast.error("Nothing is READY — resolve source, date, account and purpose first");
      return;
    }

    // Only the account a message moved through may be registered here; agents
    // and distributors are never created from a capture.
    let createdBanks = 0;
    let blockedNotReady = 0;
    const inputs: Array<Omit<Transaction, "id" | "createdAt">> = [];
    /** Parallel to `inputs`: which rows may clear open agent credits. */
    const settlePlan: boolean[] = [];

    for (let i = 0; i < enriched.length; i++) {
      const e = enriched[i];
      if (!e.row.ok) continue;
      const { row } = e;
      if (!isImportable(i, e)) {
        blockedNotReady++;
        continue;
      }
      const when = resolvedDate(i, row)!;
      const purpose = purposeFor(i, row);

      // ----- Bank resolution
      let bankId = e.bank?.id;
      const bAction = bankActionFor(i, e);
      if (!bankId && bAction.kind === "auto" && row.channel) {
        const name = suggestBankName(row.channel, row.accountTail);
        const bank = await upsertBank({
          name,
          channel: row.channel,
          accountNumber: row.accountTail,
          openingBalanceSantim: 0,
        });
        bankId = bank.id;
        createdBanks++;
      }

      // ----- Party resolution (explicit links only)
      let partyId: string | undefined;
      let partyType: Transaction["partyType"] | undefined;
      const pAction = partyActionFor(i, e, purpose);
      if (pAction.kind === "link") {
        partyId = pAction.id;
        partyType = pAction.partyType;
      }

      // ----- Distributor resolution (airtime rows only)
      let distributorId: string | undefined;
      if (isAirtimeRow(row.type) || requiresDistributor(purpose)) {
        const dAction = distActionFor(i, e, purpose);
        if (dAction.kind === "link") distributorId = dAction.id;
        // A distributor payment links the distributor as the counterparty too.
        if (requiresDistributor(purpose) && distributorId && !partyId) {
          partyId = distributorId;
          partyType = "distributor";
        }
        // If the party itself was linked as a distributor, prefer that link
        // so the two sides can never disagree.
        if (partyType === "distributor" && partyId) distributorId = partyId;
      }

      inputs.push({
        type: row.type,
        amountSantim: row.amountSantim,
        // Principal is kept apart from the final debit; the fulfilment queue
        // expects EVD equal to the principal, never the debited total.
        principalSantim: row.principalSantim,
        dateIsDayOnly: when.dayOnly,
        // Pasted alerts describe airtime distributed out to agents.
        airtimeDirection: isAirtimeTransaction({ type: row.type }) ? "sent" : undefined,
        partyName: row.party ?? "Unknown",
        partyId,
        partyType,
        channel: row.channel ?? "Other",
        bankId,
        distributorId,
        reference: row.reference,
        note: row.note ?? row.raw,
        date: when.iso,
        isPersonal: isPersonal || isPersonalPurpose(purpose),
        needsReview: row.needsReview,
        source: "paste_parse",
      });
      settlePlan.push(settlesAgentCredits(purpose) && partyType === "agent");
    }

    const res = await addTransactionsBulk(inputs);
    setSkippedInfo(res.skippedRows.map((s) => ({ input: s.input, reason: s.reason })));

    // Persist only the links the operator explicitly asked to remember, and
    // count reuse of the ones an earlier approval pre-selected.
    for (let i = 0; i < enriched.length; i++) {
      const e = enriched[i];
      if (!e.row.ok || !isImportable(i, e)) continue;
      const purpose = purposeFor(i, e.row);
      const pAction = partyActionFor(i, e, purpose);
      if (pAction.kind !== "link" || pAction.partyType !== "agent") continue;
      const label = e.row.party?.trim();
      if (!label) continue;
      if (e.agentMapping && e.agentMapping.targetId === pAction.id) {
        await recordMappingUse(e.agentMapping.id);
        continue;
      }
      if (!remember[i]) continue;
      const agent = agents.find((a) => a.id === pAction.id);
      if (agent) {
        await approveMapping({
          label,
          sourceFamily: "bank_message",
          targetType: "agent",
          targetId: agent.id,
          targetName: agent.name,
        });
      }
    }

    // FIFO settle: only an explicit "Agent settlement" purpose clears credits.
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (!settlePlan[i] || inp.type !== "in" || !inp.partyId) continue;
      const open = openCreditsFor(inp.partyId, txns);
      if (!open.length) continue;
      const plan = planFifoSettlement(inp.amountSantim, open);
      for (const cid of plan.settled) {
        const c = txns.find((t) => t.id === cid);
        if (c)
          await updateTransaction({ ...c, isSettled: true, settledAt: new Date().toISOString() });
      }
    }

    const extras = [createdBanks && `${createdBanks} new bank${createdBanks > 1 ? "s" : ""}`]
      .filter(Boolean)
      .join(", ");
    toast.success(
      `Imported ${res.inserted}` +
        (res.skipped ? `, skipped ${res.skipped} duplicate(s)` : "") +
        (extras ? ` · registered ${extras}` : ""),
    );
    if (res.inserted > 0) onSaved?.();
    if (blockedNotReady > 0) {
      toast.error(
        `${blockedNotReady} row(s) not imported: still missing a source, date, account, purpose or link.`,
      );
    } else {
      setText("");
      writePendingText("");
      setRows(null);
      setPartyActions({});
      setBankActions({});
      setDistActions({});
      setManualDates({});
      setPurposes({});
      setRemember({});
    }
  }

  async function forceImportSkipped() {
    if (!skippedInfo.length) return;
    const ids = await forceInsertTransactions(skippedInfo.map((s) => s.input));
    toast.success(`Force-imported ${ids.length} row(s)`);
    setSkippedInfo([]);
  }

  function encodePartyAction(a: PartyAction): string {
    if (a.kind === "link") return `link:${a.partyType}:${a.id}`;
    return a.kind;
  }
  function decodePartyAction(v: string): PartyAction {
    if (v === "none") return { kind: "none" };
    const [, type, id] = v.split(":");
    return { kind: "link", partyType: type as "agent" | "distributor", id };
  }

  return (
    <div
      className={
        embedded ? "space-y-3" : "rounded-xl border border-border bg-card p-4 shadow-sm space-y-3"
      }
    >
      <>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="font-semibold">{embedded ? "Bank message" : "Paste bank SMS"}</div>
            <div className="text-xs text-ink-soft">
              Reviewed before saving — agents are only linked when the match is exact.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="personal" className="text-xs text-ink-soft">
              Mark as personal
            </Label>
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
          <Button onClick={detect} variant="secondary">
            Re-read message
          </Button>
          {enriched.length > 0 && (
            <Button onClick={importAll} className="ml-auto" disabled={importableCount === 0}>
              Import {importableCount}
            </Button>
          )}
        </div>
        {enriched.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded bg-muted text-ink-soft font-semibold px-2 py-0.5">
              {readiness.total} parsed
            </span>
            <span className="rounded bg-money-in/10 text-money-in font-semibold px-2 py-0.5">
              {readiness.ready} ready
            </span>
            <span className="rounded bg-airtime/10 text-airtime font-semibold px-2 py-0.5">
              {readiness.needsAttention} need attention
            </span>
            <span className="rounded bg-money-out/10 text-money-out font-semibold px-2 py-0.5">
              {readiness.incomplete} incomplete
            </span>
            <span className="rounded bg-money-out/20 text-money-out font-semibold px-2 py-0.5">
              {readiness.invalid} invalid
            </span>
          </div>
        )}
        {rows !== null && enriched.filter((e) => e.row.ok).length === 0 && (
          <div className="rounded-md border border-money-out/40 bg-money-out/5 p-2 text-xs space-y-1">
            <div className="font-semibold text-money-out">Nothing recognised in this message.</div>
            <div className="text-ink-soft">
              {enriched.length === 0
                ? "The paste contained only greetings or footers — no amount was found."
                : "The amount, direction or channel could not be read. Nothing was guessed; the text is kept above so you can paste the full message or enter it manually."}
            </div>
          </div>
        )}
        {enriched.length > 0 && (
          <ul className="text-sm divide-y divide-border rounded-md border border-border overflow-hidden">
            {enriched.map((e, i) => {
              const { row, agent, bank, distributor, payee } = e;
              const purpose = purposeFor(i, row);
              const pAction = partyActionFor(i, e, purpose);
              const bAction = bankActionFor(i, e);
              const dAction = distActionFor(i, e, purpose);
              const state = rowReadiness(readinessInput(i, e));
              const needsAgent = requiresAgent(purpose);
              const needsDistributor = requiresDistributor(purpose);
              const fp = row.ok ? fingerprintSource(row.raw) : null;
              const suggestedBank =
                row.ok && !bank && row.channel && row.channel !== "Other"
                  ? suggestBankName(row.channel, row.accountTail)
                  : null;
              const transfer = isBankTransferRow(row);
              const partyIsReal = row.ok && row.party && !isGenericParty(row.party);
              const airtime = row.ok && isAirtimeRow(row.type);
              const airtimeForm = airtime ? airtimeFormOf(row.type) : undefined;
              const distributorChoices = needsDistributor
                ? distributors
                : airtime
                  ? distributors.filter(
                      (d) =>
                        !airtimeForm ||
                        !d.forms ||
                        d.forms.length === 0 ||
                        d.forms.includes(airtimeForm),
                    )
                  : [];
              return (
                <li key={i} className={"p-2 " + (row.ok ? "" : "bg-money-out/5")}>
                  {row.ok ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span
                          className={
                            "font-bold tabular-nums " +
                            (row.type === "in" ? "text-money-in" : "text-money-out")
                          }
                        >
                          {row.type === "in" ? "+" : "−"} {formatEtb(row.amountSantim)}
                        </span>
                        <span className="flex items-center gap-1 text-xs">
                          <span className="uppercase font-semibold text-ink-soft">
                            {row.channel}
                          </span>
                          {row.accountTail && (
                            <span className="rounded bg-muted text-ink-soft px-1.5 py-0.5 tabular-nums">
                              ···{row.accountTail}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-[11px]">
                        <span
                          className={
                            "rounded px-1.5 py-0.5 font-semibold " +
                            (state === "READY"
                              ? "bg-money-in/10 text-money-in"
                              : state === "NEEDS_ATTENTION"
                                ? "bg-airtime/15 text-airtime"
                                : "bg-money-out/10 text-money-out")
                          }
                        >
                          {state}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-ink-soft">
                          source: {fp?.resolved ? fp.source : "unresolved"}
                          {fp?.channel ? ` · ${fp.channel}` : ""}
                        </span>
                        {fp && fp.evidence.length > 0 && (
                          <span className="text-ink-soft">{fp.evidence.join(" · ")}</span>
                        )}
                        {fp && fp.conflicts.length > 0 && (
                          <span className="text-money-out">{fp.conflicts.join(" · ")}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-ink-soft">Business purpose:</span>
                        <Select
                          value={purpose}
                          onValueChange={(v) =>
                            setPurposes((s) => ({ ...s, [i]: v as BusinessPurpose }))
                          }
                        >
                          <SelectTrigger className="h-6 w-auto min-w-[11rem] text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {purposeOptions(directionOf(row)).map((p) => (
                              <SelectItem key={p} value={p}>
                                {PURPOSE_LABEL[p]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {purpose === "unresolved" && (
                          <span className="text-money-out">
                            An unresolved purpose can never be imported.
                          </span>
                        )}
                        {requiresAgent(purpose) && (
                          <span className="text-airtime">
                            Pick the exact agent below — agents are never created here.
                          </span>
                        )}
                      </div>
                      <div className="text-xs">
                        <span className="font-medium">{row.party}</span>
                        {row.counterpartyPhone && (
                          <span className="text-ink-soft"> · {row.counterpartyPhone}</span>
                        )}
                        {agent && !transfer && (
                          <span className="text-money-in font-semibold">
                            {" "}
                            · linked → {agent.name}
                          </span>
                        )}
                        {!agent && !transfer && row.party && row.party !== "Unknown" && (
                          <span className="text-ink-soft"> · no agent match</span>
                        )}
                        {bank ? (
                          <span className="text-money-in font-semibold">
                            {" "}
                            · account → {bank.name}
                          </span>
                        ) : row.accountTail ? (
                          <span className="text-airtime">
                            {" "}
                            · no bank match (···{row.accountTail})
                          </span>
                        ) : null}
                        {airtime && distributor && (
                          <span className="text-money-in font-semibold">
                            {" "}
                            · distributor → {distributor.name}
                          </span>
                        )}
                        {airtime && !distributor && (
                          <span className="text-airtime"> · no distributor linked</span>
                        )}
                        {transfer && payee && (
                          <span className="text-money-in font-semibold">
                            {" "}
                            · paid to → {payee.name}
                          </span>
                        )}
                        {transfer && !payee && (
                          <span className="text-money-out font-semibold">
                            {" "}
                            · recipient not a configured distributor — pick one below
                          </span>
                        )}
                        {row.needsReview && (
                          <span className="ml-1 inline-flex items-center rounded bg-airtime/15 text-airtime text-[10px] font-semibold px-1.5 py-0.5">
                            review
                          </span>
                        )}
                        {row.template && (
                          <span className="ml-1 inline-flex items-center rounded bg-money-in/10 text-money-in text-[10px] font-semibold px-1.5 py-0.5">
                            {row.template}
                          </span>
                        )}
                      </div>
                      {row.ok &&
                        (transfer ||
                          row.feeSantim !== undefined ||
                          row.vatSantim !== undefined ||
                          row.finalDebitSantim !== undefined) && (
                          <div className="text-[11px] rounded border border-border bg-muted/40 px-2 py-1 space-y-0.5">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 tabular-nums">
                              <span>
                                <span className="text-ink-soft">Principal: </span>
                                {formatEtb(row.principalSantim ?? row.amountSantim)}
                              </span>
                              <span>
                                <span className="text-ink-soft">Final bank debit: </span>
                                {(() => {
                                  const final = resolveFinalAmount({
                                    statedFinalSantim: row.finalDebitSantim,
                                    principalSantim: row.principalSantim ?? row.amountSantim,
                                    feeSantim: row.feeSantim,
                                    vatSantim: row.vatSantim,
                                    otherChargesSantim: row.drChargeSantim,
                                    hasCharges:
                                      row.feeSantim !== undefined || row.vatSantim !== undefined,
                                  });
                                  return final !== undefined ? (
                                    formatEtb(final)
                                  ) : (
                                    <span className="text-money-out">not stated</span>
                                  );
                                })()}
                              </span>
                              <span>
                                <span className="text-ink-soft">Service charge: </span>
                                {row.feeSantim !== undefined ? (
                                  formatEtb(row.feeSantim)
                                ) : (
                                  <span className="text-ink-soft">not stated</span>
                                )}
                              </span>
                              <span>
                                <span className="text-ink-soft">VAT: </span>
                                {row.vatSantim !== undefined ? (
                                  formatEtb(row.vatSantim)
                                ) : (
                                  <span className="text-ink-soft">not stated</span>
                                )}
                              </span>
                              <span>
                                <span className="text-ink-soft">DR charge: </span>
                                {row.drChargeSantim !== undefined ? (
                                  formatEtb(row.drChargeSantim)
                                ) : (
                                  <span className="text-ink-soft">not stated</span>
                                )}
                              </span>
                              <span>
                                <span className="text-ink-soft">Balance: </span>
                                {row.balanceSantim !== undefined ? (
                                  formatEtb(row.balanceSantim)
                                ) : (
                                  <span className="text-ink-soft">not stated</span>
                                )}
                              </span>
                              <span>
                                <span className="text-ink-soft">Source account tail: </span>
                                {row.accountTail ?? "not stated"}
                              </span>
                              <span>
                                <span className="text-ink-soft">Destination account tail: </span>
                                {row.counterpartyAccountTail ?? "not stated"}
                              </span>
                              <span className="sm:col-span-2">
                                <span className="text-ink-soft">Recipient: </span>
                                {row.party}
                              </span>
                            </div>
                            {row.missingFields && row.missingFields.length > 0 && (
                              <div className="text-money-out">
                                Not stated in the message (left empty):{" "}
                                {row.missingFields.join(", ")}
                              </div>
                            )}
                          </div>
                        )}
                      {row.ok && blockersFor(row).length > 0 && (
                        <ul className="text-[11px] rounded border border-money-out/40 bg-money-out/5 px-2 py-1 text-money-out list-disc list-inside">
                          {blockersFor(row).map((issue, k) => (
                            <li key={k}>{issue}</li>
                          ))}
                          <li>This row cannot be imported until the message is corrected.</li>
                        </ul>
                      )}
                      {row.ok && !row.date && blockersFor(row).length === 0 && (
                        <div className="text-[11px] rounded border border-airtime/40 bg-airtime/5 px-2 py-1 space-y-1">
                          <div className="text-airtime font-semibold">
                            Date: missing — manual entry required
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Label className="text-[11px] text-ink-soft">
                              Transaction date
                              <Input
                                type="date"
                                className="h-7 text-[11px] mt-0.5"
                                value={manualDates[i]?.date ?? ""}
                                onChange={(ev) =>
                                  setManualDates((s) => ({
                                    ...s,
                                    [i]: { time: s[i]?.time ?? "", date: ev.target.value },
                                  }))
                                }
                              />
                            </Label>
                            <Label className="text-[11px] text-ink-soft">
                              Time (optional)
                              <Input
                                type="time"
                                className="h-7 text-[11px] mt-0.5"
                                value={manualDates[i]?.time ?? ""}
                                onChange={(ev) =>
                                  setManualDates((s) => ({
                                    ...s,
                                    [i]: { date: s[i]?.date ?? "", time: ev.target.value },
                                  }))
                                }
                              />
                            </Label>
                          </div>
                          {!manualDates[i]?.date && (
                            <div className="text-money-out">
                              Import stays disabled for this row until a date is supplied.
                            </div>
                          )}
                        </div>
                      )}
                      {(suggestedBank || needsAgent || needsDistributor || airtime) && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {suggestedBank && (
                            <div className="flex items-center gap-1.5 text-[11px] bg-muted/50 border border-border rounded px-2 py-1">
                              <span className="text-ink-soft">Bank:</span>
                              <Select
                                value={bAction.kind}
                                onValueChange={(v) =>
                                  setBankActions((s) => ({
                                    ...s,
                                    [i]: { kind: v as BankAction["kind"] },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-6 w-auto min-w-[9rem] text-[11px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="auto">Register “{suggestedBank}”</SelectItem>
                                  <SelectItem value="skip">Skip — leave unlinked</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          {(airtime || needsDistributor) && (
                            <div className="flex items-center gap-1.5 text-[11px] bg-muted/50 border border-border rounded px-2 py-1">
                              <span className="text-ink-soft">
                                {needsDistributor
                                  ? "Paid to distributor →"
                                  : `${airtimeForm === "float" ? "Float" : "EVD"} from →`}
                              </span>
                              <Select
                                value={dAction.kind === "link" ? `link:${dAction.id}` : "none"}
                                onValueChange={(v) =>
                                  setDistActions((s) => ({
                                    ...s,
                                    [i]:
                                      v === "none"
                                        ? { kind: "none" }
                                        : { kind: "link", id: v.slice("link:".length) },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-6 w-auto min-w-[10rem] text-[11px]">
                                  <SelectValue placeholder="Pick distributor…" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">
                                    Don't link (skew expected stock)
                                  </SelectItem>
                                  {distributorChoices.map((d) => (
                                    <SelectItem key={d.id} value={`link:${d.id}`}>
                                      {d.name}
                                    </SelectItem>
                                  ))}
                                  {distributorChoices.length === 0 && (
                                    <SelectItem value="none" disabled>
                                      No matching distributor — add one first
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          {needsAgent && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] bg-muted/50 border border-border rounded px-2 py-1">
                              <span className="text-ink-soft">
                                {partyIsReal ? `“${row.party}” →` : "Agent →"}
                              </span>
                              <Select
                                value={
                                  pAction.kind === "link" && pAction.partyType === "agent"
                                    ? `link:agent:${pAction.id}`
                                    : "none"
                                }
                                onValueChange={(v) =>
                                  setPartyActions((st) => ({ ...st, [i]: decodePartyAction(v) }))
                                }
                              >
                                <SelectTrigger className="h-6 w-auto min-w-[11rem] text-[11px]">
                                  <SelectValue placeholder="Pick the exact agent…" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Unresolved — don't link</SelectItem>
                                  {agents.map((a) => (
                                    <SelectItem key={`a-${a.id}`} value={`link:agent:${a.id}`}>
                                      {a.name}
                                    </SelectItem>
                                  ))}
                                  {agents.length === 0 && (
                                    <SelectItem value="none" disabled>
                                      No agents yet — add one on the Agents page
                                    </SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                              {partyIsReal &&
                                pAction.kind === "link" &&
                                pAction.partyType === "agent" &&
                                e.agentMapping?.targetId !== pAction.id && (
                                  <label className="flex items-center gap-1 text-ink-soft">
                                    <input
                                      type="checkbox"
                                      className="h-3 w-3 accent-[hsl(var(--money-in))]"
                                      checked={Boolean(remember[i])}
                                      onChange={(ev) =>
                                        setRemember((st) => ({ ...st, [i]: ev.target.checked }))
                                      }
                                    />
                                    Remember this exact sender label
                                  </label>
                                )}
                              {e.agentMapping && (
                                <span className="text-money-in">
                                  remembered → {e.agentMapping.targetName}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="text-[11px] text-ink-soft whitespace-pre-wrap break-words">
                        {row.note}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-money-out">
                      Couldn't parse: <span className="text-ink-soft">{row.raw}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {skippedInfo.length > 0 && (
          <div className="rounded-md border border-airtime/40 bg-airtime/5 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs">
                <div className="font-semibold text-airtime">
                  {skippedInfo.length} row(s) skipped as duplicates
                </div>
                <div className="text-ink-soft">
                  Review below — if any aren't actually duplicates, force-import them.
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSkippedInfo([])}>
                  Dismiss
                </Button>
                <Button size="sm" onClick={forceImportSkipped}>
                  Force import {skippedInfo.length}
                </Button>
              </div>
            </div>
            <ul className="text-[11px] divide-y divide-border rounded border border-border bg-card overflow-hidden">
              {skippedInfo.map((s, i) => (
                <li key={i} className="p-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={
                        "font-bold tabular-nums " +
                        (s.input.type === "in" ? "text-money-in" : "text-money-out")
                      }
                    >
                      {s.input.type === "in" ? "+" : "−"} {formatEtb(s.input.amountSantim)}
                    </span>
                    <span className="uppercase font-semibold text-ink-soft">{s.input.channel}</span>
                    <span>· {s.input.partyName}</span>
                    {s.input.reference && (
                      <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">
                        ref {s.input.reference}
                      </span>
                    )}
                    <span className="ml-auto text-ink-soft">
                      {s.reason === "reference" ? "same reference" : "amount/party/time match"}
                    </span>
                  </div>
                  {s.input.note && (
                    <div className="text-ink-soft whitespace-pre-wrap break-words pt-1">
                      {s.input.note}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    </div>
  );
}
