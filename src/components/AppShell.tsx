import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Zap,
  Users,
  Landmark,
  Truck,
  List,
  ShieldAlert,
  FileText,
  Settings as Cog,
  Lock,
  ScaleIcon,
  CheckCircle2,
  MoreHorizontal,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { lock } from "@/lib/crypto";
import { ensurePeriodOpeningsMigrated, purgeExpiredRecords, useBanks, useDistributors } from "@/lib/db";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

const TABS = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/capture", label: "Capture", icon: Zap },
  { to: "/agents", label: "Agents", icon: Users },
  { to: "/history", label: "History", icon: List },
] as const;

const MORE_TABS = [
  { to: "/alerts", label: "Alerts", icon: ShieldAlert },
  { to: "/distributors", label: "Distributors", icon: Truck },
  { to: "/banks", label: "Banks", icon: Landmark },
  { to: "/reconcile", label: "Reconcile", icon: ScaleIcon },
  { to: "/close", label: "Close Week", icon: CheckCircle2 },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/settings", label: "Settings", icon: Cog },
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
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  // Backfill legacy period openings whenever banks/distributors change,
  // so aggregate stock totals get split across current distributors
  // and zero rows appear for newly-added accounts.
  const banks = useBanks();
  const distributors = useDistributors();
  useEffect(() => {
    ensurePeriodOpeningsMigrated().catch((err) => {
      console.warn("period opening migration failed", err);
    });
  }, [banks.length, distributors.length]);
  // Enforce 6-month retention: anything older than 180 days is purged.
  useEffect(() => {
    purgeExpiredRecords().catch((err) => {
      console.warn("retention purge failed", err);
    });
  }, []);
  if (pathname === "/unlock") {
    return <div className="min-h-screen bg-background">{children}</div>;
  }
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Desktop side rail */}
      <aside className="hidden md:flex md:w-64 md:flex-col bg-ink text-foreground border-r border-border/60">
        <div className="px-5 pt-6 pb-4">
          <div className="text-2xl font-extrabold tracking-tight text-foreground">
            Ethio<span className="text-primary">Track</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">{todayLabel()}</div>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-1 overflow-y-auto">
          {[...TABS, ...MORE_TABS].map((t) => {
            const active = pathname === t.to;
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                  (active
                    ? "bg-primary text-primary-foreground shadow-[var(--shadow-glow)]"
                    : "text-muted-foreground hover:bg-card hover:text-foreground")
                }
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={() => { lock(); location.href = "/unlock"; }}
          className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Lock className="h-3.5 w-3.5" /> Lock
        </button>
        <div className="px-5 py-3 text-[11px] text-muted-foreground/70 border-t border-border/60">
          Local-only · data never leaves this device
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <GlobalSearchHotkey />
        {/* Mobile top bar */}
        <header className="md:hidden px-4 pt-5 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-primary/50 grid place-items-center text-primary-foreground font-bold text-sm">
              ET
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground leading-tight">Welcome back,</div>
              <div className="text-base font-semibold tracking-tight leading-tight text-foreground">
              Ethio<span className="text-primary">Track</span>
            </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearchIconButton />
            <Link
              to="/settings"
              className="inline-flex items-center justify-center h-11 w-11 rounded-full bg-card border border-border/60 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Settings"
            >
              <Cog className="h-4 w-4" />
            </Link>
          </div>
        </header>

        <main className="flex-1 pb-36 md:pb-8 fade-rise">{children}</main>

        {/* Mobile bottom tabs */}
        <nav
          className="md:hidden fixed bottom-3 inset-x-3 z-30 rounded-2xl border border-border/60 bg-card/90 backdrop-blur-md shadow-[0_10px_30px_-15px_rgba(0,0,0,0.6)] grid grid-cols-5"
        >
          {TABS.map((t) => {
            const active = pathname === t.to;
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={
                  "flex flex-col items-center justify-center gap-1 py-3 min-h-[52px] text-[10px] font-semibold transition-colors rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                  (active ? "text-primary" : "text-muted-foreground hover:text-foreground")
                }
              >
                <span
                  className={
                    "grid place-items-center h-8 w-8 rounded-full transition-colors " +
                    (active ? "bg-primary/15 text-primary" : "text-muted-foreground")
                  }
                >
                  <Icon className="h-4 w-4" />
                </span>
                {t.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="More sections"
            className={
              "flex flex-col items-center justify-center gap-1 py-3 min-h-[52px] text-[10px] font-semibold transition-colors rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (MORE_TABS.some((t) => t.to === pathname)
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <span
              className={
                "grid place-items-center h-8 w-8 rounded-full transition-colors " +
                (MORE_TABS.some((t) => t.to === pathname)
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground")
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
            More
          </button>
        </nav>

        {/* Mobile "More" sheet — mirrors every desktop side-rail entry */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="md:hidden rounded-t-2xl border-border/60 bg-card/95 backdrop-blur-md">
            <SheetHeader className="text-left">
              <SheetTitle>All sections</SheetTitle>
              <SheetDescription>Everything from the desktop side rail.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-3 gap-2 pb-2">
              {MORE_TABS.map((t) => {
                const active = pathname === t.to;
                const Icon = t.icon;
                return (
                  <Link
                    key={t.to}
                    to={t.to}
                    onClick={() => setMoreOpen(false)}
                    className={
                      "flex flex-col items-center justify-center gap-2 py-4 rounded-xl border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                      (active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/60 bg-background/40 text-muted-foreground hover:text-foreground")
                    }
                  >
                    <Icon className="h-5 w-5" />
                    {t.label}
                  </Link>
                );
              })}
            </div>
            <button
              onClick={() => { lock(); location.href = "/unlock"; }}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Lock className="h-4 w-4" /> Lock app
            </button>
            <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
              Local-only · data never leaves this device
            </p>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}