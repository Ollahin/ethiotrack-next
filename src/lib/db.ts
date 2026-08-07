import Dexie, { type Table } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { airtimeDirectionOf, airtimeStockDelta } from "./airtime-movement";
import type {
  Agent,
  Bank,
  DailyClosing,
  DailyOpening,
  Distributor,
  FulfillmentEntry,
  InboxDecision,
  PeriodClosing,
  PeriodOpening,
  SharedInput,
  SettlementAllocation,
  StatementImport,
  Transaction,
} from "./types";
import { makeId } from "./ids";
import { agentCredits, planAllocations } from "./settlement";
import type { InboxSmsDraft } from "./capture/inbox-ingest";
import {
  applyApproval,
  markUsed,
  pruneMappings,
  type ApprovedMapping,
  type MappingApproval,
  type MappingTargetType,
  type EntityIndex,
} from "./approved-mappings";
import {
  BACKUP_APP,
  BACKUP_VERSION,
  base64ToBytes,
  bytesToBase64,
  countsOf,
  isCredentialMetaKey,
  validateBackup,
  type BackupV4,
  type SerializedStatementImport,
  type SerializedSharedInput,
} from "./backup-format";

/**
 * Canonical dedup fingerprint for a transaction. Shared by:
 *  - addTransactionsBulk() to skip near-duplicates on insert
 *  - brain/alerts.ts to flag existing near-duplicates for review
 * Keep both callers using this exact key so the two policies never drift.
 * Time proximity is enforced by the caller (default: `DUPLICATE_WINDOW_MS`).
 */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;
export function duplicateKey(
  t: Pick<
    Transaction,
    "type" | "amountSantim" | "partyName" | "channel" | "airtimeDirection" | "isReversal"
  >,
): string {
  // Airtime sent out and airtime received in are never the same event, so the
  // direction (legacy missing = "sent") is part of the identity. A reversal is
  // likewise never the same event as the movement it reverses.
  const dir = airtimeDirectionOf(t) ?? "-";
  const rev = t.isReversal ? "rev" : "-";
  return `${t.type}|${dir}|${rev}|${t.amountSantim}|${(t.partyName ?? "").toLowerCase()}|${t.channel}`;
}

/**
 * Authoritative duplicate identity for a referenced transaction. A reference is
 * only unique within the same channel, type and airtime direction.
 */
export function referenceKey(
  t: Pick<Transaction, "type" | "channel" | "airtimeDirection" | "isReversal">,
  reference: string,
): string {
  const dir = airtimeDirectionOf(t) ?? "-";
  const rev = t.isReversal ? "rev" : "-";
  return `${t.channel}|${t.type}|${dir}|${rev}|${reference.trim().toUpperCase()}`;
}

// -- schema ------------------------------------------------------------------

class EthioTrackDB extends Dexie {
  agents!: Table<Agent, string>;
  distributors!: Table<Distributor, string>;
  banks!: Table<Bank, string>;
  dailyOpenings!: Table<DailyOpening, string>;
  dailyClosings!: Table<DailyClosing, string>;
  periodOpenings!: Table<PeriodOpening, string>;
  periodClosings!: Table<PeriodClosing, string>;
  transactions!: Table<Transaction, string>;
  statementImports!: Table<StatementImport, string>;
  fulfillments!: Table<FulfillmentEntry, string>;
  approvedMappings!: Table<ApprovedMapping, string>;
  sharedInputs!: Table<SharedInput, string>;
  settlementAllocations!: Table<SettlementAllocation, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("ethiotrack");
    this.version(1).stores({
      agents: "id, name, phone",
      distributors: "id, name",
      banks: "id, name, channel",
      dailyOpenings: "id, date",
      dailyClosings: "id, date, openingId",
      transactions: "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId",
      statementImports: "id, distributorId, importedAt",
      meta: "key",
    });
    this.version(2).stores({
      agents: "id, name, phone",
      distributors: "id, name",
      banks: "id, name, channel",
      dailyOpenings: "id, date",
      dailyClosings: "id, date, openingId",
      periodOpenings: "id, weekStart",
      periodClosings: "id, weekStart, openingId",
      transactions: "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId",
      statementImports: "id, distributorId, importedAt",
      meta: "key",
    });
    // v3: backfill per-bank & per-distributor breakdowns on legacy openings.
    this.version(3)
      .stores({
        agents: "id, name, phone",
        distributors: "id, name",
        banks: "id, name, channel",
        dailyOpenings: "id, date",
        dailyClosings: "id, date, openingId",
        periodOpenings: "id, weekStart",
        periodClosings: "id, weekStart, openingId",
        transactions: "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId",
        statementImports: "id, distributorId, importedAt",
        meta: "key",
      })
      .upgrade(async (tx) => {
        const distributors = await tx.table("distributors").toArray();
        const banks = await tx.table("banks").toArray();
        const distIds = distributors.map((d: { id: string }) => d.id);
        const bankIds = banks.map((b: { id: string }) => b.id);
        await tx
          .table("periodOpenings")
          .toCollection()
          .modify((rec: PeriodOpening) => {
            migratePeriodOpeningShape(rec, bankIds, distIds);
          });
      });
    // v4: distributors now carry telecom + airtime form tags.
    this.version(4)
      .stores({
        agents: "id, name, phone",
        distributors: "id, name",
        banks: "id, name, channel",
        dailyOpenings: "id, date",
        dailyClosings: "id, date, openingId",
        periodOpenings: "id, weekStart",
        periodClosings: "id, weekStart, openingId",
        transactions: "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId",
        statementImports: "id, distributorId, importedAt",
        meta: "key",
      })
      .upgrade(async (tx) => {
        await tx
          .table("distributors")
          .toCollection()
          .modify((rec: Distributor) => {
            if (!rec.telecoms || rec.telecoms.length === 0) {
              rec.telecoms = ["ethiotelecom", "safaricom"];
            }
            if (!rec.forms || rec.forms.length === 0) {
              rec.forms = ["evd", "float"];
            }
          });
      });
    // v5: additive only — append-only EVD purchase fulfilment ledger.
    // No existing store, index or record is changed, so old accounts open
    // unchanged and simply start with an empty `fulfillments` table.
    this.version(5).stores({
      agents: "id, name, phone",
      distributors: "id, name",
      banks: "id, name, channel",
      dailyOpenings: "id, date",
      dailyClosings: "id, date, openingId",
      periodOpenings: "id, weekStart",
      periodClosings: "id, weekStart, openingId",
      transactions: "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId",
      statementImports: "id, distributorId, importedAt",
      fulfillments: "id, intentTxnId, recordedAt",
      meta: "key",
    });
    // v6: additive only — approved counterparty mappings and the share-target
    // inbox. No existing store, index or record changes.
    this.version(6).stores({
      agents: "id, name, phone",
      distributors: "id, name",
      banks: "id, name, channel",
      dailyOpenings: "id, date",
      dailyClosings: "id, date, openingId",
      periodOpenings: "id, weekStart",
      periodClosings: "id, weekStart, openingId",
      transactions: "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId",
      statementImports: "id, distributorId, importedAt",
      fulfillments: "id, intentTxnId, recordedAt",
      approvedMappings: "id, targetType, normalizedLabel, targetId",
      sharedInputs: "id, receivedAt, status",
      meta: "key",
    });
    // v7: additive only — explicit, partial-aware agent settlement allocations
    // plus a capture identity index so a retried import can never double-write.
    this.version(7).stores({
      agents: "id, name, phone",
      distributors: "id, name",
      banks: "id, name, channel",
      dailyOpenings: "id, date",
      dailyClosings: "id, date, openingId",
      periodOpenings: "id, weekStart",
      periodClosings: "id, weekStart, openingId",
      transactions:
        "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId, captureKey",
      statementImports: "id, distributorId, importedAt",
      fulfillments: "id, intentTxnId, recordedAt",
      approvedMappings: "id, targetType, normalizedLabel, targetId",
      sharedInputs: "id, receivedAt, status",
      settlementAllocations: "id, paymentTxnId, creditTxnId, agentId",
      meta: "key",
    });
    // v8: additive only — inbox review decisions are stored on the inbox row
    // itself. No index changes, no data rewrite: existing rows simply have no
    // `decisions` object, which means "nothing decided yet".
    this.version(8).stores({
      agents: "id, name, phone",
      distributors: "id, name",
      banks: "id, name, channel",
      dailyOpenings: "id, date",
      dailyClosings: "id, date, openingId",
      periodOpenings: "id, weekStart",
      periodClosings: "id, weekStart, openingId",
      transactions:
        "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId, captureKey",
      statementImports: "id, distributorId, importedAt",
      fulfillments: "id, intentTxnId, recordedAt",
      approvedMappings: "id, targetType, normalizedLabel, targetId",
      sharedInputs: "id, receivedAt, status",
      settlementAllocations: "id, paymentTxnId, creditTxnId, agentId",
      meta: "key",
    });
  }
}

// -- migration helpers -------------------------------------------------------

function splitEvenly(total: number, ids: string[]): Record<string, number> {
  if (!ids.length || total <= 0) return Object.fromEntries(ids.map((id) => [id, 0]));
  const share = Math.floor(total / ids.length);
  const remainder = total - share * ids.length;
  return Object.fromEntries(ids.map((id, i) => [id, share + (i === 0 ? remainder : 0)]));
}

/** Fill in per-bank & per-distributor maps from legacy aggregate totals. Mutates rec. Returns true if changed. */
export function migratePeriodOpeningShape(
  rec: PeriodOpening,
  bankIds: string[],
  distIds: string[],
): boolean {
  let changed = false;
  if (!rec.bankBalances || typeof rec.bankBalances !== "object") {
    rec.bankBalances = {};
    changed = true;
  }
  // Seed zero entries for any newly-registered banks so the UI can show them.
  for (const id of bankIds) {
    if (rec.bankBalances[id] === undefined) {
      rec.bankBalances[id] = 0;
      changed = true;
    }
  }
  const needsEvd =
    !rec.evdStockByDistributor || Object.keys(rec.evdStockByDistributor).length === 0;
  if (needsEvd) {
    rec.evdStockByDistributor = splitEvenly(rec.evdStockSantim ?? 0, distIds);
    changed = true;
  } else {
    for (const id of distIds) {
      if (rec.evdStockByDistributor![id] === undefined) {
        rec.evdStockByDistributor![id] = 0;
        changed = true;
      }
    }
  }
  const needsFloat =
    !rec.floatStockByDistributor || Object.keys(rec.floatStockByDistributor).length === 0;
  if (needsFloat) {
    rec.floatStockByDistributor = splitEvenly(rec.floatStockSantim ?? 0, distIds);
    changed = true;
  } else {
    for (const id of distIds) {
      if (rec.floatStockByDistributor![id] === undefined) {
        rec.floatStockByDistributor![id] = 0;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Lazy migration for openings created before distributors/banks existed.
 * Splits legacy aggregate stock across current distributors and seeds
 * zero entries for newly-registered banks. Idempotent — safe to call often.
 */
export async function ensurePeriodOpeningsMigrated(): Promise<number> {
  const [openings, distributors, banks] = await Promise.all([
    db().periodOpenings.toArray(),
    db().distributors.toArray(),
    db().banks.toArray(),
  ]);
  const distIds = distributors.map((d) => d.id);
  const bankIds = banks.map((b) => b.id);
  let migrated = 0;
  for (const rec of openings) {
    if (migratePeriodOpeningShape(rec, bankIds, distIds)) {
      await db().periodOpenings.put(rec);
      migrated++;
    }
  }
  return migrated;
}

let _db: EthioTrackDB | null = null;
export function db(): EthioTrackDB {
  if (!_db) _db = new EthioTrackDB();
  return _db;
}

// -- reactive hooks ----------------------------------------------------------

export function useTransactions(): Transaction[] {
  return (
    useLiveQuery(async () => {
      const cutoff = activeCutoffISO();
      const all = await db().transactions.where("date").aboveOrEqual(cutoff).toArray();
      all.sort((a, b) => (a.date < b.date ? 1 : -1));
      return all;
    }, []) ?? []
  );
}

// -- retention: 3 months active, 3 more months archived ----------------------

export const ACTIVE_WINDOW_DAYS = 90;
export const RETENTION_WINDOW_DAYS = 180;

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function activeCutoffISO(): string {
  return daysAgoISO(ACTIVE_WINDOW_DAYS);
}

export function retentionCutoffISO(): string {
  return daysAgoISO(RETENTION_WINDOW_DAYS);
}

/** Transactions in the 3–6 month archive band, on demand. */
export function useArchivedTransactions(): Transaction[] {
  return (
    useLiveQuery(async () => {
      const active = activeCutoffISO();
      const retention = retentionCutoffISO();
      const rows = await db()
        .transactions.where("date")
        .between(retention, active, true, false)
        .toArray();
      rows.sort((a, b) => (a.date < b.date ? 1 : -1));
      return rows;
    }, []) ?? []
  );
}

export function useArchivedCount(): number {
  return (
    useLiveQuery(async () => {
      const active = activeCutoffISO();
      const retention = retentionCutoffISO();
      return db().transactions.where("date").between(retention, active, true, false).count();
    }, []) ?? 0
  );
}

/** Delete anything older than the 6-month retention window. */
export async function purgeExpiredRecords(): Promise<{
  transactions: number;
  statementImports: number;
}> {
  const cutoff = retentionCutoffISO();
  const d = db();
  const txDeleted = await d.transactions.where("date").below(cutoff).delete();
  const impDeleted = await d.statementImports.where("importedAt").below(cutoff).delete();
  return { transactions: txDeleted, statementImports: impDeleted };
}

export function useAgents(): Agent[] {
  return useLiveQuery(() => db().agents.orderBy("name").toArray(), []) ?? [];
}

export function useDistributors(): Distributor[] {
  return useLiveQuery(() => db().distributors.orderBy("name").toArray(), []) ?? [];
}

export function useBanks(): Bank[] {
  return useLiveQuery(() => db().banks.orderBy("name").toArray(), []) ?? [];
}

export function useStatementImports(): StatementImport[] {
  return (
    useLiveQuery(() => db().statementImports.orderBy("importedAt").reverse().toArray(), []) ?? []
  );
}

// -- purchase fulfilment ledger (append-only) --------------------------------

export function useFulfillmentEntries(): FulfillmentEntry[] {
  return useLiveQuery(() => db().fulfillments.orderBy("recordedAt").toArray(), []) ?? [];
}

/** Append one immutable fulfilment entry. Existing entries are never rewritten. */
export async function appendFulfillmentEntry(entry: FulfillmentEntry): Promise<FulfillmentEntry> {
  await db().fulfillments.add(entry);
  return entry;
}

export async function fulfillmentEntriesFor(intentTxnId: string): Promise<FulfillmentEntry[]> {
  const rows = await db().fulfillments.where("intentTxnId").equals(intentTxnId).toArray();
  rows.sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
  return rows;
}

export function useDailyOpening(date: string): DailyOpening | undefined {
  return useLiveQuery(() => db().dailyOpenings.where("date").equals(date).first(), [date]);
}

export function useDailyClosing(date: string): DailyClosing | undefined {
  return useLiveQuery(() => db().dailyClosings.where("date").equals(date).first(), [date]);
}

// -- weekly periods ----------------------------------------------------------

/** Monday of the given date's ISO week, as YYYY-MM-DD. */
export function getWeekStart(d: Date | string = new Date()): string {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  const day = dt.getDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - diff);
  return dt.toISOString().slice(0, 10);
}

export function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

export function usePeriodOpening(weekStart: string): PeriodOpening | undefined | null {
  return useLiveQuery(async () => {
    const rec = await db().periodOpenings.where("weekStart").equals(weekStart).first();
    return rec ?? null;
  }, [weekStart]);
}

/**
 * Expected opening balances for a week, carried forward from the previous
 * week's opening + net transaction deltas within that previous week.
 * Returns undefined while loading, or null when there is no prior week.
 */
export function usePreviousPeriodExpected(weekStart: string):
  | {
      prevWeekStart: string;
      cashSantim: number;
      bankBalances: Record<string, number>;
      evdStockByDistributor: Record<string, number>;
      floatStockByDistributor: Record<string, number>;
    }
  | null
  | undefined {
  return useLiveQuery(async () => {
    const prev = await db()
      .periodOpenings.where("weekStart")
      .below(weekStart)
      .reverse()
      .sortBy("weekStart");
    const prevRec = prev[0];
    if (!prevRec) return null;
    const prevWeekStart = prevRec.weekStart;
    const prevWeekEnd = getWeekEnd(prevWeekStart);
    // include everything strictly before the new weekStart
    const txns = await db()
      .transactions.where("date")
      .between(prevWeekStart, weekStart, true, false)
      .toArray();
    let cash = prevRec.cashOnHandSantim;
    const bankBalances: Record<string, number> = { ...prevRec.bankBalances };
    const evd: Record<string, number> = { ...(prevRec.evdStockByDistributor ?? {}) };
    const flt: Record<string, number> = { ...(prevRec.floatStockByDistributor ?? {}) };
    for (const t of txns) {
      if (t.isPersonal) continue;
      if (t.type === "in") {
        if (t.bankId) bankBalances[t.bankId] = (bankBalances[t.bankId] ?? 0) + t.amountSantim;
        else cash += t.amountSantim;
      } else if (t.type === "out" || t.type === "expense") {
        if (t.bankId) bankBalances[t.bankId] = (bankBalances[t.bankId] ?? 0) - t.amountSantim;
        else cash -= t.amountSantim;
      } else if (t.type === "airtime_evd" && t.distributorId) {
        evd[t.distributorId] = (evd[t.distributorId] ?? 0) + airtimeStockDelta(t);
      } else if (t.type === "airtime_float" && t.distributorId) {
        flt[t.distributorId] = (flt[t.distributorId] ?? 0) + airtimeStockDelta(t);
      }
    }
    void prevWeekEnd;
    return {
      prevWeekStart,
      cashSantim: cash,
      bankBalances,
      evdStockByDistributor: evd,
      floatStockByDistributor: flt,
    };
  }, [weekStart]);
}

export function usePeriodClosing(weekStart: string): PeriodClosing | undefined | null {
  return useLiveQuery(async () => {
    const rec = await db().periodClosings.where("weekStart").equals(weekStart).first();
    return rec ?? null;
  }, [weekStart]);
}

export function useAllPeriodClosings(): PeriodClosing[] {
  return useLiveQuery(() => db().periodClosings.orderBy("weekStart").reverse().toArray(), []) ?? [];
}

export async function openPeriod(
  input: Omit<PeriodOpening, "id" | "openedAt" | "weekEnd">,
): Promise<PeriodOpening> {
  const existing = await db().periodOpenings.where("weekStart").equals(input.weekStart).first();
  const rec: PeriodOpening = {
    ...input,
    weekEnd: getWeekEnd(input.weekStart),
    id: existing?.id ?? makeId(),
    openedAt: existing?.openedAt ?? new Date().toISOString(),
  };
  await db().periodOpenings.put(rec);
  return rec;
}

export async function closePeriod(
  input: Omit<PeriodClosing, "id" | "closedAt" | "weekEnd">,
): Promise<PeriodClosing> {
  const rec: PeriodClosing = {
    ...input,
    weekEnd: getWeekEnd(input.weekStart),
    id: makeId(),
    closedAt: new Date().toISOString(),
  };
  await db().periodClosings.put(rec);
  return rec;
}

// -- transactions ------------------------------------------------------------

export async function addTransaction(
  input: Omit<Transaction, "id" | "createdAt">,
): Promise<Transaction> {
  const txn: Transaction = {
    ...input,
    id: makeId(),
    createdAt: new Date().toISOString(),
  };
  await db().transactions.put(txn);
  return txn;
}

export async function addTransactionsBulk(
  inputs: Array<Omit<Transaction, "id" | "createdAt">>,
): Promise<{
  inserted: number;
  skipped: number;
  ids: string[];
  /** Written id per input index; undefined where the input was skipped. */
  insertedFor: Array<string | undefined>;
  skippedRows: Array<{
    index: number;
    input: Omit<Transaction, "id" | "createdAt">;
    reason: "reference" | "heuristic" | "capture";
  }>;
}> {
  const existing = await db().transactions.toArray();
  const seen = new Map<string, number[]>();
  const seenRefs = new Set<string>();
  // Capture identity: the exact same reviewed row, saved twice (retry, refresh
  // or a replayed share) must land once.
  const seenCaptures = new Set<string>();
  for (const t of existing) {
    const k = duplicateKey(t);
    seen.set(k, [...(seen.get(k) ?? []), new Date(t.date).getTime()]);
    if (t.reference && t.reference.trim()) {
      seenRefs.add(referenceKey(t, t.reference));
    }
    if (t.captureKey) seenCaptures.add(t.captureKey);
  }
  const inserted: Transaction[] = [];
  const skippedRows: Array<{
    index: number;
    input: Omit<Transaction, "id" | "createdAt">;
    reason: "reference" | "heuristic" | "capture";
  }> = [];
  let skipped = 0;
  const insertedFor: Array<string | undefined> = new Array(inputs.length).fill(undefined);
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (input.captureKey && seenCaptures.has(input.captureKey)) {
      skipped++;
      skippedRows.push({ index: i, input, reason: "capture" });
      continue;
    }
    if (input.captureKey) seenCaptures.add(input.captureKey);
    // Authoritative: same channel + same reference => duplicate, regardless of amount/party/time.
    if (input.reference && input.reference.trim()) {
      const rk = referenceKey(input, input.reference);
      if (seenRefs.has(rk)) {
        skipped++;
        skippedRows.push({ index: i, input, reason: "reference" });
        continue;
      }
      // A reference is a strong unique signal — skip the heuristic entirely when present.
      const txn: Transaction = {
        ...input,
        id: makeId(),
        createdAt: new Date().toISOString(),
      };
      inserted.push(txn);
      insertedFor[i] = txn.id;
      seenRefs.add(rk);
      const k = duplicateKey(input);
      seen.set(k, [...(seen.get(k) ?? []), new Date(input.date).getTime()]);
      continue;
    }
    const k = duplicateKey(input);
    const ts = new Date(input.date).getTime();
    const near = (seen.get(k) ?? []).some((p) => Math.abs(p - ts) <= DUPLICATE_WINDOW_MS);
    if (near) {
      skipped++;
      skippedRows.push({ index: i, input, reason: "heuristic" });
      continue;
    }
    const txn: Transaction = {
      ...input,
      id: makeId(),
      createdAt: new Date().toISOString(),
    };
    inserted.push(txn);
    insertedFor[i] = txn.id;
    seen.set(k, [...(seen.get(k) ?? []), ts]);
  }
  if (inserted.length) await db().transactions.bulkPut(inserted);
  return {
    inserted: inserted.length,
    skipped,
    ids: inserted.map((t) => t.id),
    insertedFor,
    skippedRows,
  };
}

export async function updateTransaction(txn: Transaction): Promise<void> {
  await db().transactions.put(txn);
}

// -- agent settlement allocations --------------------------------------------

export function useSettlementAllocations(): SettlementAllocation[] {
  return useLiveQuery(() => db().settlementAllocations.toArray(), [], []) ?? [];
}

export async function allocationsFor(agentId: string): Promise<SettlementAllocation[]> {
  return db().settlementAllocations.where("agentId").equals(agentId).toArray();
}

export interface SettlementResult {
  allocated: number;
  leftoverSantim: number;
  closed: number;
  alreadyApplied: boolean;
}

/**
 * THE agent-settlement domain command. Every caller — the manual settlement
 * screen and the SMS inbox import alike — goes through this one body, inside
 * whatever Dexie transaction the caller already opened, so a receipt, its
 * allocations, the closed credits and the inbox row always commit together.
 */
async function settleAgentPaymentWithin(
  d: EthioTrackDB,
  paymentTxnId: string,
  agentId: string,
  paymentSantim: number,
): Promise<SettlementResult> {
  const prior = await d.settlementAllocations.where("paymentTxnId").equals(paymentTxnId).count();
  if (prior > 0) return { allocated: 0, leftoverSantim: 0, closed: 0, alreadyApplied: true };

  const all = await d.transactions.toArray();
  const allocs = await d.settlementAllocations.toArray();
  const credits = agentCredits(agentId, all);
  const plan = planAllocations(paymentSantim, credits, allocs);
  if (plan.allocations.length === 0) {
    return { allocated: 0, leftoverSantim: plan.leftoverSantim, closed: 0, alreadyApplied: false };
  }
  const now = new Date().toISOString();
  const rows: SettlementAllocation[] = plan.allocations.map((a) => ({
    id: makeId(),
    paymentTxnId,
    creditTxnId: a.creditTxnId,
    agentId,
    amountSantim: a.amountSantim,
    createdAt: now,
  }));
  await d.settlementAllocations.bulkPut(rows);

  // A credit is only marked settled once it is fully covered.
  let closed = 0;
  for (const a of plan.allocations) {
    if (!a.closes) continue;
    const credit = credits.find((c) => c.id === a.creditTxnId);
    if (!credit) continue;
    await d.transactions.put({ ...credit, isSettled: true, settledAt: now });
    closed++;
  }
  const payment = await d.transactions.get(paymentTxnId);
  if (payment) {
    await d.transactions.put({
      ...payment,
      settlesTxnIds: plan.allocations.map((a) => a.creditTxnId),
    });
  }
  return {
    allocated: plan.allocations.reduce((s, a) => s + a.amountSantim, 0),
    leftoverSantim: plan.leftoverSantim,
    closed,
    alreadyApplied: false,
  };
}

/**
 * Apply one agent payment against that agent's open credits, FIFO and
 * partial-aware, in a single atomic write. Re-running it for the same payment
 * is a no-op: allocations already recorded for the payment are never doubled.
 */
export async function recordAgentSettlement(
  paymentTxnId: string,
  agentId: string,
  paymentSantim: number,
): Promise<SettlementResult> {
  const d = db();
  return d.transaction("rw", [d.transactions, d.settlementAllocations], () =>
    settleAgentPaymentWithin(d, paymentTxnId, agentId, paymentSantim),
  );
}

export async function deleteTransaction(id: string): Promise<void> {
  await db().transactions.delete(id);
}

/** Force-insert transactions bypassing duplicate detection. For "not actually a dupe" overrides. */
export async function forceInsertTransactions(
  inputs: Array<Omit<Transaction, "id" | "createdAt">>,
): Promise<string[]> {
  const now = new Date().toISOString();
  const txns: Transaction[] = inputs.map((input) => ({
    ...input,
    id: makeId(),
    createdAt: now,
  }));
  if (txns.length) await db().transactions.bulkPut(txns);
  return txns.map((t) => t.id);
}

// -- master data -------------------------------------------------------------

async function pruneDanglingMappings() {
  const [agents, distributors, banks, mappings] = await Promise.all([
    db().agents.toArray(),
    db().distributors.toArray(),
    db().banks.toArray(),
    db().approvedMappings.toArray(),
  ]);

  const index: EntityIndex = {
    agent: new Set(agents.map((a) => a.id)),
    distributor: new Set(distributors.map((d) => d.id)),
    bank: new Set(banks.map((b) => b.id)),
  };

  const { kept, dropped } = pruneMappings(mappings, index);
  if (dropped.length > 0) {
    await db().approvedMappings.bulkDelete(dropped.map((m) => m.id));
  }
}



export async function upsertAgent(
  a: Omit<Agent, "id" | "createdAt"> & { id?: string },
): Promise<Agent> {
  const rec: Agent = {
    id: a.id ?? makeId(),
    name: a.name.trim(),
    phone: a.phone?.trim() || undefined,
    creditLimitSantim: a.creditLimitSantim,
    createdAt: a.id
      ? ((await db().agents.get(a.id))?.createdAt ?? new Date().toISOString())
      : new Date().toISOString(),
  };
  await db().agents.put(rec);
  return rec;
}
export async function deleteAgent(id: string) {
  await db().agents.delete(id);
  await pruneDanglingMappings();
}

export async function upsertDistributor(
  a: Omit<Distributor, "id" | "createdAt"> & { id?: string },
): Promise<Distributor> {
  const rec: Distributor = {
    id: a.id ?? makeId(),
    name: a.name.trim(),
    contact: a.contact?.trim() || undefined,
    statementFormat: a.statementFormat,
    telecoms: a.telecoms && a.telecoms.length ? a.telecoms : ["ethiotelecom", "safaricom"],
    forms: a.forms && a.forms.length ? a.forms : ["evd", "float"],
    createdAt: a.id
      ? ((await db().distributors.get(a.id))?.createdAt ?? new Date().toISOString())
      : new Date().toISOString(),
  };
  await db().distributors.put(rec);
  return rec;
}
export async function deleteDistributor(id: string) {
  await db().distributors.delete(id);
  await pruneDanglingMappings();
}

export async function upsertBank(
  a: Omit<Bank, "id" | "createdAt"> & { id?: string },
): Promise<Bank> {
  const rec: Bank = {
    id: a.id ?? makeId(),
    name: a.name.trim(),
    accountNumber: a.accountNumber?.trim() || undefined,
    channel: a.channel,
    openingBalanceSantim: a.openingBalanceSantim ?? 0,
    createdAt: a.id
      ? ((await db().banks.get(a.id))?.createdAt ?? new Date().toISOString())
      : new Date().toISOString(),
  };
  await db().banks.put(rec);
  return rec;
}
export async function deleteBank(id: string) {
  await db().banks.delete(id);
  await pruneDanglingMappings();
}

// -- day open / close --------------------------------------------------------

export async function openDay(input: Omit<DailyOpening, "id" | "openedAt">): Promise<DailyOpening> {
  const rec: DailyOpening = { ...input, id: makeId(), openedAt: new Date().toISOString() };
  await db().dailyOpenings.put(rec);
  return rec;
}

export async function closeDay(
  input: Omit<DailyClosing, "id" | "closedAt">,
): Promise<DailyClosing> {
  const rec: DailyClosing = { ...input, id: makeId(), closedAt: new Date().toISOString() };
  await db().dailyClosings.put(rec);
  return rec;
}

// -- statement imports -------------------------------------------------------

export async function recordStatementImport(
  input: Omit<StatementImport, "id" | "importedAt">,
): Promise<StatementImport> {
  const rec: StatementImport = {
    ...input,
    id: makeId(),
    importedAt: new Date().toISOString(),
  };
  await db().statementImports.put(rec);
  return rec;
}

/** Patch an existing import record in place (status, OCR text, parse error). */
export async function updateStatementImport(
  id: string,
  patch: Partial<Omit<StatementImport, "id">>,
): Promise<void> {
  await db().statementImports.update(id, patch);
}

// -- meta --------------------------------------------------------------------

export async function metaGet<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db().meta.get(key);
  return row?.value as T | undefined;
}
export async function metaSet(key: string, value: unknown): Promise<void> {
  await db().meta.put({ key, value });
}

// -- backup ------------------------------------------------------------------

export type Backup = BackupV4;

/** True when this device account holds no financial or entity records. */
export async function accountIsEmpty(): Promise<boolean> {
  const d = db();
  const counts = await Promise.all([
    d.agents.count(),
    d.distributors.count(),
    d.banks.count(),
    d.dailyOpenings.count(),
    d.dailyClosings.count(),
    d.periodOpenings.count(),
    d.periodClosings.count(),
    d.transactions.count(),
    d.statementImports.count(),
    d.fulfillments.count(),
  ]);
  return counts.every((n) => n === 0);
}

// -- approved counterparty mappings ------------------------------------------

export function useApprovedMappings(): ApprovedMapping[] {
  return useLiveQuery(() => db().approvedMappings.toArray(), [], [] as ApprovedMapping[]) ?? [];
}

export async function approveMapping(
  approval: Omit<MappingApproval, "id" | "approvedAt"> & { approvedAt?: string },
): Promise<ApprovedMapping | null> {
  const d = db();
  const current = await d.approvedMappings.toArray();
  const next = applyApproval(current, {
    ...approval,
    id: makeId(),
    approvedAt: approval.approvedAt ?? new Date().toISOString(),
  });
  await d.approvedMappings.bulkPut(next);
  const changed = next.find(
    (m) => m.targetType === approval.targetType && m.targetId === approval.targetId,
  );
  return changed ?? null;
}

export async function recordMappingUse(id: string): Promise<void> {
  const d = db();
  const current = await d.approvedMappings.toArray();
  await d.approvedMappings.bulkPut(markUsed(current, id, new Date().toISOString()));
}

export async function deleteMapping(id: string): Promise<void> {
  await db().approvedMappings.delete(id);
}

/** Drop mappings whose target entity no longer exists. Returns how many went. */
export async function pruneDanglingMappings(): Promise<number> {
  const d = db();
  const [mappings, agents, distributors, banks] = await Promise.all([
    d.approvedMappings.toArray(),
    d.agents.toArray(),
    d.distributors.toArray(),
    d.banks.toArray(),
  ]);
  const { dropped } = pruneMappings(mappings, {
    agent: new Set(agents.map((a) => a.id)),
    distributor: new Set(distributors.map((x) => x.id)),
    bank: new Set(banks.map((b) => b.id)),
  });
  if (dropped.length) await d.approvedMappings.bulkDelete(dropped.map((m) => m.id));
  return dropped.length;
}

// -- share-target inbox ------------------------------------------------------

export function useSharedInputs(): SharedInput[] {
  return (
    useLiveQuery(
      () => db().sharedInputs.orderBy("receivedAt").reverse().toArray(),
      [],
      [] as SharedInput[],
    ) ?? []
  );
}

export async function addSharedInput(
  input: Omit<SharedInput, "id" | "receivedAt" | "status"> & {
    id?: string;
    receivedAt?: string;
  },
): Promise<SharedInput> {
  const rec: SharedInput = {
    ...input,
    id: input.id ?? makeId(),
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    status: "pending",
  };
  // put(), not add(): a share handed over twice must never duplicate.
  await db().sharedInputs.put(rec);
  return rec;
}

export async function setSharedInputStatus(
  id: string,
  status: SharedInput["status"],
): Promise<void> {
  await db().sharedInputs.update(id, {
    status,
    reviewedAt: status === "pending" ? undefined : new Date().toISOString(),
  });
}

export async function deleteSharedInput(id: string): Promise<void> {
  await db().sharedInputs.delete(id);
}

/**
 * Merge a review decision into one inbox row. Decisions are stored where the
 * message is stored, so refreshing, locking or reopening the app can never
 * lose work a human already did. Unknown ids are ignored rather than creating
 * an orphan row.
 */
export async function setInboxDecision(id: string, patch: Partial<InboxDecision>): Promise<void> {
  const d = db();
  await d.transaction("rw", d.sharedInputs, async () => {
    const row = await d.sharedInputs.get(id);
    if (!row) return;
    await d.sharedInputs.put({ ...row, decisions: { ...row.decisions, ...patch } });
  });
}

/** The same merge applied to many rows atomically (bulk date/purpose apply). */
export async function setInboxDecisions(
  ids: string[],
  patch: Partial<InboxDecision>,
): Promise<number> {
  if (!ids.length) return 0;
  const d = db();
  return d.transaction("rw", d.sharedInputs, async () => {
    const rows = (await d.sharedInputs.bulkGet(ids)).filter(Boolean) as SharedInput[];
    if (!rows.length) return 0;
    await d.sharedInputs.bulkPut(
      rows.map((row) => ({ ...row, decisions: { ...row.decisions, ...patch } })),
    );
    return rows.length;
  });
}

/**
 * The one ingestion path for pasted, clipboard and shared SMS. Each message
 * becomes its own persisted inbox row BEFORE anything is parsed, so a paste of
 * 200 messages is 200 ordered rows even if the app is closed straight after.
 * Ids are derived from the capture, so replaying the same capture never
 * duplicates a row.
 */
export async function addSmsInboxRows(drafts: InboxSmsDraft[]): Promise<number> {
  if (!drafts.length) return 0;
  const rows: SharedInput[] = drafts.map((d) => ({
    id: d.id,
    receivedAt: d.receivedAt,
    seq: d.seq,
    origin: d.origin,
    kind: "text",
    text: d.text,
    status: "pending",
  }));
  await db().sharedInputs.bulkPut(rows);
  return rows.length;
}

export interface InboxImportResult {
  id: string | null;
  duplicate: boolean;
  allocated: number;
  closed: number;
  leftoverSantim: number;
}

/**
 * Import ONE reviewed inbox row. Everything happens in a single Dexie
 * transaction: the receipt is written with its agent link, the FIFO settlement
 * allocations are created, the covered credits are closed and the inbox row is
 * removed. If any step throws, none of it is kept.
 */
export async function importInboxSms(
  input: Omit<Transaction, "id" | "createdAt">,
  opts: { inboxId?: string; settleAgentId?: string } = {},
): Promise<InboxImportResult> {
  const d = db();
  return d.transaction(
    "rw",
    [d.transactions, d.settlementAllocations, d.sharedInputs],
    async () => {
      const all = await d.transactions.toArray();
      if (input.captureKey && all.some((t) => t.captureKey === input.captureKey)) {
        // The exact same reviewed message is already in the ledger. The inbox
        // row still goes, otherwise it would be offered again forever.
        if (opts.inboxId) await d.sharedInputs.delete(opts.inboxId);
        return { id: null, duplicate: true, allocated: 0, closed: 0, leftoverSantim: 0 };
      }

      const txn: Transaction = { ...input, id: makeId(), createdAt: new Date().toISOString() };
      await d.transactions.put(txn);

      // Settlement always runs through the one shared domain command, inside
      // this same transaction, so allocation can never diverge from the
      // manual settlement path.
      let allocated = 0;
      let closed = 0;
      let leftoverSantim = 0;
      if (opts.settleAgentId) {
        const res = await settleAgentPaymentWithin(d, txn.id, opts.settleAgentId, txn.amountSantim);
        allocated = res.allocated;
        closed = res.closed;
        leftoverSantim = res.leftoverSantim;
      }

      if (opts.inboxId) await d.sharedInputs.delete(opts.inboxId);
      return { id: txn.id, duplicate: false, allocated, closed, leftoverSantim };
    },
  );
}

async function serializeStatementImport(s: StatementImport): Promise<SerializedStatementImport> {
  const { rawImage, ...rest } = s;
  if (!rawImage) return rest;
  const bytes = new Uint8Array(await rawImage.arrayBuffer());
  return {
    ...rest,
    rawImageBase64: bytesToBase64(bytes),
    rawImageType: rawImage.type || undefined,
  };
}

function deserializeStatementImport(s: SerializedStatementImport): StatementImport {
  const { rawImageBase64, rawImageType, ...rest } = s;
  if (!rawImageBase64) return rest;
  const bytes = base64ToBytes(rawImageBase64);
  return {
    ...rest,
    rawImage: new Blob([bytes as unknown as BlobPart], { type: rawImageType || "image/png" }),
  };
}

async function serializeSharedInput(s: SharedInput): Promise<SerializedSharedInput> {
  const { blob, ...rest } = s;
  if (!blob) return rest;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { ...rest, blobBase64: bytesToBase64(bytes), blobType: blob.type || undefined };
}

function deserializeSharedInput(s: SerializedSharedInput): SharedInput {
  const { blobBase64, blobType, ...rest } = s;
  if (!blobBase64) return rest;
  const bytes = base64ToBytes(blobBase64);
  return {
    ...rest,
    blob: new Blob([bytes as unknown as BlobPart], {
      type: blobType || (rest.kind === "pdf" ? "application/pdf" : "image/png"),
    }),
  };
}

export async function exportBackup(): Promise<BackupV4> {
  const d = db();
  const [
    agents,
    distributors,
    banks,
    dailyOpenings,
    dailyClosings,
    periodOpenings,
    periodClosings,
    transactions,
    statementImports,
    fulfillments,
    approvedMappings,
    sharedInputs,
    settlementAllocations,
    meta,
  ] = await Promise.all([
    d.agents.toArray(),
    d.distributors.toArray(),
    d.banks.toArray(),
    d.dailyOpenings.toArray(),
    d.dailyClosings.toArray(),
    d.periodOpenings.toArray(),
    d.periodClosings.toArray(),
    d.transactions.toArray(),
    d.statementImports.toArray(),
    d.fulfillments.toArray(),
    d.approvedMappings.toArray(),
    d.sharedInputs.toArray(),
    d.settlementAllocations.toArray(),
    d.meta.toArray(),
  ]);

  const body: Omit<BackupV4, "counts"> = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    // Credentials (PIN, master PIN, license, lockout state) stay on the device.
    settings: meta
      .filter((m) => !isCredentialMetaKey(m.key) && m.value !== undefined)
      .map((m) => ({ key: m.key, value: m.value })),
    agents,
    distributors,
    banks,
    dailyOpenings,
    dailyClosings,
    periodOpenings,
    periodClosings,
    transactions,
    statementImports: await Promise.all(statementImports.map(serializeStatementImport)),
    fulfillments,
    approvedMappings,
    // Unfinished review work travels too, so a restore resumes the same queue
    // instead of silently losing captures that were never booked.
    sharedInputs: await Promise.all(
      sharedInputs.filter((s) => s.status === "pending").map(serializeSharedInput),
    ),
    // Allocations are financial history: restoring must reproduce the same
    // outstanding receivables, not recompute them.
    settlementAllocations,
  };
  return { ...body, counts: countsOf(body) };
}

export interface ImportOptions {
  /**
   * Required when the account already holds records. Importing always replaces
   * the whole account: there is no silent merge or dedupe of financial history.
   */
  replaceExisting?: boolean;
}

export class BackupImportError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors[0] ?? "Backup could not be imported");
    this.name = "BackupImportError";
    this.errors = errors;
  }
}

/**
 * Atomically replace this device account with a validated backup. The whole
 * write runs in one Dexie transaction, so any failure leaves the previous
 * account exactly as it was — never a partial restore.
 */
export async function importBackup(b: BackupV4, opts: ImportOptions = {}): Promise<void> {
  const validation = validateBackup(b);
  if (!validation.ok) throw new BackupImportError(validation.errors);
  const backup = validation.backup;

  if (!opts.replaceExisting && !(await accountIsEmpty())) {
    throw new BackupImportError([
      "This device account already holds data. Confirm replacement before importing.",
    ]);
  }

  const statementImports = backup.statementImports.map(deserializeStatementImport);
  const sharedInputs = backup.sharedInputs.map(deserializeSharedInput);
  const d = db();
  await d.transaction(
    "rw",
    [
      d.agents,
      d.distributors,
      d.banks,
      d.dailyOpenings,
      d.dailyClosings,
      d.periodOpenings,
      d.periodClosings,
      d.transactions,
      d.statementImports,
      d.fulfillments,
      d.approvedMappings,
      d.sharedInputs,
      d.settlementAllocations,
      d.meta,
    ],
    async () => {
      await Promise.all([
        d.agents.clear(),
        d.distributors.clear(),
        d.banks.clear(),
        d.dailyOpenings.clear(),
        d.dailyClosings.clear(),
        d.periodOpenings.clear(),
        d.periodClosings.clear(),
        d.transactions.clear(),
        d.statementImports.clear(),
        d.fulfillments.clear(),
        d.approvedMappings.clear(),
        d.sharedInputs.clear(),
        d.settlementAllocations.clear(),
      ]);
      // Replace portable settings only; credentials on this device survive.
      const existingMeta = await d.meta.toArray();
      await Promise.all(
        existingMeta.filter((m) => !isCredentialMetaKey(m.key)).map((m) => d.meta.delete(m.key)),
      );

      await d.agents.bulkAdd(backup.agents);
      await d.distributors.bulkAdd(backup.distributors);
      await d.banks.bulkAdd(backup.banks);
      await d.dailyOpenings.bulkAdd(backup.dailyOpenings);
      await d.dailyClosings.bulkAdd(backup.dailyClosings);
      await d.periodOpenings.bulkAdd(backup.periodOpenings);
      await d.periodClosings.bulkAdd(backup.periodClosings);
      await d.transactions.bulkAdd(backup.transactions);
      await d.statementImports.bulkAdd(statementImports);
      await d.fulfillments.bulkAdd(backup.fulfillments);
      await d.approvedMappings.bulkAdd(backup.approvedMappings);
      await d.sharedInputs.bulkAdd(sharedInputs);
      await d.settlementAllocations.bulkAdd(backup.settlementAllocations ?? []);
      await d.meta.bulkPut(
        backup.settings
          .filter((s) => !isCredentialMetaKey(s.key))
          .map((s) => ({ key: s.key, value: s.value })),
      );
    },
  );
}

export async function clearAll(): Promise<void> {
  const d = db();
  await d.transaction(
    "rw",
    [
      d.agents,
      d.distributors,
      d.banks,
      d.dailyOpenings,
      d.dailyClosings,
      d.periodOpenings,
      d.periodClosings,
      d.transactions,
      d.statementImports,
      d.fulfillments,
      d.approvedMappings,
      d.sharedInputs,
      d.settlementAllocations,
      d.meta,
    ],
    async () => {
      await Promise.all([
        d.agents.clear(),
        d.distributors.clear(),
        d.banks.clear(),
        d.dailyOpenings.clear(),
        d.dailyClosings.clear(),
        d.periodOpenings.clear(),
        d.periodClosings.clear(),
        d.transactions.clear(),
        d.statementImports.clear(),
        d.fulfillments.clear(),
        d.approvedMappings.clear(),
        d.sharedInputs.clear(),
        d.settlementAllocations.clear(),
        // keep meta so PIN stays; caller decides
      ]);
    },
  );
}
