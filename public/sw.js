/*
 * EthioTrack Service Worker
 *
 * 1. Share Target (Android): Handles incoming screenshot/text shares via POST.
 * 2. Offline Cache: Precaches the app shell and assets for offline use.
 * 3. Update Flow: Detects new versions and prompts for restart.
 */

importScripts("/sw-precache.js");

const CACHE_NAME = "ethiotrack-v2";
const HANDOFF_DB = "ethiotrack-share";
const HANDOFF_STORE = "pending";
const SHARE_PATH = "/share-target";

// PRECACHE_ASSETS is loaded via importScripts
const PRECACHE_LIST = self.PRECACHE_ASSETS || ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Try adding all, but don't let a single missing asset kill the SW
      return Promise.allSettled(
        PRECACHE_LIST.map((url) =>
          cache.add(url).catch((err) => console.warn(`Failed to precache ${url}:`, err)),
        ),
      );
    }),
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

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Share Target POST - Never cache
  if (event.request.method === "POST" && url.pathname === SHARE_PATH) {
    event.respondWith(handleShare(event.request));
    return;
  }

  // Skip non-GET requests for caching
  if (event.request.method !== "GET") {
    return;
  }

  // 2. Navigation requests: Return base "/" (App Shell) for offline support
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match("/");
      }),
    );
    return;
  }

  // 3. Static assets: Stale-While-Revalidate
  // Cache only specific safe asset classes
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/fonts/") ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".ico"));

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchedResponse = fetch(event.request)
        .then((networkResponse) => {
          // Only cache valid GET responses from our own origin for static assets
          if (
            isStaticAsset &&
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === "basic"
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If network fails, the cachedResponse (if any) will be returned
        });

      return cachedResponse || fetchedResponse;
    }),
  );
});
