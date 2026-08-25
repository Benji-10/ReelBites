/**
 * Client-side OCR using Tesseract.js.
 *
 * Runs entirely in the browser. Tesseract.js downloads its language data
 * (~10MB for English) on first use, cached by the browser afterward.
 *
 * For each frame extracted from the video, we run OCR and collect any text
 * that appears on screen (ingredient lists, timers, step labels, etc.).
 */

import Tesseract from 'tesseract.js';

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
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      onProgress?.(`OCR frame ${i + 1}/${frames.length} (t=${frame.timestamp}s)...`);

      try {
        // Convert Uint8Array to Blob for Tesseract.
        const blob = new Blob([frame.data], { type: 'image/jpeg' });
        const { data } = await worker.recognize(blob);
        const text = (data.text || '').trim();

        if (text.length >= 3) {
          textParts.push(`[Frame @ ${frame.timestamp}s]\n${text}`);
        }
      } catch (err) {
        console.error(`OCR failed for frame ${i}:`, err);
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
