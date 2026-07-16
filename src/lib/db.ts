import { openDB, type IDBPDatabase } from "idb";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Transaction } from "./types";

const DB_NAME = "ethiotrack";
const DB_VERSION = 1;
const STORE_TXN = "transactions";
const STORE_META = "meta";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable on server"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_TXN)) {
          const s = db.createObjectStore(STORE_TXN, { keyPath: "id" });
          s.createIndex("date", "date");
          s.createIndex("party", "party");
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

// --- reactive store ---------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: Transaction[] = [];
let loaded = false;

function emit() {
  for (const l of listeners) l();
}

async function refresh() {
  const db = await getDb();
  const all = (await db.getAll(STORE_TXN)) as Transaction[];
  all.sort((a, b) => (a.date < b.date ? 1 : -1));
  cache = all;
  loaded = true;
  emit();
}

function subscribe(l: Listener) {
  listeners.add(l);
  if (!loaded) void refresh();
  return () => listeners.delete(l);
}

function getSnapshot() {
  return cache;
}

const EMPTY: Transaction[] = [];
function getServerSnapshot(): Transaction[] {
  return EMPTY;
}

export function useTransactions(): {
  transactions: Transaction[];
  loaded: boolean;
} {
  const transactions = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    if (loaded) setReady(true);
    else void refresh().then(() => setReady(true));
  }, []);
  return { transactions, loaded: ready };
}

function makeId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

export async function addTransaction(
  input: Omit<Transaction, "id" | "createdAt">,
): Promise<Transaction> {
  const db = await getDb();
  const txn: Transaction = {
    ...input,
    id: makeId(),
    createdAt: new Date().toISOString(),
  };
  await db.put(STORE_TXN, txn);
  await refresh();
  return txn;
}

export async function addTransactionsBulk(
  inputs: Array<Omit<Transaction, "id" | "createdAt">>,
): Promise<{ inserted: number; skipped: number }> {
  const db = await getDb();
  // Dedupe against existing rows: same type + amount + party + channel
  // within a 10-minute window is considered a duplicate. Runs inside the
  // same transaction so two concurrent imports can't both slip through.
  const existing = (await db.getAll(STORE_TXN)) as Transaction[];
  const seenKeys = new Map<string, number[]>();
  for (const t of existing) {
    const k = `${t.type}|${t.amountSantim}|${t.party.toLowerCase()}|${t.channel}`;
    seenKeys.set(k, [...(seenKeys.get(k) ?? []), new Date(t.date).getTime()]);
  }
  const tx = db.transaction(STORE_TXN, "readwrite");
  let inserted = 0;
  let skipped = 0;
  for (const input of inputs) {
    const key = `${input.type}|${input.amountSantim}|${input.party.toLowerCase()}|${input.channel}`;
    const ts = new Date(input.date).getTime();
    const near = (seenKeys.get(key) ?? []).some(
      (prev) => Math.abs(prev - ts) <= 10 * 60_000,
    );
    if (near) {
      skipped++;
      continue;
    }
    await tx.store.put({
      ...input,
      id: makeId(),
      createdAt: new Date().toISOString(),
    });
    seenKeys.set(key, [...(seenKeys.get(key) ?? []), ts]);
    inserted++;
  }
  await tx.done;
  await refresh();
  return { inserted, skipped };
}

export async function updateTransaction(txn: Transaction): Promise<void> {
  const db = await getDb();
  await db.put(STORE_TXN, txn);
  await refresh();
}

export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_TXN, id);
  await refresh();
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_TXN);
  await refresh();
}

export async function importAll(txns: Transaction[]): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(STORE_TXN, "readwrite");
  for (const t of txns) await tx.store.put(t);
  await tx.done;
  await refresh();
  return txns.length;
}

// --- meta (ignored leak IDs) -----------------------------------------------

export async function getIgnoredLeaks(): Promise<Set<string>> {
  try {
    const db = await getDb();
    const rec = (await db.get(STORE_META, "ignoredLeaks")) as
      | { key: string; ids: string[] }
      | undefined;
    return new Set(rec?.ids ?? []);
  } catch {
    return new Set();
  }
}

export async function setIgnoredLeaks(ids: Set<string>): Promise<void> {
  const db = await getDb();
  await db.put(STORE_META, { key: "ignoredLeaks", ids: [...ids] });
}