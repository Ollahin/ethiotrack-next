# EthioTrack Execution Contract

Permanent execution rules for all AI-assisted work in this repository. Future
tasks may reference this contract instead of repeating these rules.

1. Work only on `production-v3`. Never rewrite `ethiotrack-next2.0`.
2. Read `PROJECT_STATUS.md` and the task-relevant repository contracts first.
3. Change only files explicitly allowed by the current task.
4. Never commit original private screenshots, names, account values, URLs,
   references, phone numbers, or raw private messages.
5. Corpus data must be synthetic while preserving layout, order, punctuation,
   signs, dates, repetition, and OCR failure structure.
6. Never invent a financial amount, sign, date, agent, reference, or match.
7. Agent matching normalizes case and whitespace only. No fuzzy auto-linking.
8. Separate visible financial rows remain separate unless an explicit business
   rule proves otherwise.
9. Reversals and OCR sign noise must remain distinguishable.
10. Do not change production parser/OCR/database/UI behavior unless the task
    explicitly authorizes it.
11. Do not change dependencies, lockfiles, or configuration unless explicitly
    authorized.
12. Stop and report any scope discrepancy before making broader changes.
13. Run `bun run verify` before completion.
14. Use this compact completion format:

```
Task:
Status:
Changed:
Counts:
Tests:
Verify:
Deviations:
Behavior changed:
Private data committed:
```