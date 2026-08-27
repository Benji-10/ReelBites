/**
 * GET /api/video-proxy?videoUrl=<url>
 *
 * Proxies a video download from Instagram's CDN to avoid CORS issues.
 * Instagram's CDN (instagram.f*.fna.fbcdn.net) does not send CORS headers,
 * so the browser blocks direct fetches from a different origin.
 *
 * This endpoint fetches the video server-side and streams it back to the
 * client with the appropriate CORS headers.
 *
 * The videoUrl must be URL-encoded as a query parameter.
 */

import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const videoUrl = request.nextUrl.searchParams.get('videoUrl');

  if (!videoUrl) {
    return new Response(JSON.stringify({ error: 'Missing videoUrl parameter.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate the URL is from Instagram/Facebook CDN.
  try {
    const parsed = new URL(videoUrl);
    const isAllowed =
      parsed.hostname.includes('fbcdn.net') ||
      parsed.hostname.includes('cdninstagram') ||
      parsed.hostname.includes('instagram.com');
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: 'URL must be from Instagram CDN.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(videoUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `CDN returned ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stream the video back to the client.
    const headers = new Headers();
    headers.set('Content-Type', response.headers.get('content-type') || 'video/mp4');
    headers.set('Content-Length', response.headers.get('content-length') || '');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'no-cache');

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Proxy fetch failed: ${(err as Error).message}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
