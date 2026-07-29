# EthioTrack Blueprint Decision Log

## Version 1.0 — Approved baseline

The following locked business decisions are copied from the Master Blueprint decision register. Meaning is preserved exactly. No new decisions are introduced here.

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

The correct distributor platform name is **Moderntech Safaricom**.

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
