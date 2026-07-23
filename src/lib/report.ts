import jsPDF from "jspdf";
import { formatEtb } from "./format";
import type { Agent, Transaction } from "./types";
import { computeAgentStats } from "./brain/stats";

export function generateWeeklyReport(
  agents: Agent[],
  txns: Transaction[],
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const week = txns.filter((t) => new Date(t.date) >= weekAgo);
  const sum = (t: Transaction[], type: Transaction["type"]) =>
    t.filter((x) => x.type === type).reduce((s, x) => s + x.amountSantim, 0);

  let y = 48;
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("EthioTrack — Weekly Report", 40, y); y += 20;
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  doc.text(`${weekAgo.toISOString().slice(0,10)} → ${now.toISOString().slice(0,10)}`, 40, y);
  y += 24;

  doc.setFont("helvetica", "bold"); doc.text("Summary", 40, y); y += 16;
  doc.setFont("helvetica", "normal");
  const line = (k: string, v: string) => {
    doc.text(k, 40, y); doc.text(v, 320, y, { align: "right" }); y += 14;
  };
  line("Airtime distributed — EVD", formatEtb(sum(week, "airtime_evd")));
  line("Airtime distributed — Float", formatEtb(sum(week, "airtime_float")));
  line("Cash collected (Money In)", formatEtb(sum(week, "in")));
  line("Cash paid (Money Out)", formatEtb(sum(week, "out")));
  line("Expenses", formatEtb(sum(week, "expense")));
  const net = sum(week, "in") - sum(week, "out") - sum(week, "expense");
  line("Net", formatEtb(net));
  y += 12;

  doc.setFont("helvetica", "bold"); doc.text("Aged Receivables", 40, y); y += 14;
  doc.setFont("helvetica", "normal");
  const rows: Array<[string, string, string]> = [];
  for (const a of agents) {
    const s = computeAgentStats(a, txns);
    if (s.openCreditSantim > 0) {
      rows.push([a.name, formatEtb(s.openCreditSantim), s.oldestOpenCreditDays ? `${s.oldestOpenCreditDays}d` : "—"]);
    }
  }
  if (!rows.length) {
    doc.text("(No open credits — all agents settled.)", 40, y);
  } else {
    for (const r of rows) {
      if (y > 780) { doc.addPage(); y = 48; }
      doc.text(r[0], 40, y);
      doc.text(r[1], 320, y, { align: "right" });
      doc.text(r[2], 380, y);
      y += 14;
    }
  }
  return doc.output("blob");
}