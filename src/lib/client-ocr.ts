/**
 * Client-side OCR using Tesseract.js with batch parallel processing.
 *
 * Processes frames in batches of 10 — each batch runs 10 OCR workers
 * in parallel, dramatically reducing total processing time.
 *
 * Image preprocessing (grayscale + contrast + threshold) is applied
 * before OCR to improve accuracy on frames with complex backgrounds.
 */

import Tesseract from 'tesseract.js';

/**
 * Preprocess a frame image for better OCR results.
 * Converts to grayscale, increases contrast, applies adaptive thresholding,
 * and scales up 1.5x.
 */
async function preprocessFrameAsync(data: Uint8Array): Promise<string> {
  return new Promise((resolve) => {
    const blob = new Blob([data], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (!ctx) {
        resolve(uint8ArrayToDataUrl(data));
        return;
      }

      const scale = 1.5;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      // Grayscale
      for (let i = 0; i < pixels.length; i += 4) {
        const gray = 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2];
        pixels[i] = gray; pixels[i+1] = gray; pixels[i+2] = gray;
      }

      // Contrast
      const cf = 1.5;
      for (let i = 0; i < pixels.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          pixels[i+c] = Math.max(0, Math.min(255, (pixels[i+c] - 128) * cf + 128));
        }
      }

      // Adaptive threshold
      const bs = 15, half = 7;
      const w = canvas.width, h = canvas.height;
      const gray = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 0; i < pixels.length; i += 4, j++) gray[j] = pixels[i];

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0, count = 0;
          for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) { sum += gray[ny*w+nx]; count++; }
            }
          }
          const mean = sum / count;
          const idx = (y * w + x) * 4;
          const result = gray[y*w+x] < mean - 5 ? 0 : 255;
          pixels[idx] = result; pixels[idx+1] = result; pixels[idx+2] = result;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(uint8ArrayToDataUrl(data)); };
    img.src = url;
  });
}

function uint8ArrayToDataUrl(data: Uint8Array, mimeType: string = 'image/jpeg'): string {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < copy.length; i += chunkSize) {
    const chunk = copy.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/**
 * Run OCR on a single frame using a dedicated worker.
 * Returns the text and confidence.
 */
async function ocrSingleFrame(
  frame: { url: string; timestamp: number },
  worker: Tesseract.Worker,
): Promise<{ text: string; timestamp: number; confidence: number }> {
  try {
    const { data } = await worker.recognize(frame.url);
    return {
      text: (data.text || '').trim(),
      timestamp: frame.timestamp,
      confidence: data.confidence ?? 0,
    };
  } catch {
    return { text: '', timestamp: frame.timestamp, confidence: 0 };
  }
}

/**
 * Run OCR on a list of video frames using batch parallel processing.
 *
 * Processes frames in batches of BATCH_SIZE — each batch creates multiple
 * Tesseract workers that run in parallel. This is ~5x faster than sequential
 * processing.
 *
 * @param frames - Array of { data: Uint8Array, timestamp: number }
 * @param onProgress - Callback with (message, percent) where percent is 0-100
 * @returns The combined OCR text from all frames
 */
export async function ocrFrames(
  frames: { data: Uint8Array; timestamp: number }[],
  onProgress?: (message: string, percent?: number) => void,
): Promise<string> {
  const lang = process.env.NEXT_PUBLIC_TESSERACT_LANG || 'eng';

  if (frames.length === 0) return '';

  const BATCH_SIZE = 10;
  const MIN_TEXT_LENGTH = 5;
  const MIN_CONFIDENCE = 30;

  onProgress?.(`OCR: ${frames.length} frames, processing in batches of ${BATCH_SIZE}...`, 0);

  // Step 1: Preprocess all frames.
  onProgress?.('OCR: Preprocessing frames...', 5);
  const processedFrames: { url: string; timestamp: number }[] = [];
  const preprocessStart = performance.now();

  for (let i = 0; i < frames.length; i++) {
    try {
      const url = await preprocessFrameAsync(frames[i].data);
      processedFrames.push({ url, timestamp: frames[i].timestamp });
    } catch {
      processedFrames.push({ url: uint8ArrayToDataUrl(frames[i].data), timestamp: frames[i].timestamp });
    }
    if (i % 10 === 0) {
      const pct = Math.round(5 + (i / frames.length) * 15); // 5-20%
      onProgress?.(`OCR: Preprocessing ${i+1}/${frames.length}...`, pct);
    }
  }
  const preprocessTime = Math.round(performance.now() - preprocessStart);
  console.log(`[OCR] Preprocessing done: ${preprocessTime}ms (${Math.round(preprocessTime/frames.length)}ms/frame)`);

  // Step 2: Batch OCR processing.
  onProgress?.(`OCR: Processing ${processedFrames.length} frames in batches of ${BATCH_SIZE}...`, 20);

  const allResults: { text: string; timestamp: number; confidence: number }[] = [];
  const ocrStart = performance.now();

  for (let batchStart = 0; batchStart < processedFrames.length; batchStart += BATCH_SIZE) {
    const batch = processedFrames.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(processedFrames.length / BATCH_SIZE);

    // Create workers for this batch.
    const workers: Tesseract.Worker[] = [];
    for (let i = 0; i < batch.length; i++) {
      const worker = await Tesseract.createWorker(lang, 1);
      workers.push(worker);
    }

    // Process this batch in parallel.
    const batchResults = await Promise.all(
      batch.map((frame, i) => ocrSingleFrame(frame, workers[i])),
    );

    // Terminate all workers in this batch.
    for (const worker of workers) {
      await worker.terminate();
    }

    allResults.push(...batchResults);

    const processed = Math.min(batchStart + BATCH_SIZE, processedFrames.length);
    const pct = Math.round(20 + (processed / processedFrames.length) * 75); // 20-95%
    const goodResults = allResults.filter(r => r.text.length >= MIN_TEXT_LENGTH && r.confidence >= MIN_CONFIDENCE).length;
    onProgress?.(
      `OCR: Batch ${batchNum}/${totalBatches} done — ${processed}/${processedFrames.length} frames (${goodResults} with text)`,
      pct,
    );
    console.log(`[OCR] Batch ${batchNum}/${totalBatches} complete: ${batchResults.filter(r => r.text.length > 0).length} frames with text`);
  }

  const ocrTime = Math.round(performance.now() - ocrStart);
  console.log(`[OCR] OCR done: ${ocrTime}ms (${Math.round(ocrTime/frames.length)}ms/frame avg)`);

  // Step 3: Filter and combine results.
  onProgress?.('OCR: Combining results...', 95);

  const textParts: string[] = [];
  for (const result of allResults) {
    if (result.text.length >= MIN_TEXT_LENGTH && result.confidence >= MIN_CONFIDENCE) {
      textParts.push(`[Frame @ ${result.timestamp}s]\n${result.text}`);
    }
  }

  const combinedText = textParts.join('\n\n---\n\n');
  onProgress?.(
    combinedText
      ? `OCR complete: ${textParts.length}/${frames.length} frames with text.`
      : 'OCR complete: no readable text found.',
    100,
  );

  return combinedText;
}
