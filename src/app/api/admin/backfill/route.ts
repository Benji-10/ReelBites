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
 * Progress logging:
 *   Every step is logged to the server console so you can watch progress
 *   in the Netlify function logs.
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
  label: string = '',
): Promise<Map<string, import('@/lib/canonicalize').CanonicalIngredient> | null> {
  const prefix = label ? `[backfill:${label}]` : '[backfill]';
  console.log(`${prefix} Calling Gemini with ${names.length} unique name(s)...`);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await canonicalizeNames(names, { throwOnError: true });
      console.log(`${prefix} ✅ Gemini returned ${result.size} canonical entries.`);
      return result;
    } catch (err) {
      const is429 = err instanceof Error && err.message.includes('429');
      const isQuota = err instanceof Error && err.message.includes('quota');

      if (is429 || isQuota) {
        if (attempt < MAX_RETRIES) {
          const waitMs = 60000 * Math.pow(1.5, attempt);
          console.log(`${prefix} ⏳ 429 rate limit hit. Waiting ${waitMs / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
          await sleep(waitMs);
          continue;
        }
        console.error(`${prefix} ❌ 429 rate limit — out of retries.`);
      }
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

  console.log('========================================');
  console.log(`[backfill] START — force=${force}, scope=${scope}`);
  console.log('========================================');

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
    console.log('[backfill:pantry] Phase 1 — Pantry items');
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
      console.log(`[backfill:pantry] Found ${items.length} total pantry items.`);

      const needsBackfill = items.filter((item) => {
        if (force) return true;
        return (
          !item.genericName ||
          !item.canonicalAncestors ||
          !item.canonicalAttributes ||
          item.canonicalHardAttributeKeys === null
        );
      });

      console.log(`[backfill:pantry] ${needsBackfill.length} items need backfill, ${items.length - needsBackfill.length} already up to date.`);

      if (needsBackfill.length > 0) {
        const uniqueNames = Array.from(new Set(needsBackfill.map((i) => i.name).filter(Boolean)));
        console.log(`[backfill:pantry] Deduplicated to ${uniqueNames.length} unique names.`);

        const canonicalMap = await canonicalizeWithRetry(uniqueNames, 'pantry');

        if (canonicalMap === null) {
          result.rateLimited = true;
          result.pantry.failed = needsBackfill.length;
          result.nextSteps.push('Pantry: rate limited. Wait 1 minute and re-run.');
          console.log(`[backfill:pantry] ❌ Rate limited — skipping all ${needsBackfill.length} items.`);
        } else {
          console.log(`[backfill:pantry] Updating database records...`);
          let count = 0;
          for (const item of needsBackfill) {
            count++;
            const canonical = canonicalMap.get(item.name);
            if (!canonical || !canonical.canonical_name) {
              result.pantry.failed++;
              console.log(`[backfill:pantry]   ${count}/${needsBackfill.length} ⚠️  No result for "${item.name}"`);
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

              // Log progress every 5 items or on the last item.
              if (count % 5 === 0 || count === needsBackfill.length) {
                const pct = Math.round((count / needsBackfill.length) * 100);
                console.log(`[backfill:pantry]   ${count}/${needsBackfill.length} (${pct}%) — updated "${item.name}" → "${canonical.canonical_name}"`);
              }
            } catch (err) {
              console.error(`[backfill:pantry]   ${count}/${needsBackfill.length} ❌ Failed "${item.name}":`, err);
              result.pantry.failed++;
            }
          }
          console.log(`[backfill:pantry] ✅ Done. Updated ${result.pantry.updated}, failed ${result.pantry.failed}.`);
        }
      } else {
        result.pantry.skipped = items.length;
        console.log(`[backfill:pantry] ✅ All ${items.length} items already up to date — skipping.`);
      }
    } catch (err) {
      console.error('[backfill:pantry] ❌ Pantry backfill failed:', err);
      result.pantry.failed++;
    }
  }

  // Rate-limit delay between pantry and recipe phases.
  if (scope === 'all') {
    console.log(`[backfill] Waiting ${RATE_LIMIT_DELAY_MS / 1000}s before recipe phase...`);
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  // ===========================================================================
  // RECIPE BACKFILL
  // ===========================================================================
  if (scope === 'all' || scope === 'recipes') {
    console.log('[backfill:recipes] Phase 2 — Recipe ingredients');
    try {
      const recipes = await db.recipe.findMany({
        select: { id: true, ingredients: true },
      });
      result.recipes.total = recipes.length;
      console.log(`[backfill:recipes] Found ${recipes.length} total recipes.`);

      let processed = 0;
      for (const recipe of recipes) {
        processed++;
        const pct = Math.round((processed / recipes.length) * 100);

        try {
          const ingredients = recipe.ingredients as RecipeIngredient[];
          if (!Array.isArray(ingredients) || ingredients.length === 0) {
            result.recipes.skipped++;
            console.log(`[backfill:recipes]   ${processed}/${recipes.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: no ingredients, skipped.`);
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
            console.log(`[backfill:recipes]   ${processed}/${recipes.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: already canonicalized, skipped.`);
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
          console.log(`[backfill:recipes]   ${processed}/${recipes.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: canonicalizing ${uniqueNames.length} ingredient(s)...`);

          // Rate-limit: wait before each recipe's API call.
          await sleep(RATE_LIMIT_DELAY_MS);

          const canonicalMap = await canonicalizeWithRetry(uniqueNames, `recipe-${processed}`);

          if (canonicalMap === null) {
            result.rateLimited = true;
            result.recipes.failed++;
            result.nextSteps.push(`Recipe "${recipe.id}": rate limited. Re-run to retry.`);
            console.log(`[backfill:recipes]   ${processed}/${recipes.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: ❌ Rate limited. Stopping recipe phase.`);
            // Stop processing more recipes — we're rate limited.
            result.recipes.skipped += recipes.length - processed;
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
          console.log(`[backfill:recipes]   ${processed}/${recipes.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: ✅ Updated.`);
        } catch (err) {
          console.error(`[backfill:recipes]   ${processed}/${recipes.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: ❌ Failed:`, err);
          result.recipes.failed++;
        }
      }
      console.log(`[backfill:recipes] ✅ Done. Updated ${result.recipes.updated}, skipped ${result.recipes.skipped}, failed ${result.recipes.failed}.`);
    } catch (err) {
      console.error('[backfill:recipes] ❌ Recipe backfill failed:', err);
      result.recipes.failed++;
    }
  }

  result.duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  console.log('========================================');
  console.log(`[backfill] COMPLETE — ${result.duration}`);
  console.log(`[backfill] Pantry:  ${result.pantry.updated} updated, ${result.pantry.skipped} skipped, ${result.pantry.failed} failed (of ${result.pantry.total})`);
  console.log(`[backfill] Recipes: ${result.recipes.updated} updated, ${result.recipes.skipped} skipped, ${result.recipes.failed} failed (of ${result.recipes.total})`);
  console.log('========================================');

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
