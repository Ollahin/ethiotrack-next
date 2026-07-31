"""Render sanitized OCR text fixtures into screenshot PNGs for manual smoke tests.

Usage: python tests/corpus/fixtures/images/generate.py <output-dir>

Output images are scratch artifacts and must never be committed.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SPECS = [
    ("mj-clean.png", "ocr/mj-transfers-sent/photo-5.raw.txt", 0, None),
    ("mj-reversal.png", "ocr/mj-transfers-sent/photo-4.raw.txt", 0, None),
    ("refill-clean.png", "ocr/refill-history/photo-64.raw.txt", 0, None),
    ("mj-rotated-90.png", "ocr/mj-transfers-sent/photo-5.raw.txt", 90, None),
    ("mj-cropped.png", "ocr/mj-transfers-sent/photo-5.raw.txt", 0, 9),
]


def render(lines, rotation):
    font = ImageFont.load_default(28)
    width, line_h, pad = 1000, 46, 32
    img = Image.new("RGB", (width, pad * 2 + line_h * len(lines)), "white")
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        draw.text((pad, pad + i * line_h), line, fill="black", font=font)
    return img.rotate(-rotation, expand=True) if rotation else img


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, src, rotation, limit in SPECS:
        lines = (ROOT / src).read_text(encoding="utf-8").splitlines()
        render(lines[:limit] if limit else lines, rotation).save(out / name)
        print("wrote", out / name)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ethiotrack-shots")
