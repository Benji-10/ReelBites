/**
 * Server-side OCR helpers using Gemini Vision.
 *
 * A single image in, extracted text out. Used by the server-side recipe
 * pipeline (frame OCR) and the fridge/receipt scanners.
 *
 * Fails soft: returns null on any error.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export interface OcrOptions {
  /** MIME type of the image. Defaults to image/jpeg. */
  mimeType?: string;
  /** Override the OCR prompt (defaults to a general-purpose OCR prompt). */
  prompt?: string;
  /** Model to use. Defaults to the GEMINI_MODEL env var (must be vision-capable). */
  model?: string;
}

const DEFAULT_OCR_PROMPT = `You are an OCR engine. Extract ALL text visible in this image.

Rules:
- Extract text in ANY language (Chinese, Japanese, Korean, English, etc.)
- Preserve the original text exactly as shown — do NOT translate
- Include numbers, measurements, and units exactly as they appear
- Ignore watermarks, usernames, timestamps, and UI elements
- Separate distinct pieces of text with a blank line
- If no text is visible, return an empty response
- Return ONLY the extracted text, no explanations or formatting`;

/**
 * Extract text from a base64-encoded image using Gemini Vision.
 *
 * @param imageBase64 - raw base64 (no data: prefix) or a full data URL
 *   ("data:image/jpeg;base64,....").
 * @returns The extracted text, or null on any failure.
 */
export async function extractTextFromImage(
  imageBase64: string,
  options: OcrOptions = {},
): Promise<string | null> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[ocr] GEMINI_API_KEY is not set.');
      return null;
    }

    // Accept both raw base64 and data URLs.
    let mimeType = options.mimeType || 'image/jpeg';
    let base64Data = imageBase64;

    const dataUrlMatch = imageBase64.match(/^data:([^;]+);base64,([\s\S]*)$/);
    if (dataUrlMatch) {
      mimeType = options.mimeType || dataUrlMatch[1];
      base64Data = dataUrlMatch[2];
    }

    if (!base64Data || base64Data.length === 0) {
      console.warn('[ocr] Empty image data.');
      return null;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: options.prompt || DEFAULT_OCR_PROMPT },
            { inlineData: { mimeType, data: base64Data } },
          ],
        },
      ],
    });

    const text = result.response.text().trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    console.warn('[ocr] extractTextFromImage failed:', (err as Error).message);
    return null;
  }
}
