import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  deleteAgent,
  deleteTransaction,
  updateTransaction,
  upsertAgent,
  useAgents,
  useTransactions,
} from "@/lib/db";
import { computeAgentStats } from "@/lib/brain/stats";
import { openCreditsFor, planFifoSettlement } from "@/lib/brain/credits";
import { formatEtb, parseEtbToSantim, formatTxnDate } from "@/lib/format";
import type { Agent, Transaction } from "@/lib/types";
import { Trash2, UserPlus, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Agents · EthioTrack" },
      {
        name: "description",
        content: "Every downstream sales agent, their credit balance and payment behavior.",
      },
      { property: "og:title", content: "Agent Book · EthioTrack" },
      {
        property: "og:description",
        content: "Track open credits, aging risk, and settlement history per agent.",
      },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const agents = useAgents();
  const txns = useTransactions();
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      agents
        .map((a) => ({ agent: a, stats: computeAgentStats(a, txns) }))
        .sort((x, y) => y.stats.openCreditSantim - x.stats.openCreditSantim),
    [agents, txns],
  );

  const totals = useMemo(() => {
    let airtimeOut = 0,
      cashIn = 0,
      open = 0,
      reversed = 0,
      excess = 0;
    for (const { stats } of rows) {
      airtimeOut += stats.totalOutSantim;
      cashIn += stats.totalInSantim;
      open += stats.openCreditSantim;
      reversed += stats.reversedSantim;
      excess += stats.excessReversalSantim;
    }
    return { airtimeOut, cashIn, open, reversed, excess };
  }, [rows]);

  const focused = selected ? agents.find((a) => a.id === selected) : null;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Agent Book</h1>
          <p className="text-sm text-ink-soft">
            Downstream buyers, credit balances and payment behavior.
          </p>
        </div>
        <AgentDialog
          trigger={
            <Button>
              <UserPlus className="h-4 w-4 mr-1" /> New agent
            </Button>
          }
        />
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-xl border border-border bg-card p-3 text-xs">
          <div>
            <div className="text-ink-soft">Net airtime delivered</div>
            <div className="font-bold tabular-nums text-airtime">
              {formatEtb(totals.airtimeOut)}
            </div>
            {totals.reversed > 0 && (
              <div className="text-[10px] text-amber-500">
                after {formatEtb(totals.reversed)} reversed
              </div>
            )}
          </div>
          <div>
            <div className="text-ink-soft">Reversed back</div>
            <div className="font-bold tabular-nums text-amber-500">
              {formatEtb(totals.reversed)}
            </div>
          </div>
          <div>
            <div className="text-ink-soft">Cash received</div>
            <div className="font-bold tabular-nums text-money-in">{formatEtb(totals.cashIn)}</div>
          </div>
          <div>
            <div className="text-ink-soft">Open (leak signal)</div>
            <div
              className={
                "font-bold tabular-nums " + (totals.open > 0 ? "text-money-out" : "text-ink-soft")
              }
            >
              {formatEtb(totals.open)}
            </div>
            {totals.excess > 0 && (
              <div className="text-[10px] text-amber-500">
                {formatEtb(totals.excess)} excess reversal — review
              </div>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-ink-soft">
          No agents yet. Add your first agent to start tracking credit.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map(({ agent, stats }) => {
          const overLimit =
            agent.creditLimitSantim && stats.openCreditSantim > agent.creditLimitSantim;
          return (
            <div
              key={agent.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm hover:border-primary/50"
            >
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  to="/agents/$agentId"
                  params={{ agentId: agent.id }}
                  className="font-semibold hover:underline"
                >
                  {agent.name}
                </Link>
                <div
                  className={
                    "text-sm font-bold tabular-nums " +
                    (overLimit ? "text-money-out" : "text-credit")
                  }
                >
                  {formatEtb(stats.openCreditSantim)}
                </div>
              </div>
              <div className="text-[11px] text-ink-soft mt-1 flex flex-wrap gap-2">
                <span>{stats.unsettledCount} open</span>
                <span>·</span>
                <span>in {formatEtb(stats.totalInSantim)}</span>
                <span>·</span>
                <span>out {formatEtb(stats.totalOutSantim)}</span>
                {stats.avgPaymentDays !== null && (
                  <>
                    <span>·</span>
                    <span>avg {stats.avgPaymentDays.toFixed(1)}d</span>
                  </>
                )}
                {stats.oldestOpenCreditDays !== null && stats.oldestOpenCreditDays > 0 && (
                  <>
                    <span>·</span>
                    <span>{stats.oldestOpenCreditDays}d oldest</span>
                  </>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setSelected(agent.id)}>
                  Manage
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/agents/$agentId" params={{ agentId: agent.id }}>
                    History
                  </Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {focused && <AgentDetail agent={focused} txns={txns} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AgentDialog({ agent, trigger }: { agent?: Agent; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(agent?.name ?? "");
  const [phone, setPhone] = useState(agent?.phone ?? "");
  const [limit, setLimit] = useState(
    agent?.creditLimitSantim ? (agent.creditLimitSantim / 100).toString() : "",
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{agent ? "Edit agent" : "New agent"}</DialogTitle>
          <DialogDescription>Downstream buyers who take airtime on credit.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09xxxxxxxx"
            />
          </div>
          <div>
            <Label>Credit limit (ETB, optional)</Label>
            <Input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
          <Button
            className="w-full"
            onClick={async () => {
              if (!name.trim()) return toast.error("Name required");
              await upsertAgent({
                id: agent?.id,
                name,
                phone,
                creditLimitSantim: parseEtbToSantim(limit) ?? undefined,
              });
              toast.success("Saved");
              setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AgentDetail({
  agent,
  txns,
  onClose,
}: {
  agent: Agent;
  txns: Transaction[];
  onClose: () => void;
}) {
  const mine = txns
    .filter((t) => t.partyId === agent.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const stats = computeAgentStats(agent, txns);
  const [settleAmt, setSettleAmt] = useState("");

  async function settle() {
    const santim = parseEtbToSantim(settleAmt);
    if (!santim) return toast.error("Enter amount");
    const open = openCreditsFor(agent.id, txns);
    const plan = planFifoSettlement(santim, open);
    for (const cid of plan.settled) {
      const c = txns.find((t) => t.id === cid);
      if (c)
        await updateTransaction({ ...c, isSettled: true, settledAt: new Date().toISOString() });
    }
    toast.success(`Settled ${plan.settled.length} credit(s)`);
    setSettleAmt("");
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {agent.name}
            <span className="text-xs font-normal text-ink-soft">{agent.phone}</span>
          </DialogTitle>
          <DialogDescription>
            {formatEtb(stats.openCreditSantim)} open · {stats.unsettledCount} unsettled ·{" "}
            {stats.avgPaymentDays !== null
              ? `avg pays in ${stats.avgPaymentDays.toFixed(1)}d`
              : "no payment history"}
          </DialogDescription>
        </DialogHeader>

        {stats.openCreditSantim > 0 && (
          <div className="rounded-md border border-border p-3 bg-money-in/5 space-y-2">
            <div className="text-sm font-semibold">Settle credit (FIFO)</div>
            <div className="flex gap-2">
              <Input
                inputMode="decimal"
                placeholder="ETB"
                value={settleAmt}
                onChange={(e) => setSettleAmt(e.target.value)}
              />
              <Button onClick={settle}>
                <Plus className="h-4 w-4 mr-1" /> Apply
              </Button>
            </div>
            <div className="text-[11px] text-ink-soft">
              Applies to oldest unsettled credits first.
            </div>
          </div>
        )}

        <ul className="divide-y divide-border rounded-md border border-border">
          {mine.map((t) => (
            <li key={t.id} className="p-2 flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-semibold text-ink-soft">
                    {t.type}
                  </span>
                  {t.isSettled && (
                    <span className="text-[10px] text-money-in font-semibold">settled</span>
                  )}
                  <span className="text-xs text-ink-soft">{formatTxnDate(t.date, t.dateIsDayOnly)}</span>
                </div>
                <div className="text-[11px] text-ink-soft truncate">{t.note}</div>
              </div>
              <div
                className={
                  "font-bold tabular-nums " +
                  (t.type === "in" ? "text-money-in" : "text-foreground")
                }
              >
                {t.type === "in" ? "+" : "−"} {formatEtb(t.amountSantim)}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  await deleteTransaction(t.id);
                  toast.success("Deleted");
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-money-out" />
              </Button>
            </li>
          ))}
          {!mine.length && (
            <li className="p-6 text-center text-xs text-ink-soft">No transactions yet.</li>
          )}
        </ul>

        <div className="flex justify-between pt-2">
          <AgentDialog
            agent={agent}
            trigger={
              <Button variant="secondary" size="sm">
                Edit
              </Button>
            }
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (!confirm(`Delete agent ${agent.name}? Transactions stay but become unlinked.`))
                return;
              await deleteAgent(agent.id);
              toast.success("Deleted");
              onClose();
            }}
          >
            <Trash2 className="h-4 w-4 mr-1" /> Delete agent
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
