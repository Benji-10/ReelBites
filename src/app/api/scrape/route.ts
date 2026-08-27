/**
 * POST /api/scrape
 *
 * Calls Apify to scrape an Instagram reel. Returns the video URL, caption,
 * and comments. This is a lightweight endpoint — only depends on apify-client
 * (~2MB), keeping the Netlify function bundle small.
 *
 * The heavy processing (video download, audio extraction, OCR) is done
 * client-side to avoid bundling ffmpeg/tesseract binaries into the function.
 *
 * Request:  { "url": "https://www.instagram.com/reel/..." }
 * Response: { "videoUrl": "...", "caption": "...", "comments": [...], ... }
 */

import { NextRequest, NextResponse } from 'next/server';
import { scrapeInstagramPost } from '@/lib/apify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Missing "url" field.' }, { status: 400 });
  }

  try {
    const post = await scrapeInstagramPost(url);
    return NextResponse.json({ post });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
