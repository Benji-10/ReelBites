/**
 * Client-side OCR using Tesseract.js.
 *
 * Runs entirely in the browser. Tesseract.js downloads its language data
 * (~10MB for English) on first use, cached by the browser afterward.
 *
 * For each frame extracted from the video, we run OCR and collect any text
 * that appears on screen (ingredient lists, timers, step labels, etc.).
 *
 * IMPORTANT: The frame data comes from ffmpeg.wasm, which returns Uint8Arrays
 * backed by the WASM heap. When these are passed to Tesseract's worker via
 * postMessage, the ArrayBuffer gets TRANSFERRED (detached), making it
 * unusable. We must copy each frame's data into a fresh ArrayBuffer before
 * creating the Blob.
 */

import Tesseract from 'tesseract.js';

/**
 * Copy a Uint8Array into a fresh ArrayBuffer.
 *
 * This is necessary because ffmpeg.wasm returns Uint8Arrays that share
 * memory with the WASM heap. Passing these directly to a Web Worker via
 * postMessage (which Tesseract does internally) transfers the ArrayBuffer,
 * detaching it from the original Uint8Array.
 */
function copyToFreshBuffer(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
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

  // Pre-copy all frame data into fresh ArrayBuffers BEFORE creating the worker.
  // This prevents the "ArrayBuffer is detached" error when Tesseract's worker
  // tries to read the data.
  const safeFrames = frames.map((f) => ({
    data: copyToFreshBuffer(f.data),
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
    for (let i = 0; i < safeFrames.length; i++) {
      const frame = safeFrames[i];
      onProgress?.(`OCR frame ${i + 1}/${safeFrames.length} (t=${frame.timestamp}s)...`);

      try {
        // Create a fresh copy for this iteration (the Blob may also transfer
        // the buffer when passed to the worker).
        const frameCopy = copyToFreshBuffer(frame.data);
        const blob = new Blob([frameCopy], { type: 'image/jpeg' });
        const { data } = await worker.recognize(blob);
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
