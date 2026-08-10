import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { hasPin, isUnlocked, lock, subscribeUnlock } from "@/lib/crypto";

/**
 * Guards every route except /unlock. If no PIN is set, redirects to /unlock
 * to force setup. If a PIN is set and not unlocked, redirects to /unlock.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [checked, setChecked] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    const unsub = subscribeUnlock(() => force((n) => n + 1));
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const exists = await hasPin();

      if (!alive) return;
      if (pathname !== "/unlock" && (!exists || !isUnlocked())) {
        nav({ to: "/unlock", replace: true });
      }
      setChecked(true);
    })();
    return () => {
      alive = false;
    };
  }, [pathname, nav]);

  if (!checked && pathname !== "/unlock") return null;
  return <>{children}</>;
}
