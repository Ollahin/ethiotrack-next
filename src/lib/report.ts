import { formatEtb } from "./format";
import type { Agent, Transaction } from "./types";
import { computeAgentStats } from "./brain/stats";

export async function generateRangeReport(
  agents: Agent[],
  txns: Transaction[],
  from: Date,
  to: Date,
  title = "EthioTrack — Report",
): Promise<Blob> {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const range = txns.filter((t) => {
    const d = new Date(t.date);
    return d >= from && d <= to && !t.isPersonal;
  });
  const sum = (t: Transaction[], type: Transaction["type"]) =>
    t.filter((x) => x.type === type).reduce((s, x) => s + x.amountSantim, 0);

  let y = 48;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, 40, y);
  y += 20;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`, 40, y);
  y += 24;

  doc.setFont("helvetica", "bold");
  doc.text("Summary", 40, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  const line = (k: string, v: string) => {
    doc.text(k, 40, y);
    doc.text(v, 320, y, { align: "right" });
    y += 14;
  };
  line("Airtime distributed — EVD", formatEtb(sum(range, "airtime_evd")));
  line("Airtime distributed — Float", formatEtb(sum(range, "airtime_float")));
  line("Cash collected (Money In)", formatEtb(sum(range, "in")));
  line("Cash paid (Money Out)", formatEtb(sum(range, "out")));
  line("Expenses", formatEtb(sum(range, "expense")));
  const net = sum(range, "in") - sum(range, "out") - sum(range, "expense");
  line("Net", formatEtb(net));
  y += 12;

  doc.setFont("helvetica", "bold");
  doc.text("Aged Receivables", 40, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  const rows: Array<[string, string, string]> = [];
  for (const a of agents) {
    const s = computeAgentStats(a, txns);
    if (s.openCreditSantim > 0) {
      rows.push([
        a.name,
        formatEtb(s.openCreditSantim),
        s.oldestOpenCreditDays ? `${s.oldestOpenCreditDays}d` : "—",
      ]);
    }
  }
  if (!rows.length) {
    doc.text("(No open credits — all agents settled.)", 40, y);
  } else {
    for (const r of rows) {
      if (y > 780) {
        doc.addPage();
        y = 48;
      }
      doc.text(r[0], 40, y);
      doc.text(r[1], 320, y, { align: "right" });
      doc.text(r[2], 380, y);
      y += 14;
    }
  }
  return doc.output("blob");
}

export function generateWeeklyReport(agents: Agent[], txns: Transaction[]): Promise<Blob> {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  return generateRangeReport(agents, txns, from, to, "EthioTrack — Weekly Report");
}

export function generateMonthlyReport(
  agents: Agent[],
  txns: Transaction[],
  year: number,
  month: number, // 1-12
): Promise<Blob> {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const monthName = from.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return generateRangeReport(agents, txns, from, to, `EthioTrack — Monthly Report · ${monthName}`);
}
