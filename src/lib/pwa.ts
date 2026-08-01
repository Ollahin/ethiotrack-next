/**
 * Guarded service-worker registration.
 *
 * The worker only exists to catch Android share-target POSTs, and it caches
 * nothing. It must still never register inside the Lovable editor preview, an
 * iframe or dev, where a controlling worker can confuse hot reloads.
 */
const SW_PATH = "/sw.js";

export function shouldRegisterServiceWorker(
  loc: { hostname: string; search: string },
  opts: { isProd: boolean; inIframe: boolean },
): boolean {
  if (!opts.isProd) return false;
  if (opts.inIframe) return false;
  if (new URLSearchParams(loc.search).get("sw") === "off") return false;
  const h = loc.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return false;
  for (const base of ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"]) {
    if (h === base || h.endsWith(`.${base}`)) return false;
  }
  return true;
}

export async function setupServiceWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const allowed = shouldRegisterServiceWorker(window.location, {
    isProd: import.meta.env.PROD,
    inIframe: window.top !== window.self,
  });
  if (!allowed) {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.allSettled(
      regs.filter((r) => (r.active?.scriptURL ?? "").endsWith(SW_PATH)).map((r) => r.unregister()),
    );
    return;
  }
  try {
    await navigator.serviceWorker.register(SW_PATH);
  } catch {
    /* share target simply stays unavailable; the app is unaffected */
  }
}
