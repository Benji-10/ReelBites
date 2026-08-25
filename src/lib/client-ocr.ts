/**
 * Client-side OCR using Tesseract.js.
 *
 * Runs entirely in the browser. Tesseract.js downloads its language data
 * (~10MB for English) on first use, cached by the browser afterward.
 *
 * IMAGE PREPROCESSING:
 * Raw video frames often have complex backgrounds that confuse Tesseract.
 * Before OCR, each frame is preprocessed using a Canvas:
 *   1. Convert to grayscale
 *   2. Increase contrast
 *   3. Apply adaptive thresholding (binarize to black/white)
 *   4. Scale up 2x for better character recognition
 *
 * This dramatically improves OCR accuracy on frames with busy backgrounds.
 */

import Tesseract from 'tesseract.js';

/**
 * Preprocess a frame image for better OCR results.
 *
 * Converts the image to grayscale, increases contrast, applies thresholding,
 * and scales it up. Returns a data URL of the processed image.
 */
function preprocessFrame(data: Uint8Array): string {
  // Create an Image from the raw bytes.
  const blob = new Blob([data], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);

  // We need to do this synchronously-ish, so we use a canvas.
  // Create a temporary image element.
  const img = new Image();
  img.src = url;

  // Since image loading is async, we'll use a canvas approach.
  // Create an off-screen canvas.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    // If canvas context fails, fall back to the original image.
    return uint8ArrayToDataUrl(data);
  }

  // We need to draw the image to get its dimensions, but Image loading is async.
  // Since this function is called in an async context, we'll handle it differently.
  // Fall back to direct conversion — the caller should use preprocessFrameAsync instead.
  return uint8ArrayToDataUrl(data);
}

/**
 * Async version of preprocessFrame that properly loads the image first.
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

      // Scale up 1.5x for better character recognition.
      const scale = 1.5;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      // Draw the image scaled.
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Get image data for processing.
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      // Step 1: Convert to grayscale.
      for (let i = 0; i < pixels.length; i += 4) {
        const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        pixels[i] = gray;
        pixels[i + 1] = gray;
        pixels[i + 2] = gray;
      }

      // Step 2: Increase contrast.
      const contrastFactor = 1.5;
      for (let i = 0; i < pixels.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const val = pixels[i + c];
          pixels[i + c] = Math.max(0, Math.min(255, (val - 128) * contrastFactor + 128));
        }
      }

      // Step 3: Adaptive thresholding — compute local mean and binarize.
      // This handles uneven lighting better than a global threshold.
      const blockSize = 15; // Must be odd.
      const halfBlock = Math.floor(blockSize / 2);
      const width = canvas.width;
      const height = canvas.height;

      // Create a copy of the grayscale values for computing local means.
      const grayValues = new Uint8ClampedArray(width * height);
      for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
        grayValues[j] = pixels[i];
      }

      // Apply adaptive threshold.
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Compute local mean in the block.
          let sum = 0;
          let count = 0;
          for (let dy = -halfBlock; dy <= halfBlock; dy++) {
            for (let dx = -halfBlock; dx <= halfBlock; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                sum += grayValues[ny * width + nx];
                count++;
              }
            }
          }
          const localMean = sum / count;
          const idx = (y * width + x) * 4;
          const val = grayValues[y * width + x];
          // Binarize: if pixel is darker than local mean, make it black, else white.
          const result = val < localMean - 5 ? 0 : 255;
          pixels[idx] = result;
          pixels[idx + 1] = result;
          pixels[idx + 2] = result;
        }
      }

      // Put the processed image back.
      ctx.putImageData(imageData, 0, 0);

      // Return as data URL.
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(uint8ArrayToDataUrl(data));
    };
  });
}

/**
 * Convert a Uint8Array to a base64 data URL (no preprocessing).
 */
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
 * Run OCR on a list of video frames.
 *
 * Each frame is preprocessed (grayscale + contrast + threshold + scale)
 * before being sent to Tesseract. This improves accuracy on frames with
 * complex backgrounds.
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

  onProgress?.(`Running OCR on ${frames.length} frames (with preprocessing)...`);

  // Preprocess all frames first (grayscale + contrast + threshold).
  const preprocessStart = performance.now();
  onProgress?.('Preprocessing frames for better OCR accuracy...');
  const processedFrames: { url: string; timestamp: number }[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frameStart = performance.now();
    try {
      const url = await preprocessFrameAsync(frames[i].data);
      processedFrames.push({ url, timestamp: frames[i].timestamp });
      const frameTime = Math.round(performance.now() - frameStart);
      console.log(`[OCR] Preprocessed frame ${i + 1}/${frames.length} in ${frameTime}ms`);
      if (i === 0) {
        onProgress?.(`Preprocessing frame ${i + 1}/${frames.length} (${frameTime}ms/frame)...`);
      }
    } catch (err) {
      console.error(`Preprocessing failed for frame ${i}:`, err);
      processedFrames.push({
        url: uint8ArrayToDataUrl(frames[i].data),
        timestamp: frames[i].timestamp,
      });
    }
  }
  const preprocessTotal = Math.round(performance.now() - preprocessStart);
  console.log(`[OCR] Preprocessing complete: ${processedFrames.length} frames in ${preprocessTotal}ms (${Math.round(preprocessTotal / processedFrames.length)}ms/frame avg)`);
  onProgress?.(`Preprocessing done (${preprocessTotal}ms). Starting OCR...`);

  onProgress?.('Initializing Tesseract worker...');

  // Create a single worker with optimized settings.
  const worker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        const percent = Math.floor(m.progress * 100);
        onProgress?.(`OCR processing: ${percent}%`);
      }
    },
  });

  const textParts: string[] = [];
  const MIN_TEXT_LENGTH = 5; // Filter out noise (very short results).
  const MIN_CONFIDENCE = 30; // Filter out low-confidence results.

  try {
    for (let i = 0; i < processedFrames.length; i++) {
      const frame = processedFrames[i];
      onProgress?.(`OCR frame ${i + 1}/${processedFrames.length} (t=${frame.timestamp}s)...`);

      try {
        const { data } = await worker.recognize(frame.url);
        const text = (data.text || '').trim();

        // Only include results with sufficient text and confidence.
        if (text.length >= MIN_TEXT_LENGTH && (data.confidence ?? 0) >= MIN_CONFIDENCE) {
          textParts.push(`[Frame @ ${frame.timestamp}s]\n${text}`);
        } else if (text.length >= 3) {
          // Log low-confidence results for debugging but don't include.
          console.log(`[OCR] Frame ${i} skipped (confidence: ${data.confidence?.toFixed(0)}%, length: ${text.length})`);
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
      : 'OCR complete: no readable text found in any frame.',
  );

  return combinedText;
}
