/**
 * POST /api/extract
 *
 * Refactored recipe extraction entry point. Delegates to the server-side
 * pipeline in src/lib/recipe-pipeline.ts, which handles video download,
 * audio transcription (Whisper), frame OCR (Gemini Vision), and recipe
 * generation (Gemini) in one call.
 *
 * Request:  { "videoUrl": "...", "caption": "...", "comments": [...], "sourceUrl": "..." }
 * Response: { "recipe": {...} }
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractRecipeFromVideo } from '@/lib/recipe-pipeline';
import type { InstagramComment } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Video processing + Whisper + Gemini can take a while.

export async function POST(request: NextRequest) {
  let body: {
    videoUrl?: string;
    caption?: string | null;
    comments?: InstagramComment[];
    sourceUrl?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { videoUrl, caption, comments, sourceUrl } = body;

  if (!videoUrl && !caption && (!comments || comments.length === 0)) {
    return NextResponse.json(
      { error: 'Provide a videoUrl, a caption, or comments to extract from.' },
      { status: 400 },
    );
  }

  try {
    const recipe = await extractRecipeFromVideo(videoUrl || '', {
      caption: caption || null,
      comments: comments || [],
      sourceUrl: sourceUrl || '',
    });

    if (!recipe) {
      return NextResponse.json(
        { error: 'Could not extract a recipe from this source.' },
        { status: 422 },
      );
    }

    return NextResponse.json({ recipe });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    console.error('[extract] Failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
