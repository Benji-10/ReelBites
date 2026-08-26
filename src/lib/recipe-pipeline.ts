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

    // Debug: log what the scraper returned so we can diagnose issues.
    console.log('[Pipeline] Apify scrape result:', {
      videoUrl: post.videoUrl ? `${post.videoUrl.slice(0, 80)}...` : null,
      videoUrlLength: post.videoUrl?.length || 0,
      captionLength: post.caption?.length || 0,
      commentsCount: post.comments?.length || 0,
      author: post.author,
      shortCode: post.shortCode,
      thumbnailUrl: post.thumbnailUrl ? '(present)' : null,
    });

    if (!post.videoUrl) {
      throw new Error(
        'No video URL found in the Instagram post. The Apify actor returned: ' +
          `caption=${post.caption ? `${post.caption.length} chars` : 'null'}, ` +
          `comments=${post.comments?.length || 0}, ` +
          `thumbnail=${post.thumbnailUrl ? 'present' : 'null'}. ` +
          'The post may not contain a video, or the Apify actor did not return one. ' +
          'Check the Apify dashboard at https://console.apify.com to see the raw output.',
      );
    }

    // Validate the video URL looks reasonable.
    try {
      const parsed = new URL(post.videoUrl);
      console.log('[Pipeline] Video URL is valid:', parsed.hostname, parsed.pathname.slice(0, 50));
    } catch {
      throw new Error(
        `The scraper returned an invalid video URL: "${post.videoUrl.slice(0, 100)}". ` +
          'This may indicate the Apify actor returned malformed data.',
      );
    }

    onProgress({
      step: 'scrape',
      message: `Found video from @${post.author || 'unknown'} (${post.videoUrl.length} chars). Caption: ${post.caption?.slice(0, 60) || '(none)'}...`,
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

    // Verify the video file was actually downloaded and has content.
    const { stat } = await import('fs/promises');
    try {
      const videoStats = await stat(videoPath);
      console.log('[Pipeline] Video downloaded:', {
        path: videoPath,
        sizeMB: (videoStats.size / 1024 / 1024).toFixed(2),
      });
      if (videoStats.size < 1000) {
        throw new Error(
          `Downloaded video file is only ${videoStats.size} bytes — the download may have failed. ` +
            'The video URL may have expired or be rate-limited.',
        );
      }
    } catch (statErr) {
      throw new Error(
        `Video file not found after download: ${(statErr as Error).message}. ` +
          'This indicates the download step failed silently.',
      );
    }

    // Step 3: Extract audio.
    // First, verify ffmpeg is available and report its path to the client.
    const { getFfmpegPath } = await import('./video');
    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath) {
      throw new Error(
        'ffmpeg binary not found in the function environment. ' +
          'Tried: /usr/bin/ffmpeg, /usr/local/bin/ffmpeg, /opt/bin/ffmpeg, ' +
          '@ffmpeg-installer/ffmpeg, ffmpeg-static, and PATH lookup. ' +
          'Visit /api/debug/ffmpeg for full diagnostics.',
      );
    }
    onProgress({
      step: 'audio',
      message: `Using ffmpeg at: ${ffmpegPath}`,
      progress: 34,
    });

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
