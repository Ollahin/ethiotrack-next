import { z } from "zod";

export const InputKind = z.enum(["ocr_screenshot", "ocr_text", "sms_text"]);
export type InputKind = z.infer<typeof InputKind>;

export const SourceFamily = z.enum([
  "mj_transfers_sent",
  "refill_history",
  "cbe",
  "bank_of_abyssinia",
  "telebirr",
  "cooperative_bank",
  "coop_ebirr",
  "dashen",
]);
export type SourceFamily = z.infer<typeof SourceFamily>;

export const PlatformHint = z.enum(["mj", "yunus_or_alami", "unknown"]);
export type PlatformHint = z.infer<typeof PlatformHint>;

export const FixtureStatus = z.enum(["catalogued", "active", "retired"]);
export type FixtureStatus = z.infer<typeof FixtureStatus>;

export const PrivacyStatus = z.enum(["sanitized", "metadata_only"]);
export type PrivacyStatus = z.infer<typeof PrivacyStatus>;

const nonEmpty = z.string().min(1);
const nonNegInt = z.number().int().nonnegative();

export const ExpectedCounts = z
  .object({
    completeRowCount: nonNegInt,
    partialRowCount: nonNegInt,
    reversalRowCount: nonNegInt,
  })
  .strict()
  .refine((v) => v.reversalRowCount <= v.completeRowCount, {
    message: "reversalRowCount cannot exceed completeRowCount",
  });
export type ExpectedCounts = z.infer<typeof ExpectedCounts>;

export const CurrentBaseline = z
  .object({
    parsedRowCount: nonNegInt,
  })
  .strict();
export type CurrentBaseline = z.infer<typeof CurrentBaseline>;

export const FixtureCatalogEntry = z
  .object({
    id: nonEmpty,
    sourceFileName: nonEmpty,
    inputKind: InputKind,
    sourceFamily: SourceFamily,
    platformHint: PlatformHint,
    status: FixtureStatus,
    privacyStatus: PrivacyStatus,
    currentOcrConfidence: z.number().min(0).max(1).optional(),
    expected: ExpectedCounts,
    currentBaseline: CurrentBaseline,
    tags: z.array(nonEmpty),
    notes: z.string().optional(),
    rawFixturePath: nonEmpty.optional(),
    expectedFixturePath: nonEmpty.optional(),
  })
  .strict()
  .refine(
    (e) =>
      e.status !== "active" ||
      (typeof e.rawFixturePath === "string" && typeof e.expectedFixturePath === "string"),
    { message: "active status requires rawFixturePath and expectedFixturePath" },
  );
export type FixtureCatalogEntry = z.infer<typeof FixtureCatalogEntry>;

export const FixtureCatalog = z.array(FixtureCatalogEntry);
export type FixtureCatalog = z.infer<typeof FixtureCatalog>;

// ── Sanitized golden OCR expectations ──────────────────────────────────────

export const DatePrecision = z.enum(["unknown", "day", "minute", "second"]);
export type DatePrecision = z.infer<typeof DatePrecision>;

export const ExpectedEventKind = z.enum(["evd_sent_to_agent", "evd_reversal"]);
export type ExpectedEventKind = z.infer<typeof ExpectedEventKind>;

export const AgentResolution = z.enum([
  "unassigned",
  "existing_agent",
  "create_agent",
  "explicit_alias",
]);
export type AgentResolution = z.infer<typeof AgentResolution>;

export const AmountPrefixDisposition = z.enum(["ocr_noise", "confirmed_reversal"]);
export type AmountPrefixDisposition = z.infer<typeof AmountPrefixDisposition>;

/**
 * Records punctuation observed immediately around an amount in flattened OCR
 * and how the human-authored golden fixture interpreted it. It does NOT
 * authorize the production parser to guess a sign without evidence.
 */
export const AmountEvidence = z
  .object({
    observedText: nonEmpty,
    prefixDisposition: AmountPrefixDisposition,
  })
  .strict();
export type AmountEvidence = z.infer<typeof AmountEvidence>;

export const ExpectedOcrRow = z
  .object({
    sourceOrder: nonNegInt,
    agentText: nonEmpty,
    rawAmountText: nonEmpty,
    signedAmountMinor: z
      .number()
      .int()
      .refine((v) => v !== 0, {
        message: "signedAmountMinor cannot be zero",
      }),
    isReversal: z.boolean(),
    eventKind: ExpectedEventKind,
    date: z.string().min(1).nullable(),
    datePrecision: DatePrecision,
    agentResolution: AgentResolution,
    amountEvidence: AmountEvidence.optional(),
  })
  .strict()
  .refine((r) => (r.isReversal ? r.signedAmountMinor < 0 : r.signedAmountMinor > 0), {
    message: "isReversal must agree with the sign of signedAmountMinor",
  })
  .refine((r) => (r.eventKind === "evd_reversal" ? r.isReversal : !r.isReversal), {
    message: "eventKind must agree with isReversal",
  })
  .refine((r) => (r.datePrecision === "unknown" ? r.date === null : r.date !== null), {
    message: "datePrecision must agree with date presence",
  })
  .refine(
    (r) =>
      r.amountEvidence?.prefixDisposition !== "ocr_noise" ||
      (r.signedAmountMinor > 0 && !r.isReversal && r.eventKind === "evd_sent_to_agent"),
    {
      message:
        "ocr_noise requires a positive, non-reversal evd_sent_to_agent row",
    },
  )
  .refine(
    (r) =>
      r.amountEvidence?.prefixDisposition !== "confirmed_reversal" ||
      (r.signedAmountMinor < 0 && r.isReversal && r.eventKind === "evd_reversal"),
    {
      message: "confirmed_reversal requires a negative evd_reversal row",
    },
  );
export type ExpectedOcrRow = z.infer<typeof ExpectedOcrRow>;

export const GoldenOcrExpectationSchema = z
  .object({
    schemaVersion: z.literal(1),
    fixtureId: nonEmpty,
    sourceFamily: z.literal("mj_transfers_sent"),
    platformHint: z.literal("mj"),
    expectedRows: z.array(ExpectedOcrRow).min(1),
    forbiddenAgentCandidates: z.array(nonEmpty),
    expectedWarnings: z.array(nonEmpty),
  })
  .strict();
export type GoldenOcrExpectation = z.infer<typeof GoldenOcrExpectationSchema>;
