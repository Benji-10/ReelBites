import { NextResponse } from 'next/server';

/**
 * GET /api — health check endpoint.
 * Returns basic app info to verify the deployment is working.
 */
export async function GET() {
  return NextResponse.json({
    name: 'RealBites API',
    version: '1.0.0',
    status: 'ok',
    timestamp: new Date().toISOString(),
    endpoints: {
      scrape: 'POST /api/scrape — Calls Apify to get video URL, caption',
      comments: 'POST /api/comments — Fetches comments via comment scraper',
      transcribe: 'POST /api/transcribe — Calls Groq Whisper with base64 audio',
      generate: 'POST /api/generate — Calls Gemini to generate the recipe',
      recipes: 'GET/POST /api/recipes — List or create recipes',
      recipe: 'GET/PUT/DELETE /api/recipes/:id — Manage a single recipe',
      settings: 'GET/PUT /api/settings — User settings sync',
      health: 'GET /api/debug/health — Check env vars are configured',
    },
  });
}
