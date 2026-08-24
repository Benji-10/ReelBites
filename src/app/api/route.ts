import { NextResponse } from 'next/server';

/**
 * GET /api — health check endpoint.
 * Returns basic app info to verify the deployment is working.
 */
export async function GET() {
  return NextResponse.json({
    name: 'Reel Recipes API',
    version: '1.0.0',
    status: 'ok',
    timestamp: new Date().toISOString(),
    endpoints: {
      extract: 'POST /api/extract — Extract a recipe from an Instagram reel URL',
      recipes: 'GET/POST /api/recipes — List or create recipes',
      recipe: 'GET/PUT/DELETE /api/recipes/:id — Manage a single recipe',
    },
  });
}
