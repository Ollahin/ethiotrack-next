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
import { parseMany, type ParsedOk, type ParsedRow } from "@/lib/parser";
import { summarizeReadiness, type RowDecisionInput } from "@/lib/capture-disclosure";
import {
  addTransactionsBulk,
  forceInsertTransactions,
  updateTransaction,
  upsertAgent,
  upsertBank,
  upsertDistributor,
  useAgents,
  useBanks,
  useDistributors,
  useTransactions,
} from "@/lib/db";
import { matchAgent } from "@/lib/brain/fuzzy";
import { matchDistributorForPayment } from "@/lib/purchase-fulfillment";
import { openCreditsFor, planFifoSettlement } from "@/lib/brain/credits";
import { formatEtb } from "@/lib/format";
import type { AirtimeForm, Bank, Distributor, Transaction } from "@/lib/types";
import { toast } from "sonner";

type PartyAction =
  | { kind: "none" }
  | { kind: "new-agent" }
  | { kind: "new-distributor" }
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
    initialText && initialText.trim() ? parseMany(initialText) : null,
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
      const match = r.ok && r.party ? matchAgent(r.party, agents) : null;
      const bank = matchBank(r);
      const distributor = matchDistributor(r, distributors);
      const payee = matchTransferDistributor(r, distributors);
      return { row: r, agent: match, bank, distributor, payee };
    });
  }, [rows, agents, banks, distributors]);

  function partyActionFor(i: number, e: (typeof enriched)[number]): PartyAction {
    const override = partyActions[i];
    if (override) return override;
    // A bank transfer to a distributor is never turned into a new agent, and
    // is only linked when the payee matched strictly.
    if (isBankTransferRow(e.row)) {
      return e.payee
        ? { kind: "link", partyType: "distributor", id: e.payee.id }
        : { kind: "none" };
    }
    if (e.agent) return { kind: "link", partyType: "agent", id: e.agent.id };
    if (e.row.ok && e.row.party && !isGenericParty(e.row.party)) return { kind: "new-agent" };
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

  function distActionFor(i: number, e: (typeof enriched)[number]): DistributorAction {
    const override = distActions[i];
    if (override) return override;
    if (isBankTransferRow(e.row))
      return e.payee ? { kind: "link", id: e.payee.id } : { kind: "none" };
    if (e.distributor) return { kind: "link", id: e.distributor.id };
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

  /** Only rows that can actually be persisted are counted and imported. */
  function isImportable(i: number, row: ParsedRow): boolean {
    if (!row.ok) return false;
    if (blockersFor(row).length > 0) return false;
    return resolvedDate(i, row) !== null;
  }

  const importableCount = enriched.filter((e, i) => isImportable(i, e.row)).length;

  /** Batch readiness, shown before anything can be saved. */
  const readiness = useMemo(
    () =>
      summarizeReadiness(
        enriched.map((e, i): RowDecisionInput => {
          const transfer = isBankTransferRow(e.row);
          return {
            parsedOk: e.row.ok,
            blockers: blockersFor(e.row).length,
            hasDate: resolvedDate(i, e.row) !== null,
            requiresCounterparty: transfer,
            counterpartyLinked: transfer ? distActionFor(i, e).kind === "link" : true,
            counterpartyCertain: transfer ? Boolean(e.payee) : true,
            needsReview: Boolean(e.row.ok && e.row.needsReview),
          };
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enriched, manualDates, distActions],
  );

  useEffect(() => {
    if (initialText === undefined) return;
    setText(initialText);
    setRows(initialText.trim() ? parseMany(initialText) : null);
    setPartyActions({});
    setBankActions({});
    setDistActions({});
    setManualDates({});
  }, [initialText]);

  function detect() {
    if (!text.trim()) return;
    setRows(parseMany(text));
    setPartyActions({});
    setBankActions({});
    setDistActions({});
    setManualDates({});
  }

  async function importAll() {
    const ok = enriched.filter((e, i) => isImportable(i, e.row));
    if (!ok.length) {
      toast.error("Nothing importable — fix the flagged rows first");
      return;
    }

    // Resolve per-row party + bank decisions BEFORE we build tx inputs, so
    // newly-created agents/distributors/banks get real ids we can link to.
    let createdBanks = 0,
      createdAgents = 0,
      createdDistributors = 0;
    let blockedNoDate = 0;
    let blockedInvalid = 0;
    const inputs: Array<Omit<Transaction, "id" | "createdAt">> = [];

    for (let i = 0; i < enriched.length; i++) {
      const e = enriched[i];
      if (!e.row.ok) continue;
      const { row } = e;
      if (blockersFor(row).length > 0) {
        blockedInvalid++;
        continue;
      }
      const when = resolvedDate(i, row);
      if (!when) {
        blockedNoDate++;
        continue;
      }

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

      // ----- Party resolution
      let partyId: string | undefined;
      let partyType: Transaction["partyType"] | undefined;
      const pAction = partyActionFor(i, e);
      if (pAction.kind === "link") {
        partyId = pAction.id;
        partyType = pAction.partyType;
      } else if (pAction.kind === "new-agent" && row.party) {
        const a = await upsertAgent({ name: row.party, phone: row.counterpartyPhone });
        partyId = a.id;
        partyType = "agent";
        createdAgents++;
      } else if (pAction.kind === "new-distributor" && row.party) {
        const d = await upsertDistributor({ name: row.party });
        partyId = d.id;
        partyType = "distributor";
        createdDistributors++;
      }

      // ----- Distributor resolution (airtime rows only)
      let distributorId: string | undefined;
      if (isAirtimeRow(row.type) || isBankTransferRow(row)) {
        const dAction = distActionFor(i, e);
        if (dAction.kind === "link") distributorId = dAction.id;
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
        isPersonal,
        needsReview: row.needsReview,
        source: "paste_parse",
      });
    }

    const res = await addTransactionsBulk(inputs);
    setSkippedInfo(res.skippedRows.map((s) => ({ input: s.input, reason: s.reason })));

    // FIFO settle: for each new 'in' payment linked to an agent, settle oldest credits.
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (inp.type !== "in" || !inp.partyId) continue;
      const open = openCreditsFor(inp.partyId, txns);
      if (!open.length) continue;
      const plan = planFifoSettlement(inp.amountSantim, open);
      for (const cid of plan.settled) {
        const c = txns.find((t) => t.id === cid);
        if (c)
          await updateTransaction({ ...c, isSettled: true, settledAt: new Date().toISOString() });
      }
    }

    const extras = [
      createdBanks && `${createdBanks} new bank${createdBanks > 1 ? "s" : ""}`,
      createdAgents && `${createdAgents} agent${createdAgents > 1 ? "s" : ""}`,
      createdDistributors &&
        `${createdDistributors} distributor${createdDistributors > 1 ? "s" : ""}`,
    ]
      .filter(Boolean)
      .join(", ");
    toast.success(
      `Imported ${res.inserted}` +
        (res.skipped ? `, skipped ${res.skipped} duplicate(s)` : "") +
        (extras ? ` · registered ${extras}` : ""),
    );
    if (res.inserted > 0) onSaved?.();
    if (blockedNoDate > 0) {
      toast.error(
        `${blockedNoDate} row(s) not imported: no transaction date — enter one in review.`,
      );
    }
    if (blockedInvalid > 0) {
      toast.error(
        `${blockedInvalid} row(s) not imported: the message failed financial validation.`,
      );
    }
    if (blockedNoDate === 0 && blockedInvalid === 0) {
      setText("");
      setRows(null);
      setPartyActions({});
      setBankActions({});
      setDistActions({});
      setManualDates({});
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
    if (v === "none" || v === "new-agent" || v === "new-distributor") return { kind: v };
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
            <span className="rounded bg-money-in/10 text-money-in font-semibold px-2 py-0.5">
              {readiness.ready} ready
            </span>
            <span className="rounded bg-airtime/10 text-airtime font-semibold px-2 py-0.5">
              {readiness.needsAttention} need attention
            </span>
            <span className="rounded bg-money-out/10 text-money-out font-semibold px-2 py-0.5">
              {readiness.incomplete} incomplete
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
              const pAction = partyActionFor(i, e);
              const bAction = bankActionFor(i, e);
              const dAction = distActionFor(i, e);
              const suggestedBank =
                row.ok && !bank && row.channel && row.channel !== "Other"
                  ? suggestBankName(row.channel, row.accountTail)
                  : null;
              const transfer = isBankTransferRow(row);
              const partyIsReal = row.ok && row.party && !isGenericParty(row.party) && !transfer;
              const airtime = row.ok && isAirtimeRow(row.type);
              const airtimeForm = airtime ? airtimeFormOf(row.type) : undefined;
              const distributorChoices = transfer
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
                      {row.ok && transfer && (
                        <div className="text-[11px] rounded border border-border bg-muted/40 px-2 py-1 space-y-0.5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 tabular-nums">
                            <span>
                              <span className="text-ink-soft">Principal: </span>
                              {formatEtb(row.principalSantim ?? row.amountSantim)}
                            </span>
                            <span>
                              <span className="text-ink-soft">Final bank debit: </span>
                              {row.finalDebitSantim !== undefined ? (
                                formatEtb(row.finalDebitSantim)
                              ) : (
                                <span className="text-money-out">not stated</span>
                              )}
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
                              Not stated in the message (left empty): {row.missingFields.join(", ")}
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
                      {(suggestedBank || partyIsReal || airtime || transfer) && (
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
                          {(airtime || transfer) && (
                            <div className="flex items-center gap-1.5 text-[11px] bg-muted/50 border border-border rounded px-2 py-1">
                              <span className="text-ink-soft">
                                {transfer
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
                          {partyIsReal && (
                            <div className="flex items-center gap-1.5 text-[11px] bg-muted/50 border border-border rounded px-2 py-1">
                              <span className="text-ink-soft">“{row.party}” →</span>
                              <Select
                                value={encodePartyAction(pAction)}
                                onValueChange={(v) =>
                                  setPartyActions((s) => ({ ...s, [i]: decodePartyAction(v) }))
                                }
                              >
                                <SelectTrigger className="h-6 w-auto min-w-[10rem] text-[11px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="new-agent">Add as new agent</SelectItem>
                                  <SelectItem value="new-distributor">
                                    Add as new distributor
                                  </SelectItem>
                                  <SelectItem value="none">Don't link (manual later)</SelectItem>
                                  {agents.length > 0 && (
                                    <>
                                      {agents.map((a) => (
                                        <SelectItem key={`a-${a.id}`} value={`link:agent:${a.id}`}>
                                          Link → agent · {a.name}
                                        </SelectItem>
                                      ))}
                                    </>
                                  )}
                                  {distributors.length > 0 && (
                                    <>
                                      {distributors.map((d) => (
                                        <SelectItem
                                          key={`d-${d.id}`}
                                          value={`link:distributor:${d.id}`}
                                        >
                                          Link → distributor · {d.name}
                                        </SelectItem>
                                      ))}
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
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
