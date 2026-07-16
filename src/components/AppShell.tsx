import { Link, useRouterState } from "@tanstack/react-router";
import {
  PencilLine,
  List,
  Users,
  ShieldAlert,
  Download,
} from "lucide-react";
import type { ReactNode } from "react";

const TABS = [
  { to: "/", label: "Log", icon: PencilLine },
  { to: "/history", label: "History", icon: List },
  { to: "/agents", label: "Agents", icon: Users },
  { to: "/leaks", label: "Leaks", icon: ShieldAlert },
  { to: "/export", label: "Export", icon: Download },
] as const;

function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Desktop side rail */}
      <aside className="hidden md:flex md:w-60 md:flex-col bg-ink text-white">
        <div className="px-5 pt-6 pb-4">
          <div className="text-2xl font-extrabold tracking-tight">
            Ethio<span className="text-primary">Track</span>
          </div>
          <div className="text-xs text-white/60 mt-1">{todayLabel()}</div>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-1">
          {TABS.map((t) => {
            const active = pathname === t.to;
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors " +
                  (active
                    ? "bg-primary text-primary-foreground"
                    : "text-white/80 hover:bg-white/5")
                }
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 text-[11px] text-white/40">
          Local-only · data never leaves this device
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden bg-ink text-white px-4 pt-3 pb-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-extrabold tracking-tight leading-none">
              Ethio<span className="text-primary">Track</span>
            </div>
            <div className="text-[11px] text-white/60 mt-0.5">
              {todayLabel()}
            </div>
          </div>
          <Link
            to="/export"
            className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </Link>
        </header>

        <main className="flex-1 pb-24 md:pb-8">{children}</main>

        {/* Mobile bottom tabs */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border grid grid-cols-5">
          {TABS.map((t) => {
            const active = pathname === t.to;
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold " +
                  (active ? "text-primary" : "text-ink-soft")
                }
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}