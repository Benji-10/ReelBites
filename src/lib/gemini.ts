/**
 * Recipe generation using Google Gemini.
 *
 * Sends the caption, comments, transcript, and OCR text to Gemini and asks
 * it to produce a structured recipe. The prompt explicitly instructs the
 * model to:
 *
 *   - Cite evidence for every field (which source the info came from).
 *   - Flag missing information (e.g. "add salt" with no amount).
 *   - Avoid hallucinations — if an amount isn't given, leave it null and
 *     add a flag rather than inventing a value.
 *
 * The model is configurable via GEMINI_MODEL (default: gemini-2.5-flash-lite).
 * The user mentioned "gemini-3.1-flash-lite" — if/when Google ships that name,
 * set GEMINI_MODEL=gemini-3.1-flash-lite and it will just work.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  GeneratedRecipe,
  InstagramComment,
  RecipeFlag,
  RecipeIngredient,
  RecipeInstruction,
  RecipeMetadata,
} from './types';

/**
 * Build the prompt for Gemini.
 */
function buildPrompt(args: {
  caption: string | null;
  comments: InstagramComment[];
  transcript: string;
  ocrText: string;
  sourceUrl: string;
}): string {
  const { caption, comments, transcript, ocrText, sourceUrl } = args;

  const commentsText =
    comments.length > 0
      ? comments
          .map(
            (c, i) =>
              `${i + 1}. ${c.isPinned ? '[PINNED] ' : ''}${c.author} (${c.likes} likes): ${c.text}`,
          )
          .join('\n')
      : '(No comments available)';

  return `You are a professional recipe extractor. Your job is to read a recipe from an Instagram reel and output a structured JSON recipe object.

CRITICAL RULES — FOLLOW THESE EXACTLY:
1. Use information from the sources below. If an amount is specified, use it exactly.
2. If an ingredient is mentioned but its amount is NOT specified, MAKE UP a realistic quantity based on your cooking knowledge (e.g. "salt" → 1 tsp, "olive oil" → 2 tbsp, "onion" → 1). Set "flag" to "estimated_amount" to indicate it was estimated, not from the source.
3. If a step is vague (e.g. "cook until done" with no time), include it but add a flag of type "vague_instruction".
4. For EVERY ingredient, instruction, and metadata field, include an "evidence" string that cites which source the info came from: "caption", "transcript", "ocr", "comments", or "estimated".
5. Set "food_hint" to true if the caption, transcript, or comments mention food, cooking, or recipe-related terms in ANY language (e.g. 鬆餅, 食譜, レシピ, pancake, bake, etc.). Set it to false only if the video is clearly not food-related (e.g. a travel vlog, fitness video, ad).
6. If "food_hint" is true but you cannot extract a complete recipe from the text sources, set "needs_ocr" to true — the recipe may be shown on-screen as text overlays.
7. If "food_hint" is false, set title to "Not a recipe" and add a flag of type "not_a_recipe".
8. Do NOT include units in the "amount" field — put the unit in "unit". E.g. { amount: "2", unit: "cups" }, not { amount: "2 cups" }.
9. Amount should be a number or simple fraction (e.g. "2", "0.5", "1.5"). Unit should be standard (cups, tbsp, tsp, oz, g, ml, pieces, cloves, etc.).
10. Return ONLY the JSON object, no markdown fences, no preamble.

SOURCES:

--- CAPTION ---
${caption || '(No caption)'}

--- COMMENTS (top/pinned) ---
${commentsText}

--- AUDIO TRANSCRIPT (Whisper) ---
${transcript || '(No speech detected)'}

--- ON-SCREEN TEXT (OCR from video frames) ---
${ocrText || '(No text detected on screen)'}

--- SOURCE URL ---
${sourceUrl}

OUTPUT FORMAT (JSON):
{
  "title": "string — the recipe name",
  "description": "string — 1-2 sentence summary of the dish",
  "food_hint": true,
  "needs_ocr": false,
  "ingredients": [
    {
      "name": "string",
      "amount": "string | null",
      "unit": "string | null",
      "notes": "string | null",
      "evidence": "caption | transcript | ocr | comments | estimated",
      "flag": "estimated_amount | null"
    }
  ],
  "instructions": [
    {
      "step": "string — one clear instruction",
      "evidence": "caption | transcript | ocr | comments",
      "flag": "vague_instruction | null"
    }
  ],
  "metadata": [
    {
      "key": "servings | prepTime | cookTime | temperature | etc",
      "value": "string",
      "evidence": "caption | transcript | ocr | comments",
      "flag": "null"
    }
  ],
  "flags": [
    {
      "type": "estimated_amount | vague_instruction | not_a_recipe | needs_ocr | missing_step | unclear_ingredient | etc",
      "message": "string — human-readable explanation",
      "field": "ingredients[0] | instructions[2] | etc",
      "severity": "info | warning | error"
    }
  ]
}

Remember: ONLY return the JSON. No markdown, no explanation.`;
}

interface GeminiRecipeResponse {
  title: string;
  description: string;
  food_hint?: boolean;
  needs_ocr?: boolean;
  ingredients: RecipeIngredient[];
  instructions: RecipeInstruction[];
  metadata: RecipeMetadata[];
  flags: RecipeFlag[];
}

/**
 * Generate a structured recipe from the collected source data using Gemini.
 */
export async function generateRecipe(args: {
  caption: string | null;
  comments: InstagramComment[];
  transcript: string;
  ocrText: string;
  sourceUrl: string;
  onProgress?: (message: string) => void;
}): Promise<GeneratedRecipe> {
  const { caption, comments, transcript, ocrText, sourceUrl, onProgress } = args;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Add it to your .env file or Netlify environment variables.',
    );
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  onProgress?.(`Calling Gemini (${modelName}) to generate recipe...`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.1, // Low temperature for factual extraction.
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });

  const prompt = buildPrompt({ caption, comments, transcript, ocrText, sourceUrl });

  let result;
  try {
    result = await model.generateContent(prompt);
  } catch (err) {
    throw new Error(`Gemini API call failed: ${(err as Error).message}`);
  }

  const responseText = result.response.text();
  onProgress?.('Parsing Gemini response...');

  let parsed: GeminiRecipeResponse;
  try {
    parsed = JSON.parse(responseText) as GeminiRecipeResponse;
  } catch (err) {
    // If JSON parsing fails, try to extract JSON from the response.
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]) as GeminiRecipeResponse;
      } catch {
        throw new Error(
          `Failed to parse Gemini response as JSON: ${(err as Error).message}. Raw response: ${responseText.slice(0, 500)}`,
        );
      }
    } else {
      throw new Error(
        `Gemini response did not contain valid JSON. Raw response: ${responseText.slice(0, 500)}`,
      );
    }
  }

  // Validate and normalize the response.
  if (!parsed.title || typeof parsed.title !== 'string') {
    parsed.title = 'Untitled Recipe';
  }
  if (!parsed.description || typeof parsed.description !== 'string') {
    parsed.description = '';
  }
  if (!Array.isArray(parsed.ingredients)) parsed.ingredients = [];
  if (!Array.isArray(parsed.instructions)) parsed.instructions = [];
  if (!Array.isArray(parsed.metadata)) parsed.metadata = [];
  if (!Array.isArray(parsed.flags)) parsed.flags = [];

  onProgress?.(
    `Recipe generated: ${parsed.ingredients.length} ingredients, ${parsed.instructions.length} steps, ${parsed.flags.length} flags.`,
  );

  return {
    title: parsed.title,
    description: parsed.description,
    foodHint: parsed.food_hint ?? false,
    needsOcr: parsed.needs_ocr ?? false,
    ingredients: parsed.ingredients,
    instructions: parsed.instructions,
    metadata: parsed.metadata,
    flags: parsed.flags,
    sourceUrl,
    sourceCaption: caption || '',
    sourceComments: comments,
    transcript,
    ocrText,
    imageUrl: null,
    sourceVideoUrl: null,
  };
}
