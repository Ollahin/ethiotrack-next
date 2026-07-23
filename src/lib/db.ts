import Dexie, { type Table } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import type {
  Agent,
  Bank,
  DailyClosing,
  DailyOpening,
  Distributor,
  PeriodClosing,
  PeriodOpening,
  StatementImport,
  Transaction,
} from "./types";
import { makeId } from "./ids";

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
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("ethiotrack");
    this.version(1).stores({
      agents: "id, name, phone",
      distributors: "id, name",
      banks: "id, name, channel",
      dailyOpenings: "id, date",
      dailyClosings: "id, date, openingId",
      transactions:
        "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId",
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
      transactions:
        "id, date, type, partyId, channel, isSettled, isPersonal, statementImportId",
      statementImports: "id, distributorId, importedAt",
      meta: "key",
    });
  }
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
      const all = await db().transactions.toArray();
      all.sort((a, b) => (a.date < b.date ? 1 : -1));
      return all;
    }, []) ?? []
  );
}

export function useAgents(): Agent[] {
  return useLiveQuery(() => db().agents.orderBy("name").toArray(), []) ?? [];
}

export function useDistributors(): Distributor[] {
  return (
    useLiveQuery(() => db().distributors.orderBy("name").toArray(), []) ?? []
  );
}

export function useBanks(): Bank[] {
  return useLiveQuery(() => db().banks.orderBy("name").toArray(), []) ?? [];
}

export function useStatementImports(): StatementImport[] {
  return (
    useLiveQuery(
      () => db().statementImports.orderBy("importedAt").reverse().toArray(),
      [],
    ) ?? []
  );
}

export function useDailyOpening(date: string): DailyOpening | undefined {
  return useLiveQuery(
    () => db().dailyOpenings.where("date").equals(date).first(),
    [date],
  );
}

export function useDailyClosing(date: string): DailyClosing | undefined {
  return useLiveQuery(
    () => db().dailyClosings.where("date").equals(date).first(),
    [date],
  );
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

export function usePeriodClosing(weekStart: string): PeriodClosing | undefined | null {
  return useLiveQuery(async () => {
    const rec = await db().periodClosings.where("weekStart").equals(weekStart).first();
    return rec ?? null;
  }, [weekStart]);
}

export function useAllPeriodClosings(): PeriodClosing[] {
  return (
    useLiveQuery(
      () => db().periodClosings.orderBy("weekStart").reverse().toArray(),
      [],
    ) ?? []
  );
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
): Promise<{ inserted: number; skipped: number; ids: string[] }> {
  const existing = await db().transactions.toArray();
  const seen = new Map<string, number[]>();
  for (const t of existing) {
    const k = `${t.type}|${t.amountSantim}|${t.partyName.toLowerCase()}|${t.channel}`;
    seen.set(k, [...(seen.get(k) ?? []), new Date(t.date).getTime()]);
  }
  const inserted: Transaction[] = [];
  let skipped = 0;
  for (const input of inputs) {
    const k = `${input.type}|${input.amountSantim}|${input.partyName.toLowerCase()}|${input.channel}`;
    const ts = new Date(input.date).getTime();
    const near = (seen.get(k) ?? []).some(
      (p) => Math.abs(p - ts) <= 10 * 60_000,
    );
    if (near) {
      skipped++;
      continue;
    }
    const txn: Transaction = {
      ...input,
      id: makeId(),
      createdAt: new Date().toISOString(),
    };
    inserted.push(txn);
    seen.set(k, [...(seen.get(k) ?? []), ts]);
  }
  if (inserted.length) await db().transactions.bulkPut(inserted);
  return {
    inserted: inserted.length,
    skipped,
    ids: inserted.map((t) => t.id),
  };
}

export async function updateTransaction(txn: Transaction): Promise<void> {
  await db().transactions.put(txn);
}

export async function deleteTransaction(id: string): Promise<void> {
  await db().transactions.delete(id);
}

// -- master data -------------------------------------------------------------

export async function upsertAgent(a: Omit<Agent, "id" | "createdAt"> & { id?: string }): Promise<Agent> {
  const rec: Agent = {
    id: a.id ?? makeId(),
    name: a.name.trim(),
    phone: a.phone?.trim() || undefined,
    creditLimitSantim: a.creditLimitSantim,
    createdAt: a.id ? (await db().agents.get(a.id))?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
  };
  await db().agents.put(rec);
  return rec;
}
export async function deleteAgent(id: string) { await db().agents.delete(id); }

export async function upsertDistributor(a: Omit<Distributor, "id" | "createdAt"> & { id?: string }): Promise<Distributor> {
  const rec: Distributor = {
    id: a.id ?? makeId(),
    name: a.name.trim(),
    contact: a.contact?.trim() || undefined,
    statementFormat: a.statementFormat,
    createdAt: a.id ? (await db().distributors.get(a.id))?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
  };
  await db().distributors.put(rec);
  return rec;
}
export async function deleteDistributor(id: string) { await db().distributors.delete(id); }

export async function upsertBank(a: Omit<Bank, "id" | "createdAt"> & { id?: string }): Promise<Bank> {
  const rec: Bank = {
    id: a.id ?? makeId(),
    name: a.name.trim(),
    accountNumber: a.accountNumber?.trim() || undefined,
    channel: a.channel,
    openingBalanceSantim: a.openingBalanceSantim ?? 0,
    createdAt: a.id ? (await db().banks.get(a.id))?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
  };
  await db().banks.put(rec);
  return rec;
}
export async function deleteBank(id: string) { await db().banks.delete(id); }

// -- day open / close --------------------------------------------------------

export async function openDay(input: Omit<DailyOpening, "id" | "openedAt">): Promise<DailyOpening> {
  const rec: DailyOpening = { ...input, id: makeId(), openedAt: new Date().toISOString() };
  await db().dailyOpenings.put(rec);
  return rec;
}

export async function closeDay(input: Omit<DailyClosing, "id" | "closedAt">): Promise<DailyClosing> {
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

// -- meta --------------------------------------------------------------------

export async function metaGet<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db().meta.get(key);
  return row?.value as T | undefined;
}
export async function metaSet(key: string, value: unknown): Promise<void> {
  await db().meta.put({ key, value });
}

// -- backup ------------------------------------------------------------------

export interface Backup {
  version: 2;
  exportedAt: string;
  agents: Agent[];
  distributors: Distributor[];
  banks: Bank[];
  dailyOpenings: DailyOpening[];
  dailyClosings: DailyClosing[];
  periodOpenings?: PeriodOpening[];
  periodClosings?: PeriodClosing[];
  transactions: Transaction[];
  statementImports: StatementImport[];
}

export async function exportBackup(): Promise<Backup> {
  const d = db();
  const [agents, distributors, banks, dailyOpenings, dailyClosings, periodOpenings, periodClosings, transactions, statementImports] =
    await Promise.all([
      d.agents.toArray(),
      d.distributors.toArray(),
      d.banks.toArray(),
      d.dailyOpenings.toArray(),
      d.dailyClosings.toArray(),
      d.periodOpenings.toArray(),
      d.periodClosings.toArray(),
      d.transactions.toArray(),
      d.statementImports.toArray(),
    ]);
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    agents, distributors, banks, dailyOpenings, dailyClosings, periodOpenings, periodClosings, transactions, statementImports,
  };
}

export async function importBackup(b: Backup): Promise<void> {
  const d = db();
  await d.transaction("rw", [d.agents, d.distributors, d.banks, d.dailyOpenings, d.dailyClosings, d.periodOpenings, d.periodClosings, d.transactions, d.statementImports], async () => {
    if (b.agents) await d.agents.bulkPut(b.agents);
    if (b.distributors) await d.distributors.bulkPut(b.distributors);
    if (b.banks) await d.banks.bulkPut(b.banks);
    if (b.dailyOpenings) await d.dailyOpenings.bulkPut(b.dailyOpenings);
    if (b.dailyClosings) await d.dailyClosings.bulkPut(b.dailyClosings);
    if (b.periodOpenings) await d.periodOpenings.bulkPut(b.periodOpenings);
    if (b.periodClosings) await d.periodClosings.bulkPut(b.periodClosings);
    if (b.transactions) await d.transactions.bulkPut(b.transactions);
    if (b.statementImports) await d.statementImports.bulkPut(b.statementImports);
  });
}

export async function clearAll(): Promise<void> {
  const d = db();
  await d.transaction("rw", [d.agents, d.distributors, d.banks, d.dailyOpenings, d.dailyClosings, d.periodOpenings, d.periodClosings, d.transactions, d.statementImports, d.meta], async () => {
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
      // keep meta so PIN stays; caller decides
    ]);
  });
}