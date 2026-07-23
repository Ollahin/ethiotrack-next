import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Home,
  Zap,
  Users,
  ShieldAlert,
  FileText,
  History as HistoryIcon,
  Building2,
  Landmark,
  Scale,
  CalendarCheck,
  Settings as SettingsIcon,
  Search,
  Lock,
  ArrowRightLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgents, useBanks, useDistributors, useTransactions } from "@/lib/db";
import { formatEtb } from "@/lib/format";
import { lock } from "@/lib/crypto";

const PAGES: {
  to: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { to: "/", label: "Dashboard", hint: "Home overview", icon: Home },
  { to: "/capture", label: "Capture transaction", hint: "Log a new txn or paste alert", icon: Zap },
  { to: "/history", label: "History", hint: "Browse & search all transactions", icon: HistoryIcon },
  { to: "/agents", label: "Agents", hint: "Manage sales agents", icon: Users },
  { to: "/distributors", label: "Distributors", hint: "EVD / Float suppliers", icon: Building2 },
  { to: "/banks", label: "Banks & wallets", hint: "Accounts and channels", icon: Landmark },
  { to: "/alerts", label: "Alerts", hint: "Leaks & anomalies", icon: ShieldAlert },
  { to: "/reconcile", label: "Reconcile", hint: "Expected vs actual balances", icon: Scale },
  { to: "/close", label: "Close week", hint: "End-of-week reconciliation", icon: CalendarCheck },
  { to: "/reports", label: "Reports", hint: "Export & analytics", icon: FileText },
  { to: "/account", label: "Account", hint: "Name, license, PIN, master PIN", icon: SettingsIcon },
  { to: "/exports", label: "Exports & backups", hint: "JSON / CSV download and restore", icon: SettingsIcon },
  { to: "/settings", label: "Settings", hint: "Account & exports hub", icon: SettingsIcon },
];

function useGlobalHotkey(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpen]);
}

export function GlobalSearchTrigger({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useGlobalHotkey(() => setOpen(true));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "group flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-left shadow-sm backdrop-blur hover:border-primary/50 hover:bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
          (className ?? "")
        }
        aria-label="Open global search"
      >
        <Search className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        <span className="flex-1 text-sm text-muted-foreground">
          Search transactions, agents, pages…
        </span>
        <kbd className="hidden md:inline-flex items-center gap-1 rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>
      <GlobalSearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Mount once (in AppShell) to enable ⌘K everywhere without a visible trigger. */
export function GlobalSearchHotkey() {
  const [open, setOpen] = useState(false);
  useGlobalHotkey(() => setOpen(true));
  return <GlobalSearchDialog open={open} onOpenChange={setOpen} />;
}

export function GlobalSearchIconButton() {
  const [open, setOpen] = useState(false);
  useGlobalHotkey(() => setOpen(true));
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Search (⌘K)"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
      </Button>
      <GlobalSearchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const txns = useTransactions();
  const agents = useAgents();
  const distributors = useDistributors();
  const banks = useBanks();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();

  const txnMatches = useMemo(() => {
    if (!q) return txns.slice(0, 6);
    return txns
      .filter((t) => {
        const hay = [
          t.partyName,
          t.reference,
          t.note,
          t.channel,
          t.type,
          String(t.amountSantim / 100),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [txns, q]);

  const filter = (name: string) => (!q ? true : name.toLowerCase().includes(q));

  const go = (path: string, search?: Record<string, unknown>) => {
    onOpenChange(false);
    navigate({ to: path, search: search as never });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search anything — pages, agents, banks, transactions…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {q && (
          <CommandGroup heading="Search across history">
            <CommandItem
              value={`search-history-${q}`}
              onSelect={() => go("/history", { q: query, archive: false })}
            >
              <Search className="mr-2 h-4 w-4" />
              <span>
                Search “{query}” in active history
              </span>
            </CommandItem>
            <CommandItem
              value={`search-archive-${q}`}
              onSelect={() => go("/history", { q: query, archive: true })}
            >
              <HistoryIcon className="mr-2 h-4 w-4" />
              <span>Search “{query}” including archive (3–6 mo)</span>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem
              key={p.to}
              value={`page ${p.label} ${p.hint}`}
              onSelect={() => go(p.to)}
            >
              <p.icon className="mr-2 h-4 w-4" />
              <span className="flex-1">{p.label}</span>
              <span className="text-[11px] text-muted-foreground">{p.hint}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {agents.filter((a) => filter(a.name) || (a.phone ?? "").includes(q)).length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Agents">
              {agents
                .filter((a) => filter(a.name) || (a.phone ?? "").includes(q))
                .slice(0, 8)
                .map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`agent ${a.name} ${a.phone ?? ""}`}
                    onSelect={() => go("/agents")}
                  >
                    <Users className="mr-2 h-4 w-4" />
                    <span className="flex-1">{a.name}</span>
                    {a.phone && (
                      <span className="text-[11px] text-muted-foreground">{a.phone}</span>
                    )}
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        )}

        {distributors.filter((d) => filter(d.name)).length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Distributors">
              {distributors
                .filter((d) => filter(d.name))
                .slice(0, 6)
                .map((d) => (
                  <CommandItem
                    key={d.id}
                    value={`distributor ${d.name}`}
                    onSelect={() => go("/distributors")}
                  >
                    <Building2 className="mr-2 h-4 w-4" />
                    <span>{d.name}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        )}

        {banks.filter((b) => filter(b.name) || filter(b.channel)).length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Banks & wallets">
              {banks
                .filter((b) => filter(b.name) || filter(b.channel))
                .slice(0, 6)
                .map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`bank ${b.name} ${b.channel}`}
                    onSelect={() => go("/banks")}
                  >
                    <Landmark className="mr-2 h-4 w-4" />
                    <span className="flex-1">{b.name}</span>
                    <span className="text-[11px] text-muted-foreground">{b.channel}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        )}

        {txnMatches.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={q ? "Matching transactions" : "Recent transactions"}>
              {txnMatches.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`txn ${t.partyName} ${t.reference ?? ""} ${t.note ?? ""} ${t.channel}`}
                  onSelect={() => go("/history", { q: t.reference || t.partyName || "" })}
                >
                  <ArrowRightLeft className="mr-2 h-4 w-4" />
                  <span className="flex-1 truncate">
                    {t.partyName || t.channel}
                    {t.reference ? (
                      <span className="text-muted-foreground"> · {t.reference}</span>
                    ) : null}
                  </span>
                  <span
                    className={
                      "text-[11px] tabular-nums " +
                      (t.type === "in" ? "text-money-in" : "text-money-out")
                    }
                  >
                    {t.type === "in" ? "+" : "−"}
                    {formatEtb(t.amountSantim)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="action lock app"
            onSelect={() => {
              onOpenChange(false);
              lock();
            }}
          >
            <Lock className="mr-2 h-4 w-4" />
            <span>Lock app</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}