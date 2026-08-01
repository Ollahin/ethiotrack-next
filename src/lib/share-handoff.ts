/**
 * Bridge between the share-target service worker and the app database.
 *
 * The worker cannot write Dexie tables safely from its own context, so it
 * parks each share in a tiny standalone IndexedDB store. The app drains that
 * store into the inbox on load. Draining is destructive-after-copy: a record
 * is deleted only once it has been handed to the caller.
 */

export const HANDOFF_DB = "ethiotrack-share";
export const HANDOFF_STORE = "pending";

export interface HandoffFile {
  name: string;
  type: string;
  blob: Blob;
}

export interface HandoffRecord {
  id: string;
  receivedAt: string;
  title?: string;
  text?: string;
  files?: HandoffFile[];
  error?: string;
}

function openHandoffDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDOFF_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(HANDOFF_STORE)) {
        req.result.createObjectStore(HANDOFF_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Read every parked share. Never throws — a missing store means "nothing". */
export async function readHandoffs(): Promise<HandoffRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openHandoffDb();
    return await new Promise<HandoffRecord[]>((resolve, reject) => {
      const tx = db.transaction(HANDOFF_STORE, "readonly");
      const req = tx.objectStore(HANDOFF_STORE).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as HandoffRecord[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteHandoff(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openHandoffDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDOFF_STORE, "readwrite");
      tx.objectStore(HANDOFF_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* the share stays parked and will be retried on the next load */
  }
}
