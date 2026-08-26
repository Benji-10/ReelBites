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

  // Step 5: Generate recipe via Gemini — WITHOUT OCR first.
  // Most recipe reels have the recipe in the caption, transcript, or author
  // comments. Frame extraction + OCR is slow (2-5 minutes) and often fails.
  // By trying Gemini first, we can skip OCR entirely for most reels.
  onProgress({
    step: 'gemini',
    message: 'Generating recipe from caption + transcript + comments...',
    progress: 65,
  });

  // Filter comments for Gemini: only send author comments that contain
  // recipe-related keywords.
  const RECIPE_KEYWORDS = ['recipe', 'ingredients', 'cup', 'tbsp', 'tsp', 'gram', 'oz', 'lb', 'kg', 'ml', 'temperature', 'bake', 'cook', 'fry', 'mix', 'add', 'stir', 'oven', 'minutes', 'hours', 'serves', 'servings'];

  const allComments = post.comments || [];
  const authorComments = allComments.filter((c) => c.isAuthor);
  const commentsForGemini = authorComments.filter((c) => {
    const lowerText = c.text.toLowerCase();
    return RECIPE_KEYWORDS.some((kw) => lowerText.includes(kw));
  });
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
  console.log('[pipeline] === END COMMENT FILTERING ===');

  // First attempt: caption + transcript + comments (no OCR).
  const firstResponse = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caption: post.caption,
      comments: finalCommentsForGemini,
      transcript,
      ocrText: '', // No OCR yet.
      sourceUrl: instagramUrl,
    }),
  });

  if (!firstResponse.ok) {
    const errorData = await firstResponse.json().catch(() => ({ error: 'Recipe generation failed.' }));
    throw new Error(errorData.error || `Generation failed: HTTP ${firstResponse.status}`);
  }

  const firstResult = (await firstResponse.json()) as { recipe: GeneratedRecipe };
  let recipe = firstResult.recipe;
  recipe.imageUrl = post.thumbnailUrl;
  recipe.sourceVideoUrl = post.videoUrl;

  // Use Gemini's food_hint and needs_ocr fields (supports any language).
  const hasFoodHint = recipe.foodHint ?? false;
  const needsOcr = recipe.needsOcr ?? false;

  // Check if Gemini explicitly said this is NOT a recipe.
  const titleSaysNotRecipe = recipe.title.toLowerCase().includes('not a recipe');

  // Check if the recipe is "complete enough" — does it have ingredients with
  // amounts and at least 2 instructions?
  const hasGoodIngredients = recipe.ingredients.length >= 2 &&
    recipe.ingredients.some((ing) => ing.amount || ing.flag === 'estimated_amount');
  const hasGoodInstructions = recipe.instructions.length >= 2;

  // Decision tree:
  // 1. If recipe is complete → done (skip OCR)
  // 2. If Gemini says needs_ocr → try OCR
  // 3. If Gemini says "not a recipe" AND no food hints → not a recipe (don't save)
  // 4. If food hints detected but recipe incomplete → try OCR
  // 5. If recipe is incomplete (missing ingredients/steps) → try OCR

  if (hasGoodIngredients && hasGoodInstructions && !needsOcr) {
    // Case 1: Complete recipe — skip OCR.
    console.log('[pipeline] Recipe looks complete without OCR. Skipping frame extraction.');
    onProgress({
      step: 'done',
      message: 'Recipe extracted successfully (no OCR needed).',
      progress: 100,
    });
    return { recipe, post, isRecipe: true };
  }

  if (needsOcr) {
    // Case 2: Gemini explicitly says OCR is needed.
    console.log('[pipeline] Gemini says OCR needed. Extracting frames...');
    onProgress({
      step: 'frames',
      message: 'Checking video for on-screen recipe text...',
      progress: 70,
    });
  } else if (titleSaysNotRecipe && !hasFoodHint) {
    // Case 3: Not a recipe, no food hints — don't save.
    console.log('[pipeline] Not a recipe (no food hints). Not saving.');
    onProgress({
      step: 'done',
      message: "This video doesn't appear to be a recipe. Not saving.",
      progress: 100,
    });
    return { recipe, post, isRecipe: false };
  } else if (hasFoodHint) {
    // Case 4: Food hints but recipe incomplete — try OCR.
    console.log('[pipeline] Food-related content detected but recipe incomplete. Trying OCR...');
    onProgress({
      step: 'frames',
      message: 'Caption mentions food — checking video for on-screen recipe...',
      progress: 70,
    });
  } else {
    // Case 5: Incomplete recipe — try OCR for missing info.
    console.log('[pipeline] Recipe incomplete. Running OCR for more data...');
    onProgress({
      step: 'frames',
      message: 'Recipe needs more data. Extracting video frames for OCR...',
      progress: 70,
    });
  }

  let ocrText = '';
  try {
    const frames = await extractFrames(videoData, 0.5, 120, (msg) =>
      onProgress({ step: 'frames', message: msg, progress: 75 }),
    );

    if (frames.length > 0) {
      onProgress({
        step: 'ocr',
        message: `Analyzing ${frames.length} frames with Gemini Vision...`,
        progress: 80,
      });

      // Convert frames to base64 and send to /api/ocr (Gemini Vision).
      const BATCH_SIZE = 10;
      const allOcrText: string[] = [];

      for (let i = 0; i < frames.length; i += BATCH_SIZE) {
        const batch = frames.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(frames.length / BATCH_SIZE);
        onProgress({
          step: 'ocr',
          message: `OCR batch ${batchNum}/${totalBatches} (${i + batch.length}/${frames.length} frames)...`,
          progress: 80 + Math.round((i / frames.length) * 10),
        });

        // Convert frames to base64 (they're already Uint8Array JPEGs).
        const framesData = batch.map((f) => {
          let binary = '';
          const chunkSize = 8192;
          for (let j = 0; j < f.data.length; j += chunkSize) {
            const chunk = f.data.subarray(j, j + chunkSize);
            binary += String.fromCharCode(...chunk);
          }
          return { data: btoa(binary), timestamp: f.timestamp };
        });

        try {
          const ocrResponse = await fetch('/api/ocr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frames: framesData }),
          });

          if (ocrResponse.ok) {
            const ocrResult = await ocrResponse.json();
            if (ocrResult.ocrText) {
              allOcrText.push(ocrResult.ocrText);
            }
          }
        } catch (err) {
          console.warn(`[pipeline] OCR batch ${batchNum} failed:`, err);
        }
      }

      ocrText = allOcrText.join('\n\n---\n\n');
      onProgress({
        step: 'ocr',
        message: ocrText
          ? `OCR complete: ${ocrText.length} chars extracted.`
          : 'OCR complete: no text found.',
        progress: 90,
      });
    }
  } catch (err) {
    console.warn('[pipeline] Frame extraction/OCR failed:', err);
    onProgress({
      step: 'ocr',
      message: `OCR skipped: ${(err as Error).message.slice(0, 60)}. Using initial recipe.`,
      progress: 90,
    });
  }

  // Step 7: Re-generate recipe WITH OCR text.
  if (ocrText.length > 0) {
    onProgress({
      step: 'gemini',
      message: 'Re-generating recipe with OCR data...',
      progress: 92,
    });

    const secondResponse = await fetch('/api/generate', {
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

    if (secondResponse.ok) {
      const secondResult = (await secondResponse.json()) as { recipe: GeneratedRecipe };
      // Only use the second result if it's better (more ingredients).
      if (secondResult.recipe.ingredients.length >= recipe.ingredients.length) {
        recipe = secondResult.recipe;
        recipe.imageUrl = post.thumbnailUrl;
        recipe.sourceVideoUrl = post.videoUrl;
      }
    }
  }

  onProgress({
    step: 'done',
    message: 'Recipe extraction complete!',
    progress: 100,
  });

  return { recipe, post, isRecipe: true };
}
