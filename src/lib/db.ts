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
): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(STORE_TXN, "readwrite");
  for (const input of inputs) {
    await tx.store.put({
      ...input,
      id: makeId(),
      createdAt: new Date().toISOString(),
    });
  }
  await tx.done;
  await refresh();
  return inputs.length;
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