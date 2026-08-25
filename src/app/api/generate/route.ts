/**
 * POST /api/generate
 *
 * Sends the collected caption, comments, transcript, and OCR text to Gemini
 * to generate a structured recipe with evidence-backed flags.
 *
 * Request:  { "caption": "...", "comments": [...], "transcript": "...", "ocrText": "...", "sourceUrl": "..." }
 * Response: { "recipe": {...} }
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateRecipe } from '@/lib/gemini';
import type { InstagramComment } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let body: {
    caption?: string | null;
    comments?: InstagramComment[];
    transcript?: string;
    ocrText?: string;
    sourceUrl?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const recipe = await generateRecipe({
      caption: body.caption || null,
      comments: body.comments || [],
      transcript: body.transcript || '',
      ocrText: body.ocrText || '',
      sourceUrl: body.sourceUrl || '',
    });
    return NextResponse.json({ recipe });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
