// Strict sanitized SMS fixture contract for the Float / EVD corpus.
//
// Design source: docs/float-evd-sms-corpus-design.md
// This module describes fixture *meaning* only. It never imports, invokes or
// depends on the production parser.

import { z } from "zod";

const nonEmpty = z.string().min(1);
const nonNegInt = z.number().int().nonnegative();

export const SmsFamily = z.enum(["float_distribution", "evd_receipt", "float_receipt"]);
export type SmsFamily = z.infer<typeof SmsFamily>;

export const SmsPlatformHint = z.enum(["mpesa", "evd_shortcode", "unknown"]);
export type SmsPlatformHint = z.infer<typeof SmsPlatformHint>;

export const SmsLanguage = z.enum(["en", "am"]);
export type SmsLanguage = z.infer<typeof SmsLanguage>;

export const SmsFixtureStatus = z.enum(["catalogued", "active", "retired"]);
export type SmsFixtureStatus = z.infer<typeof SmsFixtureStatus>;

export const SmsPrivacyStatus = z.enum(["sanitized", "metadata_only"]);
export type SmsPrivacyStatus = z.infer<typeof SmsPrivacyStatus>;

export const SmsEventKind = z.enum([
  "float_sent_to_agent",
  "evd_received_from_distributor",
  "float_received_from_distributor",
]);
export type SmsEventKind = z.infer<typeof SmsEventKind>;

export const SmsDirection = z.enum(["inbound", "outbound"]);
export type SmsDirection = z.infer<typeof SmsDirection>;

export const SmsDatePrecision = z.enum(["none", "date", "minute"]);
export type SmsDatePrecision = z.infer<typeof SmsDatePrecision>;

export const SmsDateSource = z.enum(["in_message", "sms_app", "user_selected", "absent"]);
export type SmsDateSource = z.infer<typeof SmsDateSource>;

export const SmsPairing = z.enum(["paired", "english_only", "amharic_only"]);
export type SmsPairing = z.infer<typeof SmsPairing>;

/** `pending` means a companion half is expected but absent or non-pairable. */
export const SmsPairingStatus = z.enum(["complete", "pending"]);
export type SmsPairingStatus = z.infer<typeof SmsPairingStatus>;

export const SmsCounterpartyMatch = z.enum(["unassigned", "exact"]);
export type SmsCounterpartyMatch = z.infer<typeof SmsCounterpartyMatch>;

export const SmsConfidence = z.enum(["high", "medium", "low"]);
export type SmsConfidence = z.infer<typeof SmsConfidence>;

export const SmsReviewReason = z.enum([
  "missing_amount",
  "ambiguous_direction",
  "missing_reference",
  "reference_mismatch",
  "missing_date",
  "ambiguous_counterparty",
  "code_conflict",
]);
export type SmsReviewReason = z.infer<typeof SmsReviewReason>;

export const SmsFieldEvidence = z
  .object({
    observedText: nonEmpty,
    confidence: SmsConfidence,
  })
  .strict();
export type SmsFieldEvidence = z.infer<typeof SmsFieldEvidence>;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SYNTHETIC_REFERENCE = /^SYN[0-9]{7}$/;
const SYNTHETIC_CODE = /^[0-9]{5}$/;

export const SmsExpectedEvent = z
  .object({
    sourceOrder: nonNegInt,
    eventKind: SmsEventKind,
    direction: SmsDirection,
    /** Signed santim. Outbound is negative, inbound is positive. */
    amountMinor: z
      .number()
      .int()
      .refine((v) => v !== 0, { message: "amountMinor cannot be zero" }),
    rawAmountText: nonEmpty,
    /** Informational only. Never usable as the transaction amount. */
    resultingBalanceMinor: z.number().int().positive().nullable(),
    rawBalanceText: z.string().min(1).nullable(),
    transactionReference: z.string().regex(SYNTHETIC_REFERENCE).nullable(),
    occurredAt: z.string().min(1).nullable(),
    datePrecision: SmsDatePrecision,
    dateSource: SmsDateSource,
    counterpartyLabel: z.string().min(1).nullable(),
    shopLabel: z.string().min(1).nullable(),
    counterpartyMatch: SmsCounterpartyMatch,
    senderCode: z.string().regex(SYNTHETIC_CODE).nullable(),
    recipientCode: z.string().regex(SYNTHETIC_CODE).nullable(),
    pairing: SmsPairing,
    pairingStatus: SmsPairingStatus,
    /** Sanitized Amharic evidence retained even when extraction is partial. */
    amharicEvidenceText: z.string().min(1).nullable(),
    evidence: z.record(SmsFieldEvidence),
  })
  .strict()
  .refine((e) => (e.direction === "outbound" ? e.amountMinor < 0 : e.amountMinor > 0), {
    message: "direction must agree with the sign of amountMinor",
  })
  .refine(
    (e) =>
      (e.eventKind === "float_sent_to_agent" && e.direction === "outbound") ||
      (e.eventKind !== "float_sent_to_agent" && e.direction === "inbound"),
    { message: "eventKind must agree with direction" },
  )
  .refine((e) => Math.abs(e.amountMinor) !== (e.resultingBalanceMinor ?? -1), {
    message: "resulting balance must never equal the transaction amount",
  })
  .refine((e) => (e.resultingBalanceMinor === null) === (e.rawBalanceText === null), {
    message: "rawBalanceText presence must agree with resultingBalanceMinor",
  })
  .refine(
    (e) => {
      if (e.datePrecision === "none") return e.occurredAt === null;
      if (e.occurredAt === null) return false;
      return e.datePrecision === "date"
        ? LOCAL_DATE.test(e.occurredAt)
        : LOCAL_MINUTE.test(e.occurredAt);
    },
    { message: "occurredAt must match the shape required by datePrecision" },
  )
  .refine((e) => (e.dateSource === "absent") === (e.datePrecision === "none"), {
    message: "dateSource must agree with datePrecision",
  })
  .refine((e) => !(e.dateSource === "user_selected" && e.datePrecision === "minute"), {
    message: "a user-selected date must never carry an invented time",
  })
  // Codes only exist where an Amharic half is present. They are never derived
  // from English text.
  .refine((e) => e.pairing !== "english_only" || (e.senderCode === null && e.recipientCode === null), {
    message: "english_only events must not carry sender or recipient codes",
  })
  .refine((e) => e.pairing !== "amharic_only" || e.counterpartyLabel === null, {
    message: "amharic_only events must not carry an English counterparty label",
  })
  .refine((e) => e.pairing !== "paired" || e.pairingStatus === "complete", {
    message: "paired events must be complete",
  })
  .refine((e) => e.pairing === "paired" || e.pairingStatus === "pending", {
    message: "unpaired halves remain pending",
  })
  .refine((e) => e.counterpartyMatch === "unassigned" || e.counterpartyLabel !== null, {
    message: "an exact counterparty match requires a label",
  })
  .refine((e) => e.pairing !== "amharic_only" || e.amharicEvidenceText !== null, {
    message: "amharic_only events must retain their Amharic evidence",
  });
export type SmsExpectedEvent = z.infer<typeof SmsExpectedEvent>;

export const SmsExpectedReview = z
  .object({
    sourceOrder: nonNegInt,
    reason: SmsReviewReason,
    observedText: nonEmpty,
  })
  .strict();
export type SmsExpectedReview = z.infer<typeof SmsExpectedReview>;

export const SmsGoldenExpectationSchema = z
  .object({
    schemaVersion: z.literal(1),
    fixtureId: nonEmpty,
    family: SmsFamily,
    platformHint: SmsPlatformHint,
    languageHalves: z.array(SmsLanguage).min(1),
    expectedEvents: z.array(SmsExpectedEvent).min(1),
    reviewRows: z.array(SmsExpectedReview),
    notes: z.array(nonEmpty),
  })
  .strict()
  .refine(
    (f) =>
      (f.family === "evd_receipt" && f.platformHint === "evd_shortcode") ||
      (f.family !== "evd_receipt" && f.platformHint === "mpesa"),
    { message: "platformHint must match family" },
  )
  .refine(
    (f) =>
      f.expectedEvents.every(
        (e) =>
          (f.family === "float_distribution" && e.eventKind === "float_sent_to_agent") ||
          (f.family === "evd_receipt" && e.eventKind === "evd_received_from_distributor") ||
          (f.family === "float_receipt" && e.eventKind === "float_received_from_distributor"),
      ),
    { message: "eventKind must match family" },
  )
  .refine((f) => f.expectedEvents.every((e, i) => e.sourceOrder === i), {
    message: "expectedEvents sourceOrder must be contiguous and zero-based",
  })
  .refine(
    (f) =>
      f.expectedEvents.every((e) => e.pairing === "english_only" || f.languageHalves.includes("am")),
    { message: "code-bearing events require an Amharic half in languageHalves" },
  );
export type SmsGoldenExpectation = z.infer<typeof SmsGoldenExpectationSchema>;

export const SmsFixtureCatalogEntry = z
  .object({
    id: nonEmpty,
    family: SmsFamily,
    platformHint: SmsPlatformHint,
    languageHalves: z.array(SmsLanguage).min(1),
    status: SmsFixtureStatus,
    privacyStatus: SmsPrivacyStatus,
    expected: z
      .object({
        eventCount: nonNegInt,
        reviewRowCount: nonNegInt,
      })
      .strict(),
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
export type SmsFixtureCatalogEntry = z.infer<typeof SmsFixtureCatalogEntry>;

export const SmsFixtureCatalog = z.array(SmsFixtureCatalogEntry);
export type SmsFixtureCatalog = z.infer<typeof SmsFixtureCatalog>;