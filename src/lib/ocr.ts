/**
 * OCR using Tesseract.js to extract text from video frames.
 *
 * Tesseract.js is a pure-JS OCR engine that runs in Node.js without native
 * dependencies. It downloads its language data on first use (cached afterward).
 *
 * For each frame extracted from the video, we run OCR and collect any text
 * that appears on screen (common in recipe videos: ingredient lists, timers,
 * step labels, etc.).
 */

import Tesseract from 'tesseract.js';
import type { VideoFrame } from './types';

/**
 * Run OCR on a list of video frames.
 *
 * @param frames - Array of { path, timestamp } from the video extractor.
 * @param onProgress - Optional callback for progress updates.
 * @returns The combined OCR text from all frames, with timestamp markers.
 */
export async function ocrFrames(
  frames: { path: string; timestamp: number }[],
  onProgress?: (message: string) => void,
): Promise<{ combinedText: string; frames: VideoFrame[] }> {
  const lang = process.env.TESSERACT_LANG || 'eng';
  onProgress?.(`Running OCR on ${frames.length} frames (language: ${lang})...`);

  // Create a single worker and reuse it for all frames (much faster than
  // creating a new worker per frame).
  const worker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        const percent = Math.floor(m.progress * 100);
        onProgress?.(`OCR processing: ${percent}%`);
      }
    },
  });

  const results: VideoFrame[] = [];
  const textParts: string[] = [];

  try {
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      onProgress?.(`OCR frame ${i + 1}/${frames.length} (t=${frame.timestamp}s)...`);

      try {
        const { data } = await worker.recognize(frame.path);
        const text = (data.text || '').trim();
        if (text.length > 0) {
          // Filter out very short/noisy results.
          if (text.length >= 3) {
            results.push({
              path: frame.path,
              timestamp: frame.timestamp,
              text,
            });
            textParts.push(`[Frame @ ${frame.timestamp}s]\n${text}`);
          }
        }
      } catch (err) {
        // Continue on per-frame errors.
        console.error(`OCR failed for frame ${i}:`, err);
      }
    }
  } finally {
    await worker.terminate();
  }

  const combinedText = textParts.join('\n\n---\n\n');
  onProgress?.(
    combinedText
      ? `OCR complete: ${results.length} frames with text, ${combinedText.length} chars total.`
      : 'OCR complete: no text found in any frame.',
  );

  return { combinedText, frames: results };
}
