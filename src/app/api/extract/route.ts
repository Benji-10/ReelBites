/**
 * POST /api/extract
 *
 * Runs the full recipe extraction pipeline and streams progress updates
 * to the client via Server-Sent Events (SSE).
 *
 * Request body: { "url": "https://www.instagram.com/reel/..." }
 *
 * SSE event format:
 *   data: {"step":"scrape","message":"...","progress":5,"status":"processing"}\n\n
 *   data: {"step":"done","progress":100,"status":"completed","recipe":{...}}\n\n
 *   data: {"step":"error","message":"...","status":"failed"}\n\n
 */

import { NextRequest } from 'next/server';
import { runExtractionPipeline } from '@/lib/recipe-pipeline';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';
import { isValidInstagramUrl } from '@/lib/apify';
import type { GeneratedRecipe, RecipeIngredient, RecipeInstruction, RecipeMetadata, RecipeFlag } from '@/lib/types';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface SavedRecipeRow {
  id: string;
  title: string;
  description: string | null;
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
  metadata: RecipeMetadata[];
  flags: RecipeFlag[];
  sourceUrl: string | null;
  sourceCaption: string | null;
  sourceComments: unknown;
  transcript: string | null;
  ocrText: string | null;
  imageUrl: string | null;
  sourceVideoUrl: string | null;
}

async function saveRecipeToDb(
  userId: string,
  recipe: GeneratedRecipe,
): Promise<string | null> {
  try {
    const saved = await db.recipe.create({
      data: {
        userId,
        title: recipe.title,
        description: recipe.description,
        ingredients: recipe.ingredients as never,
        instructions: recipe.instructions as never,
        metadata: recipe.metadata as never,
        flags: recipe.flags as never,
        sourceUrl: recipe.sourceUrl,
        sourceCaption: recipe.sourceCaption,
        sourceComments: recipe.sourceComments as never,
        transcript: recipe.transcript,
        ocrText: recipe.ocrText,
        imageUrl: recipe.imageUrl,
        sourceVideoUrl: recipe.sourceVideoUrl,
      },
    });
    return saved.id;
  } catch (err) {
    console.warn('Could not save recipe to DB:', (err as Error).message);
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { url } = body;
  if (!url || typeof url !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Missing "url" field in request body.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!isValidInstagramUrl(url)) {
    return new Response(
      JSON.stringify({
        error: 'Invalid Instagram URL. Must be a reel or post URL from instagram.com.',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const user = getUserFromRequest(request);
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'Authentication required. Please log in.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  await ensureUserInDb(user);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<{
    step: string;
    message: string;
    progress: number;
    status: 'processing' | 'completed' | 'failed';
    error?: string;
    recipe?: SavedRecipeRow;
  }>({
    async start(controller) {
      const send = (data: {
        step: string;
        message: string;
        progress: number;
        status: 'processing' | 'completed' | 'failed';
        error?: string;
        recipe?: SavedRecipeRow;
      }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client may have disconnected.
        }
      };

      try {
        send({
          step: 'start',
          message: 'Starting extraction pipeline...',
          progress: 0,
          status: 'processing',
        });

        const { recipe } = await runExtractionPipeline(url, ({ step, message, progress }) => {
          send({ step, message, progress, status: 'processing' });
        });

        const recipeId = await saveRecipeToDb(user.id, recipe);

        const savedRecipe: SavedRecipeRow = {
          id: recipeId || 'unsaved',
          title: recipe.title,
          description: recipe.description,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
          metadata: recipe.metadata,
          flags: recipe.flags,
          sourceUrl: recipe.sourceUrl,
          sourceCaption: recipe.sourceCaption,
          sourceComments: recipe.sourceComments,
          transcript: recipe.transcript,
          ocrText: recipe.ocrText,
          imageUrl: recipe.imageUrl,
          sourceVideoUrl: recipe.sourceVideoUrl,
        };

        send({
          step: 'done',
          message: recipeId
            ? 'Recipe extracted and saved to your recipe box!'
            : 'Recipe extracted (could not save to DB — check your DATABASE_URL).',
          progress: 100,
          status: 'completed',
          recipe: savedRecipe,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error during extraction.';
        send({
          step: 'error',
          message,
          progress: 0,
          status: 'failed',
          error: message,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
