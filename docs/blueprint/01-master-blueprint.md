# EthioTrack Production Blueprint

**Document ID:** ET-BP-001  
**Version:** 1.0  
**Status:** Approved design baseline; implementation has not started  
**Prepared:** 28 July 2026  
**Active source branch:** `ethiotrack-next2.0`  
**Planned implementation branch:** `production-v3`  
**Repository:** `Ollahin/ethiotrack-next`  
**Primary deployment target:** Vercel or Netlify free tier  
**Operating model:** Single-device, local-first, offline-capable PWA

---

## 1. Purpose of this blueprint

This document is the authoritative product and architecture blueprint for EthioTrack. It consolidates the repository review, raw-data investigation, parser/OCR findings, business rules, design decisions, target architecture, migration constraints, delivery standards, and unresolved decisions.

A developer or implementation agent should be able to continue the project by reading this document, the companion parser/corpus specification, the execution playbook, and the repository. No previous conversation is required.

The blueprint is intentionally explicit. Where the current application and the target product differ, the difference is stated. Where a decision is not final, it is labelled as proposed or open rather than silently assumed.

---

## 2. Product north star

EthioTrack is an offline-first financial and EVD-airtime operations ledger for Ethiopian telecom subdistributors.

Its central purpose is not merely to record transactions. It must prevent operational money loss by connecting these events:

1. Money leaves a subdistributor's bank or wallet account.
2. The beneficiary is a configured airtime distributor.
3. The principal payment creates an expectation that the same value of EVD will arrive.
4. If the EVD is not confirmed within 15 minutes, the payment becomes overdue and visible as money at risk.
5. The user manually records the actual EVD received.
6. Payments and receipts are reconciled, including partial, combined, surplus, disputed, refunded, personal, and unmatched cases.
7. EVD sent to agents reduces platform inventory and increases the agent's EVD/credit position.
8. MJ reversals are retained as signed negative EVD movements and reduce the agent's net EVD received.

The product succeeds when the user can answer, quickly and confidently:

- How much money came in and went out?
- How much was actually debited, including bank charges?
- How much EVD was expected from each distributor?
- Which payments are still awaiting EVD?
- How much EVD was received, sold to agents, reversed, and remains in inventory?
- How much does each agent owe or have outstanding?
- Which records are uncertain, duplicated, incomplete, or require review?
- Can the data still be recovered if the browser closes or the device goes offline?

---

## 3. Primary user and operating environment

### 3.1 Primary user

The initial user is an owner-operator or employee of an Ethiopian telecom airtime subdistribution business. The user purchases EVD from upstream distributors and transfers EVD to downstream agents.

### 3.2 Device and account model

- One account is intended for one device in the first production release.
- User data is stored locally on that device.
- Cross-device synchronization is out of scope.
- Account transfer or recovery relies on versioned export/import backups.
- A local PIN already exists and is used to unlock the app and confirm destructive data deletion.
- Security hardening is not the current delivery priority, but current behavior must not be broken during the core rebuild.

### 3.3 Expected environment

- Android phones are the main target.
- SMS sources include Samsung Messages, Truecaller, and other built-in Android SMS applications.
- Internet may be intermittent.
- The app must work after an initial online installation and first-time asset download.
- English OCR is required. Amharic OCR is explicitly out of scope for now.
- Target screenshot OCR processing time is no more than 5 seconds per image on a typical Android phone.

---

## 4. Scope

### 4.1 In scope for the production rebuild

- Device-local profile and PIN gate.
- Manual transaction entry.
- SMS ingestion by paste, Android share target, and timestamped export file.
- Bank and mobile-money parsing for the supported source families.
- Screenshot OCR for MJ Transfers/Sent and Yunus/Alami Refill History layouts.
- Review-before-save for all parsed/OCR imports.
- Strict agent identity resolution.
- Distributor recognition through configured exact names, confirmed aliases, and account tails.
- Bank principal, charges, and final debit breakdown.
- Automatic airtime-purchase classification for configured distributor payments, unless marked Personal.
- Fifteen-minute EVD fulfillment tracking.
- Manual EVD receipt confirmation and many-to-many reconciliation.
- Platform-specific and overall EVD inventory.
- EVD sent-to-agent and reversal events.
- Agent history, net EVD, credit, and settlement views.
- Local notifications and browser notifications where supported.
- Offline PWA behavior, persisted ingestion queue, backup and recovery.
- Auditable corrections and non-destructive financial history.
- Corpus-based regression testing, mutation testing, and CI.

### 4.2 Explicitly out of scope for the first production release

- Cloud accounts, server authentication, or cloud sync.
- Multiple devices per account.
- Multi-user concurrent editing.
- Direct reading of the Android SMS database.
- Becoming the default Android SMS application.
- Amharic OCR.
- Automatic fuzzy consolidation of agent names.
- Fully automatic EVD receipt detection from distributor systems.
- Automatic classification of bonus, commission, or loan without user confirmation.
- A backend database unless later required for licensing, sync, or shared operations.

---

## 5. Canonical terminology

| Term | Definition |
|---|---|
| Subdistributor | The EthioTrack user/business purchasing airtime from upstream distributors and sending it to agents. |
| Distributor | An upstream supplier of EVD/float, identified by configured names, aliases, contacts, or bank account tails. |
| Agent | A downstream recipient of EVD airtime. |
| EVD | Electronic Voucher Distribution airtime value. |
| Principal | The amount transferred to a distributor before service charges, VAT, or other bank charges. |
| Final debit | Total reduction from the bank balance, including principal and all charges. |
| Expected EVD | EVD expected from a distributor payment; normally equal to the principal. |
| EVD receipt | The actual EVD value confirmed as received from a distributor. |
| Fulfillment | Allocation of EVD receipts against one or more distributor payments. |
| Reversal | Negative MJ EVD movement that reverses all or part of an earlier transfer to an agent. |
| Personal | An outgoing bank transaction that must not create an expected EVD obligation. |
| Evidence | Original SMS, shared payload, image, PDF, OCR output, or import file retained as provenance. |
| Candidate | A parser/OCR result not yet committed as a confirmed ledger event. |

---

## 6. Locked business decisions

The following are authoritative unless changed through a documented architecture decision.

### ADR-001 — Single-device local-first release

The first production release is single-device. Data remains in IndexedDB. No cloud synchronization is required.

### ADR-002 — Hosting and PWA

The web shell will be hosted on Vercel or Netlify. The installed PWA must cache the application shell, local fonts, required static assets, and OCR runtime/model assets so that the application works offline after initial setup.

### ADR-003 — EVD screenshot layouts

- `Transfers → Sent` is the MJ layout.
- `Refill History` is used by Yunus and Alami.
- Both layouts represent EVD airtime movements and create `airtime_evd`-equivalent domain events.
- Yunus versus Alami cannot reliably be inferred from layout alone; the user selects the platform for the import batch.

### ADR-004 — Distributor platform list

Supported platform labels initially include:

- MJ
- Yunus
- Alami
- Tilanesh
- Moderntech Safaricom
- Other
- Not specified

Platform is metadata. Agent identity and transaction meaning do not depend on broad platform inference.

### ADR-005 — MJ reversal semantics

- Negative values in MJ Transfers/Sent are reversals.
- A reversal is stored as an immutable negative EVD movement.
- It reduces the agent's MJ-specific EVD total and the agent's overall net EVD.
- It restores MJ platform inventory.
- The user confirms the reversal during review.
- No PIN is required.
- If the reversal would exceed the recorded MJ balance, block normal confirmation; allow an explicit override only after a second warning and a required explanation.
- The app may suggest possible earlier positive movements but must not silently link a reversal to one.

### ADR-006 — Agent-name matching

Automatic linking is strict. The only automatic normalization allowed is:

- Trim leading and trailing whitespace.
- Collapse repeated internal whitespace.
- Compare case-insensitively.

Spelling variants are not automatically merged. For example, `SampleY` and `SampleZ`, or `SampleMA` and `SampleMB`, remain separate until the user decides.

For an unrecognized name, the user chooses:

- Link to an existing agent.
- Create a new agent.
- Leave unassigned.

The detected name remains editable.

### ADR-007 — Distributor recognition

Distributor recognition uses:

1. Exact normalized account tail.
2. Exact normalized official name.
3. Explicitly approved alias.
4. User confirmation.

No broad fuzzy matching is permitted.

Known configuration example:

- Platform: Moderntech Safaricom
- Beneficiary/legal name: Moderntech Technologies PLC
- Recognized aliases: Gutema Edao, Nuri Edao
- Known CBE account tail: 4278
- The no-space variant `ModerntechTechnologies PLC` may be retained as an approved normalized alias if encountered.

### ADR-008 — Bank debit accounting

For outgoing bank transactions:

- Store principal, service charge, VAT, other charges, and total final debit separately.
- Cash-out uses the final debit.
- Expected EVD uses the principal.
- The parser must not confuse the current balance, fee, VAT, or total with the principal.

### ADR-009 — Default airtime-purchase classification

When an outgoing bank transaction matches a configured distributor name or account, classify it as an airtime purchase by default.

The existing Personal toggle overrides this behavior:

- Personal transactions remain bank cash-out.
- Personal transactions do not create expected EVD.
- Personal transactions are excluded from airtime fulfillment alerts.

### ADR-010 — EVD fulfillment deadline

A distributor payment becomes overdue 15 minutes after the payment time if it has not been fully fulfilled.

Notification behavior:

- Always show an in-app alert/badge.
- Also send a browser notification when the installed browser/device supports it and the user has granted permission.

### ADR-011 — Manual EVD receipt confirmation

Actual EVD received is entered manually. The user is asked whether the EVD arrived and enters:

- Actual amount received.
- Received date/time.
- Distributor.
- Optional note.

This is intentionally manual because the number of large EVD receipts is low and manual confirmation is less confusing than an overly complex automatic detector.

### ADR-012 — Many-to-many reconciliation

Support all of the following:

- One bank payment fulfilled by several EVD receipts.
- Several bank payments fulfilled by one EVD receipt.
- Partial fulfillment.
- Unmatched manual EVD receipts.
- Excess EVD.

### ADR-013 — Partial and excess fulfillment

- A partial receipt changes status to `partially_fulfilled` and leaves the remainder outstanding.
- Excess EVD defaults to `unexplained_surplus`.
- The user may classify the surplus as bonus, commission, or loan to be settled by a later transaction.

### ADR-014 — Disputes and corrections

A pending airtime purchase may later be marked:

- Disputed.
- Cancelled/refunded.
- Incorrectly classified.
- Personal.

After the 15-minute deadline, changing the purpose/status requires a note.

### ADR-015 — Inventory

Confirmed EVD receipts increase platform-specific inventory. EVD sent to agents reduces the selected platform's inventory. MJ reversals restore MJ inventory.

The app shows:

- Inventory by platform.
- Overall EVD inventory across all platforms.
- Agent EVD by platform.
- Overall agent net EVD after reversals.

### ADR-016 — Date precision

Do not invent time information.

- When an exact timestamp is available, store an instant.
- When only a date is available, store the day and `datePrecision = day`.
- When no source date exists, use the original SMS timestamp if available or require a user-selected date/time.
- Never silently present import time as the transaction time.

### ADR-017 — Import review

Every screenshot import and every uncertain text import must display a review table before saving. At minimum:

- Agent/party.
- Signed amount.
- Date/time and precision.
- Distributor/platform.
- Confidence and warnings.
- Completeness.
- Duplicate/overlap warning.
- Include/exclude control.

### ADR-018 — Partial rows and overlapping screenshots

- Partially visible screenshot rows are shown as incomplete candidates.
- They are unselected for saving by default.
- Separate screenshots are not automatically joined.
- Overlap detection compares sequences of consecutive rows and proposes probable duplicates.
- A single repeated party/amount/date is never removed automatically.

### ADR-019 — Data preservation during ingestion

Raw input must be saved to a durable local ingestion inbox before OCR or parsing begins. Each image and OCR result is persisted independently so that closing the app or a parser crash does not lose data.

The initial recommended screenshot selection cap is 3 images per selection, processed sequentially. The user may add more after each group is safely queued. This cap may be changed only after Android memory/performance tests.

### ADR-020 — SMS acquisition

Supported SMS acquisition paths:

1. Share selected text from Samsung Messages, Truecaller, or another Android SMS app to the installed EthioTrack PWA.
2. Import a timestamped SMS export file.
3. Paste copied messages manually.
4. Upload a screenshot when text sharing is not available.

A normal PWA will not read the entire SMS inbox.

---

## 7. Current repository architecture

### 7.1 Current technology stack

Verified from the `ethiotrack-next2.0` branch:

- React 19.
- TanStack Router and TanStack Start.
- Vite 8.
- TypeScript 5.8 in strict mode.
- Tailwind CSS 4 and Radix-based UI components.
- Dexie 4 / IndexedDB.
- Zod.
- Tesseract.js 7 for browser OCR.
- PDF.js for PDF extraction.
- Vitest.
- Recharts.
- Nitro beta server runtime through the Lovable TanStack configuration.

Current package scripts include development, build, preview, lint, format, tests, and a Python responsive visual test. There is no dedicated `typecheck`, `format:check`, or complete `verify` script in the current package file.

### 7.2 Current high-level scaffold

The following is a verified high-level map, not a byte-for-byte file listing:

```text
src/
  components/
    AppShell.tsx
    LockGate.tsx
    PasteImport.tsx
    StatementImport.tsx
    TransactionForm.tsx
    DashboardTiles.tsx
    WeekBreakdown.tsx
    OpenPeriodModal.tsx
    GlobalSearch.tsx
    LicenseStatus.tsx
    LicenseExpiryBanner.tsx
    ui/
      Radix/shadcn-style reusable controls

  lib/
    types.ts
    db.ts
    parser.ts
    ocr-parser.ts
    distributor-parser.ts
    ocr.ts
    pdf-parser.ts
    format.ts
    ids.ts
    crypto.ts
    user.ts
    lovable-error-reporting.ts
    error-capture.ts
    error-page.ts
    brain/
      fuzzy.ts
      credits.ts
      stats.ts
      alerts.ts
      other analysis helpers

  routes/
    __root.tsx
    index.tsx
    account.tsx
    agents.tsx
    alerts.tsx
    banks.tsx
    capture.tsx
    close.tsx
    distributors.tsx
    exports.tsx
    history.tsx
    reconcile.tsx
    reports.tsx
    settings.tsx
    unlock.tsx

  routeTree.gen.ts
  router.tsx
  server.ts
  styles.css

public/
  favicon.ico
```

No `manifest.webmanifest`, `manifest.json`, `sw.js`, or `service-worker.js` was found at the standard public paths during the branch review.

### 7.3 Current route responsibilities

| Route | Current purpose |
|---|---|
| `/` | Weekly dashboard, opening state, cash-flow summary, quick actions. |
| `/capture` | Paste SMS, upload PDF/image statement, or manually enter a transaction. |
| `/agents` | Agent list, open credit, FIFO settlement, transaction history. |
| `/distributors` | Distributor registration, telecom/form tags, statement format. |
| `/banks` | Local bank/account setup. |
| `/history` | Transaction history and filters. |
| `/reconcile` | Weekly cash, bank, EVD, and float physical-balance reconciliation. |
| `/alerts` | Brain-generated operational alerts. |
| `/reports` | Business reports. |
| `/exports` | Backup/export/import functions. |
| `/close` | Weekly close workflow. |
| `/settings` | App settings. |
| `/account` | Profile, PIN/master PIN, license, destructive data clear. |
| `/unlock` | Owner/master setup, license renewal, daily PIN setup and unlock. |

### 7.4 Current data model

The current `Transaction` is a broad flat record with:

- `type`: `in`, `out`, `airtime_evd`, `airtime_float`, `expense`, `personal`.
- One `amountSantim`.
- Optional agent/distributor/bank links.
- Party name, channel, note, reference.
- Personal flag.
- Boolean settlement fields.
- One ISO `date`.
- Parser review flag.
- Source and statement import ID.

This model is useful for a prototype, but it cannot safely represent the full production workflows without accumulating ambiguous optional fields.

### 7.5 Current ingestion paths

#### Pasted text

`PasteImport` calls `parseMany`, enriches rows with fuzzy agent matches, can auto-register banks/agents/distributors, defaults missing dates to the current time, applies a global Personal toggle, writes transactions, and automatically settles agent credit FIFO.

#### Screenshot/PDF

`StatementImport`:

- Runs Tesseract for images or PDF.js for PDFs.
- Detects a statement template.
- Uses fuzzy agent matching.
- Automatically creates unmatched alphabetic agent names during commit.
- Writes the current time as the transaction date instead of preserving row date precision.
- Stores extracted raw text and overall OCR confidence, but not the source image or bounding-box OCR structure.

### 7.6 Current OCR/parser organization

Parsing is split across three overlapping modules:

- `parser.ts`: high-precision SMS templates, generic rules, batch splitting, and a Transfers/Sent OCR fallback.
- `ocr-parser.ts`: date-anchor OCR parsing for distributor refill and bank transfer text.
- `distributor-parser.ts`: statement-template detection and per-format row parsers.

This overlap makes parser dispatch and behavior difficult to reason about. There are two separate Sent-transfer OCR approaches with different assumptions.

### 7.7 Current persistence

The current Dexie database is named `ethiotrack`. It contains agents, distributors, banks, daily and weekly openings/closings, transactions, statement imports, and metadata.

Current characteristics:

- Four schema versions.
- A migration that splits aggregate EVD/float stock evenly across all registered distributors when detailed historical allocation is absent.
- Active records limited to 90 days in the default reactive query.
- Archive band from 90 to 180 days.
- A function that permanently deletes transactions and imports older than 180 days.
- Hard transaction deletion.
- Duplicate detection based on reference or type + amount + lowercased party + channel within 10 minutes.
- Backup version 2 imported directly into tables without a comprehensive runtime schema at the import boundary.

### 7.8 Current account and license behavior

The app has:

- A master PIN.
- A daily user PIN.
- Local lockout behavior after failed attempts.
- A 30-day license renewal flow driven by the master PIN.
- Local profile fields.
- PIN confirmation before destructive data deletion.

The product owner has stated that parser, OCR, and reconciliation are the current priority. Licensing and deeper security are not allowed to derail the core rebuild. The current account behavior should therefore be isolated and preserved until an explicit product decision is made.

---

## 8. Current-state strengths

The project should not be discarded entirely. Valuable assets include:

- A coherent mobile-first UI shell.
- Working TanStack routes and navigation.
- Useful agent, bank, distributor, dashboard, capture, history, and reconciliation interfaces.
- Local Dexie persistence.
- Existing account/PIN gate.
- A Personal toggle already present in the SMS capture workflow.
- Tesseract and PDF dependencies already integrated.
- A large SMS corpus and an annotated screenshot corpus.
- Strict TypeScript enabled.
- Existing parser, credit, statistics, and alert tests that can be preserved as baseline evidence.

---

## 9. Current-state critical gaps

### 9.1 Financial model gaps

- One amount cannot distinguish principal, fees, VAT, other charges, and final debit.
- Airtime purchase expectation and fulfillment are not first-class entities.
- Many-to-many payment/receipt allocation is absent.
- Partial fulfillment and surplus classification are absent.
- EVD receipts are not modeled independently.
- Signed reversals are not a dedicated event.
- Date precision is lost.
- Hard deletion and in-place update weaken auditability.

### 9.2 Parser/OCR gaps

- OCR returns only flattened text and overall confidence.
- Layout relationships are discarded.
- Current MJ recall is materially below the required threshold.
- Negative signs and reversal semantics can be lost.
- UI artifacts can become agent names.
- Account-holder text can be mistaken for the agent.
- Date-anchor parsing fails when OCR misses dates.
- Fuzzy matching links unauthorized spelling variants.
- Unknown names may be auto-created without an explicit user decision.

### 9.3 Data-integrity gaps

- Even stock migration invents distributor allocation.
- Old financial records may be purged.
- Hard deletion removes audit history.
- Deduplication can suppress legitimate repeated EVD movements.
- Missing dates may become import time.
- Backup import is insufficiently validated.

### 9.4 Offline/PWA gaps

- No standard manifest or service worker file was found.
- OCR worker/language assets are fetched on first use.
- Google Fonts are loaded externally.
- No Android share-target ingestion path exists.
- Raw import evidence is not persisted before processing.

### 9.5 Engineering-control gaps

- No dedicated type-check script.
- No verified CI workflow in the inspected branch.
- No corpus evaluator.
- No mutation/fuzz test harness.
- TypeScript allows unused locals/parameters and skips library checking.
- Route generation file is excluded through `@ts-nocheck`, which is normal for generated code, but generated code should be excluded from general formatting/lint tooling rather than manually edited.

---

## 10. Target architecture principles

1. **Evidence first:** Preserve original input before interpretation.
2. **Abstain rather than invent:** Uncertain data goes to review.
3. **Immutable financial events:** Corrections append or void; they do not erase history.
4. **Explicit money roles:** Principal, fee, VAT, other charge, final debit, expected EVD, and actual EVD are separate.
5. **Domain logic independent of React and Dexie:** Business calculations remain testable without the UI or database.
6. **Strict identity linking:** Exact normalized matching and approved aliases only.
7. **Layout-aware OCR:** Coordinates and confidence are part of the parser input.
8. **Safe local persistence:** Every processing stage survives reload or interruption.
9. **Projection-based balances:** Inventory, agent net EVD, and reconciliation are calculated from confirmed immutable events.
10. **Corpus-gated releases:** Parser/OCR changes cannot ship if corpus metrics regress.
11. **Progressive migration:** New tables and modules are added beside legacy data; legacy code is removed only after verified migration.
12. **Offline by design:** No core workflow depends on a live network after installation.

---

## 11. Target scaffold

```text
src/
  app/
    router.tsx
    routeTree.gen.ts
    AppShell.tsx
    providers/
    routes/

  domain/
    money/
      Money.ts
      BankAmountBreakdown.ts
    dates/
      Occurrence.ts
    ledger/
      LedgerEvent.ts
      projections.ts
    agents/
      Agent.ts
      AgentAlias.ts
      agentBalance.ts
    distributors/
      Distributor.ts
      DistributorAlias.ts
      DistributorAccount.ts
    inventory/
      EvdMovement.ts
      inventoryProjection.ts
    reconciliation/
      EvdPurchase.ts
      EvdReceipt.ts
      EvdAllocation.ts
      fulfillment.ts
    ingestion/
      Evidence.ts
      IngestionJob.ts
      ParsedCandidate.ts
      confidence.ts

  application/
    use-cases/
      captureBankSms.ts
      importScreenshot.ts
      confirmCandidates.ts
      confirmEvdReceipt.ts
      allocateReceipt.ts
      recordEvdReversal.ts
      voidEvent.ts
    ports/
      repositories.ts
      ocr.ts
      notifications.ts
      clock.ts

  infrastructure/
    database/
      EthioTrackDatabase.ts
      schema.ts
      repositories/
      migrations/
      validation/
    ocr/
      tesseractWorker.ts
      imagePreprocessor.ts
      layoutExtractor.ts
    parsers/
      registry.ts
      sms/
      screenshot/
      pdf/
    pwa/
      serviceWorker.ts
      shareTarget.ts
      install.ts
    notifications/
      browserNotifications.ts
      inAppNotifications.ts
    backup/
      backupSchema.ts
      exportBackup.ts
      importBackup.ts

  features/
    capture/
    ingestion-inbox/
    review-import/
    dashboard/
    agents/
    distributors/
    purchases/
    receipts/
    inventory/
    reconciliation/
    history/
    alerts/
    account/

  shared/
    components/
    formatting/
    validation/
    errors/
    testing/

tests/
  fixtures/
    sms/
    screenshots/
    ocr-text/
  corpus/
  unit/
  integration/
  e2e/

docs/
  blueprint/
  decisions/
  runbooks/
```

This scaffold may be adapted to TanStack file-route constraints, but domain and infrastructure boundaries must remain.

---

## 12. Target domain model

### 12.1 Money

All stored monetary values use integer santim.

```ts
type Santim = number;

interface BankAmountBreakdown {
  principalSantim: Santim;
  serviceChargeSantim: Santim;
  vatSantim: Santim;
  otherChargeSantim: Santim;
  totalDebitSantim: Santim;
}
```

Validation invariant for ordinary outgoing bank messages:

```text
totalDebit ≈ principal + serviceCharge + vat + otherCharge
```

If the bank message is internally inconsistent, preserve all extracted values and require review.

### 12.2 Occurrence and date precision

```ts
type DatePrecision = "instant" | "day" | "unknown";

interface Occurrence {
  occurredAt?: string;  // UTC ISO instant
  occurredOn?: string;  // YYYY-MM-DD
  precision: DatePrecision;
  sourceTimezone?: string;
}
```

### 12.3 Evidence

```ts
interface Evidence {
  id: string;
  kind: "sms_share" | "sms_export" | "paste" | "image" | "pdf" | "manual";
  originalText?: string;
  originalBlobId?: string;
  sourceFileName?: string;
  receivedAt: string;
  sourceApplication?: string;
  contentHash: string;
  parserVersion?: string;
  ocrEngine?: string;
  ocrVersion?: string;
}
```

### 12.4 Bank transaction

```ts
interface BankTransactionEvent {
  id: string;
  kind: "bank_in" | "bank_out";
  bankId?: string;
  partyName?: string;
  distributorId?: string;
  reference?: string;
  accountTail?: string;
  amount: BankAmountBreakdown;
  purpose: "airtime_purchase" | "personal" | "other" | "unknown";
  occurrence: Occurrence;
  evidenceId?: string;
  status: "draft" | "confirmed" | "needs_review" | "voided";
}
```

For `bank_in`, the amount structure may use principal and total as the same amount when no fees exist.

### 12.5 EVD purchase

```ts
interface EvdPurchase {
  id: string;
  bankEventId: string;
  distributorId: string;
  expectedSantim: number;
  deadlineAt: string;
  status:
    | "pending"
    | "partially_fulfilled"
    | "fulfilled"
    | "overdue"
    | "disputed"
    | "cancelled"
    | "refunded"
    | "not_applicable";
  note?: string;
}
```

### 12.6 EVD receipt and allocation

```ts
interface EvdReceipt {
  id: string;
  distributorId: string;
  amountSantim: number;
  occurrence: Occurrence;
  source: "manual" | "future_import";
  status: "confirmed" | "needs_review" | "voided";
  surplusClassification?: "unexplained" | "bonus" | "commission" | "loan";
  note?: string;
}

interface EvdAllocation {
  id: string;
  purchaseId: string;
  receiptId: string;
  allocatedSantim: number;
  createdAt: string;
}
```

### 12.7 Agent EVD movement

```ts
interface AgentEvdMovement {
  id: string;
  kind: "evd_sent" | "evd_reversal";
  signedAmountSantim: number;
  agentId?: string;
  detectedAgentName: string;
  distributorPlatformId?: string;
  occurrence: Occurrence;
  evidenceId?: string;
  status: "draft" | "confirmed" | "needs_review" | "voided";
  reversalReason?: string;
  relatedMovementId?: string;
}
```

Rules:

- Sent is positive.
- Reversal is negative.
- The signed value is preserved exactly.
- The relationship to an earlier transfer is optional and user-confirmed.

### 12.8 Audit entry

```ts
interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: "created" | "confirmed" | "edited_metadata" | "voided" | "restored";
  before?: unknown;
  after?: unknown;
  reason?: string;
  createdAt: string;
}
```

Core financial values should not be silently overwritten. A correction should create a replacement/adjustment or void the prior event with an audit reason.

---

## 13. Core workflows

### 13.1 Bank SMS to pending EVD purchase

```text
SMS share / export / paste
  → raw evidence saved
  → source profile detected
  → principal, fees, total, party, reference, account, date extracted
  → configured distributor matched strictly
  → review screen
  → Personal toggle may override
  → bank event confirmed
  → if airtime purchase: create EVD purchase with 15-minute deadline
  → in-app timer/alert
  → browser notification when supported
```

### 13.2 Manual EVD receipt and reconciliation

```text
Open pending purchases
  → user confirms EVD arrived
  → enter actual amount and time
  → select one or more pending payments
  → allocation suggestion (oldest compatible payments first)
  → user confirms allocations
  → statuses recomputed
  → inventory increases
  → surplus remains unexplained until classified
```

### 13.3 Screenshot EVD import

```text
Select up to the safe batch limit
  → save each original image locally
  → preprocess image
  → OCR words/lines with coordinates
  → detect layout profile
  → reconstruct visual rows
  → persist OCR and candidates
  → overlap/partial-row analysis
  → strict agent resolution
  → user review
  → confirm signed movements
  → update platform inventory and agent projections
```

### 13.4 MJ reversal

```text
Negative MJ candidate
  → resolve agent
  → calculate agent MJ net EVD
  → show before/reversal/after
  → if after >= 0: normal confirmation
  → if after < 0: block normal confirmation
       → show second warning
       → require explanation
       → user explicitly overrides or cancels
  → save immutable negative movement
```

### 13.5 Agent payment and credit settlement

The existing FIFO settlement concept may be preserved, but the production model should use explicit allocations rather than only `isSettled` booleans. Partial payments must be representable without marking an entire credit event settled prematurely.

---

## 14. Accounting and projection rules

### 14.1 Cash and bank

```text
Outgoing bank cash effect = -totalDebitSantim
Incoming bank cash effect = +received amount
Personal transactions still affect cash/bank
Personal transactions do not affect EVD expectation
```

### 14.2 EVD purchase obligation

```text
Expected EVD = principal amount sent to distributor
Outstanding = expected - total allocated receipt amount
```

### 14.3 Platform inventory

```text
Platform EVD inventory
= opening inventory
+ confirmed EVD receipts
+ positive inventory adjustments
- EVD sent to agents
+ absolute value of confirmed reversals
- negative inventory adjustments
```

A reversal is a negative agent movement, so it increases available platform inventory.

### 14.4 Agent net EVD

```text
Agent platform net EVD = sum of signed agent EVD movements for that platform
Agent overall net EVD = sum across all platforms
```

### 14.5 Profit/bonus/commission analytics

The system records the facts first. Bonus, commission, and loan classifications are separate metadata/ledger decisions. The exact profit formula should be finalized during the reporting phase, based on purchased EVD, sold EVD, cash collected, and classified surplus.

---

## 15. Identity rules

### 15.1 Agent identity

Store:

- Canonical registered name.
- Optional exact approved aliases added only through user confirmation.
- Phone if available.
- Normalized comparison key.

No Levenshtein, substring, or broad fuzzy matching may automatically link an OCR name.

### 15.2 Distributor identity

Store:

- Display/platform name.
- Legal/beneficiary names.
- Confirmed aliases.
- Account tails by bank.
- Contact numbers.
- Supported telecom and airtime form.
- Statement layout family.

Distributor payment matching should explain which signal matched.

---

## 16. Deduplication and overlap policy

Priority order:

1. Exact bank reference or receipt identifier.
2. Exact normalized full SMS content hash.
3. Exact source row ID/timestamp when available.
4. Exact evidence fingerprint.
5. Multi-row screenshot overlap sequence.
6. User review for uncertain duplicates.

Never use only `party + amount + day` or `party + amount + ten-minute window` for EVD screenshot rows.

Every duplicate decision should retain:

- Candidate ID.
- Existing event ID.
- Detection method.
- Confidence.
- User action.

---

## 17. Offline/PWA target

### 17.1 Installation and cache

The service worker should precache:

- App shell.
- Route bundles required for capture/review/history.
- Local fonts.
- Icons and manifest.
- OCR worker and English model assets.
- Static validation/configuration assets.

Generated exports and raw financial files must not be placed in a public precache.

### 17.2 Share target

The PWA manifest should register a text share target. Shared SMS text is posted to a dedicated route/service-worker handler, stored in the ingestion inbox, and then opened in review.

Original SMS timestamp may not be available from every SMS app. Timestamp priority is:

1. Timestamp embedded in the shared/exported payload.
2. Timestamp in the imported SMS export.
3. User-selected date/time.

### 17.3 Update safety

- Persist all unsaved ingestion jobs before activating a new service worker.
- Show an update-available prompt.
- Do not force reload in the middle of OCR/review.
- Test database migration and offline launch together.

---

## 18. Target user experience

### 18.1 Capture hub

Provide clear entry points:

- Share/import SMS.
- Paste SMS/text.
- Upload screenshot.
- Import timestamped SMS file.
- Manual bank transaction.
- Manual EVD receipt.
- Manual agent EVD movement.

### 18.2 Ingestion inbox

Every captured item has:

- Saved/processing/ready/failed/committed status.
- Original evidence.
- Retry without data loss.
- Parser/OCR version.
- Candidate count.
- Warnings.

### 18.3 Review table

Rows are editable. Uncertain values are highlighted at field level. Partial rows remain visible. No uncertain record is committed silently.

### 18.4 Dashboard

Primary production dashboard cards:

- Pending EVD amount.
- Overdue EVD amount.
- Partially fulfilled amount.
- Today's EVD received.
- EVD inventory by platform.
- Total EVD sent to agents.
- Reversals.
- Open agent credit.
- Unmatched receipts.
- Unexplained surplus.

### 18.5 Distributor purchase view

Show each bank payment with:

- Principal.
- Charges.
- Final debit.
- Expected EVD.
- Received/allocated EVD.
- Outstanding.
- Deadline/status.
- Personal/disputed/refunded controls.
- Evidence and audit history.

---

## 19. Persistence and migration strategy

### 19.1 Non-destructive approach

Do not rewrite the legacy schema in place at the start. Add new versioned tables beside existing tables.

Suggested new tables:

- `evidence`
- `ingestionJobs`
- `parsedCandidates`
- `bankEvents`
- `evdPurchases`
- `evdReceipts`
- `evdAllocations`
- `agentEvdMovements`
- `creditAllocations`
- `auditEntries`
- `notifications`
- `migrationReports`

### 19.2 Legacy migration rules

- Never split an aggregate opening balance evenly across distributors.
- If historical allocation is unknown, keep it as `unallocated opening inventory` and require a user-assisted allocation later.
- Do not delete or modify legacy rows until migration validation is complete.
- Preserve original legacy IDs.
- Every migrated row receives a migration provenance record.
- Ambiguous data becomes `needs_review`, not invented data.
- Remove the 180-day purge behavior for financial history.
- Replace hard deletion with void/correction workflows.

### 19.3 Backup

The new backup envelope must include:

- Product format identifier.
- Schema version.
- Export timestamp.
- App version.
- All current and legacy tables needed for rollback.
- Optional evidence blobs or a clear evidence-exclusion flag.
- Integrity hash/manifest.

Import must validate fully before applying and must be atomic.

---

## 20. Performance requirements

| Requirement | Target |
|---|---:|
| OCR processing, one standard screenshot | ≤ 5 seconds on a typical Android phone after first load |
| Capture-to-durable-inbox write | < 500 ms for text; immediate before parsing |
| Review table responsiveness | Smooth with at least 100 candidates |
| Local history | Designed for multi-year records; no 180-day deletion |
| Dashboard projections | Incremental/indexed; avoid loading every record for every render |
| Screenshot selection | Initial recommended cap: 3 per selection, sequential processing |
| Offline launch | Core shell opens without network after install |

OCR performance should be measured using real Android devices, not desktop-only benchmarks.

---

## 21. Quality and release gates

The production rebuild cannot be considered ready until:

- Typecheck, lint, format check, tests, and production build pass in CI.
- Parser corpus gates pass.
- No unsupported fuzzy agent links occur.
- Signed reversal accuracy is 100% on the golden corpus.
- Bank principal/fee/total roles pass all fixture tests.
- Database migration is tested from every legacy schema version.
- Backup restore is verified on a clean browser profile.
- Core app works offline after install.
- Shared SMS payload is not lost on app restart.
- Browser notification fallback behavior is tested.
- Accessibility smoke tests pass.
- Vercel and Netlify deployments are both tested, or one is formally selected.

---

## 22. Keep, replace, remove

| Area | Action | Reason |
|---|---|---|
| React/TanStack UI shell | Keep | Good existing mobile foundation. |
| TanStack routes | Keep and evolve | Existing route inventory is useful. |
| Radix/Tailwind components | Keep | Reusable and production-suitable with accessibility review. |
| Dexie | Keep | Appropriate for device-local offline data. |
| Current flat Transaction model | Replace progressively | Cannot represent required accounting/reconciliation safely. |
| `parser.ts`, `ocr-parser.ts`, `distributor-parser.ts` | Replace behind new parser registry, then retire | Overlap and behavior drift. |
| Tesseract dependency | Keep, reconfigure | Needs coordinates, worker reuse, offline assets, preprocessing. |
| Fuzzy auto-linking | Remove from automatic decisions | Conflicts with strict identity rules. |
| FIFO credit concept | Keep concept; replace boolean implementation | Partial allocation and auditability are needed. |
| Personal toggle | Keep and integrate | Core business override. |
| Current weekly reconciliation UI | Reuse visual ideas; replace domain logic | Does not model purchase fulfillment. |
| Automatic old-record purge | Remove | Financial history must persist. |
| Even stock split migration | Remove/replace | Invents historical data. |
| Hard transaction deletion | Replace with void/correction | Preserve audit history. |
| Current PIN/profile | Preserve during core rebuild | Not current priority; avoid regressions. |
| Prototype monthly license gate | Isolate; product decision required | Separate from core ledger architecture. |

---

## 23. Open decisions

These are not blockers for establishing the core architecture, but must be resolved before final release:

1. Whether the prototype 30-day master-PIN license system remains in production.
2. Exact profit and commission reporting formula.
3. Final safe screenshot batch cap after Android testing.
4. Backup evidence-blob inclusion policy and maximum backup size.
5. Whether Tilanesh and Moderntech Safaricom have screenshot layouts requiring dedicated OCR profiles.
6. Final Vercel versus Netlify production choice.
7. Long-term approach to encrypted backups.
8. Whether cloud sync becomes a later paid feature.

---

## 24. Source and evidence register

### Repository snapshot

Branch reviewed: `ethiotrack-next2.0`, 28 July 2026.

Key files reviewed:

- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `eslint.config.js`
- `src/routeTree.gen.ts`
- `src/routes/__root.tsx`
- `src/routes/index.tsx`
- `src/routes/capture.tsx`
- `src/routes/agents.tsx`
- `src/routes/distributors.tsx`
- `src/routes/reconcile.tsx`
- `src/routes/account.tsx`
- `src/routes/unlock.tsx`
- `src/components/PasteImport.tsx`
- `src/components/StatementImport.tsx`
- `src/lib/types.ts`
- `src/lib/db.ts`
- `src/lib/parser.ts`
- `src/lib/ocr-parser.ts`
- `src/lib/distributor-parser.ts`
- `src/lib/ocr.ts`
- `src/lib/brain/fuzzy.ts`
- `src/server.ts`

### User-provided corpus

- `Parser corpus.docx`: annotated screenshot OCR outputs, current results, expected results, distributor and agent samples.
- `sms samples.docx`: large multi-bank/mobile-money SMS corpus.
- `Beriso Haji Fejo Samples.docx`: additional CBE transaction samples and duplicates.
- More than 30 uploaded screenshot images across MJ and Refill History layouts.

### Decision history

All ADRs in this document were derived from explicit product-owner decisions during the design discussion completed on 28 July 2026.

---

## 25. Handoff statement

Any implementation agent beginning work must:

1. Read this master blueprint.
2. Read the Parser/OCR & Corpus Specification.
3. Read the Production Execution Playbook.
4. Confirm the active branch and freeze a commit SHA in the baseline report.
5. Make no parser behavior changes before the corpus evaluator exists.
6. Preserve the current `ethiotrack-next2.0` branch as rollback evidence.
7. Implement changes in small, independently verifiable tasks on `production-v3`.

