## Goal

Add three verbatim Markdown documents from the uploaded `EthioTrack_Blueprint_Archive_v1.0.zip` into the repo. Documentation-only change on branch `production-v3`.

## Steps

1. Extract the archive to a temp directory (`/tmp/blueprint-extract/`).
2. Create `docs/blueprint/`.
3. Copy the three `.md` files verbatim to their target names:
   - `01_EthioTrack_Master_Blueprint_v1.0.md` → `docs/blueprint/01-master-blueprint.md`
   - `02_EthioTrack_Parser_OCR_Corpus_Spec_v1.0.md` → `docs/blueprint/02-parser-ocr-corpus-spec.md`
   - `03_EthioTrack_Production_Execution_Playbook_v1.0.md` → `docs/blueprint/03-production-execution-playbook.md`
4. Scan the copied files for relative Markdown links; if any point to old filenames (e.g. the `01_...v1.0.md` names) that would now be broken, retarget them to the new kebab-case filenames. Leave all other content untouched.
5. Do not copy the `.docx` files, `README.txt`, or the ZIP.

## Constraints

- No changes to any non-documentation file (no code, config, schema, deps, UI, styling, parser, OCR).
- No summarizing, rewriting, or reformatting of the Markdown contents.
- Only fix clearly broken relative Markdown links between the three docs.

## Report at the end

- Files added.
- Whether any text inside the Markdown was changed (and, if so, exactly which link fixes).
- Confirmation that no non-documentation file changed.
