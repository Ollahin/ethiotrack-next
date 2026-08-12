import { toast } from "sonner";

/**
 * Enhanced service-worker registration with update detection.
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
    const registration = await navigator.serviceWorker.register(SW_PATH);

    // Handle updates
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // New version available!
          showUpdateToast();
        }
      });
    });
  } catch (err) {
    console.error("SW registration failed:", err);
  }
}

function showUpdateToast() {
  toast.info("Update available", {
    description: "A new version of EthioTrack is ready.",
    action: {
      label: "Update Now",
      onClick: () => {
        window.location.reload();
      },
    },
    duration: Infinity,
  });
}
