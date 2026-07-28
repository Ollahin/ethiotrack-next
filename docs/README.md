# EthioTrack Documentation

## Authoritative documents

1. [Master Blueprint](./blueprint/01-master-blueprint.md)
   Defines the product, domain rules, current architecture, target
   architecture, business model and production goals.

2. [Parser, OCR and Corpus Specification](./blueprint/02-parser-ocr-corpus-spec.md)
   Defines ingestion, OCR, parsing, corpus evaluation, confidence,
   review, overlap handling and identity matching.

3. [Production Execution Playbook](./blueprint/03-production-execution-playbook.md)
   Defines implementation phases, branch discipline, validation gates,
   migrations, release requirements and handoff procedures.

## Authority order

When requirements conflict, use this order:

1. Latest approved decision in blueprint/CHANGELOG.md
2. Master Blueprint
3. Parser/OCR Specification for ingestion matters
4. Production Execution Playbook for implementation process
5. Existing application behavior

Existing code is not authoritative when it conflicts with an approved
business rule.

## Active baseline

- Protected source branch: ethiotrack-next2.0
- Active development branch: production-v3
- Blueprint version: 1.0
- Current stage: Stage 0 — Establish control
- Next task: Validation baseline and CI

## Agent startup procedure

Before changing code:

1. Read this documentation index.
2. Read the relevant blueprint document.
3. Inspect the current implementation.
4. State the approved requirement being implemented.
5. Make only the requested change.
6. Add or update tests.
7. Run required validation commands.
8. Report changed files, results and risks.
