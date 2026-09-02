/**
 * POST /api/pantry-recipes
 *
 * Generates high-quality recipe suggestions from the user's pantry items.
 *
 * Modes:
 *   - "inspiration": Use pantry as a starting point. The AI can add common
 *     staples (oil, salt, spices) and suggest recipes that use key pantry
 *     ingredients but may require a few additional purchases.
 *   - "strict": Use ONLY what's in the pantry. No additional ingredients
 *     allowed. The AI must work within the constraints.
 *
 * Returns 5 recipes in the same format as regular recipes, ready to be
 * viewed, cooked, and optionally added to the recipe box.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { canonicalizeNames, CURRENT_CANONICAL_VERSION } from '@/lib/canonicalize';
import type { RecipeIngredient, RecipeInstruction, RecipeMetadata, RecipeFlag } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface PantryItemInput {
  name: string;
  genericName: string | null;
  category: string | null;
  quantity: string | null;
  isRunningLow: boolean;
}

interface GeneratedRecipeRaw {
  title: string;
  description: string;
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
  metadata: RecipeMetadata[];
  flags: RecipeFlag[];
  tags: string[];
}

function buildPrompt(args: {
  pantryItems: PantryItemInput[];
  mode: 'inspiration' | 'strict';
  servings: number;
}): string {
  const { pantryItems, mode, servings } = args;

  // Group pantry items by category for the AI.
  const byCategory: Record<string, string[]> = {};
  for (const item of pantryItems) {
    const cat = item.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item.name);
  }

  const pantryList = Object.entries(byCategory)
    .map(([cat, items]) => `${cat}: ${items.join(', ')}`)
    .join('\n');

  const modeInstructions =
    mode === 'strict'
      ? `STRICT MODE — You can ONLY use ingredients from the pantry list below.
- Do NOT invent ingredients that aren't in the pantry.
- Common staples (salt, pepper, water, cooking oil) are assumed to be available even if not listed — use them freely.
- If the pantry lacks a key ingredient for a dish, choose a different dish that works with what's available.
- Be creative: combine ingredients in unexpected but delicious ways.
- Do NOT just throw everything in a pan. Each recipe should be a thoughtfully constructed dish.`
      : `INSPIRATION MODE — Use the pantry as inspiration.
- Identify the key proteins, vegetables, and flavor-makers in the pantry.
- Create recipes that showcase those ingredients.
- You CAN add common staples (oil, salt, pepper, spices, basic aromatics like onion/garlic if not in pantry) as needed.
- You can suggest 1-2 additional ingredients per recipe that would elevate the dish (mark them with flag "suggested_addition").
- But the pantry ingredients should be the STARS of each recipe.`;

  return `You are a professional chef and recipe developer creating recipes for a home cook.

${modeInstructions}

AVAILABLE PANTRY ITEMS:
${pantryList}

Create 5 DISTINCT, high-quality recipes. Each recipe must be:
1. A real, cookable dish — not a hodgepodge or "leftover special".
2. Thoughtfully constructed with proper technique (searing, braising, roasting, etc.).
3. Flavor-balanced (acid, fat, salt, heat, umami).
4. Specific — give exact amounts, times, and temperatures.
5. Diverse — don't make 5 pasta dishes. Vary the cuisine, cooking method, and meal type.

QUALITY BAR:
- Each recipe should be something you'd be proud to serve to guests.
- Include proper seasoning at each stage (not just "add salt" at the end).
- Include a cooking technique (don't just say "cook until done").
- Specify doneness cues (internal temp, visual cues, texture).
- Include rest/finish steps where appropriate.

INGREDIENT NAMING:
- Use natural, descriptive ingredient names as a home cook would say them.
- Include variety/type information when it matters: "Japanese rice", "short grain rice", "long grain rice" — these are different ingredients with different cooking properties.
- Keep names clean and natural — no brand names or marketing words.
- Example: "Pietro Dressing (Wafu)" → "wafu dressing" (use the generic cooking term)
- Example: "Mushroom Farms Mushrooms" → "mushrooms"
- But "Japanese short grain rice" is fine — that's useful information for a cook.

SERVINGS:
- Each recipe should serve ${servings} people.
- Scale all ingredient amounts to feed ${servings} servings.

For EACH recipe, provide:
- title: A specific, appetizing name (e.g. "Crispy Skin Chicken Thighs with Roasted Root Veg" not "Chicken and Vegetables")
- description: 1-2 sentences explaining the dish and why it's good
- ingredients: Array of { name, amount, unit, notes, evidence: "ai_generated", flag: null }
  - Use exact amounts (e.g. "2", "1.5", "1/2")
  - Use proper units (cups, tbsp, tsp, g, ml, cloves, etc.)
  - If in inspiration mode and suggesting an ingredient NOT in the pantry, set flag to "suggested_addition"
- instructions: Array of { step, evidence: "ai_generated", flag: null, ingredientRefs: [indices] }
  - Each step should be specific and actionable
  - Include cooking times, temperatures, and visual/texture cues
  - ingredientRefs: array of 0-based indices of ingredients used in that step (empty array if none)
- metadata: Array of { key, value, evidence: "ai_generated", flag: null }
  - ALWAYS include: servings (set to ${servings}), prepTime, cookTime, totalTime, difficulty, cuisine
  - Optionally: nutrition (rough estimate), equipment
- flags: Array of { type, message, field, severity } — only if needed (e.g. "suggested_addition" warnings)
- tags: Array of 2-5 relevant tags (e.g. "dinner", "high-protein", "30-minute", "one-pan")

OUTPUT FORMAT:
Return a JSON object with a "recipes" array containing 5 recipe objects.
Return ONLY the JSON, no markdown fences, no explanation.

{
  "recipes": [
    {
      "title": "...",
      "description": "...",
      "ingredients": [...],
      "instructions": [...],
      "metadata": [...],
      "flags": [...],
      "tags": [...]
    },
    ...
  ]
}

Remember: 5 DISTINCT, high-quality recipes. Make them genuinely good.`;
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  let body: { mode?: 'inspiration' | 'strict'; servings?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const mode: 'inspiration' | 'strict' = body.mode === 'strict' ? 'strict' : 'inspiration';
  const servings = body.servings && body.servings > 0 && body.servings <= 20 ? body.servings : 4;

  // Fetch the user's pantry items.
  const pantryItemsRaw = await db.pantryItem.findMany({
    where: { userId: user.id },
    select: {
      name: true,
      genericName: true,
      category: true,
      quantity: true,
      isRunningLow: true,
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  if (pantryItemsRaw.length === 0) {
    return NextResponse.json({
      error: 'Your pantry is empty. Add some ingredients first, then try generating recipes!',
    }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not set.' }, { status: 500 });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      generationConfig: {
        temperature: 0.7, // Higher temperature for creative recipe ideas.
        maxOutputTokens: 32768, // Increased — 5 detailed recipes need a lot of tokens.
        responseMimeType: 'application/json',
      },
    });

    const prompt = buildPrompt({ pantryItems: pantryItemsRaw, mode, servings });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Robust JSON parsing — Gemini sometimes returns extra text after the JSON
    // or truncates it if maxOutputTokens is exceeded.
    let parsed: { recipes: GeneratedRecipeRaw[] };

    // Strategy 1: Try direct parse.
    try {
      parsed = JSON.parse(text);
    } catch {
      // Strategy 2: Try to extract the first valid JSON object using a brace-matching
      // approach. This handles cases where Gemini appends text after the JSON.
      const jsonStart = text.indexOf('{');
      if (jsonStart === -1) {
        throw new Error('Gemini response did not contain any JSON object.');
      }

      // Walk through the string counting braces to find the matching close.
      let depth = 0;
      let inString = false;
      let escape = false;
      let jsonEnd = -1;

      for (let i = jsonStart; i < text.length; i++) {
        const char = text[i];

        if (escape) {
          escape = false;
          continue;
        }

        if (char === '\\') {
          escape = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }

      if (jsonEnd === -1) {
        // Strategy 3: The JSON is likely truncated (hit maxOutputTokens).
        // Try to repair it by closing all open braces/arrays.
        console.warn('[pantry-recipes] JSON appears truncated, attempting repair...');

        // Count unclosed braces and brackets
        let openBraces = 0;
        let openBrackets = 0;
        let inStr = false;
        let esc = false;

        for (let i = jsonStart; i < text.length; i++) {
          const char = text[i];
          if (esc) { esc = false; continue; }
          if (char === '\\') { esc = true; continue; }
          if (char === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (char === '{') openBraces++;
          else if (char === '}') openBraces--;
          else if (char === '[') openBrackets++;
          else if (char === ']') openBrackets--;
        }

        // Try to close everything. First, trim any trailing incomplete content.
        let repaired = text.slice(jsonStart);

        // Remove trailing incomplete string/property
        // Find the last complete element (look for last comma at depth 1)
        // This is heuristic — if it fails, we still have strategies below.

        // Close open brackets and braces
        for (let i = 0; i < openBrackets; i++) repaired += ']';
        for (let i = 0; i < openBraces; i++) repaired += '}';

        try {
          parsed = JSON.parse(repaired);
          console.log('[pantry-recipes] JSON repair succeeded — got', parsed.recipes?.length || 0, 'recipes.');
        } catch (repairErr) {
          console.error('[pantry-recipes] JSON repair failed:', repairErr);

          // Strategy 4: Try to extract individual recipe objects from the truncated text.
          // Look for { "title" patterns and extract what we can.
          const recipeMatches = text.match(/\{\s*"title"\s*:[^}]*\}/g);
          if (recipeMatches && recipeMatches.length > 0) {
            console.warn(`[pantry-recipes] Extracted ${recipeMatches.length} partial recipe objects from truncated response.`);
            // This won't have full data, but at least we can try.
            throw new Error(
              `Gemini response was truncated (got ${recipeMatches.length} partial recipes). ` +
              `Try reducing the number of recipes or simplifying the prompt.`
            );
          }

          throw new Error(
            'Could not parse Gemini response as JSON. The response may have been truncated. ' +
            `Response length: ${text.length} chars. First 200 chars: ${text.slice(0, 200)}`
          );
        }
      } else {
        // Found the matching close brace — extract just the JSON.
        const jsonStr = text.slice(jsonStart, jsonEnd);
        parsed = JSON.parse(jsonStr);
      }
    }

    if (!parsed.recipes || !Array.isArray(parsed.recipes) || parsed.recipes.length === 0) {
      throw new Error('Gemini did not return any recipes.');
    }

    console.log(`[pantry-recipes] Successfully parsed ${parsed.recipes.length} recipes.`);

    // Canonicalize ALL ingredient names across all 5 recipes in ONE batch
    // (much more efficient than canonicalizing per-recipe).
    const allIngredientNames = Array.from(new Set(
      parsed.recipes.flatMap((r) => r.ingredients.map((ing) => ing.name)),
    ));

    console.log(`[pantry-recipes] Canonicalizing ${allIngredientNames.length} unique ingredient names...`);
    const canonicalMap = await canonicalizeNames(allIngredientNames);
    console.log(`[pantry-recipes] Canonicalization complete.`);

    // Apply canonical data to each recipe's ingredients.
    const recipesWithCanonical = parsed.recipes.map((recipe) => ({
      ...recipe,
      ingredients: recipe.ingredients.map((ing) => {
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
      }),
    }));

    // Add a temp ID to each recipe so the UI can track them.
    // These are NOT saved to the DB — they're temporary until the user adds one to the recipe box.
    const tempRecipes = recipesWithCanonical.map((recipe, idx) => ({
      ...recipe,
      id: `temp-pantry-${Date.now()}-${idx}`,
      isFavorite: false,
      collection: null,
      sourceUrl: null,
      sourceCaption: null,
      sourceComments: null,
      transcript: null,
      ocrText: null,
      imageUrl: null,
      sourceVideoUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      canonicalVersion: CURRENT_CANONICAL_VERSION,
      _isTempPantryRecipe: true,
    }));

    return NextResponse.json({
      recipes: tempRecipes,
      mode,
      pantryItemCount: pantryItemsRaw.length,
    });
  } catch (err) {
    console.error('[pantry-recipes] Failed:', err);
    return NextResponse.json({
      error: `Could not generate recipes: ${(err as Error).message}`,
    }, { status: 500 });
  }
}
