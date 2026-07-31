# Sanitized screenshot image fixtures (generated, never committed)

The corpus guard forbids committing any image to `tests/corpus/fixtures/`, so
these smoke-test screenshots are generated on demand into a scratch directory
instead of being stored in the repository.

Generate them with:

```bash
python tests/corpus/fixtures/images/generate.py /tmp/ethiotrack-shots
```

Each image is rendered deterministically from the sanitized OCR text fixtures
in `tests/corpus/fixtures/ocr/` onto a plain white canvas. No private
screenshot, name, amount, reference or account value is involved.

| File                | Source                                                    | Purpose                            |
| ------------------- | --------------------------------------------------------- | ---------------------------------- |
| `mj-clean.png`      | `ocr/mj-transfers-sent/photo-5.raw.txt`                   | clean MJ Transfers → Sent          |
| `mj-reversal.png`   | `ocr/mj-transfers-sent/photo-4.raw.txt`                   | MJ screenshot containing reversals |
| `refill-clean.png`  | `ocr/refill-history/photo-64.raw.txt`                     | clean Refill History               |
| `mj-rotated-90.png` | `ocr/mj-transfers-sent/photo-5.raw.txt`                   | 90°-rotated capture                |
| `mj-cropped.png`    | `ocr/mj-transfers-sent/photo-5.raw.txt` (first rows only) | cropped/incomplete capture         |

Manual smoke test: open Quick Capture, drop all five at once, and confirm each
tile reports its own orientation, layout and rows independently.
