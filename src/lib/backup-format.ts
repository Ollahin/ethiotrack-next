/**
 * Versioned, validated EthioTrack backup format.
 *
 * Pure module: no Dexie, no DOM. It defines the on-disk shape, validates and
 * migrates incoming files, and proves referential integrity before anything is
 * written to a device account. Nothing here mutates the caller's input.
 */
import { z } from "zod";
import type {
  Agent,
  Bank,
  DailyClosing,
  DailyOpening,
  Distributor,
  FulfillmentEntry,
  PeriodClosing,
  PeriodOpening,
  SettlementAllocation,
  StatementImport,
  Transaction,
  SharedInput,
} from "./types";
import type { ApprovedMapping } from "./approved-mappings";
import { familyOf } from "./approved-mappings";

export const BACKUP_APP = "ethiotrack" as const;
export const BACKUP_VERSION = 5 as const;
/** Older formats we still accept and migrate forward. */
export const SUPPORTED_BACKUP_VERSIONS = [2, 3, 4, 5] as const;

/**
 * Credentials never travel in a backup. A backup file is portable, so shipping
 * a PIN hash or a paid license record inside it would let the file act as an
 * entitlement transfer. These meta keys stay on the device that owns them.
 */
export const CREDENTIAL_META_KEYS = ["daily_pin_v1", "master_pin_v1", "auth_lockout_v1"] as const;

export function isCredentialMetaKey(key: string): boolean {
  return (CREDENTIAL_META_KEYS as readonly string[]).includes(key);
}

/** Statement imports keep the raw screenshot; JSON needs it base64-encoded. */
export type SerializedStatementImport = Omit<StatementImport, "rawImage"> & {
  rawImageBase64?: string;
  rawImageType?: string;
};

/** Pending shared inputs travel too; their Blob is base64 in JSON. */
export type SerializedSharedInput = Omit<SharedInput, "blob"> & {
  blobBase64?: string;
  blobType?: string;
};

export interface BackupSetting {
  key: string;
  value: unknown;
}

export interface BackupCounts {
  agents: number;
  distributors: number;
  banks: number;
  dailyOpenings: number;
  dailyClosings: number;
  periodOpenings: number;
  periodClosings: number;
  transactions: number;
  statementImports: number;
  fulfillments: number;
  approvedMappings: number;
  sharedInputs: number;
  settings: number;
}

export interface BackupV5 {
  app: typeof BACKUP_APP;
  version: 5;
  exportedAt: string;
  settings: BackupSetting[];
  agents: Agent[];
  distributors: Distributor[];
  banks: Bank[];
  dailyOpenings: DailyOpening[];
  dailyClosings: DailyClosing[];
  periodOpenings: PeriodOpening[];
  periodClosings: PeriodClosing[];
  transactions: Transaction[];
  statementImports: SerializedStatementImport[];
  fulfillments: FulfillmentEntry[];
  /**
   * Human-approved counterparty mappings. They are review shortcuts, not
   * financial records: restoring them never changes a saved transaction.
   */
  approvedMappings: ApprovedMapping[];
  /**
   * Inbox items that were shared but not yet imported or dismissed. They are
   * queue state, not financial history: restoring them re-offers the same
   * review, it never books a row.
   */
  sharedInputs: SerializedSharedInput[];
  /**
   * Explicit agent settlement allocations. They are financial records: a
   * restore must reproduce the same outstanding balances exactly.
   */
  settlementAllocations?: SettlementAllocation[];
  counts: BackupCounts;
}

/** Alias kept so existing call sites keep compiling against "the current format". */
export type BackupV4 = BackupV5;

/** Previous format: identical minus the pending shared-input queue. */
export type BackupV3 = Omit<
  BackupV5,
  "version" | "approvedMappings" | "sharedInputs" | "counts"
> & {
  version: 3;
  counts: Omit<BackupCounts, "approvedMappings" | "sharedInputs">;
};

/** Legacy v2 backup, as written by earlier builds. */
export interface BackupV2 {
  version: 2;
  exportedAt: string;
  agents: Agent[];
  distributors: Distributor[];
  banks: Bank[];
  dailyOpenings: DailyOpening[];
  dailyClosings: DailyClosing[];
  periodOpenings?: PeriodOpening[];
  periodClosings?: PeriodClosing[];
  transactions: Transaction[];
  statementImports: StatementImport[];
  fulfillments?: FulfillmentEntry[];
}

// -- zod schemas -------------------------------------------------------------

const idString = z.string().min(1);
const santim = z.number().int();

const agentSchema = z
  .object({
    id: idString,
    name: z.string(),
    phone: z.string().optional(),
    creditLimitSantim: santim.optional(),
    createdAt: z.string(),
  })
  .passthrough();

const distributorSchema = z
  .object({
    id: idString,
    name: z.string(),
    contact: z.string().optional(),
    statementFormat: z.string().optional(),
    telecoms: z.array(z.string()).optional(),
    forms: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    accountTails: z.array(z.string()).optional(),
    createdAt: z.string(),
  })
  .passthrough();

const bankSchema = z
  .object({
    id: idString,
    name: z.string(),
    accountNumber: z.string().optional(),
    channel: z.string(),
    openingBalanceSantim: santim,
    createdAt: z.string(),
  })
  .passthrough();

const dailyOpeningSchema = z
  .object({ id: idString, date: z.string(), openedAt: z.string() })
  .passthrough();
const dailyClosingSchema = z
  .object({ id: idString, date: z.string(), openingId: idString, closedAt: z.string() })
  .passthrough();
const periodOpeningSchema = z
  .object({ id: idString, weekStart: z.string(), weekEnd: z.string(), openedAt: z.string() })
  .passthrough();
const periodClosingSchema = z
  .object({
    id: idString,
    weekStart: z.string(),
    weekEnd: z.string(),
    openingId: idString,
    closedAt: z.string(),
  })
  .passthrough();

const transactionSchema = z
  .object({
    id: idString,
    type: z.enum(["in", "out", "airtime_evd", "airtime_float", "expense", "personal"]),
    amountSantim: santim,
    partyId: idString.optional(),
    partyType: z.enum(["agent", "distributor", "bank", "other"]).optional(),
    partyName: z.string(),
    channel: z.string(),
    bankId: idString.optional(),
    distributorId: idString.optional(),
    reference: z.string().optional(),
    note: z.string().optional(),
    telecom: z.enum(["ethiotelecom", "safaricom"]).optional(),
    airtimeDirection: z.enum(["sent", "received"]).optional(),
    isReversal: z.boolean().optional(),
    overrideReason: z.string().optional(),
    principalSantim: santim.optional(),
    dateIsDayOnly: z.boolean().optional(),
    isPersonal: z.boolean().optional(),
    isSettled: z.boolean().optional(),
    settledAt: z.string().optional(),
    needsReview: z.boolean().optional(),
    settlesTxnIds: z.array(idString).optional(),
    source: z.string(),
    statementImportId: idString.optional(),
    date: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

const statementImportSchema = z
  .object({
    id: idString,
    distributorId: idString.optional(),
    fileName: z.string(),
    rowCount: z.number().int(),
    totalSantim: santim,
    importedAt: z.string(),
    rawText: z.string(),
    sourceKind: z.enum(["pdf", "image", "sms"]).optional(),
    ocrConfidence: z.number().optional(),
    status: z.enum(["pending", "parsed", "empty", "failed"]).optional(),
    orientation: z.number().optional(),
    layout: z.string().optional(),
    parseError: z.string().optional(),
    rawImageBase64: z.string().optional(),
    rawImageType: z.string().optional(),
  })
  .passthrough();

const fulfillmentSchema = z
  .object({
    id: idString,
    intentTxnId: idString,
    kind: z.enum(["receipt", "adjustment", "exception"]),
    amountSantim: santim,
    surplusSantim: santim.optional(),
    surplusClassification: z.string().optional(),
    action: z.string().optional(),
    note: z.string().optional(),
    correctsEntryId: idString.optional(),
    recordedAt: z.string(),
  })
  .passthrough();

const settingSchema = z.object({ key: z.string().min(1), value: z.unknown() });

const approvedMappingSchema = z
  .object({
    id: idString,
    label: z.string(),
    normalizedLabel: z.string().min(1),
    targetType: z.enum(["agent", "distributor", "bank"]),
    targetId: idString,
    targetName: z.string(),
    approvedAt: z.string(),
    lastUsedAt: z.string().optional(),
    useCount: z.number().int().nonnegative(),
    sourceFamily: z
      .enum(["bank_message", "airtime_sms", "distributor_statement", "manual"])
      .optional(),
  })
  .passthrough();

const sharedInputSchema = z
  .object({
    id: idString,
    receivedAt: z.string(),
    kind: z.enum(["text", "image", "pdf", "unsupported"]),
    seq: z.number().int().nonnegative().optional(),
    origin: z.enum(["paste", "clipboard", "share"]).optional(),
    title: z.string().optional(),
    text: z.string().optional(),
    fileName: z.string().optional(),
    fileType: z.string().optional(),
    status: z.enum(["pending", "reviewed", "dismissed"]),
    reviewedAt: z.string().optional(),
    decisions: z
      .object({
        bankId: z.string().nullable().optional(),
        agentId: z.string().nullable().optional(),
        distributorId: z.string().nullable().optional(),
        purpose: z.string().optional(),
        day: z.string().optional(),
        time: z.string().optional(),
        correctedDay: z.string().optional(),
        correctionConfirmed: z.boolean().optional(),
        recipientConfirmed: z.boolean().optional(),
        duplicateAcknowledged: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    blobBase64: z.string().optional(),
    blobType: z.string().optional(),
  })
  .passthrough();

const countsSchema = z.object({
  agents: z.number().int().nonnegative(),
  distributors: z.number().int().nonnegative(),
  banks: z.number().int().nonnegative(),
  dailyOpenings: z.number().int().nonnegative(),
  dailyClosings: z.number().int().nonnegative(),
  periodOpenings: z.number().int().nonnegative(),
  periodClosings: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
  statementImports: z.number().int().nonnegative(),
  fulfillments: z.number().int().nonnegative(),
  approvedMappings: z.number().int().nonnegative(),
  sharedInputs: z.number().int().nonnegative(),
  settings: z.number().int().nonnegative(),
});

const backupV5Schema = z.object({
  app: z.literal(BACKUP_APP),
  version: z.literal(5),
  exportedAt: z.string().min(1),
  settings: z.array(settingSchema),
  agents: z.array(agentSchema),
  distributors: z.array(distributorSchema),
  banks: z.array(bankSchema),
  dailyOpenings: z.array(dailyOpeningSchema),
  dailyClosings: z.array(dailyClosingSchema),
  periodOpenings: z.array(periodOpeningSchema),
  periodClosings: z.array(periodClosingSchema),
  transactions: z.array(transactionSchema),
  statementImports: z.array(statementImportSchema),
  fulfillments: z.array(fulfillmentSchema),
  approvedMappings: z.array(approvedMappingSchema),
  sharedInputs: z.array(sharedInputSchema),
  settlementAllocations: z
    .array(
      z
        .object({
          id: idString,
          paymentTxnId: idString,
          creditTxnId: idString,
          agentId: idString,
          amountSantim: santim,
          createdAt: z.string(),
        })
        .passthrough(),
    )
    .optional(),
  counts: countsSchema,
});

const backupV4Schema = z.object({
  app: z.literal(BACKUP_APP),
  version: z.literal(4),
  exportedAt: z.string().min(1),
  settings: z.array(settingSchema),
  agents: z.array(agentSchema),
  distributors: z.array(distributorSchema),
  banks: z.array(bankSchema),
  dailyOpenings: z.array(dailyOpeningSchema),
  dailyClosings: z.array(dailyClosingSchema),
  periodOpenings: z.array(periodOpeningSchema),
  periodClosings: z.array(periodClosingSchema),
  transactions: z.array(transactionSchema),
  statementImports: z.array(statementImportSchema),
  fulfillments: z.array(fulfillmentSchema),
  approvedMappings: z.array(approvedMappingSchema),
  counts: countsSchema.omit({ sharedInputs: true }),
});

const backupV3Schema = z.object({
  app: z.literal(BACKUP_APP),
  version: z.literal(3),
  exportedAt: z.string().min(1),
  settings: z.array(settingSchema),
  agents: z.array(agentSchema),
  distributors: z.array(distributorSchema),
  banks: z.array(bankSchema),
  dailyOpenings: z.array(dailyOpeningSchema),
  dailyClosings: z.array(dailyClosingSchema),
  periodOpenings: z.array(periodOpeningSchema),
  periodClosings: z.array(periodClosingSchema),
  transactions: z.array(transactionSchema),
  statementImports: z.array(statementImportSchema),
  fulfillments: z.array(fulfillmentSchema),
  counts: countsSchema.omit({ approvedMappings: true, sharedInputs: true }),
});

const backupV2Schema = z.object({
  version: z.literal(2),
  exportedAt: z.string().min(1),
  agents: z.array(agentSchema).optional(),
  distributors: z.array(distributorSchema).optional(),
  banks: z.array(bankSchema).optional(),
  dailyOpenings: z.array(dailyOpeningSchema).optional(),
  dailyClosings: z.array(dailyClosingSchema).optional(),
  periodOpenings: z.array(periodOpeningSchema).optional(),
  periodClosings: z.array(periodClosingSchema).optional(),
  transactions: z.array(transactionSchema).optional(),
  statementImports: z.array(statementImportSchema).optional(),
  fulfillments: z.array(fulfillmentSchema).optional(),
});

// -- counts ------------------------------------------------------------------

export function countsOf(b: Omit<BackupV4, "counts">): BackupCounts {
  return {
    agents: b.agents.length,
    distributors: b.distributors.length,
    banks: b.banks.length,
    dailyOpenings: b.dailyOpenings.length,
    dailyClosings: b.dailyClosings.length,
    periodOpenings: b.periodOpenings.length,
    periodClosings: b.periodClosings.length,
    transactions: b.transactions.length,
    statementImports: b.statementImports.length,
    fulfillments: b.fulfillments.length,
    approvedMappings: b.approvedMappings.length,
    sharedInputs: b.sharedInputs.length,
    settings: b.settings.length,
  };
}

// -- validation --------------------------------------------------------------

export type BackupValidation =
  | { ok: true; backup: BackupV4; migratedFromVersion?: number }
  | { ok: false; errors: string[] };

function duplicateIds(rows: { id: string }[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) dupes.add(r.id);
    seen.add(r.id);
  }
  return [...dupes];
}

/**
 * Structural + referential validation. Every dangling id is reported: a backup
 * whose histories cannot be rebuilt must never be applied silently.
 */
export function checkIntegrity(b: BackupV4): string[] {
  const errors: string[] = [];

  const tables: [string, { id: string }[]][] = [
    ["agents", b.agents],
    ["distributors", b.distributors],
    ["banks", b.banks],
    ["dailyOpenings", b.dailyOpenings],
    ["dailyClosings", b.dailyClosings],
    ["periodOpenings", b.periodOpenings],
    ["periodClosings", b.periodClosings],
    ["transactions", b.transactions],
    ["statementImports", b.statementImports],
    ["fulfillments", b.fulfillments],
  ];
  for (const [name, rows] of tables) {
    const dupes = duplicateIds(rows);
    if (dupes.length) errors.push(`${name}: duplicate id(s) ${dupes.join(", ")}`);
  }

  const settingKeys = new Set<string>();
  for (const s of b.settings) {
    if (settingKeys.has(s.key)) errors.push(`settings: duplicate key ${s.key}`);
    settingKeys.add(s.key);
    if (isCredentialMetaKey(s.key)) {
      errors.push(`settings: credential key ${s.key} is not portable`);
    }
  }

  const declared = countsOf(b);
  for (const key of Object.keys(declared) as (keyof BackupCounts)[]) {
    if (b.counts[key] !== declared[key]) {
      errors.push(`counts.${key} says ${b.counts[key]} but file holds ${declared[key]}`);
    }
  }

  const agentIds = new Set(b.agents.map((a) => a.id));
  const distIds = new Set(b.distributors.map((d) => d.id));
  const bankIds = new Set(b.banks.map((x) => x.id));
  const importIds = new Set(b.statementImports.map((s) => s.id));
  const txnIds = new Set(b.transactions.map((t) => t.id));
  const fulfilmentIds = new Set(b.fulfillments.map((f) => f.id));
  const dailyOpeningIds = new Set(b.dailyOpenings.map((o) => o.id));
  const periodOpeningIds = new Set(b.periodOpenings.map((o) => o.id));

  for (const t of b.transactions) {
    if (t.partyId) {
      const pool =
        t.partyType === "agent"
          ? agentIds
          : t.partyType === "distributor"
            ? distIds
            : t.partyType === "bank"
              ? bankIds
              : new Set([...agentIds, ...distIds, ...bankIds]);
      if (!pool.has(t.partyId)) {
        errors.push(
          `transaction ${t.id}: partyId ${t.partyId} has no matching ${t.partyType ?? "entity"}`,
        );
      }
    }
    if (t.bankId && !bankIds.has(t.bankId)) {
      errors.push(`transaction ${t.id}: bankId ${t.bankId} has no matching bank`);
    }
    if (t.distributorId && !distIds.has(t.distributorId)) {
      errors.push(
        `transaction ${t.id}: distributorId ${t.distributorId} has no matching distributor`,
      );
    }
    if (t.statementImportId && !importIds.has(t.statementImportId)) {
      errors.push(
        `transaction ${t.id}: statementImportId ${t.statementImportId} has no matching import`,
      );
    }
    for (const settled of t.settlesTxnIds ?? []) {
      if (!txnIds.has(settled)) {
        errors.push(`transaction ${t.id}: settlesTxnIds references missing transaction ${settled}`);
      }
    }
  }

  for (const s of b.statementImports) {
    if (s.distributorId && !distIds.has(s.distributorId)) {
      errors.push(
        `statement import ${s.id}: distributorId ${s.distributorId} has no matching distributor`,
      );
    }
  }

  for (const f of b.fulfillments) {
    if (!txnIds.has(f.intentTxnId)) {
      errors.push(`fulfillment ${f.id}: intentTxnId ${f.intentTxnId} has no matching transaction`);
    }
    if (f.correctsEntryId && !fulfilmentIds.has(f.correctsEntryId)) {
      errors.push(
        `fulfillment ${f.id}: correctsEntryId ${f.correctsEntryId} has no matching entry`,
      );
    }
  }

  for (const c of b.dailyClosings) {
    if (!dailyOpeningIds.has(c.openingId)) {
      errors.push(`daily closing ${c.id}: openingId ${c.openingId} has no matching opening`);
    }
  }
  for (const c of b.periodClosings) {
    if (!periodOpeningIds.has(c.openingId)) {
      errors.push(`period closing ${c.id}: openingId ${c.openingId} has no matching opening`);
    }
  }

  // Approved mappings must point at entities the backup actually restores,
  // otherwise a restored mapping would pre-select a non-existent counterparty.
  const mappingKeys = new Set<string>();
  for (const m of b.approvedMappings) {
    const pool =
      m.targetType === "agent" ? agentIds : m.targetType === "distributor" ? distIds : bankIds;
    if (!pool.has(m.targetId)) {
      errors.push(
        `approved mapping ${m.id}: targetId ${m.targetId} has no matching ${m.targetType}`,
      );
    }
    const key = `${familyOf(m)}::${m.targetType}::${m.normalizedLabel}`;
    if (mappingKeys.has(key)) {
      errors.push(
        `approved mappings: duplicate ${familyOf(m)} ${m.targetType} label "${m.normalizedLabel}"`,
      );
    }
    mappingKeys.add(key);
  }

  return errors;
}

function migrateV2(v2: z.infer<typeof backupV2Schema>): BackupV4 {
  const body: Omit<BackupV4, "counts"> = {
    app: BACKUP_APP,
    version: 5,
    exportedAt: v2.exportedAt,
    settings: [],
    agents: (v2.agents ?? []) as unknown as Agent[],
    distributors: (v2.distributors ?? []) as unknown as Distributor[],
    banks: (v2.banks ?? []) as unknown as Bank[],
    dailyOpenings: (v2.dailyOpenings ?? []) as unknown as DailyOpening[],
    dailyClosings: (v2.dailyClosings ?? []) as unknown as DailyClosing[],
    periodOpenings: (v2.periodOpenings ?? []) as unknown as PeriodOpening[],
    periodClosings: (v2.periodClosings ?? []) as unknown as PeriodClosing[],
    transactions: (v2.transactions ?? []) as unknown as Transaction[],
    statementImports: (v2.statementImports ?? []) as unknown as SerializedStatementImport[],
    fulfillments: (v2.fulfillments ?? []) as unknown as FulfillmentEntry[],
    approvedMappings: [],
    sharedInputs: [],
  };
  return { ...body, counts: countsOf(body) };
}

/** v3 → v5: neither mappings nor a shared inbox existed yet. */
function migrateV3(v3: z.infer<typeof backupV3Schema>): BackupV4 {
  const body: Omit<BackupV4, "counts"> = {
    ...(v3 as unknown as Omit<
      BackupV4,
      "counts" | "version" | "approvedMappings" | "sharedInputs"
    >),
    version: 5,
    approvedMappings: [],
    sharedInputs: [],
  };
  return { ...body, counts: countsOf(body) };
}

/** v4 → v5: the shared inbox was not part of a backup yet. */
function migrateV4(v4: z.infer<typeof backupV4Schema>): BackupV4 {
  const body: Omit<BackupV4, "counts"> = {
    ...(v4 as unknown as Omit<BackupV4, "counts" | "version" | "sharedInputs">),
    version: 5,
    sharedInputs: [],
  };
  return { ...body, counts: countsOf(body) };
}

function issueMessages(err: z.ZodError): string[] {
  return err.issues.slice(0, 25).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** Validate an untrusted parsed JSON value and migrate it to the current format. */
export function validateBackup(raw: unknown): BackupValidation {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["Backup file is not a JSON object."] };
  }
  const version = (raw as { version?: unknown }).version;
  if (typeof version !== "number") {
    return { ok: false, errors: ["Backup file has no numeric `version` field."] };
  }
  if (!(SUPPORTED_BACKUP_VERSIONS as readonly number[]).includes(version)) {
    return {
      ok: false,
      errors: [
        `Backup format version ${version} is not supported by this build (supported: ${SUPPORTED_BACKUP_VERSIONS.join(", ")}).`,
      ],
    };
  }

  let backup: BackupV4;
  let migratedFromVersion: number | undefined;
  if (version === 5) {
    const parsed = backupV5Schema.safeParse(raw);
    if (!parsed.success) return { ok: false, errors: issueMessages(parsed.error) };
    backup = parsed.data as unknown as BackupV4;
  } else if (version === 4) {
    const parsed = backupV4Schema.safeParse(raw);
    if (!parsed.success) return { ok: false, errors: issueMessages(parsed.error) };
    backup = migrateV4(parsed.data);
    migratedFromVersion = 4;
  } else if (version === 3) {
    const parsed = backupV3Schema.safeParse(raw);
    if (!parsed.success) return { ok: false, errors: issueMessages(parsed.error) };
    backup = migrateV3(parsed.data);
    migratedFromVersion = 3;
  } else {
    const parsed = backupV2Schema.safeParse(raw);
    if (!parsed.success) return { ok: false, errors: issueMessages(parsed.error) };
    backup = migrateV2(parsed.data);
    migratedFromVersion = 2;
  }

  const errors = checkIntegrity(backup);
  if (errors.length) return { ok: false, errors };
  return migratedFromVersion ? { ok: true, backup, migratedFromVersion } : { ok: true, backup };
}

/** Parse raw file text into a validated backup. */
export function parseBackupText(text: string): BackupValidation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["File is not valid JSON."] };
  }
  return validateBackup(raw);
}

// -- blob <-> base64 ---------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
