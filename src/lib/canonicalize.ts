/**
 * Shared ingredient canonicalization using Gemini.
 *
 * Produces a hierarchical semantic representation:
 *   - canonical_name: the most specific meaningful grocery concept
 *   - ancestors: IS-A (subtype) relationships only, NOT food categories
 *   - attributes: meaningful properties, each marked as hard or soft
 *   - hardAttributeKeys: which attributes are "hard" (must match for cooking)
 *
 * HARD vs SOFT attributes:
 *   - HARD: materially changes the recipe (e.g. "form" for garlic powder vs garlic paste)
 *   - SOFT: doesn't really change the dish (e.g. "fat" for light butter vs regular butter)
 *   Gemini decides per-attribute, per-ingredient, based on whether it alters the recipe.
 *
 * Matching rules:
 *   - Hard attributes: must match exactly (blocking)
 *   - Soft attributes: if both sides have the attribute AND values differ → match but WARN
 *   - Soft attributes: if only one side has it → ignore (not enough info)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export interface CanonicalIngredient {
  canonical_name: string;
  ancestors: string[];
  attributes: Record<string, string | string[]>;
  hardAttributeKeys: string[]; // which attribute keys are "hard" (blocking)
}

/**
 * Current canonicalization prompt version.
 *
 * BUMP THIS NUMBER every time you change CANONICALIZATION_PROMPT.
 * The backfill script uses this to determine which items need re-canonicalization:
 *   - Items with canonicalVersion < CURRENT_CANONICAL_VERSION (or null) are re-processed.
 *   - Items with canonicalVersion === CURRENT_CANONICAL_VERSION are skipped.
 *
 * This makes the backfill RESUMABLE — if it times out, re-running picks up
 * exactly where it left off.
 *
 * Version history:
 *   1: Initial flat canonicalization
 *   2: Hierarchical with ancestors + attributes
 *   3: Hard/soft attributes
 *   4: IS-A ancestors only (no "dairy")
 *   5: Cooking context (wraps, spray)
 *   6: Given/changeable attributes (fresh, diced)
 *   7: Array values for "or" alternatives
 */
export const CURRENT_CANONICAL_VERSION = 7;

const CANONICALIZATION_PROMPT = `You are a Grocery Semantic Normalizer for a COOKING APPLICATION.

Your output is used to match ingredients in RECIPES against items in a user's PANTRY. The matching is directional: a specific pantry item can satisfy a generic recipe need (e.g. recipe needs "noodles", pantry has "udon" → match), but not vice versa.

THE KEY QUESTION for every decision: "Would a cook consider these interchangeable in a recipe?"

For each input item, return a JSON object with this structure:
{
  "original": "<the input string>",
  "canonical_name": "<most specific meaningful grocery concept>",
  "ancestors": ["<immediate parent TYPE>", ...],
  "attributes": {"<key>": "<value>", ...},
  "hardAttributeKeys": ["<key>", ...]
}

Return a JSON ARRAY of these objects, one per input item. No explanations, no markdown.

## COOKING CONTEXT — CRITICAL

This is for RECIPE COOKING, not grocery taxonomy. Every decision must be based on whether items are interchangeable IN A RECIPE, not whether they're taxonomically related.

Examples of cooking-aware decisions:
- Wraps and bread are both "bread" taxonomically, but NOT interchangeable in cooking (you can't substitute a wrap for a sourdough slice). Wraps should NOT have "bread" as an ancestor.
- Avocado oil spray and avocado oil are the SAME ingredient for cooking. Form (spray vs liquid) is SOFT.
- Low carb wraps and regular wraps ARE interchangeable in cooking. Diet is SOFT.
- Olive oil and avocado oil are NOT interchangeable (different flavor, different smoke point). Different canonical names.

## Core principle

Identify WHAT the grocery item is, not what words it uses.

Normalize across languages, dialects, synonyms, spelling, singular/plural, abbreviations, brands, and regional terminology.

Equivalent descriptions MUST independently produce the same representation.

Use stable, lowercase US-English concept names.

## Hierarchy — COOKING-INTERCHANGEABLE types only

ancestors contains progressively broader TYPES that ARE interchangeable in cooking.

CRITICAL: An ancestor must be a TYPE that a recipe might reasonably request as a substitute. If a recipe asking for the ancestor would NOT be satisfied by this item (or vice versa), it's not a valid ancestor.

VALID ancestors (cooking-interchangeable):
- spaghetti → ["pasta"] (a recipe asking for "pasta" can use spaghetti)
- udon → ["wheat noodles", "noodles"] (a recipe asking for "noodles" can use udon)
- chicken breast → ["chicken"] (a recipe asking for "chicken" can use chicken breast)
- ground beef → ["beef"] (a recipe asking for "beef" can use ground beef)

INVALID ancestors (NOT cooking-interchangeable):
- wrap → ["bread"] ❌ (a recipe asking for "bread" cannot use a wrap — different cooking use)
- butter → ["dairy"] ❌ (dairy is a category, not a cooking ingredient)
- milk → ["dairy"] ❌ (same reason)
- wrap → ["flatbread"] ❌ (still not interchangeable in cooking)

Food categories like "dairy", "produce", "meat", "bakery" are NOT ancestors. They are categories.

If an item has no broader cooking-interchangeable type, use an empty ancestors array:
- butter → {"ancestors": []}
- milk → {"ancestors": []}
- wrap → {"ancestors": []}
- egg → {"ancestors": []}
- salt → {"ancestors": []}

Examples:

udon noodles → {"canonical_name": "udon", "ancestors": ["wheat noodles", "noodles"], "attributes": {}, "hardAttributeKeys": []}
ramen noodles → {"canonical_name": "ramen", "ancestors": ["wheat noodles", "noodles"], "attributes": {}, "hardAttributeKeys": []}
noodles → {"canonical_name": "noodles", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}
spaghetti → {"canonical_name": "spaghetti", "ancestors": ["pasta"], "attributes": {}, "hardAttributeKeys": []}
pasta → {"canonical_name": "pasta", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}
butter → {"canonical_name": "butter", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}
milk → {"canonical_name": "milk", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}
wrap → {"canonical_name": "wrap", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}
tortilla → {"canonical_name": "tortilla", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}

Thus a request for "noodles" can match "udon", while a request for "udon" cannot match "ramen".
A request for "butter" will NOT match "milk" (different concepts, no shared ancestor path).
A request for "wrap" will NOT match "bread" (different cooking uses, no shared ancestor).

## Attributes — HARD vs SOFT (cooking context)

For EACH attribute, decide HARD or SOFT based on whether substituting would change the dish.

### "GIVEN" attributes — DO NOT INCLUDE THESE

Some attributes are the DEFAULT state and would never be mentioned in a recipe. Do NOT include them as attributes at all:
- "state: fresh" for produce/meat/dairy (fresh is the default — a recipe saying "chicken" implies fresh chicken)
- "state: raw" for meats (raw is the default — you cook it)
- "form: whole" for most items (whole is the default)
- "state: liquid" for oils/milk/water (liquid is the default)

Only include a "state" or "form" attribute when it's NOT the default:
- "garlic powder" → state: dry, form: powder (dry powder is NOT the default for garlic)
- "sun-dried tomatoes" → state: sun-dried (NOT the default)
- "frozen peas" → state: frozen (frozen is NOT the default)
- "canned beans" → packaging: canned (NOT the default)

If a recipe just says "chicken breast", it has NO attributes — not {state: fresh}. Fresh is implied.

### "CHANGEABLE" attributes — ALWAYS SOFT

Some attributes describe prep states that the COOK can change at home. These are ALWAYS SOFT:
- "form: diced" / "form: chopped" / "form: sliced" / "form: minced" / "form: grated" / "form: crushed"
  (The cook can dice/chop/slice/mince/grate/crush the ingredient themselves.)
- "preparation: peeled" (The cook can peel it.)
- "preparation: washed" (The cook can wash it.)

Example: "diced onions" → canonical_name: "onion", attributes: {form: "diced"}, hardAttributeKeys: []
(The recipe can use any onion — the cook will dice it themselves.)

### TRULY HARD attributes

These CANNOT be changed by the cook at home and represent fundamentally different products:
- "form: powder" for aromatics (garlic powder ≠ fresh garlic — can't make powder at home)
- "form: paste" (garlic paste ≠ fresh garlic — different product)
- "state: dry" for herbs (dried basil ≠ fresh basil — different potency, can't easily dry at home)
- "state: sun-dried" (sun-dried tomatoes ≠ fresh — completely different product)
- "color" for onions (red onion ≠ white onion — can't change the color, different flavor)
- "source" for oils (olive oil ≠ avocado oil — different flavor, different smoke point)
- "source" for vinegars (rice vinegar ≠ balsamic — different flavor)

### SOFT attributes

These don't materially change the dish:
- "diet": low carb wrap ≈ regular wrap, gluten-free pasta ≈ regular pasta
- "brand": Kewpie mayo ≈ Heinz mayo
- "form" for oils/sauces: spray oil ≈ regular oil
- "form" for solid fats: butter sticks ≈ spreadable butter
- "color" for mild vegetables: red capsicum ≈ green capsicum
- "fat content" for dairy: light cream ≈ regular cream
- "variety" for potatoes: russet ≈ yukon gold
- "packaging" (unless it changes the product): canned ≈ jarred
- "source" for milk: oat milk ≈ soy milk (lean SOFT)

### CONTEXT MATTERS

The same attribute can be HARD for one ingredient and SOFT for another:
- "form" is HARD for garlic (powder ≠ fresh) but SOFT for oil (spray ≈ liquid) and SOFT for onions (diced ≈ whole)
- "color" is HARD for onions (red ≠ white) but SOFT for bell peppers (red ≈ green)
- "source" is HARD for oils (olive ≠ avocado) but SOFT for milk (oat ≈ soy)

When unsure, lean toward SOFT (lenient matching). The cook can always choose to be stricter.

List the keys of HARD attributes in "hardAttributeKeys". All other attributes are implicitly SOFT.

## "OR" alternatives — use ARRAY values

When a recipe ingredient offers alternatives for a specific attribute (e.g. "minced beef or lamb"), use an ARRAY for that attribute value, NOT a single string.

This allows the matcher to check if the pantry item satisfies ANY of the alternatives.

Examples:
- "minced beef or lamb" → {"canonical_name": "ground meat", "ancestors": [], "attributes": {"source": ["beef", "lamb"]}, "hardAttributeKeys": ["source"]}
  (A pantry item with source "beef" OR source "lamb" will match.)
- "sour cream or greek yogurt" → {"canonical_name": "sour cream", "ancestors": [], "attributes": {"alternative": ["greek yogurt"]}, "hardAttributeKeys": []}
  (If the concepts are different, use the first as canonical_name and put the alternative in an "alternative" attribute as SOFT.)
- "fresh or dried basil" → {"canonical_name": "basil", "ancestors": [], "attributes": {"state": ["fresh", "dry"]}, "hardAttributeKeys": ["state"]}
  (A pantry item with state "fresh" OR state "dry" will match.)
- "garlic powder or granules" → {"canonical_name": "garlic", "ancestors": [], "attributes": {"form": ["powder", "granules"]}, "hardAttributeKeys": ["state", "form"]}
  (Both forms are equivalent — either will match.)

NEVER use a string like "beef or lamb" as an attribute value. ALWAYS use an array: ["beef", "lamb"].

## Cooking-aware examples

Low Carb Wraps → {"canonical_name": "wrap", "ancestors": [], "attributes": {"diet": "low carb"}, "hardAttributeKeys": []}
Wraps → {"canonical_name": "wrap", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}

Avocado Cooking Spray → {"canonical_name": "avocado oil", "ancestors": ["oil"], "attributes": {"form": "spray"}, "hardAttributeKeys": []}
Avocado Oil → {"canonical_name": "avocado oil", "ancestors": ["oil"], "attributes": {}, "hardAttributeKeys": []}
Olive Oil → {"canonical_name": "olive oil", "ancestors": ["oil"], "attributes": {}, "hardAttributeKeys": []}
Oil → {"canonical_name": "oil", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}

Garlic Powder → {"canonical_name": "garlic", "ancestors": [], "attributes": {"state": "dry", "form": "powder"}, "hardAttributeKeys": ["state", "form"]}
Fresh Garlic → {"canonical_name": "garlic", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}
(Garlic powder is HARD: can't make powder at home. Fresh garlic has NO attributes — fresh is the default/given state.)

Diced Onions → {"canonical_name": "onion", "ancestors": [], "attributes": {"form": "diced"}, "hardAttributeKeys": []}
(Diced is SOFT: the cook can dice it themselves.)

Red Onion → {"canonical_name": "onion", "ancestors": [], "attributes": {"color": "red"}, "hardAttributeKeys": ["color"]}
Yellow Onion → {"canonical_name": "onion", "ancestors": [], "attributes": {"color": "yellow"}, "hardAttributeKeys": ["color"]}
Onion → {"canonical_name": "onion", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}

Chicken Breast (fresh) → {"canonical_name": "chicken breast", "ancestors": ["chicken"], "attributes": {}, "hardAttributeKeys": []}
(Fresh/raw is the default — no state attribute. A recipe saying "chicken breast" implies fresh chicken breast.)
Frozen Chicken Breast → {"canonical_name": "chicken breast", "ancestors": ["chicken"], "attributes": {"state": "frozen"}, "hardAttributeKeys": []}
(Frozen is NOT the default, so include it. But SOFT — can be thawed.)

Red Bell Pepper → {"canonical_name": "bell pepper", "ancestors": [], "attributes": {"color": "red"}, "hardAttributeKeys": []}
Bell Pepper → {"canonical_name": "bell pepper", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}

Light Butter → {"canonical_name": "butter", "ancestors": [], "attributes": {"fat": "light"}, "hardAttributeKeys": []}
Butter → {"canonical_name": "butter", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}

Spaghetti → {"canonical_name": "spaghetti", "ancestors": ["pasta"], "attributes": {}, "hardAttributeKeys": []}
Gluten-Free Spaghetti → {"canonical_name": "spaghetti", "ancestors": ["pasta"], "attributes": {"diet": "gluten-free"}, "hardAttributeKeys": []}
Pasta → {"canonical_name": "pasta", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}

Oat Milk → {"canonical_name": "milk", "ancestors": [], "attributes": {"source": "oat"}, "hardAttributeKeys": []}
Milk → {"canonical_name": "milk", "ancestors": [], "attributes": {}, "hardAttributeKeys": []}

## Synonyms and dialects

Collapse equivalent terminology:
rocket / arugula / rocket leaves → arugula
capsicum / bell pepper / sweet pepper → bell pepper
courgette / zucchini → zucchini
aubergine / eggplant → eggplant
spring onion / scallion / green onion → green onion
minced beef / beef mince / ground beef → ground beef
prawns / shrimp → shrimp
cornflour / cornstarch → cornstarch
icing sugar / powdered sugar / confectioners sugar → powdered sugar
caster sugar / castor sugar / superfine sugar → castor sugar
plain flour → all-purpose flour
coriander leaf / coriander leaves / fresh coriander → cilantro
chilli flakes / chili flakes / crushed red pepper / red pepper flakes → chili pepper + state:dry + form:crushed
italian herbs / italian seasoning / mixed herbs → italian seasoning
heavy cream / whipping cream → double cream
light cream / half and half → single cream

Do not preserve the input's dialect.

Normalize singular/plural:
potato / potatoes → potato
sweet potato / sweet potatoes → sweet potato
tomato / tomatoes → tomato

Remove redundant descriptors:
mozzarella / mozzarella cheese → mozzarella
tuna / tuna fish → tuna

Ignore quantities and brands unless they materially change the product:
2 apples → apple
Kewpie mayo → mayonnaise
Tesco Spaghetti 500g → spaghetti

## Practical grocery equivalence

Optimize for shopping compatibility, not strict scientific identity.

Descriptions that would reasonably satisfy the same shopping request should converge when appropriate.

bottled water / drinking water / natural mineral water → water
chili flakes / chilli flakes / red pepper flakes / crushed red pepper → chili pepper + state:dry + form:crushed
garlic powder / garlic granules → garlic + state:dry + form:fine
ground cumin / cumin powder → cumin + state:dry + form:fine

Do not collapse meaningful distinctions:
fresh garlic ≠ dry garlic
garlic powder ≠ garlic paste
chili flakes ≠ chili powder
oat milk ≠ soy milk (different flavor, but lean SOFT since both are milk)
tomato ≠ tomato paste
butter ≠ margarine
olive oil ≠ vegetable oil (different flavor)
olive oil ≠ avocado oil (different flavor, different smoke point)
chicken breast ≠ chicken thigh

## A broad item MUST remain broad

milk → milk (attributes: {}, hardAttributeKeys: [])
cheese → cheese (attributes: {}, hardAttributeKeys: [])
noodles → noodles (attributes: {}, hardAttributeKeys: [])
potato → potato (attributes: {}, hardAttributeKeys: [])

Never invent specificity.

## Unknown or ambiguous items

If you know the broad concept but not the specific subtype, use the broad concept and leave unknown properties unspecified.

Japanese-style noodles → noodles + cuisine:japanese

Do NOT guess udon or ramen.

## Critical consistency rule

Each item is processed independently.

Never rely on previous outputs.

The same grocery concept MUST map to the same representation regardless of wording, dialect, language, or spelling.

Before responding, silently verify:
1. Same meaning → same concept.
2. Ancestors are cooking-interchangeable types, NOT food categories (dairy, produce, meat are NOT ancestors).
3. Items like wraps, tortillas, pitas do NOT have "bread" as an ancestor (not interchangeable in cooking).
4. "Given" attributes (fresh, raw, whole, liquid) are NOT included — they're defaults.
5. "Changeable" attributes (diced, chopped, sliced, minced, grated, crushed, peeled) are SOFT.
6. Only truly HARD attributes that can't be changed at home are marked HARD (powder, paste, dry herbs, color for onions, source for oils).
7. Minor variations (diet, brand, fat content, spray form, packaging) are SOFT.
8. Unspecified properties remain unspecified.
9. Singular, lowercase, stable terminology is used.
10. hardAttributeKeys only contains keys that exist in attributes.
11. "OR" alternatives use ARRAY values, never strings like "beef or lamb".
12. When unsure if HARD or SOFT, lean SOFT (lenient matching).`;

/**
 * Canonicalize a list of ingredient names using Gemini.
 * Returns a Map from original name → CanonicalIngredient.
 *
 * Options:
 *   - throwOnError: if true, throw on API failure instead of returning fallbacks.
 *     Used by the backfill script so it doesn't write bad values to the DB.
 */
export async function canonicalizeNames(
  names: string[],
  options: { throwOnError?: boolean } = {},
): Promise<Map<string, CanonicalIngredient>> {
  const result = new Map<string, CanonicalIngredient>();
  const { throwOnError = false } = options;

  if (names.length === 0) return result;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    if (throwOnError) throw new Error('GEMINI_API_KEY is not set.');
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
        temperature: 0.0,
        responseMimeType: 'application/json',
      },
    });

    const prompt = `${CANONICALIZATION_PROMPT}

Now canonicalize these grocery items. Return a JSON array with one object per item, preserving the original string in the "original" field:
${JSON.stringify(names)}`;

    const response = await model.generateContent(prompt);
    const text = response.response.text();

    let parsed: Array<{
      original: string;
      canonical_name: string;
      ancestors: string[];
      attributes: Record<string, unknown>;
      hardAttributeKeys?: string[];
    }>;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse canonicalization response.');
      }
    }

    for (const item of parsed) {
      if (item.original && item.canonical_name) {
        const attributes = normalizeAttributes(item.attributes || {});
        const hardAttributeKeys = (item.hardAttributeKeys || []).filter(
          (k) => k in attributes,
        );
        result.set(item.original, {
          canonical_name: item.canonical_name.toLowerCase().trim(),
          ancestors: (item.ancestors || []).map((a) => a.toLowerCase().trim()),
          attributes,
          hardAttributeKeys,
        });
      }
    }

    // Fill in any names that weren't returned by Gemini.
    for (const name of names) {
      if (!result.has(name)) {
        if (throwOnError) {
          throw new Error(`Gemini did not return a result for: "${name}"`);
        }
        result.set(name, simpleNormalize(name));
      }
    }
  } catch (err) {
    if (throwOnError) throw err;
    console.error('Canonicalization failed, using fallback:', err);
    for (const name of names) {
      if (!result.has(name)) {
        result.set(name, simpleNormalize(name));
      }
    }
  }

  return result;
}

/**
 * Canonicalize a single ingredient name.
 */
export async function canonicalizeName(name: string): Promise<CanonicalIngredient> {
  const map = await canonicalizeNames([name]);
  return map.get(name) || simpleNormalize(name);
}

/**
 * Normalize attribute keys and values to lowercase strings.
 * Handles both string values and array values (for "or" alternatives).
 */
function normalizeAttributes(attrs: Record<string, unknown>): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;

    const normalizedKey = key.toLowerCase().trim();

    if (Array.isArray(value)) {
      // Array value — normalize each element.
      const arr = value
        .map((v) => (typeof v === 'string' ? v.toLowerCase().trim() : String(v).toLowerCase().trim()))
        .filter((v) => v.length > 0);
      if (arr.length > 0) {
        result[normalizedKey] = arr.length === 1 ? arr[0] : arr;
      }
    } else if (typeof value === 'string') {
      const trimmed = value.toLowerCase().trim();
      if (trimmed.length > 0) {
        result[normalizedKey] = trimmed;
      }
    } else {
      result[normalizedKey] = String(value).toLowerCase().trim();
    }
  }
  return result;
}

/**
 * Simple client-side fallback.
 * No synonym mapping or hierarchy — just basic normalization.
 */
export function simpleNormalize(name: string): CanonicalIngredient {
  if (!name) return { canonical_name: '', ancestors: [], attributes: {}, hardAttributeKeys: [] };
  let n = name.toLowerCase().trim();
  n = n.replace(/\([^)]*\)/g, ' ');
  n = n.replace(/\d+%/g, ' ');
  n = n.split(/\s+or\s+/)[0];
  n = n.replace(/\s+/g, ' ').trim();
  if (n.endsWith('ies')) n = n.slice(0, -3) + 'y';
  else if (n.endsWith('ses')) n = n.slice(0, -2);
  else if (n.endsWith('s') && !n.endsWith('ss') && !n.endsWith('us') && !n.endsWith('is')) {
    n = n.slice(0, -1);
  }
  return { canonical_name: n.trim(), ancestors: [], attributes: {}, hardAttributeKeys: [] };
}

// =============================================================================
// MATCHING — directional, with hard/soft attribute handling
// =============================================================================

export interface MatchResult {
  matched: boolean;
  warnings: string[]; // soft attribute mismatches (non-blocking)
}

/**
 * Check if two attribute values match.
 * Values can be strings or arrays of strings (for "or" alternatives).
 *
 * - Both strings: match if equal.
 * - Recipe array, pantry string: match if pantry value is in recipe array.
 * - Recipe string, pantry array: match if recipe value is in pantry array.
 * - Both arrays: match if they have any intersection.
 */
function attributeValuesMatch(
  recipeValue: string | string[],
  pantryValue: string | string[],
): boolean {
  const recipeArr = Array.isArray(recipeValue) ? recipeValue : [recipeValue];
  const pantryArr = Array.isArray(pantryValue) ? pantryValue : [pantryValue];
  // Check for intersection.
  return recipeArr.some((r) => pantryArr.includes(r));
}

/**
 * Format an attribute value for display in warnings.
 */
function formatAttributeValue(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value.join(' or ');
  }
  return value;
}

/**
 * Check if a pantry item satisfies a recipe ingredient.
 *
 * Returns a MatchResult with:
 *   - matched: true if the pantry item can satisfy the recipe ingredient
 *   - warnings: array of warning messages for soft attribute mismatches
 *
 * Rules:
 *   1. Concept match: recipe's canonical_name must be in pantry's concept path
 *      (pantry's canonical_name + ancestors). Directional: specific satisfies general.
 *
 *   2. Attribute matching (ASYMMETRIC):
 *      The recipe is the REQUIREMENT, the pantry is what you HAVE.
 *      Attribute values can be strings OR arrays (for "or" alternatives like
 *      source: ["beef", "lamb"]). Arrays match if there's any intersection.
 *
 *      a) Both sides have the attribute:
 *         - Values match (or arrays intersect) → match.
 *         - Values don't match + either side marks it HARD → NO MATCH.
 *         - Values don't match + both SOFT → match + warning.
 *
 *      b) Only RECIPE has the attribute (pantry doesn't):
 *         - HARD on recipe → NO MATCH (pantry is too generic).
 *         - SOFT on recipe → ignore (not enough info to dispute).
 *
 *      c) Only PANTRY has the attribute (recipe doesn't):
 *         - MATCH regardless of hard/soft. The pantry is MORE SPECIFIC than
 *           the recipe needs, which is fine.
 */
export function matchIngredient(
  recipe: CanonicalIngredient,
  pantry: CanonicalIngredient,
): MatchResult {
  if (!recipe.canonical_name || !pantry.canonical_name) {
    return { matched: false, warnings: [] };
  }

  // 1. Concept match: is recipe's canonical_name in pantry's concept path?
  const pantryConcepts = [pantry.canonical_name, ...pantry.ancestors];
  if (!pantryConcepts.includes(recipe.canonical_name)) {
    return { matched: false, warnings: [] };
  }

  // 2. Collect all attribute keys from both sides.
  const allKeys = new Set([
    ...Object.keys(recipe.attributes),
    ...Object.keys(pantry.attributes),
  ]);

  const recipeHard = new Set(recipe.hardAttributeKeys);
  const pantryHard = new Set(pantry.hardAttributeKeys);

  const warnings: string[] = [];

  for (const key of allKeys) {
    const recipeValue = recipe.attributes[key];
    const pantryValue = pantry.attributes[key];
    const recipeHasIt = recipeValue !== undefined;
    const pantryHasIt = pantryValue !== undefined;

    if (recipeHasIt && pantryHasIt) {
      // Both sides have the attribute.
      if (attributeValuesMatch(recipeValue!, pantryValue!)) continue; // Match.

      const isHard = recipeHard.has(key) || pantryHard.has(key);
      if (isHard) {
        // Hard disagreement → no match.
        return { matched: false, warnings: [] };
      }

      // Soft disagreement → match but warn.
      warnings.push(
        `${key}: recipe needs "${formatAttributeValue(recipeValue!)}", pantry has "${formatAttributeValue(pantryValue!)}"`,
      );
    } else if (recipeHasIt && !pantryHasIt) {
      // Only recipe has it — pantry is too generic.
      if (recipeHard.has(key)) {
        // Recipe needs something specific, pantry doesn't have it → no match.
        return { matched: false, warnings: [] };
      }
      // Soft attribute on recipe, missing on pantry → ignore.
    } else if (!recipeHasIt && pantryHasIt) {
      // Only pantry has it — pantry is more specific than the recipe needs.
      // This is always fine: the pantry item satisfies the generic recipe need.
      continue;
    }
  }

  return { matched: true, warnings };
}

/**
 * Backward-compat wrapper: returns true/false only.
 * Use matchIngredient() if you need warnings.
 */
export function isIngredientMatch(
  recipe: CanonicalIngredient,
  pantry: CanonicalIngredient,
): boolean {
  return matchIngredient(recipe, pantry).matched;
}

// =============================================================================
// COMBINED FUNCTIONS — canonicalize + enrich + match in one Gemini call
// =============================================================================

export interface EnrichedIngredient extends CanonicalIngredient {
  category: string;
  expiryDate: string | null;
  quantity: string | null;
}

const FOOD_CATEGORIES = [
  'Produce', 'Dairy', 'Meat & Fish', 'Bakery', 'Pantry', 'Grains', 'Pasta',
  'Sauces', 'Spices', 'Canned Goods', 'Frozen', 'Snacks', 'Beverages',
  'Condiments', 'Oils & Vinegars', 'Baking', 'Other',
];

/**
 * Canonicalize + enrich a single product in one Gemini call.
 */
export async function canonicalizeAndEnrich(args: {
  productName: string;
  barcode?: string;
  knownQuantity?: string;
  knownCategory?: string;
}): Promise<EnrichedIngredient> {
  const { productName, barcode, knownQuantity, knownCategory } = args;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const fallback = simpleNormalize(productName);
    return {
      ...fallback,
      category: knownCategory || 'Other',
      expiryDate: null,
      quantity: knownQuantity || null,
    };
  }

  const today = new Date().toISOString().split('T')[0];

  const knownInfo = [
    barcode ? `Barcode: ${barcode}` : null,
    `Product name: ${productName}`,
    knownQuantity ? `Known quantity: ${knownQuantity}` : null,
    knownCategory ? `Known category: ${knownCategory}` : null,
    `Today's date: ${today}`,
  ].filter(Boolean).join('\n');

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      generationConfig: {
        temperature: 0.0,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(
      `${CANONICALIZATION_PROMPT}

ADDITIONAL TASK: Also estimate category, expiry date, and quantity for this product.

Known information:
${knownInfo}

Return a SINGLE JSON object (not an array) with this structure:
{
  "canonical_name": "...",
  "ancestors": [...],
  "attributes": {...},
  "hardAttributeKeys": [...],
  "category": "one of: ${FOOD_CATEGORIES.join(', ')}",
  "expiryDate": "YYYY-MM-DD or null",
  "quantity": "e.g. 400g, 1L, 6 pack, or null"
}

Expiry guidelines:
- Fresh produce: 5-7 days from today
- Dairy: 7-14 days
- Meat & Fish: 3-5 days
- Bread/Bakery: 3-5 days
- Canned goods: 1-2 years
- Pasta/rice/grains: 1 year
- Frozen: 3-6 months
- Spices: 1 year
- Oils/vinegars: 1 year
- Condiments (opened): 3-6 months

Only fill quantity if it's not already known. Return ONLY the JSON object.`,
    );

    const text = result.response.text();
    let parsed: {
      canonical_name?: string;
      ancestors?: string[];
      attributes?: Record<string, unknown>;
      hardAttributeKeys?: string[];
      category?: string;
      expiryDate?: string;
      quantity?: string;
    };

    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse response.');
      }
    }

    const attributes = normalizeAttributes(parsed.attributes || {});
    const hardAttributeKeys = (parsed.hardAttributeKeys || []).filter(
      (k) => k in attributes,
    );

    return {
      canonical_name: (parsed.canonical_name || productName).toLowerCase().trim(),
      ancestors: (parsed.ancestors || []).map((a) => a.toLowerCase().trim()),
      attributes,
      hardAttributeKeys,
      category: parsed.category || knownCategory || 'Other',
      expiryDate: parsed.expiryDate || null,
      quantity: parsed.quantity || knownQuantity || null,
    };
  } catch (err) {
    console.error('canonicalizeAndEnrich failed:', err);
    const fallback = simpleNormalize(productName);
    return {
      ...fallback,
      category: knownCategory || 'Other',
      expiryDate: null,
      quantity: knownQuantity || null,
    };
  }
}

/**
 * Scan-match-and-enrich: canonicalize + enrich + match against shopping list in one call.
 */
export async function scanMatchAndEnrich(args: {
  productName: string;
  barcode?: string;
  knownQuantity?: string;
  shoppingListItems: Array<{ id: string; name: string; genericName: string | null }>;
}): Promise<EnrichedIngredient & { matchedItemId: string | null }> {
  const { productName, barcode, knownQuantity, shoppingListItems } = args;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const fallback = simpleNormalize(productName);
    return {
      ...fallback,
      category: 'Other',
      expiryDate: null,
      quantity: knownQuantity || null,
      matchedItemId: null,
    };
  }

  const today = new Date().toISOString().split('T')[0];

  const shoppingListText = shoppingListItems.length > 0
    ? shoppingListItems.map((item, i) =>
        `${i + 1}. ID: "${item.id}" | Name: "${item.name}"${item.genericName ? ` | Canonical: "${item.genericName}"` : ''}`
      ).join('\n')
    : '(Shopping list is empty)';

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      generationConfig: {
        temperature: 0.0,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(
      `${CANONICALIZATION_PROMPT}

ADDITIONAL TASKS for this single product:

1. Canonicalize the scanned product (as above).
2. Estimate category, expiry date, and quantity.
3. MATCH the scanned product against the shopping list below. If the scanned product satisfies a shopping list item, return the matching item's ID in "matchedItemId". Apply these matching rules:
   - A specific scanned product CAN satisfy a more general list item (e.g. scanning "udon" satisfies "noodles" on the list).
   - A general scanned product CANNOT satisfy a specific list item (e.g. scanning "noodles" does NOT satisfy "udon" on the list).
   - If multiple items match, prefer the MOST SPECIFIC match.
   - If no item matches, set matchedItemId to null.

Known information:
${barcode ? `Barcode: ${barcode}` : ''}
Product name: ${productName}
${knownQuantity ? `Known quantity: ${knownQuantity}` : ''}
Today's date: ${today}

SHOPPING LIST:
${shoppingListText}

Return a SINGLE JSON object (not an array) with this structure:
{
  "canonical_name": "...",
  "ancestors": [...],
  "attributes": {...},
  "hardAttributeKeys": [...],
  "category": "one of: ${FOOD_CATEGORIES.join(', ')}",
  "expiryDate": "YYYY-MM-DD or null",
  "quantity": "e.g. 400g, 1L, or null",
  "matchedItemId": "the shopping list item ID that this scan satisfies, or null"
}

Return ONLY the JSON object.`,
    );

    const text = result.response.text();
    let parsed: {
      canonical_name?: string;
      ancestors?: string[];
      attributes?: Record<string, unknown>;
      hardAttributeKeys?: string[];
      category?: string;
      expiryDate?: string;
      quantity?: string;
      matchedItemId?: string | null;
    };

    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse response.');
      }
    }

    const matchedId = parsed.matchedItemId && shoppingListItems.some((i) => i.id === parsed.matchedItemId)
      ? parsed.matchedItemId
      : null;

    const attributes = normalizeAttributes(parsed.attributes || {});
    const hardAttributeKeys = (parsed.hardAttributeKeys || []).filter(
      (k) => k in attributes,
    );

    return {
      canonical_name: (parsed.canonical_name || productName).toLowerCase().trim(),
      ancestors: (parsed.ancestors || []).map((a) => a.toLowerCase().trim()),
      attributes,
      hardAttributeKeys,
      category: parsed.category || 'Other',
      expiryDate: parsed.expiryDate || null,
      quantity: parsed.quantity || knownQuantity || null,
      matchedItemId: matchedId,
    };
  } catch (err) {
    console.error('scanMatchAndEnrich failed:', err);
    const fallback = simpleNormalize(productName);
    return {
      ...fallback,
      category: 'Other',
      expiryDate: null,
      quantity: knownQuantity || null,
      matchedItemId: null,
    };
  }
}
