/**
 * Server-side recipe extraction pipeline.
 *
 * Wraps video processing (ffmpeg) + Gemini extraction into a single call:
 *
 *   video URL
 *     → download (fetch)
 *     → metadata (ffprobe — duration, has-audio)
 *     → audio track (ffmpeg) → Whisper transcript
 *     → frames (ffmpeg)      → Gemini Vision OCR
 *     → Gemini recipe generation (lib/gemini.ts)
 *
 * No-audio reels are handled gracefully: audio extraction failure yields a
 * null transcript and the pipeline continues with caption/OCR only.
 */

import fs from 'fs';
import {
  downloadVideoToFile,
  getVideoMetadata,
  extractAudio,
  extractFrames,
  cleanupFiles,
} from './video';
import { extractTextFromImage } from './ocr';
import { transcribeAudioFromBuffer } from './whisper';
import { generateRecipe } from './gemini';
import type { GeneratedRecipe, InstagramComment } from './types';

export interface ExtractRecipeOptions {
  /** Instagram caption (if already scraped). */
  caption?: string | null;
  /** Instagram comments (if already scraped). */
  comments?: InstagramComment[];
  /** Source URL (the reel permalink). */
  sourceUrl?: string;
  /** Frame extraction interval in seconds (default from env or 2). */
  frameIntervalSeconds?: number;
  /** Max frames to OCR (default from env or 30). */
  maxFrames?: number;
  /** Progress callback. */
  onProgress?: (message: string) => void;
}

/** Read a file as a Buffer, or null on failure. */
function readFileSafe(filePath: string): Buffer | null {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Extract a structured recipe from a video URL.
 *
 * Returns the generated recipe, or null when the pipeline fails at a step
 * that leaves nothing to generate from (e.g. video download failed AND no
 * caption/comments were supplied). Callers should treat null as "extraction
 * failed" and surface their own error.
 */
export async function extractRecipeFromVideo(
  videoUrl: string,
  options: ExtractRecipeOptions = {},
): Promise<GeneratedRecipe | null> {
  const {
    caption = null,
    comments = [],
    sourceUrl = '',
    frameIntervalSeconds,
    maxFrames,
    onProgress,
  } = options;

  const interval = frameIntervalSeconds ?? parseInt(process.env.FRAME_INTERVAL_SECONDS || '2', 10);
  const frameCap = maxFrames ?? parseInt(process.env.MAX_FRAMES_TO_OCR || '30', 10);

  const scratchFiles: string[] = [];

  try {
    let transcript = '';
    let ocrText = '';

    // ---- 1. Download the video -------------------------------------------
    onProgress?.('Downloading video...');
    const videoFile = videoUrl ? await downloadVideoToFile(videoUrl) : null;

    if (videoFile) {
      scratchFiles.push(videoFile);

      // ---- 2. Metadata -----------------------------------------------------
      onProgress?.('Reading video metadata...');
      const metadata = await getVideoMetadata(videoFile);
      console.log('[pipeline] Video metadata:', {
        duration: metadata?.duration ?? null,
        hasAudio: metadata?.hasAudio ?? null,
      });

      // ---- 3. Audio → Whisper transcript ------------------------------------
      // No-audio reels land here quietly: extractAudio returns null and we
      // continue with an empty transcript.
      if (!metadata || metadata.hasAudio) {
        onProgress?.('Extracting audio...');
        const audioFile = await extractAudio(videoFile);
        if (audioFile) {
          scratchFiles.push(audioFile);

          onProgress?.('Transcribing audio (Whisper)...');
          const audioBuffer = readFileSafe(audioFile);
          if (audioBuffer) {
            try {
              transcript = await transcribeAudioFromBuffer(audioBuffer, 'audio/mpeg');
              console.log(`[pipeline] Transcript: ${transcript.length} chars.`);
            } catch (err) {
              // Transcription failure is NOT fatal — caption/OCR may suffice.
              console.warn('[pipeline] Transcription failed:', (err as Error).message);
              transcript = '';
            }
          }
        } else {
          console.log('[pipeline] No audio track — continuing without transcript.');
        }
      } else {
        console.log('[pipeline] Video has no audio stream — skipping transcription.');
      }

      // ---- 4. Frames → OCR ----------------------------------------------------
      onProgress?.(`Extracting frames (every ${interval}s)...`);
      const frames = await extractFrames(videoFile, interval, frameCap);
      scratchFiles.push(...frames);

      if (frames.length > 0) {
        onProgress?.(`Running OCR on ${frames.length} frames...`);
        const frameTexts: string[] = [];

        // OCR frames in small batches to bound request size (5 per call).
        const BATCH = 5;
        for (let i = 0; i < frames.length; i += BATCH) {
          const batch = frames.slice(i, i + BATCH);

          // Concatenate a batch of frames into a single multi-image call by
          // processing each frame and joining the results (simple + reliable).
          for (const frame of batch) {
            const frameBuffer = readFileSafe(frame);
            if (!frameBuffer) continue;

            const text = await extractTextFromImage(frameBuffer.toString('base64'), {
              mimeType: 'image/jpeg',
            });
            if (text) frameTexts.push(text);
          }

          // Small delay to respect free-tier rate limits.
          if (i + BATCH < frames.length) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        // Deduplicate consecutive repeated text (static on-screen captions).
        const seen = new Set<string>();
        const dedupedTexts: string[] = [];
        for (const text of frameTexts) {
          const key = text.replace(/\s+/g, ' ').trim().toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            dedupedTexts.push(text);
          }
        }
        ocrText = dedupedTexts.join('\n\n');
        console.log(`[pipeline] OCR: ${ocrText.length} chars (from ${frameTexts.length} raw).`);
      }
    } else if (videoUrl) {
      console.warn('[pipeline] Video download failed — relying on caption/comments only.');
    }

    // ---- 5. Gemini recipe generation ----------------------------------------
    // If we have NOTHING to work with, bail out.
    if (!caption && comments.length === 0 && !transcript && !ocrText) {
      console.warn('[pipeline] No usable sources — aborting extraction.');
      return null;
    }

    onProgress?.('Generating recipe with Gemini...');
    const recipe = await generateRecipe({
      caption,
      comments,
      transcript,
      ocrText,
      sourceUrl: sourceUrl || videoUrl,
      onProgress,
    });

    // Attach the video URL for downstream use (video proxy, thumbnails).
    recipe.sourceVideoUrl = videoUrl || null;

    return recipe;
  } catch (err) {
    console.error('[pipeline] extractRecipeFromVideo failed:', err);
    return null;
  } finally {
    // ---- 6. Cleanup scratch files --------------------------------------------
    cleanupFiles(scratchFiles);
  }
}
