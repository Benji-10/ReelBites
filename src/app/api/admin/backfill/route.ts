/**
 * GET /api/admin/backfill
 *
 * ONE-CLICK backfill for ALL Gemini-canonicalized fields across the entire database.
 * Covers:
 *   - Pantry items: genericName, canonicalAncestors, canonicalAttributes, canonicalHardAttributeKeys
 *   - Recipe ingredients: canonicalName, canonicalAncestors, canonicalAttributes, canonicalHardAttributeKeys
 *
 * Usage:
 *   1. Backfill only items missing fields (default):
 *      GET /api/admin/backfill
 *
 *   2. Force re-canonicalize EVERYTHING (use after changing the Gemini prompt):
 *      GET /api/admin/backfill?force=1
 *
 *   3. Backfill only pantry (or only recipes):
 *      GET /api/admin/backfill?scope=pantry
 *      GET /api/admin/backfill?scope=recipes
 *
 * Rate limiting:
 *   Gemini free tier allows 15 requests/min. This script waits 4.5s between
 *   API calls to stay under the limit. If a 429 is hit, it retries with
 *   exponential backoff (up to 3 retries).
 *
 * No auth — admin script. Protect at network level or delete after use.
 * Idempotent: only updates items that need it (unless ?force=1).
 * Does NOT write fallback values — if Gemini fails, the item is skipped
 * so it can be retried on the next run.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { canonicalizeNames } from '@/lib/canonicalize';
import type { RecipeIngredient } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

const RATE_LIMIT_DELAY_MS = 4500; // 4.5s between API calls (15/min limit)
const MAX_RETRIES = 3;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call canonicalizeNames with retry logic for 429 errors.
 * Returns null if all retries fail (so the caller can skip without writing bad data).
 */
async function canonicalizeWithRetry(
  names: string[],
): Promise<Map<string, import('@/lib/canonicalize').CanonicalIngredient> | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await canonicalizeNames(names, { throwOnError: true });
      return result;
    } catch (err) {
      const is429 = err instanceof Error && err.message.includes('429');
      const isQuota = err instanceof Error && err.message.includes('quota');

      if (is429 || isQuota) {
        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 60s, 90s, 120s
          const waitMs = 60000 * Math.pow(1.5, attempt);
          console.log(`[backfill] 429 hit, waiting ${waitMs / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
          await sleep(waitMs);
          continue;
        }
      }
      // Non-429 error or out of retries — re-throw.
      throw err;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const searchParams = request.nextUrl.searchParams;
  const force = searchParams.get('force') === '1';
  const scope = searchParams.get('scope') || 'all';

  const result = {
    force,
    scope,
    pantry: { total: 0, updated: 0, skipped: 0, failed: 0 },
    recipes: { total: 0, updated: 0, skipped: 0, failed: 0 },
    rateLimited: false,
    duration: '',
    nextSteps: [] as string[],
  };

  // ===========================================================================
  // PANTRY BACKFILL
  // ===========================================================================
  if (scope === 'all' || scope === 'pantry') {
    try {
      const items = await db.pantryItem.findMany({
        select: {
          id: true,
          name: true,
          genericName: true,
          canonicalAncestors: true,
          canonicalAttributes: true,
          canonicalHardAttributeKeys: true,
        },
      });
      result.pantry.total = items.length;

      const needsBackfill = items.filter((item) => {
        if (force) return true;
        return (
          !item.genericName ||
          !item.canonicalAncestors ||
          !item.canonicalAttributes ||
          item.canonicalHardAttributeKeys === null
        );
      });

      if (needsBackfill.length > 0) {
        const uniqueNames = Array.from(new Set(needsBackfill.map((i) => i.name).filter(Boolean)));

        const canonicalMap = await canonicalizeWithRetry(uniqueNames);

        if (canonicalMap === null) {
          result.rateLimited = true;
          result.pantry.failed = needsBackfill.length;
          result.nextSteps.push('Pantry: rate limited. Wait 1 minute and re-run.');
        } else {
          for (const item of needsBackfill) {
            const canonical = canonicalMap.get(item.name);
            if (!canonical || !canonical.canonical_name) {
              result.pantry.failed++;
              continue;
            }

            try {
              const ancestors = canonical.ancestors.length > 0 ? canonical.ancestors : null;
              const attributes = Object.keys(canonical.attributes).length > 0 ? canonical.attributes : null;
              const hardKeys = canonical.hardAttributeKeys.length > 0 ? canonical.hardAttributeKeys : null;

              await db.pantryItem.update({
                where: { id: item.id },
                data: {
                  genericName: canonical.canonical_name,
                  canonicalAncestors: ancestors as never,
                  canonicalAttributes: attributes as never,
                  canonicalHardAttributeKeys: hardKeys as never,
                },
              });
              result.pantry.updated++;
            } catch (err) {
              console.error(`[backfill] Pantry item ${item.id} failed:`, err);
              result.pantry.failed++;
            }
          }
        }
      } else {
        result.pantry.skipped = items.length;
      }
    } catch (err) {
      console.error('[backfill] Pantry backfill failed:', err);
      result.pantry.failed++;
    }
  }

  // Rate-limit delay between pantry and recipe phases.
  if (scope === 'all') {
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  // ===========================================================================
  // RECIPE BACKFILL
  // ===========================================================================
  if (scope === 'all' || scope === 'recipes') {
    try {
      const recipes = await db.recipe.findMany({
        select: { id: true, ingredients: true },
      });
      result.recipes.total = recipes.length;

      for (const recipe of recipes) {
        try {
          const ingredients = recipe.ingredients as RecipeIngredient[];
          if (!Array.isArray(ingredients) || ingredients.length === 0) {
            result.recipes.skipped++;
            continue;
          }

          const needsBackfill = force || ingredients.some(
            (ing) => !ing.canonicalName ||
              ing.canonicalAncestors === undefined ||
              ing.canonicalAttributes === undefined ||
              ing.canonicalHardAttributeKeys === undefined,
          );

          if (!needsBackfill) {
            result.recipes.skipped++;
            continue;
          }

          const namesToCanonicalize = force
            ? ingredients.map((ing) => ing.name)
            : ingredients
                .filter((ing) => !ing.canonicalName)
                .map((ing) => ing.name);

          if (namesToCanonicalize.length === 0) {
            result.recipes.skipped++;
            continue;
          }

          const uniqueNames = Array.from(new Set(namesToCanonicalize.filter(Boolean)));

          // Rate-limit: wait before each recipe's API call.
          await sleep(RATE_LIMIT_DELAY_MS);

          const canonicalMap = await canonicalizeWithRetry(uniqueNames);

          if (canonicalMap === null) {
            result.rateLimited = true;
            result.recipes.failed++;
            result.nextSteps.push(`Recipe "${recipe.id}": rate limited. Re-run to retry.`);
            // Stop processing more recipes — we're rate limited.
            result.recipes.skipped += recipes.length - result.recipes.updated - result.recipes.failed - result.recipes.skipped;
            break;
          }

          const updatedIngredients = ingredients.map((ing) => {
            const c = canonicalMap.get(ing.name);
            if (c) {
              return {
                ...ing,
                canonicalName: c.canonical_name,
                canonicalAncestors: c.ancestors.length > 0 ? c.ancestors : null,
                canonicalAttributes: Object.keys(c.attributes).length > 0 ? c.attributes : null,
                canonicalHardAttributeKeys: c.hardAttributeKeys.length > 0 ? c.hardAttributeKeys : null,
              };
            }
            return ing;
          });

          await db.recipe.update({
            where: { id: recipe.id },
            data: { ingredients: updatedIngredients as never },
          });
          result.recipes.updated++;
        } catch (err) {
          console.error(`[backfill] Recipe ${recipe.id} failed:`, err);
          result.recipes.failed++;
        }
      }
    } catch (err) {
      console.error('[backfill] Recipe backfill failed:', err);
      result.recipes.failed++;
    }
  }

  result.duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  // Generate next steps.
  if (result.rateLimited) {
    result.nextSteps.unshift('⏳ Rate limited by Gemini. Wait 1 minute, then re-run the same command. Items that failed will be retried automatically.');
  }
  if (result.pantry.failed === 0 && result.recipes.failed === 0 && !result.rateLimited) {
    result.nextSteps.push('✅ All done! No items need backfilling.');
  }
  if (force) {
    result.nextSteps.push('Force mode was used — all items were re-canonicalized.');
  }

  return NextResponse.json({
    message: 'Backfill complete',
    ...result,
    nextSteps: result.nextSteps.length > 0 ? result.nextSteps : ['Done.'],
  });
}
