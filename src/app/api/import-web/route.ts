/**
 * POST /api/import-web
 *
 * Scrapes a web page, extracts the main recipe content, and generates
 * a structured recipe using Gemini.
 *
 * Works with food blogs, recipe sites (AllRecipes, BBC Good Food, etc.),
 * and any web page that contains a recipe.
 *
 * Request:  { "url": "https://www.allrecipes.com/recipe/..." }
 * Response: { "recipe": { ...structured recipe... } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Missing "url" field.' }, { status: 400 });
  }

  // Validate URL.
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid URL.' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set.' }, { status: 500 });
  }

  try {
    // Step 1: Fetch the web page.
    console.log('[import-web] Fetching:', url);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch page: HTTP ${response.status}` }, { status: 502 });
    }

    const html = await response.text();
    console.log('[import-web] Page fetched:', html.length, 'chars');

    // Step 2: Extract text content from HTML (strip tags, scripts, styles).
    const textContent = extractTextFromHtml(html);
    console.log('[import-web] Extracted text:', textContent.length, 'chars');

    if (textContent.length < 100) {
      return NextResponse.json({ error: 'Page has very little text content. Is this a recipe page?' }, { status: 400 });
    }

    // Limit to 15000 chars to stay within Gemini's context window.
    const truncatedText = textContent.slice(0, 15000);

    // Step 3: Extract page title.
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : '';

    // Step 4: Generate recipe with Gemini.
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    });

    const prompt = `You are a professional recipe extractor. A user has shared a web page that contains a recipe. Extract the recipe from the page content below.

Page title: ${pageTitle}
Page URL: ${url}

CRITICAL RULES:
1. Use information from the page content. If an amount is specified, use it exactly.
2. If an ingredient is mentioned but its amount is NOT specified, estimate a realistic quantity. Set "flag" to "estimated_amount".
3. If you need to add an ingredient not mentioned but clearly needed, set "flag" to "estimated_ingredient".
4. For EACH instruction, include "ingredientRefs" — array of ingredient indices used in that step.
5. Include an "evidence" string for every field: "web" (from the web page).
6. ALWAYS include metadata: servings, prepTime, cookTime, totalTime, difficulty, cuisine, nutrition, costPerServing, equipment.
7. Auto-generate 2-5 tags.
8. Set "food_hint" to true.
9. Do NOT include units in the "amount" field — put the unit in "unit".
10. Return ONLY the JSON object.

OUTPUT FORMAT (JSON):
{
  "title": "string",
  "description": "string",
  "food_hint": true,
  "needs_ocr": false,
  "tags": ["tag1", "tag2"],
  "ingredients": [{ "name": "string", "amount": "string|null", "unit": "string|null", "notes": "string|null", "evidence": "web", "flag": "estimated_amount|null" }],
  "instructions": [{ "step": "string", "evidence": "web", "flag": "null", "ingredientRefs": [0, 1] }],
  "metadata": [{ "key": "servings|prepTime|cookTime|totalTime|difficulty|cuisine|nutrition|costPerServing|equipment", "value": "string", "evidence": "web", "flag": "null" }],
  "flags": []
}

--- PAGE CONTENT ---
${truncatedText}

Return ONLY the JSON object.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse Gemini response as JSON.');
      }
    }

    // Build the full recipe object.
    const recipe = {
      title: parsed.title || pageTitle || 'Imported Recipe',
      description: parsed.description || '',
      foodHint: parsed.food_hint ?? true,
      needsOcr: false,
      tags: parsed.tags || [],
      ingredients: parsed.ingredients || [],
      instructions: parsed.instructions || [],
      metadata: parsed.metadata || [],
      flags: parsed.flags || [],
      sourceUrl: url,
      sourceCaption: pageTitle,
      sourceComments: [],
      transcript: '',
      ocrText: truncatedText.slice(0, 5000), // Store the extracted text as "OCR"
      imageUrl: null,
      sourceVideoUrl: null,
    };

    console.log('[import-web] Recipe generated:', recipe.ingredients.length, 'ingredients,', recipe.instructions.length, 'steps');
    return NextResponse.json({ recipe });
  } catch (err) {
    console.error('[import-web] Failed:', err);
    return NextResponse.json({ error: `Import failed: ${(err as Error).message}` }, { status: 500 });
  }
}

/**
 * Extract readable text content from HTML.
 * Strips scripts, styles, nav, footer, and extracts text from main content.
 */
function extractTextFromHtml(html: string): string {
  // Remove script and style tags.
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Try to find recipe-specific sections (Schema.org JSON-LD, recipe class).
  const jsonLdMatch = text.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const jsonLd = JSON.parse(jsonLdMatch[1]);
      if (jsonLd['@type'] === 'Recipe' || (Array.isArray(jsonLd['@graph']) && jsonLd['@graph'].some((n: { '@type'?: string }) => n['@type'] === 'Recipe'))) {
        // Found structured recipe data — use it directly.
        const recipe = Array.isArray(jsonLd['@graph'])
          ? jsonLd['@graph'].find((n: { '@type'?: string }) => n['@type'] === 'Recipe')
          : jsonLd;
        return JSON.stringify(recipe, null, 2);
      }
    } catch {}
  }

  // Look for recipe container elements.
  const recipeContainerMatch = text.match(/<div[^>]*class="[^"]*(?:recipe|ingredients|instructions)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (recipeContainerMatch) {
    text = recipeContainerMatch[1];
  }

  // Convert HTML to text.
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '') // Remove all remaining tags.
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines.
    .trim();

  return text;
}
