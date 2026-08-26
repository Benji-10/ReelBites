/**
 * Client-side recipe extraction pipeline.
 *
 * Orchestrates the extraction process entirely from the browser:
 *   1. Call /api/scrape to get the video URL, caption, and comments (server-side Apify)
 *   2. Download the video (client-side fetch)
 *   3. Extract audio with ffmpeg.wasm (client-side)
 *   4. Upload audio to /api/transcribe for Whisper STT (server-side HuggingFace)
 *   5. Extract video frames with ffmpeg.wasm (client-side)
 *   6. Run OCR on frames with Tesseract.js (client-side)
 *   7. Call /api/generate to generate the recipe (server-side Gemini)
 *
 * This hybrid approach keeps all API keys server-side while doing the heavy
 * binary processing (ffmpeg, OCR) client-side via WebAssembly, avoiding the
 * Netlify 250MB function size limit.
 */

import { downloadVideo, extractAudio, extractFrames } from './client-ffmpeg';
import { ocrFrames } from './client-ocr';
import type { GeneratedRecipe, InstagramComment, InstagramPost } from './types';

export type ProgressCallback = (update: {
  step: string;
  message: string;
  progress: number;
}) => void;

/**
 * Run the full extraction pipeline from the client.
 *
 * @param instagramUrl - The Instagram reel URL.
 * @param onProgress - Callback for progress updates.
 * @returns The generated recipe.
 */
export async function runClientPipeline(
  instagramUrl: string,
  onProgress: ProgressCallback,
): Promise<{ recipe: GeneratedRecipe; post: InstagramPost }> {
  // The scrape + download steps are wrapped in a retry loop.
  // If the video download fails (CORS, expired URL, rate limit), we
  // re-scrape to get a fresh video URL and try again.
  let post: InstagramPost | null = null;
  let videoData: Uint8Array | null = null;
  const MAX_RESCRAPE_ATTEMPTS = 3;

  for (let scrapeAttempt = 1; scrapeAttempt <= MAX_RESCRAPE_ATTEMPTS; scrapeAttempt++) {
    // Step 1: Scrape Instagram via server API (Apify).
    onProgress({
      step: 'scrape',
      message: scrapeAttempt === 1
        ? 'Fetching Instagram reel data via Apify...'
        : `Re-scraping for a fresh video URL (attempt ${scrapeAttempt}/${MAX_RESCRAPE_ATTEMPTS})...`,
      progress: 5,
    });

    const scrapeResponse = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: instagramUrl }),
    });

    if (!scrapeResponse.ok) {
      const errorData = await scrapeResponse.json().catch(() => ({ error: 'Scrape failed.' }));
      throw new Error(errorData.error || `Scrape failed: HTTP ${scrapeResponse.status}`);
    }

    const scrapeResult = (await scrapeResponse.json()) as { post: InstagramPost };
    post = scrapeResult.post;

    // Log all comments from the scrape result.
    console.log('[pipeline] All comments from Apify:', JSON.stringify(post.comments, null, 2));
    console.log('[pipeline] Post author:', post.author);
    console.log('[pipeline] Comment authors:', post.comments?.map(c => ({ author: c.author, isAuthor: c.isAuthor, isPinned: c.isPinned, textPreview: c.text.slice(0, 60) })));

    if (!post.videoUrl) {
      throw new Error(
        'No video URL found in the Instagram post. The post may not contain a video.',
      );
    }

    onProgress({
      step: 'scrape',
      message: `Found video from @${post.author || 'unknown'}.`,
      progress: 20,
    });

    // Step 2: Download the video AND fetch comments IN PARALLEL.
    // This saves time — the comment scraper takes 30-60s and runs
    // concurrently with the video download.
    onProgress({
      step: 'download',
      message: 'Downloading video file...',
      progress: 22,
    });

    try {
      // Start both operations in parallel.
      const [videoResult, commentsResult] = await Promise.all([
        downloadVideo(post.videoUrl, (msg) =>
          onProgress({ step: 'download', message: msg, progress: 30 }),
        ),
        (async () => {
          try {
            onProgress({ step: 'scrape', message: 'Fetching comments...', progress: 15 });
            const commentsResponse = await fetch('/api/comments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: instagramUrl, author: post.author }),
            });
            if (commentsResponse.ok) {
              const data = await commentsResponse.json();
              if (data.comments && data.comments.length > 0) {
                // Sort: author first, then pinned, then by likes.
                data.comments.sort((a: InstagramComment, b: InstagramComment) => {
                  if (a.isAuthor && !b.isAuthor) return -1;
                  if (!a.isAuthor && b.isAuthor) return 1;
                  if (a.isPinned && !b.isPinned) return -1;
                  if (!a.isPinned && b.isPinned) return 1;
                  return b.likes - a.likes;
                });
                post.comments = data.comments.slice(0, 10);
                console.log('[pipeline] Comments fetched separately:', {
                  total: data.comments.length,
                  authorComments: data.comments.filter((c: InstagramComment) => c.isAuthor).length,
                  topComments: post.comments.length,
                });
                onProgress({
                  step: 'scrape',
                  message: `Found ${data.comments.length} comments (${data.comments.filter((c: InstagramComment) => c.isAuthor).length} from author).`,
                  progress: 20,
                });
              }
            }
          } catch (err) {
            console.warn('[pipeline] Comment fetch failed:', err);
          }
        })(),
      ]);

      videoData = videoResult;
      break; // Success — exit the retry loop.
    } catch (err) {
      const downloadError = err as Error & { shouldRescrape?: boolean };
      if (downloadError.shouldRescrape && scrapeAttempt < MAX_RESCRAPE_ATTEMPTS) {
        onProgress({
          step: 'download',
          message: `Download failed, getting a fresh video URL...`,
          progress: 22,
        });
        // Loop continues — re-scrape.
      } else {
        throw err; // Max attempts reached, or non-retryable error.
      }
    }
  }

  if (!post || !videoData) {
    throw new Error('Failed to download video after multiple scrape attempts.');
  }

  // Step 3: Extract audio with ffmpeg.wasm (client-side).
  onProgress({
    step: 'audio',
    message: 'Extracting audio track...',
    progress: 35,
  });

  const { audioBase64 } = await extractAudio(videoData, (msg) =>
    onProgress({ step: 'audio', message: msg, progress: 45 }),
  );

  // Step 4: Transcribe audio via server API (Whisper).
  onProgress({
    step: 'whisper',
    message: 'Uploading audio for transcription...',
    progress: 50,
  });

  const transcribeResponse = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: audioBase64, mimeType: 'audio/mpeg' }),
  });

  if (!transcribeResponse.ok) {
    const errorData = await transcribeResponse.json().catch(() => ({ error: 'Transcription failed.' }));
    // Include debug info in the error message if available.
    let errorMessage = errorData.error || `Transcription failed: HTTP ${transcribeResponse.status}`;
    if (errorData.hint) {
      errorMessage += `\n\nHint: ${errorData.hint}`;
    }
    if (errorData.debug && Array.isArray(errorData.debug)) {
      const debugSummary = errorData.debug
        .map((d: { step: string; message: string }) => `[${d.step}] ${d.message}`)
        .join('\n');
      errorMessage += `\n\nDebug log:\n${debugSummary}`;
    }
    throw new Error(errorMessage);
  }

  const { transcript } = (await transcribeResponse.json()) as { transcript: string };

  onProgress({
    step: 'whisper',
    message: `Transcription complete (${transcript.length} chars).`,
    progress: 60,
  });

  // Step 5: Extract video frames with ffmpeg.wasm (client-side).
  let ocrText = '';
  let frames: { data: Uint8Array; timestamp: number }[] = [];
  try {
    onProgress({
      step: 'frames',
      message: 'Extracting video frames (every 0.5s)...',
      progress: 62,
    });

    // 0.5-second interval for better coverage of fast-paced reels.
    // Max 120 frames (covers up to 60 seconds of video).
    frames = await extractFrames(videoData, 0.5, 120, (msg) =>
      onProgress({ step: 'frames', message: msg, progress: 68 }),
    );

    // Step 6: Run OCR on frames (client-side Tesseract.js, batch parallel).
    if (frames.length > 0) {
      onProgress({
        step: 'ocr',
        message: `Analyzing ${frames.length} frames (batch parallel OCR)...`,
        progress: 70,
      });

      // The OCR callback now includes a percent (0-100) for the OCR phase.
      // Map it to the overall pipeline progress: 70% (start) → 85% (end).
      ocrText = await ocrFrames(frames, (msg, ocrPercent) => {
        const mappedPercent = 70 + Math.round((ocrPercent || 0) * 0.15);
        onProgress({ step: 'ocr', message: msg, progress: mappedPercent });
      });
    } else {
      onProgress({
        step: 'ocr',
        message: 'No frames extracted, skipping OCR.',
        progress: 85,
      });
    }
  } catch (err) {
    console.warn('[pipeline] Frame extraction/OCR failed:', err);
    onProgress({
      step: 'ocr',
      message: `OCR skipped: ${(err as Error).message.slice(0, 80)}. Continuing with caption + transcript.`,
      progress: 85,
    });
  }

  // Step 7: Generate recipe via server API (Gemini).
  onProgress({
    step: 'gemini',
    message: 'Generating structured recipe with Gemini...',
    progress: 88,
  });

  // Filter comments for Gemini: only send author comments that contain
  // recipe-related keywords. This ensures Gemini focuses on the actual recipe
  // (often written by the creator in a pinned comment) rather than random
  // viewer comments.
  const RECIPE_KEYWORDS = ['recipe', 'ingredients', 'cup', 'tbsp', 'tsp', 'gram', 'oz', 'lb', 'kg', 'ml', 'temperature', 'bake', 'cook', 'fry', 'mix', 'add', 'stir', 'oven', 'minutes', 'hours', 'serves', 'servings'];

  const allComments = post.comments || [];
  const authorComments = allComments.filter((c) => c.isAuthor);
  const commentsForGemini = authorComments.filter((c) => {
    const lowerText = c.text.toLowerCase();
    return RECIPE_KEYWORDS.some((kw) => lowerText.includes(kw));
  });

  // If no author comments matched keywords, send ALL author comments
  // (the author might have written the recipe without using standard keywords).
  const finalCommentsForGemini = commentsForGemini.length > 0 ? commentsForGemini : authorComments;

  console.log('[pipeline] === COMMENT FILTERING ===');
  console.log('[pipeline] Total comments from Apify:', allComments.length);
  console.log('[pipeline] Author comments:', authorComments.length);
  console.log('[pipeline] Author comments with recipe keywords:', commentsForGemini.length);
  console.log('[pipeline] Final comments sent to Gemini:', finalCommentsForGemini.length);
  console.log('[pipeline] Author comments detail:', authorComments.map(c => ({
    author: c.author,
    isAuthor: c.isAuthor,
    isPinned: c.isPinned,
    text: c.text,
    matchedKeywords: RECIPE_KEYWORDS.filter(kw => c.text.toLowerCase().includes(kw)),
  })));
  console.log('[pipeline] Final comments for Gemini:', finalCommentsForGemini.map(c => ({
    author: c.author,
    text: c.text,
  })));
  console.log('[pipeline] === END COMMENT FILTERING ===');

  const generateResponse = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caption: post.caption,
      comments: finalCommentsForGemini,
      transcript,
      ocrText,
      sourceUrl: instagramUrl,
    }),
  });

  if (!generateResponse.ok) {
    const errorData = await generateResponse.json().catch(() => ({ error: 'Recipe generation failed.' }));
    throw new Error(errorData.error || `Generation failed: HTTP ${generateResponse.status}`);
  }

  const { recipe } = (await generateResponse.json()) as { recipe: GeneratedRecipe };

  // Attach source metadata.
  recipe.imageUrl = post.thumbnailUrl;
  recipe.sourceVideoUrl = post.videoUrl;

  // Check if Gemini determined this is NOT a recipe.
  const isNotRecipe =
    recipe.title.toLowerCase().includes('not a recipe') ||
    recipe.flags.some((f) => f.type === 'not_a_recipe');

  if (isNotRecipe) {
    onProgress({
      step: 'done',
      message: 'This video doesn\'t appear to be a recipe. Not saving.',
      progress: 100,
    });
    // Return the recipe but mark it — the caller should NOT save it.
    return { recipe, post, isRecipe: false };
  }

  onProgress({
    step: 'done',
    message: 'Recipe extraction complete!',
    progress: 100,
  });

  return { recipe, post, isRecipe: true };
}
