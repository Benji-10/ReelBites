/**
 * POST /api/ocr
 *
 * Extracts text from video frames using Google Gemini Vision.
 * Returns a deduplicated chronological narrative — if the same text
 * appears in consecutive frames, it's only included once.
 *
 * Uses the existing GEMINI_API_KEY (no new API key needed).
 *
 * Request:  { "frames": [{ "data": "base64...", "timestamp": 0 }, ...] }
 * Response: { "ocrText": "chronological text narrative (no frame markers)" }
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
      const promptParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

      promptParts.push({
        text: `You are an OCR engine. These ${batch.length} images are consecutive frames from a cooking video (captured every 0.5 seconds).

Rules:
- Extract ALL text visible in the images — in ANY language (Chinese, Japanese, Korean, English, etc.)
- Preserve the original text exactly as shown — do NOT translate
- Include numbers, measurements, and units exactly as they appear
- Ignore watermarks, usernames, timestamps, and UI elements
- DEDUPLICATE: if the same text appears in multiple consecutive frames, only output it ONCE
- Write the text as a flowing narrative, chronologically as it appears in the video
- Do NOT include frame numbers, timestamps, or any metadata — just the text content
- Separate distinct pieces of text with a blank line
- If no text is visible in any frame, return an empty response
- Return ONLY the extracted text, no explanations or formatting`,
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
    }

    // Rate limit: wait 500ms between batches to stay under 15 RPM.
    if (i + BATCH_SIZE < frames.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // If we have multiple batches, use Gemini to consolidate them into
  // a single deduplicated narrative.
  let combinedText: string;

  if (allTextParts.length > 1) {
    console.log('[OCR] Consolidating batch results with Gemini...');

    try {
      const consolidateResult = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [{
            text: `Below is OCR text extracted from multiple batches of video frames. The batches overlap — the same text appears in multiple batches. Consolidate them into a SINGLE clean narrative.

Rules:
- Remove ALL duplicates — if the same text appears multiple times, keep it only once
- Preserve the chronological order (text that appears earlier in the video comes first)
- Keep the original text exactly — do NOT translate or modify
- Do NOT add any explanations, headers, or formatting
- Separate distinct pieces of text with a blank line
- Return ONLY the consolidated text

Here is the raw OCR text from all batches:

${allTextParts.join('\n\n---\n\n')}`,
          }],
        }],
      });

      combinedText = consolidateResult.response.text().trim();
      console.log(`[OCR] Consolidated: ${combinedText.length} chars (from ${allTextParts.join('').length} raw)`);
    } catch (err) {
      console.warn('[OCR] Consolidation failed, using simple dedup:', err);
      combinedText = allTextParts.join('\n\n');
    }
  } else {
    combinedText = allTextParts.join('\n\n');
  }

  // Simple line-level dedup as a final safety net.
  const lines = combinedText.split('\n');
  const dedupedLines: string[] = [];
  let prevLine = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed !== prevLine || trimmed === '') {
      dedupedLines.push(line);
      prevLine = trimmed;
    }
  }
  combinedText = dedupedLines.join('\n').trim();

  console.log(`[OCR] Complete: ${allTextParts.length} batches, ${combinedText.length} chars (deduplicated)`);

  return NextResponse.json({ ocrText: combinedText });
}
