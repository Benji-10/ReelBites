/**
 * Shared ingredient canonicalization using Gemini.
 *
 * This is the SINGLE SOURCE OF TRUTH for canonical ingredient names.
 * Both the pantry (when adding items) and the recipe (when checking pantry)
 * use this same function, so they speak the same "language".
 *
 * The goal: "capsicum" → "bell pepper", "italian herbs" → "italian seasoning",
 * "chicken breast tenders" → "chicken breast" — consistently, every time.
 *
 * Once both sides have canonical names, matching is trivial: just compare
 * canonical names (with prefix matching for specificity).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * The canonicalization prompt. This is deliberately detailed and includes
 * many examples to ensure consistent output across different inputs.
 *
 * Key principles:
 * - PRESERVE the cut/type of meat (chicken breast ≠ chicken thigh)
 * - PRESERVE the form (garlic powder ≠ garlic clove)
 * - PRESERVE the variety (red onion ≠ white onion)
 * - MAP regional synonyms to a single canonical form
 * - STRIP brand names, quantities, marketing words
 */
const CANONICALIZATION_PROMPT = `You are an ingredient canonicalizer. Your job is to convert ingredient names into a consistent canonical form so that the same ingredient always gets the same name, regardless of how it was originally worded.

CANONICALIZATION RULES (in priority order):

1. PRESERVE the cut/type of meat and fish:
   - "chicken breast tenders" → "chicken breast" (NOT "chicken")
   - "chicken thigh fillets" → "chicken thigh" (NOT "chicken")
   - "beef sirloin steak" → "beef sirloin" (NOT "beef")
   - "salmon fillet" → "salmon fillet" (NOT "salmon" — a fillet is different from a whole salmon)
   - "ground beef 95% lean" → "ground beef" (the cut/type, not the leanness)

2. PRESERVE the form/processing:
   - "garlic granules" → "garlic granules" (NOT "garlic")
   - "garlic powder" → "garlic powder" (NOT "garlic" — powder ≠ granules ≠ fresh)
   - "grated parmesan" → "parmesan" (grated is just a prep state, not a different product)
   - "crushed tomatoes" → "crushed tomatoes" (NOT "tomatoes")
   - "tomato paste" → "tomato paste" (NOT "tomatoes")
   - "sun-dried tomatoes" → "sun-dried tomatoes" (NOT "tomatoes")

3. PRESERVE the variety/color:
   - "red bell pepper" → "red bell pepper" (NOT "bell pepper" — color matters in cooking)
   - "red onion" → "red onion" (NOT "onion")
   - "sweet onion" → "sweet onion" (NOT "onion")
   - "baby spinach" → "baby spinach" (NOT "spinach" — baby spinach is different from regular)
   - "whole milk" → "whole milk" (NOT "milk" — fat content matters)

4. MAP regional synonyms to a SINGLE canonical form. Always use the more internationally common term:
   - "capsicum" / "sweet pepper" → "bell pepper"
   - "red capsicum" → "red bell pepper"
   - "aubergine" → "eggplant"
   - "courgette" → "zucchini"
   - "spring onion" / "green onion" → "scallion"
   - "rocket" / "ruccola" → "arugula"
   - "beetroot" → "beet"
   - "swede" → "rutabaga"
   - "minced beef" / "beef mince" → "ground beef"
   - "minced pork" / "pork mince" → "ground pork"
   - "coriander leaf" / "coriander leaves" / "fresh coriander" → "cilantro"
   - "prawn" / "prawns" → "shrimp"
   - "chilli flakes" / "chili flakes" / "chili flake" / "crushed red pepper" / "crushed red pepper flakes" → "red pepper flakes"
   - "italian herbs" / "italian seasoning" / "mixed herbs" → "italian seasoning"
   - "chilli powder" / "chile powder" → "chili powder"
   - "heavy cream" / "whipping cream" → "double cream"
   - "light cream" / "half and half" → "single cream"
   - "powdered sugar" / "confectioners sugar" → "icing sugar"
   - "caster sugar" / "superfine sugar" → "castor sugar"
   - "plain flour" → "all-purpose flour"
   - "self-raising flour" / "self-rising flour" → "self-raising flour"

5. STRIP these (they are NOT part of the ingredient identity):
   - Brand names: "Tesco", "Heinz", "Barilla", "Kewpie", "Knorr", etc.
   - Store names: "Waitrose", "Sainsbury's", etc.
   - Marketing words: "Organic", "Premium", "Finest", "Best", "Value", "Natural"
   - Quality descriptors: "fresh", "frozen", "raw", "cooked" (unless they define a different product)
   - Quantities: "500g", "2L", "1kg", "2-pack"
   - Percentages: "95%", "80%"
   - Prep instructions in parentheses: "garlic (minced)" → "garlic"

6. STRIP "or" alternatives — keep only the FIRST option:
   - "garlic granules or powder" → "garlic granules"
   - "vegetable oil or olive oil" → "vegetable oil"

OUTPUT FORMAT:
Return a JSON array. Each element has "original" (the input name) and "canonical" (the canonical name, lowercase, singular).
Return ONLY the JSON array, no markdown, no explanation.

EXAMPLES:
Input: ["Chicken Breast Tenders - Fresh Natural", "Tesco Spaghetti 500g", "Red Capsicum", "Crushed Red Pepper", "Italian Herbs", "Garlic Granules or Powder", "Olive Oil", "Light Cream Cheese", "Whole Milk 2L", "Spring Onion", "Minced Beef 500g"]
Output: [
  {"original": "Chicken Breast Tenders - Fresh Natural", "canonical": "chicken breast"},
  {"original": "Tesco Spaghetti 500g", "canonical": "spaghetti"},
  {"original": "Red Capsicum", "canonical": "red bell pepper"},
  {"original": "Crushed Red Pepper", "canonical": "red pepper flakes"},
  {"original": "Italian Herbs", "canonical": "italian seasoning"},
  {"original": "Garlic Granules or Powder", "canonical": "garlic granules"},
  {"original": "Olive Oil", "canonical": "olive oil"},
  {"original": "Light Cream Cheese", "canonical": "light cream cheese"},
  {"original": "Whole Milk 2L", "canonical": "whole milk"},
  {"original": "Spring Onion", "canonical": "scallion"},
  {"original": "Minced Beef 500g", "canonical": "ground beef"}
]`;

/**
 * Canonicalize a list of ingredient names using Gemini.
 * Returns a Map from original name → canonical name.
 *
 * If Gemini is unavailable or fails, falls back to a simple
 * lowercase + singularize (no synonym mapping).
 */
export async function canonicalizeNames(names: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (names.length === 0) return result;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Fallback: simple normalization.
    for (const name of names) {
      result.set(name, simpleNormalize(name));
    }
    return result;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      generationConfig: {
        temperature: 0.0, // Zero temperature for maximum consistency.
        responseMimeType: 'application/json',
      },
    });

    const prompt = `${CANONICALIZATION_PROMPT}

Now canonicalize these ingredients:
${JSON.stringify(names)}

Return the JSON array:`;

    const response = await model.generateContent(prompt);
    const text = response.response.text();

    let parsed: Array<{ original: string; canonical: string }>;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Try to extract JSON array from the response.
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse canonicalization response.');
      }
    }

    for (const item of parsed) {
      if (item.original && item.canonical) {
        result.set(item.original, item.canonical.toLowerCase().trim());
      }
    }

    // Fill in any names that weren't returned (shouldn't happen, but just in case).
    for (const name of names) {
      if (!result.has(name)) {
        result.set(name, simpleNormalize(name));
      }
    }
  } catch (err) {
    console.error('Canonicalization failed, using fallback:', err);
    for (const name of names) {
      result.set(name, simpleNormalize(name));
    }
  }

  return result;
}

/**
 * Canonicalize a single ingredient name.
 * Convenience wrapper around canonicalizeNames.
 */
export async function canonicalizeName(name: string): Promise<string> {
  const map = await canonicalizeNames([name]);
  return map.get(name) || simpleNormalize(name);
}

/**
 * Simple client-side fallback normalization.
 * Used when Gemini is not available (e.g. during build) or as a last resort.
 */
export function simpleNormalize(name: string): string {
  if (!name) return '';
  let n = name.toLowerCase().trim();
  // Remove parenthetical notes.
  n = n.replace(/\([^)]*\)/g, ' ');
  // Remove percentages.
  n = n.replace(/\d+%/g, ' ');
  // Remove "or" alternatives — keep first.
  n = n.split(/\s+or\s+/)[0];
  // Normalize whitespace.
  n = n.replace(/\s+/g, ' ').trim();
  // Simple singularization.
  if (n.endsWith('ies')) n = n.slice(0, -3) + 'y';
  else if (n.endsWith('ses')) n = n.slice(0, -2);
  else if (n.endsWith('s') && !n.endsWith('ss') && !n.endsWith('us') && !n.endsWith('is')) {
    n = n.slice(0, -1);
  }
  return n.trim();
}
