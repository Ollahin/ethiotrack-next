import { exportBackup, importBackup, type Backup } from "./db";

export async function downloadJsonBackup() {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  triggerDownload(
    blob,
    `ethiotrack-backup-${new Date().toISOString().slice(0, 10)}.json`,
  );
}

export async function downloadCsv() {
  const b = await exportBackup();
  const rows: string[][] = [
    ["date", "type", "amount_etb", "party", "party_type", "channel", "reference", "note", "is_personal", "is_settled", "source"],
    ...b.transactions.map((t) => [
      t.date, t.type, (t.amountSantim / 100).toFixed(2),
      t.partyName, t.partyType ?? "", t.channel,
      t.reference ?? "", t.note ?? "",
      t.isPersonal ? "yes" : "", t.isSettled ? "yes" : "", t.source,
    ]),
  ];
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  triggerDownload(
    new Blob([csv], { type: "text/csv" }),
    `ethiotrack-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

function csvCell(v: string): string {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function importFromFile(file: File): Promise<number> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Backup;
  await importBackup(parsed);
  return parsed.transactions?.length ?? 0;
}

function triggerDownload(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
}