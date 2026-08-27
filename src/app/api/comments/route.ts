/**
 * POST /api/comments
 *
 * Fetches comments for an Instagram post/reel using Apify.
 * This is a separate endpoint so /api/scrape can return quickly with just
 * the video URL and caption (preventing 504 timeouts).
 *
 * The client calls this in parallel with the video download, so the total
 * extraction time is max(scrape, comments) instead of scrape + comments.
 *
 * Request:  { "url": "https://www.instagram.com/reel/...", "author": "username" }
 * Response: { "comments": [...] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchComments } from '@/lib/apify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180; // 3 minutes — comment scraping can be slow.

export async function POST(request: NextRequest) {
  let body: { url?: string; author?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { url, author } = body;
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Missing "url" field.' }, { status: 400 });
  }

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'APIFY_API_TOKEN not set.' }, { status: 500 });
  }

  try {
    const comments = await fetchComments(url, token, author || null);
    return NextResponse.json({ comments });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
