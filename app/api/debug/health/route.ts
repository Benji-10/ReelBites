/**
 * GET /api/debug/health
 *
 * Server health check endpoint. Verifies that the server-side API
 * dependencies are configured correctly (without revealing the actual keys).
 *
 * Visit this endpoint at https://your-site.netlify.app/api/debug/health
 * to check if all required environment variables are set.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks = {
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      isNetlify: !!process.env.NETLIFY,
      isLambda: !!process.env.AWS_LAMBDA_FUNCTION_NAME,
    },
    envVars: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      APIFY_API_TOKEN: !!process.env.APIFY_API_TOKEN,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      GEMINI_MODEL: process.env.GEMINI_MODEL || '(not set, using default)',
      GROQ_API_KEY: !!process.env.GROQ_API_KEY,
      WHISPER_MODEL: process.env.WHISPER_MODEL || '(not set, using default)',
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || '(not set)',
    },
    endpoints: {
      scrape: 'POST /api/scrape — Calls Apify to get video URL, caption, comments',
      transcribe: 'POST /api/transcribe — Calls Groq Whisper with base64 audio',
      generate: 'POST /api/generate — Calls Gemini to generate the recipe',
      recipes: 'GET/POST /api/recipes — List or create recipes in Neon DB',
      recipe: 'GET/PUT/DELETE /api/recipes/:id — Manage a single recipe',
    },
    architecture: 'Hybrid: client-side WASM (ffmpeg, OCR) + server-side API calls',
  };

  const allConfigured =
    checks.envVars.DATABASE_URL &&
    checks.envVars.APIFY_API_TOKEN &&
    checks.envVars.GEMINI_API_KEY &&
    checks.envVars.GROQ_API_KEY;

  return NextResponse.json(
    { ...checks, allConfigured },
    { status: allConfigured ? 200 : 500 },
  );
}
