/**
 * POST /api/import-photo
 *
 * Receives an image (base64-encoded) and uses Gemini Vision to extract
 * a recipe from it. Works with screenshots of recipes, photos of recipe
 * cards, or photos of handwritten recipes.
 *
 * Request:  { "image": "base64-encoded JPEG/PNG" }
 * Response: { "recipe": { ...structured recipe... } }
 */

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let body: { image?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { image } = body;
  if (!image || typeof image !== 'string') {
    return NextResponse.json({ error: 'Missing "image" field (base64-encoded image data).' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set.' }, { status: 500 });
  }

  try {
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

    // Determine MIME type from base64 data URL or default to JPEG.
    let mimeType = 'image/jpeg';
    let imageData = image;
    if (image.startsWith('data:')) {
      const match = image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        imageData = match[2];
      }
    }

    console.log('[import-photo] Image size:', Math.round(imageData.length * 0.75 / 1024), 'KB, type:', mimeType);

    const prompt = `You are a professional recipe extractor. The user has uploaded an image that contains a recipe (could be a screenshot, a recipe card, a photo of a cookbook page, or a handwritten recipe).

Extract the recipe from the image.

CRITICAL RULES:
1. Read ALL text from the image carefully — in ANY language.
2. Preserve the original text — do NOT translate.
3. If an amount is specified, use it exactly.
4. If an ingredient is mentioned but its amount is NOT specified, estimate a realistic quantity. Set "flag" to "estimated_amount".
5. If you need to add an ingredient not visible in the image but clearly needed, set "flag" to "estimated_ingredient".
6. For EACH instruction, include "ingredientRefs" — array of ingredient indices used in that step.
7. Include an "evidence" string for every field: "photo" (from the uploaded image).
8. ALWAYS include metadata: servings, prepTime, cookTime, totalTime, difficulty, cuisine, nutrition, costPerServing, equipment. Estimate if not shown.
9. Auto-generate 2-5 tags based on the recipe.
10. Set "food_hint" to true.
11. Do NOT include units in the "amount" field — put the unit in "unit".
12. Return ONLY the JSON object.

OUTPUT FORMAT (JSON):
{
  "title": "string",
  "description": "string",
  "food_hint": true,
  "needs_ocr": false,
  "tags": ["tag1", "tag2"],
  "ingredients": [{ "name": "string", "amount": "string|null", "unit": "string|null", "notes": "string|null", "evidence": "photo", "flag": "estimated_amount|null" }],
  "instructions": [{ "step": "string", "evidence": "photo", "flag": "null", "ingredientRefs": [0, 1] }],
  "metadata": [{ "key": "servings|prepTime|cookTime|totalTime|difficulty|cuisine|nutrition|costPerServing|equipment", "value": "string", "evidence": "photo", "flag": "null" }],
  "flags": []
}

Return ONLY the JSON object.`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageData } },
        ],
      }],
    });

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

    const recipe = {
      title: parsed.title || 'Imported Recipe',
      description: parsed.description || '',
      foodHint: parsed.food_hint ?? true,
      needsOcr: false,
      tags: parsed.tags || [],
      ingredients: parsed.ingredients || [],
      instructions: parsed.instructions || [],
      metadata: parsed.metadata || [],
      flags: parsed.flags || [],
      sourceUrl: null,
      sourceCaption: null,
      sourceComments: [],
      transcript: '',
      ocrText: '[Recipe imported from photo]',
      imageUrl: null,
      sourceVideoUrl: null,
    };

    console.log('[import-photo] Recipe generated:', recipe.ingredients.length, 'ingredients,', recipe.instructions.length, 'steps');
    return NextResponse.json({ recipe });
  } catch (err) {
    console.error('[import-photo] Failed:', err);
    return NextResponse.json({ error: `Import failed: ${(err as Error).message}` }, { status: 500 });
  }
}
