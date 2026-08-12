/*
 * EthioTrack Service Worker
 *
 * 1. Share Target (Android): Handles incoming screenshot/text shares via POST.
 * 2. Offline Cache: Precaches the app shell and assets for offline use.
 * 3. Update Flow: Detects new versions and prompts for restart.
 */

const CACHE_NAME = "ethiotrack-v1";
const HANDOFF_DB = "ethiotrack-share";
const HANDOFF_STORE = "pending";
const SHARE_PATH = "/share-target";

// Core assets to precache immediately.
// Note: In a real build system, these would be injected.
// Here we target the shell and static public assets.
const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/fonts/dm-sans-v11-latin-regular.woff2",
  "/fonts/dm-sans-v11-latin-500.woff2",
  "/fonts/dm-sans-v11-latin-700.woff2",
  "/fonts/ibm-plex-sans-v14-latin-500.woff2",
  "/fonts/ibm-plex-sans-v14-latin-600.woff2",
  "/fonts/ibm-plex-sans-v14-latin-700.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Remove old caches
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        );
      }),
    ]),
  );
});

// --- Share Target Logic ---

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
    await putHandoff({
      id,
      receivedAt: received,
      error: String((err && err.message) || err),
      files: [],
    }).catch(() => {});
    return Response.redirect(`/inbox?shareError=${encodeURIComponent(id)}`, 303);
  }
}

// --- Fetch Logic (Offline Support) ---

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Share Target POST
  if (event.request.method === "POST" && url.pathname === SHARE_PATH) {
    event.respondWith(handleShare(event.request));
    return;
  }

  // 2. Navigation requests: Return index.html (App Shell) for offline support
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match("/");
      }),
    );
    return;
  }

  // 3. Static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchedResponse = fetch(event.request)
        .then((networkResponse) => {
          // Only cache valid GET responses from our own origin
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === "basic" &&
            event.request.method === "GET"
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If network fails, the cachedResponse (if any) will be returned by the outer promise
        });

      return cachedResponse || fetchedResponse;
    }),
  );
});
