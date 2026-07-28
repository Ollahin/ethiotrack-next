# EthioTrack Production Execution Playbook

**Document ID:** ET-BP-003  
**Version:** 1.0  
**Status:** Approved delivery and governance plan  
**Prepared:** 28 July 2026

---

## 1. Purpose

This playbook defines how EthioTrack is to be rebuilt without losing working functionality, corrupting local data, or creating unreviewable large changes. It is the implementation operating manual for human developers and coding agents.

---

## 2. Branch and source-control strategy

### 2.1 Protected baseline

- Keep `ethiotrack-next2.0` unchanged as the product baseline and rollback reference.
- Create `production-v3` from a frozen commit on `ethiotrack-next2.0`.
- Record the exact source SHA in `docs/baseline-report.md`.
- Do not force-push either protected branch.

### 2.2 Working branches

Use small feature branches from `production-v3`, for example:

```text
feat/baseline-ci
feat/corpus-harness
feat/domain-money
feat/domain-reconciliation
feat/db-v5-shadow-schema
feat/ingestion-inbox
feat/ocr-layout-mj
feat/ocr-layout-refill
feat/sms-cbe-profiles
feat/pwa-share-target
```

### 2.3 Commit discipline

- One independently testable concern per commit where practical.
- No drive-by UI redesign during domain/parser tasks.
- Schema changes and migrations live in the same pull request.
- Every parser change includes fixture changes and evaluator output.
- Every business-rule change updates the decision register and tests.

---

## 3. Mandatory validation commands

Target scripts:

```json
{
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "format:check": "prettier --check .",
  "test": "vitest run",
  "build": "vite build",
  "corpus:evaluate": "...",
  "verify": "bun run typecheck && bun run lint && bun run format:check && bun run test && bun run corpus:evaluate && bun run build"
}
```

All pull requests must pass CI. Required checks must not use `continue-on-error`.

---

## 4. Implementation rules

### 4.1 Rules for coding agents

Before coding:

1. Read all three blueprint documents.
2. Inspect the relevant current implementation.
3. State the exact task boundary.
4. List assumptions.
5. Confirm no locked ADR is being contradicted.

After coding:

1. Run all required checks for the phase.
2. Report changed files.
3. Report migration impact.
4. Report corpus metric changes.
5. Report unresolved risks.
6. Do not claim success without command output.

### 4.2 No silent scope expansion

An agent must not:

- Redesign unrelated screens.
- Introduce cloud services.
- Add fuzzy agent linking.
- Change transaction semantics without an ADR.
- Delete legacy data.
- Replace missing dates with import time.
- Remove negative signs.
- Auto-merge duplicate-looking EVD rows.
- Skip tests because a dependency or environment is inconvenient.

### 4.3 Evidence-first development

For parser/OCR work, the sequence is always:

```text
fixture → expected output → failing test → implementation → evaluator → review
```

Never start with a regex change and add tests afterward.

---

## 5. Delivery phases

## Phase 0 — Establish control

### Objectives

- Freeze baseline commit.
- Add typecheck/format/verify scripts.
- Add CI.
- Produce baseline report.
- Add these blueprint documents to `docs/blueprint/`.

### Exit criteria

- Clean frozen install.
- Typecheck, lint, format check, tests, and build pass.
- No parser, database, or user-facing behavior changed.

---

## Phase 1 — Corpus and evaluator

### Objectives

- Convert annotated screenshot data into sanitized fixtures.
- Convert SMS documents into logical message fixtures.
- Add fixture schema.
- Add deterministic mutation generator.
- Add corpus evaluator.
- Record current parser baseline.

### Exit criteria

- Every fixture has a stable ID.
- Baseline failures are visible and reproducible.
- No parser behavior changed in the corpus-creation pull request.

---

## Phase 2 — Domain core

### Objectives

Implement framework-independent domain models and tests for:

- Money and amount breakdown.
- Date precision.
- Evidence and candidate structures.
- Bank events.
- Distributor purchases.
- EVD receipts and allocations.
- Agent EVD movements and reversals.
- Inventory projections.
- Agent credit allocations.
- Audit events.

### Exit criteria

- Domain code imports no React, Dexie, Tesseract, or browser APIs.
- Locked business rules have direct unit tests.
- Many-to-many reconciliation and partial/surplus cases pass.

---

## Phase 3 — Shadow database schema

### Objectives

- Add new Dexie tables beside legacy tables.
- Add Zod/runtime validation at repository boundaries.
- Add migration reporting.
- Remove purge invocation from production flows.
- Preserve legacy tables.
- Add versioned backup envelope.

### Exit criteria

- Existing v1-v4 database upgrades without data loss.
- Ambiguous opening inventory remains unallocated, not evenly invented.
- Backup round-trip passes.
- Failed import is atomic.

---

## Phase 4 — Durable ingestion inbox

### Objectives

- Save text/images/PDFs before processing.
- Persist job state and errors.
- Persist OCR output and candidates.
- Resume after reload.
- Retry without duplicating committed events.

### Exit criteria

- Force-closing the app after capture does not lose input.
- Job status survives reload.
- Committed jobs cannot be committed twice without explicit override.

---

## Phase 5 — Parser registry and SMS profiles

### Objectives

- Introduce a versioned parser registry.
- Implement source detection.
- Implement CBE profiles first.
- Add Abyssinia, Telebirr, Coop, Coop eBirr, and Dashen profiles iteratively.
- Remove generic high-confidence guessing.

### Exit criteria

- Supported SMS corpus gates pass.
- Unsupported formats abstain or require review.
- Bank amount roles are correct.
- Distributor purchases are suggested from strict configured matches.

---

## Phase 6 — OCR foundation

### Objectives

- Persistent/reused Tesseract worker.
- Offline English model assets.
- Image preprocessing.
- Word/line bounding boxes.
- Field-level confidence.
- Performance telemetry in development mode.

### Exit criteria

- OCR structure is persisted.
- Offline OCR works after first setup.
- Median image processing approaches the five-second target on real Android testing.

---

## Phase 7 — Screenshot layout parsers

### Objectives

- MJ Transfers/Sent layout parser.
- Yunus/Alami Refill History layout parser.
- Signed reversal handling.
- Partial-row handling.
- Overlap sequence detection.
- Strict agent review.

### Exit criteria

- Annotated 56-row corpus meets the release gates.
- No account label or OCR symbol is used as an agent.
- No negative reversal is lost.

---

## Phase 8 — Review and commit workflow

### Objectives

- Unified review table for SMS, image, PDF, and paste.
- User resolution for agent/distributor/date/personal purpose.
- Atomic domain event commit.
- Audit entry creation.

### Exit criteria

- No parser writes directly to financial tables.
- Uncertain rows cannot bypass review.
- Partial rows are unselected by default.

---

## Phase 9 — Distributor payment fulfillment

### Objectives

- Create EVD purchase after configured distributor payment.
- Use principal as expected EVD.
- Use final debit as cash-out.
- Fifteen-minute deadline.
- Manual EVD receipt.
- Many-to-many allocation.
- Partial/fulfilled/overdue/disputed/refunded/personal states.
- Surplus classification.

### Exit criteria

- Every agreed reconciliation scenario has tests.
- Dashboard displays outstanding amount by distributor.
- Personal override suppresses EVD obligation without suppressing bank cash-out.

---

## Phase 10 — Inventory and agent projections

### Objectives

- Platform inventory projection.
- Overall inventory projection.
- Agent platform/overall net EVD.
- MJ reversal effect and override warning.
- Credit allocation improvements.

### Exit criteria

- Projection results can be rebuilt from events.
- No balance relies on an opaque mutable total.
- Reversal restores MJ inventory and reduces agent net EVD.

---

## Phase 11 — PWA and Android integration

### Objectives

- Manifest and icons.
- Service worker.
- Offline shell.
- Local fonts.
- OCR asset cache.
- Android text share target.
- Update workflow.
- Browser and in-app notifications.

### Exit criteria

- Installed app launches offline.
- Shared SMS is durable before parse.
- Notification fallback works when browser notifications are denied/unsupported.
- Service-worker update does not interrupt an active import.

---

## Phase 12 — UI migration and reporting

### Objectives

- Replace old capture/reconcile logic behind existing or revised screens.
- Add purchase/receipt/inventory views.
- Update dashboard.
- Add audit/history views.
- Finalize reporting formulas.

### Exit criteria

- All user workflows use the new domain/repository layer.
- Legacy transaction table is read-only or fully migrated.

---

## Phase 13 — Production hardening

### Objectives

- Accessibility.
- Browser/device matrix.
- Backup/recovery drills.
- Storage quota handling.
- Security/privacy review.
- Performance optimization.
- Vercel/Netlify deployment verification.
- Release runbook.

### Exit criteria

- Production readiness audit completed.
- Known limitations documented.
- Rollback tested.

---

## 6. Migration policy

### 6.1 Never invent data

Prohibited migration examples:

- Evenly splitting unknown historical EVD stock across distributors.
- Inventing current time for missing dates.
- Auto-assigning OCR names to closest agents.
- Marking legacy credit fully settled without allocation evidence.

### 6.2 Migration result states

Every migrated legacy record is:

- Migrated confidently.
- Migrated with review required.
- Left in legacy form with explanation.
- Rejected because invalid, with recovery guidance.

### 6.3 Dual-read/dual-write caution

Avoid long-lived uncontrolled dual-write behavior. If a transitional dual-write is necessary:

- Define one authoritative write path.
- Compare projections automatically.
- Add a removal date.
- Record discrepancies.

---

## 7. Testing strategy

### 7.1 Unit tests

- Money parsing and arithmetic.
- Date precision.
- Status transitions.
- Reconciliation allocations.
- Inventory projections.
- Agent balance and reversal rules.
- Strict identity normalization.

### 7.2 Fixture tests

- Every source profile.
- Every screenshot fixture.
- Duplicate and overlap cases.
- Mutation variants.

### 7.3 Integration tests

- Ingestion job persistence.
- Atomic commit.
- Database migration.
- Backup restore.
- PWA share-target payload handling.

### 7.4 End-to-end tests

- First-time setup and unlock.
- Share SMS → review → pending purchase.
- Fifteen-minute overdue state.
- Confirm partial EVD receipt.
- Complete with second receipt.
- Screenshot import with unmatched agent.
- MJ reversal with normal balance.
- MJ reversal exceeding balance and override note.
- Offline reload.
- Backup/export/import.

---

## 8. Definition of done

A task is complete only when:

- Acceptance criteria are met.
- Typecheck/lint/format/tests/build pass.
- Relevant corpus metrics do not regress.
- Data migration impact is documented.
- No locked ADR is violated.
- User-facing error/recovery states exist.
- Changed behavior is documented.
- Reviewer can reproduce the result.

---

## 9. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Parser becomes a collection of regex patches | High | Versioned profiles, corpus gates, parser registry. |
| OCR loses row structure | High | Preserve token/line boxes; layout-specific reconstruction. |
| Legitimate repeated EVD rows deduplicated | High | Reference/evidence/sequence-based duplicate policy. |
| Local data lost during import | High | Durable ingestion inbox before processing. |
| Migration invents historical values | High | Unallocated/needs-review migration states. |
| App update breaks offline data | High | Migration tests and deferred service-worker activation. |
| Tesseract too slow on budget Android | Medium/High | Worker reuse, single pass, preprocessing benchmarks, small batches. |
| SMS share lacks timestamp | Medium | Export metadata or user-selected timestamp. |
| User creates duplicate agent spellings | Medium | Strict matching plus user resolution and exact approved aliases. |
| Fifteen-minute notification unavailable | Medium | In-app fallback. |
| Free hosting runtime mismatch | Medium | Static/client-first architecture and deployment smoke tests. |
| Scope expands into security/licensing too early | Medium | Isolate current account system; core roadmap controls. |

---

## 10. Documentation governance

Required living documents in the repository:

```text
docs/
  blueprint/
    01-master-blueprint.md
    02-parser-ocr-corpus.md
    03-execution-playbook.md
  decisions/
    ADR-001-...
  baseline-report.md
  architecture.md
  data-model.md
  parser-profiles.md
  migration-runbook.md
  backup-recovery.md
  release-checklist.md
```

When a locked decision changes:

1. Create/update an ADR.
2. Update all affected blueprint sections.
3. Update tests and fixture expectations.
4. Record migration impact.

---

## 11. Immediate next tasks

### Task 0.1 — Validation baseline

- Add scripts and CI.
- Freeze source SHA.
- Fix validation-only failures.
- Do not change parser/UI/database behavior.

### Task 0.2 — Corpus harness

- Add sanitized fixtures and evaluator.
- Record current baseline.
- Do not change parser behavior.

### Task 0.3 — Domain decision tests

- Encode money, date precision, reversal, strict identity, and reconciliation decisions as unit tests before implementation.

Only after these tasks pass should the architecture restructuring begin.

---

## 12. Agent handoff checklist

Before continuing the project, answer yes to each:

```text
[ ] I am on the intended feature branch from production-v3.
[ ] I read all three blueprint documents.
[ ] I know which ADRs apply to my task.
[ ] I inspected the current implementation I am replacing.
[ ] I have fixtures/tests before parser changes.
[ ] I will not delete or rewrite legacy data silently.
[ ] I will report exact command results.
[ ] I will stop if the task requires an undecided business rule.
```

