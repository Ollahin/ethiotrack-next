// Client-side OCR for screenshot statement imports (distributor apps: MJ,
// Alami, Yenus, Tilanesh, Modern App). Runs entirely in-browser via
// tesseract.js — the worker + language data are fetched on first use, so
// keep the caller aware that the first OCR call is slower and needs network.

let _tess: typeof import("tesseract.js") | null = null;
async function loadTess() {
  if (_tess) return _tess;
  _tess = await import("tesseract.js");
  return _tess;
}

/** Below this confidence, treat the extracted text as unreliable and warn the user. */
export const OCR_LOW_CONFIDENCE = 0.6;

export interface OcrResult {
  text: string;
  /** 0..1 — Tesseract's mean recognition confidence, normalized. */
  confidence: number;
}

export async function extractImageText(file: File | Blob): Promise<OcrResult> {
  const tess = await loadTess();
  const { data } = await tess.recognize(file, "eng");
  return {
    text: (data.text ?? "").trim(),
    confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)),
  };
}