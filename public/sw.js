/*
 * EthioTrack share-target worker.
 *
 * This worker exists for ONE reason: Android can only hand a shared screenshot
 * or message to an installed web app through a POST to a share-target URL, and
 * only a service worker can catch that POST client-side.
 *
 * It deliberately caches NOTHING. There is no precache, no runtime cache and
 * no navigation fallback, so it can never serve stale HTML or a deleted chunk.
 */

const HANDOFF_DB = "ethiotrack-share";
const HANDOFF_STORE = "pending";
const SHARE_PATH = "/share-target";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function openHandoffDb() {
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

function putHandoff(record) {
  return openHandoffDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(HANDOFF_STORE, "readwrite");
        tx.objectStore(HANDOFF_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

async function handleShare(request) {
  const received = new Date().toISOString();
  const id = `share_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    const form = await request.formData();
    const files = [];
    for (const entry of form.getAll("files")) {
      if (entry && typeof entry === "object" && "arrayBuffer" in entry) {
        files.push({ name: entry.name || "shared", type: entry.type || "", blob: entry });
      }
    }
    const parts = [form.get("text"), form.get("url")].filter(
      (v) => typeof v === "string" && v.trim(),
    );
    await putHandoff({
      id,
      receivedAt: received,
      title: typeof form.get("title") === "string" ? form.get("title") : undefined,
      text: parts.join("\n").trim() || undefined,
      files,
    });
    return Response.redirect(`/inbox?shared=${encodeURIComponent(id)}`, 303);
  } catch (err) {
    // The share is never silently dropped: the inbox is told it failed.
    await putHandoff({
      id,
      receivedAt: received,
      error: String((err && err.message) || err),
      files: [],
    }).catch(() => {});
    return Response.redirect(`/inbox?shareError=${encodeURIComponent(id)}`, 303);
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === SHARE_PATH) {
    event.respondWith(handleShare(event.request));
  }
  // Every other request falls through to the network untouched.
});
