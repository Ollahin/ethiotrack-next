# Sanitized screenshot image fixtures

Generated deterministically from the sanitized OCR text fixtures in
`tests/corpus/fixtures/ocr/` by rendering each line to a plain white canvas.
No private screenshot, name, amount, reference or account value is present.

| File | Source | Purpose |
| --- | --- | --- |
| `mj-clean.png` | `ocr/mj-transfers-sent/photo-5.raw.txt` | clean MJ Transfers → Sent |
| `mj-reversal.png` | `ocr/mj-transfers-sent/photo-4.raw.txt` | MJ screenshot containing reversals |
| `refill-clean.png` | `ocr/refill-history/photo-64.raw.txt` | clean Refill History |
| `mj-rotated-90.png` | `ocr/mj-transfers-sent/photo-5.raw.txt` | 90°-rotated capture |
| `mj-cropped.png` | `ocr/mj-transfers-sent/photo-5.raw.txt` (first rows only) | cropped/incomplete capture |