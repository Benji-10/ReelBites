/**
 * The full recipe extraction pipeline.
 *
 * Orchestrates the following steps in order:
 *   1. Scrape the Instagram reel via Apify (video URL, caption, comments).
 *   2. Download the video to a temp file.
 *   3. Extract the audio track with ffmpeg.
 *   4. Transcribe the audio with Whisper (via HuggingFace).
 *   5. Extract video frames at a fixed interval with ffmpeg.
 *   6. Run OCR (Tesseract.js) on each frame.
 *   7. Send all data to Gemini to generate a structured recipe with evidence.
 *
 * Each step reports progress via the onProgress callback, which the API route
 * forwards to the client via Server-Sent Events (SSE).
 */

import { scrapeInstagramPost } from './apify';
import { downloadVideo, extractAudio, extractFrames, cleanupTempFiles } from './video';
import { transcribeAudio } from './whisper';
import { ocrFrames } from './ocr';
import { generateRecipe } from './gemini';
import type { ExtractionProgress, GeneratedRecipe } from './types';

export type ProgressCallback = (update: {
  step: string;
  message: string;
  progress: number;
}) => void;

export interface PipelineResult {
  recipe: GeneratedRecipe;
}

/**
 * Run the full extraction pipeline.
 *
 * @param instagramUrl - The Instagram reel URL.
 * @param onProgress - Callback for progress updates.
 * @returns The generated recipe.
 */
export async function runExtractionPipeline(
  instagramUrl: string,
  onProgress: ProgressCallback,
): Promise<PipelineResult> {
  let videoPath: string | null = null;

  try {
    // Step 1: Scrape Instagram via Apify.
    onProgress({
      step: 'scrape',
      message: 'Fetching Instagram reel data via Apify...',
      progress: 5,
    });

    const post = await scrapeInstagramPost(instagramUrl, (msg) =>
      onProgress({ step: 'scrape', message: msg, progress: 10 }),
    );

    if (!post.videoUrl) {
      throw new Error(
        'No video URL found in the Instagram post. The post may not contain a video, or the Apify actor did not return one.',
      );
    }

    onProgress({
      step: 'scrape',
      message: `Found video from @${post.author || 'unknown'}. Caption: ${post.caption?.slice(0, 80) || '(none)'}...`,
      progress: 20,
    });

    // Step 2: Download the video.
    onProgress({
      step: 'download',
      message: 'Downloading video file...',
      progress: 22,
    });

    videoPath = await downloadVideo(post.videoUrl, (msg) =>
      onProgress({ step: 'download', message: msg, progress: 28 }),
    );

    // Step 3: Extract audio.
    onProgress({
      step: 'audio',
      message: 'Extracting audio track...',
      progress: 35,
    });

    const audioPath = await extractAudio(videoPath, (msg) =>
      onProgress({ step: 'audio', message: msg, progress: 40 }),
    );

    // Step 4: Transcribe audio with Whisper.
    onProgress({
      step: 'whisper',
      message: 'Transcribing speech with Whisper...',
      progress: 42,
    });

    const transcript = await transcribeAudio(audioPath, (msg) =>
      onProgress({ step: 'whisper', message: msg, progress: 55 }),
    );

    // Step 5: Extract video frames.
    onProgress({
      step: 'frames',
      message: 'Extracting video frames for OCR...',
      progress: 58,
    });

    const intervalSeconds = parseInt(
      process.env.FRAME_INTERVAL_SECONDS || '2',
      10,
    );
    const maxFrames = parseInt(process.env.MAX_FRAMES_TO_OCR || '30', 10);

    const frames = await extractFrames(videoPath, intervalSeconds, maxFrames, (msg) =>
      onProgress({ step: 'frames', message: msg, progress: 62 }),
    );

    // Step 6: Run OCR on frames.
    onProgress({
      step: 'ocr',
      message: 'Running OCR on video frames...',
      progress: 65,
    });

    const { combinedText: ocrText } = await ocrFrames(frames, (msg) =>
      onProgress({ step: 'ocr', message: msg, progress: 80 }),
    );

    // Step 7: Generate recipe with Gemini.
    onProgress({
      step: 'gemini',
      message: 'Generating structured recipe with Gemini...',
      progress: 82,
    });

    const recipe = await generateRecipe({
      caption: post.caption,
      comments: post.comments,
      transcript,
      ocrText,
      sourceUrl: instagramUrl,
      onProgress: (msg) =>
        onProgress({ step: 'gemini', message: msg, progress: 92 }),
    });

    // Attach the source metadata.
    recipe.imageUrl = post.thumbnailUrl;
    recipe.sourceVideoUrl = post.videoUrl;

    onProgress({
      step: 'done',
      message: 'Recipe extraction complete!',
      progress: 100,
    });

    return { recipe };
  } finally {
    // Clean up temp files.
    if (videoPath) {
      try {
        await cleanupTempFiles(videoPath);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}
