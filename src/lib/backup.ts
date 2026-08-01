import { accountIsEmpty, BackupImportError, exportBackup, importBackup } from "./db";
import { BACKUP_VERSION, parseBackupText } from "./backup-format";

export async function downloadJsonBackup() {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  triggerDownload(
    blob,
    `ethiotrack-backup-v${BACKUP_VERSION}-${new Date().toISOString().slice(0, 10)}.json`,
  );
}

export async function downloadCsv() {
  const b = await exportBackup();
  const rows: string[][] = [
    [
      "date",
      "type",
      "amount_etb",
      "party",
      "party_type",
      "channel",
      "reference",
      "note",
      "is_personal",
      "is_settled",
      "source",
    ],
    ...b.transactions.map((t) => [
      t.date,
      t.type,
      (t.amountSantim / 100).toFixed(2),
      t.partyName,
      t.partyType ?? "",
      t.channel,
      t.reference ?? "",
      t.note ?? "",
      t.isPersonal ? "yes" : "",
      t.isSettled ? "yes" : "",
      t.source,
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

export interface RestoreResult {
  transactions: number;
  agents: number;
  distributors: number;
  migratedFromVersion?: number;
}

export class RestoreError extends Error {
  readonly errors: string[];
  /** True when the file is valid but the account must be replaced explicitly. */
  readonly needsReplaceConfirmation: boolean;
  constructor(errors: string[], needsReplaceConfirmation = false) {
    super(errors[0] ?? "Backup could not be restored");
    this.name = "RestoreError";
    this.errors = errors;
    this.needsReplaceConfirmation = needsReplaceConfirmation;
  }
}

/**
 * Validate a backup file and, when allowed, replace the whole device account
 * with it. Nothing is written unless validation passes end to end.
 */
export async function importFromFile(
  file: File,
  opts: { replaceExisting?: boolean } = {},
): Promise<RestoreResult> {
  const validation = parseBackupText(await file.text());
  if (!validation.ok) throw new RestoreError(validation.errors);

  if (!opts.replaceExisting && !(await accountIsEmpty())) {
    throw new RestoreError(
      ["This device account already holds data. Importing replaces all of it."],
      true,
    );
  }

  try {
    await importBackup(validation.backup, { replaceExisting: true });
  } catch (e) {
    if (e instanceof BackupImportError) throw new RestoreError(e.errors);
    throw e;
  }
  const r: RestoreResult = {
    transactions: validation.backup.transactions.length,
    agents: validation.backup.agents.length,
    distributors: validation.backup.distributors.length,
  };
  return validation.migratedFromVersion
    ? { ...r, migratedFromVersion: validation.migratedFromVersion }
    : r;
}

function triggerDownload(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
}
