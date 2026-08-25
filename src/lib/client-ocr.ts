/**
 * Client-side OCR using Tesseract.js.
 *
 * Runs entirely in the browser. Tesseract.js downloads its language data
 * (~10MB for English) on first use, cached by the browser afterward.
 *
 * IMPORTANT: Tesseract.js's ImageLike type is `string | HTMLImageElement |
 * HTMLCanvasElement | HTMLVideoElement`. It does NOT accept Blob or
 * Uint8Array directly. We must convert each frame to a data URL (base64
 * string) before passing it to worker.recognize().
 *
 * This also avoids the "ArrayBuffer is detached" error that occurs when
 * passing Blob/ArrayBuffer data to Tesseract's Web Worker (the worker
 * transfers the buffer, detaching it).
 */

import Tesseract from 'tesseract.js';

/**
 * Convert a Uint8Array (JPEG image data) to a base64 data URL.
 *
 * Data URLs are strings, so they don't have the ArrayBuffer transfer/detach
 * issue that Blob/Uint8Array have when passed to Web Workers.
 */
function uint8ArrayToDataUrl(data: Uint8Array, mimeType: string = 'image/jpeg'): string {
  // Copy the data into a fresh buffer first (in case it's WASM-backed).
  const copy = new Uint8Array(data.length);
  copy.set(data);

  // Convert to base64.
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < copy.length; i += chunkSize) {
    const chunk = copy.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);

  return `data:${mimeType};base64,${base64}`;
}

/**
 * Run OCR on a list of video frames.
 *
 * @param frames - Array of { data: Uint8Array, timestamp: number }
 * @param onProgress - Optional callback for progress updates
 * @returns The combined OCR text from all frames, with timestamp markers
 */
export async function ocrFrames(
  frames: { data: Uint8Array; timestamp: number }[],
  onProgress?: (message: string) => void,
): Promise<string> {
  const lang = process.env.NEXT_PUBLIC_TESSERACT_LANG || 'eng';

  if (frames.length === 0) {
    return '';
  }

  onProgress?.(`Running OCR on ${frames.length} frames (language: ${lang})...`);

  // Pre-convert all frames to data URLs.
  // This is the key fix — Tesseract.js accepts string data URLs, not Blobs.
  // Data URLs don't have the ArrayBuffer transfer/detach issue.
  onProgress?.('Preparing frames for OCR...');
  const frameUrls = frames.map((f) => ({
    url: uint8ArrayToDataUrl(f.data),
    timestamp: f.timestamp,
  }));

  onProgress?.('Initializing Tesseract worker...');

  // Create a single worker and reuse it for all frames.
  const worker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        const percent = Math.floor(m.progress * 100);
        onProgress?.(`OCR processing: ${percent}%`);
      }
    },
  });

  const textParts: string[] = [];

  try {
    for (let i = 0; i < frameUrls.length; i++) {
      const frame = frameUrls[i];
      onProgress?.(`OCR frame ${i + 1}/${frameUrls.length} (t=${frame.timestamp}s)...`);

      try {
        // Pass the data URL string directly — no Blob, no ArrayBuffer.
        const { data } = await worker.recognize(frame.url);
        const text = (data.text || '').trim();

        if (text.length >= 3) {
          textParts.push(`[Frame @ ${frame.timestamp}s]\n${text}`);
        }
      } catch (err) {
        console.error(`OCR failed for frame ${i}:`, err);
        // Continue to next frame even if this one failed.
      }
    }
  } finally {
    await worker.terminate();
  }

  const combinedText = textParts.join('\n\n---\n\n');
  onProgress?.(
    combinedText
      ? `OCR complete: ${textParts.length} frames with text, ${combinedText.length} chars total.`
      : 'OCR complete: no text found in any frame.',
  );

  return combinedText;
}
