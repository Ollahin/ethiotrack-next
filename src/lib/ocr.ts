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

/**
 * Rotate an image blob by 0/90/180/270 degrees in-browser. Returns the input
 * untouched for 0° so the common path stays allocation-free.
 */
export async function rotateImageBlob(file: File | Blob, degrees: number): Promise<Blob> {
  const deg = ((degrees % 360) + 360) % 360;
  if (deg === 0) return file;
  const bitmap = await createImageBitmap(file);
  const swap = deg === 90 || deg === 270;
  const w = swap ? bitmap.height : bitmap.width;
  const h = swap ? bitmap.width : bitmap.height;
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = (canvas as OffscreenCanvas | HTMLCanvasElement).getContext(
    "2d",
  ) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Canvas 2D context unavailable for rotation");
  ctx.translate(w / 2, h / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close?.();
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: "image/png" });
  return new Promise<Blob>((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Rotation failed"))),
      "image/png",
    ),
  );
}

/** Recognize a screenshot at a given orientation, rotating it first. */
export async function extractImageTextAt(
  file: File | Blob,
  orientation: number,
): Promise<OcrResult> {
  const rotated = await rotateImageBlob(file, orientation);
  return extractImageText(rotated);
}
