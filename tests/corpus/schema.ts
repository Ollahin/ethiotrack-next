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
