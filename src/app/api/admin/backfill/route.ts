/**
 * GET /api/admin/backfill
 *
 * ONE-CLICK backfill for ALL Gemini-canonicalized fields across the entire database.
 * Covers:
 *   - Pantry items: genericName, canonicalAncestors, canonicalAttributes, canonicalHardAttributeKeys
 *   - Recipe ingredients: canonicalName, canonicalAncestors, canonicalAttributes, canonicalHardAttributeKeys
 *
 * VERSION-BASED — RESUMABLE:
 *   Each item has a `canonicalVersion` field. The backfill only processes items
 *   where canonicalVersion != CURRENT_CANONICAL_VERSION (or is null). After
 *   processing, it sets canonicalVersion = CURRENT_CANONICAL_VERSION.
 *
 *   This means: if the backfill times out, just re-run it. It will skip all
 *   items that were already updated and continue from where it left off.
 *
 * Usage:
 *   GET /api/admin/backfill              — Backfill pantry + recipes (resumable)
 *   GET /api/admin/backfill?scope=pantry — Only pantry
 *   GET /api/admin/backfill?scope=recipes — Only recipes
 *
 * When to run:
 *   - After deploying a build where the Gemini prompt changed (I'll bump
 *     CURRENT_CANONICAL_VERSION in canonicalize.ts — the backfill will
 *     automatically detect which items need updating).
 *   - After running `prisma db push` to add the canonicalVersion column.
 *
 * Rate limiting:
 *   Gemini free tier allows 15 requests/min. This script waits 4.5s between
 *   API calls to stay under the limit. If a 429 is hit, it retries with
 *   exponential backoff (up to 3 retries).
 *
 * No auth — admin script. Protect at network level or delete after use.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { canonicalizeNames, CURRENT_CANONICAL_VERSION } from '@/lib/canonicalize';
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
  const scope = searchParams.get('scope') || 'all';

  console.log('========================================');
  console.log(`[backfill] START — scope=${scope}, target version=${CURRENT_CANONICAL_VERSION}`);
  console.log('========================================');

  const result = {
    scope,
    targetVersion: CURRENT_CANONICAL_VERSION,
    pantry: { total: 0, needsUpdate: 0, updated: 0, skipped: 0, failed: 0 },
    recipes: { total: 0, needsUpdate: 0, updated: 0, skipped: 0, failed: 0 },
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
          canonicalVersion: true,
        },
      });
      result.pantry.total = items.length;
      console.log(`[backfill:pantry] Found ${items.length} total pantry items.`);

      // Only process items that don't have the current canonical version.
      const needsBackfill = items.filter((item) => {
        return item.canonicalVersion !== CURRENT_CANONICAL_VERSION;
      });

      result.pantry.needsUpdate = needsBackfill.length;
      console.log(`[backfill:pantry] ${needsBackfill.length} items need update (version != ${CURRENT_CANONICAL_VERSION}), ${items.length - needsBackfill.length} already up to date.`);

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
                  canonicalVersion: CURRENT_CANONICAL_VERSION,
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
        console.log(`[backfill:pantry] ✅ All ${items.length} items already at version ${CURRENT_CANONICAL_VERSION} — skipping.`);
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
        select: { id: true, ingredients: true, canonicalVersion: true },
      });
      result.recipes.total = recipes.length;
      console.log(`[backfill:recipes] Found ${recipes.length} total recipes.`);

      // Only process recipes that don't have the current canonical version.
      const needsBackfill = recipes.filter((recipe) => {
        return recipe.canonicalVersion !== CURRENT_CANONICAL_VERSION;
      });

      result.recipes.needsUpdate = needsBackfill.length;
      console.log(`[backfill:recipes] ${needsBackfill.length} recipes need update, ${recipes.length - needsBackfill.length} already up to date.`);

      if (needsBackfill.length === 0) {
        result.recipes.skipped = recipes.length;
        console.log(`[backfill:recipes] ✅ All ${recipes.length} recipes already at version ${CURRENT_CANONICAL_VERSION} — skipping.`);
      } else {
        let processed = 0;
        let rateLimited = false;

        for (const recipe of needsBackfill) {
          processed++;
          const pct = Math.round((processed / needsBackfill.length) * 100);

          try {
            const ingredients = recipe.ingredients as RecipeIngredient[];
            if (!Array.isArray(ingredients) || ingredients.length === 0) {
              // Even if no ingredients, mark as updated so we don't keep trying.
              await db.recipe.update({
                where: { id: recipe.id },
                data: { canonicalVersion: CURRENT_CANONICAL_VERSION },
              });
              result.recipes.updated++;
              console.log(`[backfill:recipes]   ${processed}/${needsBackfill.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: no ingredients, marked as done.`);
              continue;
            }

            // Canonicalize ALL ingredients (since the prompt changed).
            const namesToCanonicalize = ingredients.map((ing) => ing.name);
            const uniqueNames = Array.from(new Set(namesToCanonicalize.filter(Boolean)));
            console.log(`[backfill:recipes]   ${processed}/${needsBackfill.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: canonicalizing ${uniqueNames.length} ingredient(s)...`);

            // Rate-limit: wait before each recipe's API call.
            await sleep(RATE_LIMIT_DELAY_MS);

            const canonicalMap = await canonicalizeWithRetry(uniqueNames, `recipe-${processed}`);

            if (canonicalMap === null) {
              result.rateLimited = true;
              result.recipes.failed++;
              result.nextSteps.push(`Recipe "${recipe.id}": rate limited. Re-run to retry.`);
              console.log(`[backfill:recipes]   ${processed}/${needsBackfill.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: ❌ Rate limited. Stopping recipe phase.`);
              rateLimited = true;
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
              data: {
                ingredients: updatedIngredients as never,
                canonicalVersion: CURRENT_CANONICAL_VERSION,
              },
            });
            result.recipes.updated++;
            console.log(`[backfill:recipes]   ${processed}/${needsBackfill.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: ✅ Updated.`);
          } catch (err) {
            console.error(`[backfill:recipes]   ${processed}/${needsBackfill.length} (${pct}%) — recipe ${recipe.id.slice(-8)}: ❌ Failed:`, err);
            result.recipes.failed++;
          }
        }

        // Count remaining as skipped (not processed due to rate limit or timeout).
        result.recipes.skipped = needsBackfill.length - processed;
        console.log(`[backfill:recipes] ✅ Done. Updated ${result.recipes.updated}, skipped ${result.recipes.skipped} (not yet processed), failed ${result.recipes.failed}.`);

        if (rateLimited || result.recipes.skipped > 0) {
          console.log(`[backfill:recipes] ⏳ ${result.recipes.skipped} recipes were not processed. Re-run the backfill to continue.`);
        }
      }
    } catch (err) {
      console.error('[backfill:recipes] ❌ Recipe backfill failed:', err);
      result.recipes.failed++;
    }
  }

  result.duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

  console.log('========================================');
  console.log(`[backfill] COMPLETE — ${result.duration}`);
  console.log(`[backfill] Pantry:  ${result.pantry.updated} updated, ${result.pantry.skipped} already done, ${result.pantry.failed} failed (of ${result.pantry.total}, ${result.pantry.needsUpdate} needed update)`);
  console.log(`[backfill] Recipes: ${result.recipes.updated} updated, ${result.recipes.skipped} remaining, ${result.recipes.failed} failed (of ${result.recipes.total}, ${result.recipes.needsUpdate} needed update)`);
  if (result.recipes.skipped > 0 || result.pantry.failed > 0) {
    console.log(`[backfill] ⏳ Re-run to continue — ${result.recipes.skipped} recipes + ${result.pantry.failed} pantry items still need processing.`);
  }
  console.log('========================================');

  // Generate next steps.
  if (result.rateLimited) {
    result.nextSteps.unshift('⏳ Rate limited by Gemini. Wait 1 minute, then re-run the same command. It will skip items already updated and continue from where it left off.');
  }
  if (result.recipes.skipped > 0) {
    result.nextSteps.push(`📋 ${result.recipes.skipped} recipes were not processed (timeout or rate limit). Re-run to continue.`);
  }
  if (result.pantry.failed > 0) {
    result.nextSteps.push(`📋 ${result.pantry.failed} pantry items failed. Re-run to retry.`);
  }
  if (result.recipes.skipped === 0 && result.pantry.failed === 0 && result.recipes.failed === 0 && !result.rateLimited) {
    result.nextSteps.push('✅ All done! All items are at the current canonical version.');
  }

  return NextResponse.json({
    message: 'Backfill complete',
    ...result,
    nextSteps: result.nextSteps.length > 0 ? result.nextSteps : ['Done.'],
  });
}
