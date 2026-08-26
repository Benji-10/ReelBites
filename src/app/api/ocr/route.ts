/**
 * POST /api/ocr
 *
 * Extracts text from video frames using Google Gemini Vision.
 * Gemini is multimodal — it can read text from images in ANY language
 * (Chinese, Japanese, Korean, English, etc.) and handles complex backgrounds
 * far better than Tesseract.
 *
 * Uses the existing GEMINI_API_KEY (no new API key needed).
 *
 * Request:  { "frames": [{ "data": "base64...", "timestamp": 0 }, ...] }
 * Response: { "ocrText": "combined text from all frames" }
 *
 * Cost: Free tier supports 15 requests/minute. Each request handles up to
 * 10 frames, so 57 frames = 6 requests ≈ 1-2 minutes total.
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const BATCH_SIZE = 10;

export async function POST(request: NextRequest) {
  let body: { frames?: Array<{ data: string; timestamp: number }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { frames } = body;
  if (!frames || !Array.isArray(frames) || frames.length === 0) {
    return NextResponse.json({ error: 'No frames provided.' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set.' }, { status: 500 });
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const allTextParts: string[] = [];
  console.log(`[OCR] Processing ${frames.length} frames in batches of ${BATCH_SIZE}...`);

  // Process frames in batches.
  for (let i = 0; i < frames.length; i += BATCH_SIZE) {
    const batch = frames.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(frames.length / BATCH_SIZE);
    console.log(`[OCR] Batch ${batchNum}/${totalBatches}: ${batch.length} frames`);

    try {
      // Build the prompt with inline images.
      const promptParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

      promptParts.push({
        text: `You are an OCR engine. Extract ALL text visible in these ${batch.length} images from a cooking video. 

Rules:
- Extract text in ANY language (Chinese, Japanese, Korean, English, etc.)
- Preserve the original text exactly as shown — do not translate
- Include numbers, measurements, and units exactly as they appear
- Ignore watermarks, usernames, and UI elements
- If text appears in multiple frames, deduplicate it
- Return ONLY the extracted text, one piece per line, no explanations
- If no text is visible, return an empty response

Format each text block as:
[Frame @ Xs]
<extracted text>

Where X is the timestamp in seconds.`,
      });

      // Add each frame as an inline image.
      for (const frame of batch) {
        promptParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: frame.data,
          },
        });
      }

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: promptParts }],
      });

      const text = result.response.text().trim();
      if (text && text.length > 0) {
        allTextParts.push(text);
        console.log(`[OCR] Batch ${batchNum}: extracted ${text.length} chars`);
      } else {
        console.log(`[OCR] Batch ${batchNum}: no text found`);
      }
    } catch (err) {
      console.error(`[OCR] Batch ${batchNum} failed:`, (err as Error).message);
      // Continue to next batch.
    }

    // Rate limit: wait 500ms between batches to stay under 15 RPM.
    if (i + BATCH_SIZE < frames.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const combinedText = allTextParts.join('\n\n---\n\n');
  console.log(`[OCR] Complete: ${allTextParts.length} batches, ${combinedText.length} total chars`);

  return NextResponse.json({ ocrText: combinedText });
}
