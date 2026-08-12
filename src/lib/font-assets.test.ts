import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";

const FONT_DIR = "public/fonts";

function listFonts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(listFonts(p));
    else if (/\.(woff2?|ttf|otf)$/i.test(entry)) out.push(p);
  }
  return out;
}

/** Magic numbers for real font binaries. */
function isRealFontBinary(buf: Buffer): boolean {
  const tag = buf.subarray(0, 4).toString("latin1");
  if (tag === "wOF2" || tag === "wOFF") return true; // woff2 / woff
  if (tag === "OTTO" || tag === "true" || tag === "ttcf") return true; // otf / ttf
  return buf.readUInt32BE(0) === 0x00010000; // truetype
}

describe("public font assets", () => {
  const fonts = listFonts(FONT_DIR);

  it("contains no HTML or text masquerading as a font", () => {
    const bad: string[] = [];
    for (const file of fonts) {
      const buf = readFileSync(file);
      if (!isRealFontBinary(buf)) bad.push(file);
    }
    expect(bad).toEqual([]);
  });

  it("has no zero-byte font files", () => {
    expect(fonts.filter((f) => statSync(f).size === 0)).toEqual([]);
  });
});
