/**
 * Shared ingredient canonicalization using Gemini.
 *
 * Produces a hierarchical semantic representation:
 *   - canonical_name: the most specific meaningful grocery concept
 *   - ancestors: progressively broader concepts (immediate parent → broadest)
 *   - attributes: meaningful properties (state, form, color, variety, etc.)
 *
 * This allows directional matching:
 *   - Recipe needs "noodles" → pantry has "udon" → MATCH (udon's ancestors include noodles)
 *   - Recipe needs "udon" → pantry has "noodles" → NO MATCH (can't walk downward)
 *
 * Both pantry items and recipe ingredients use this same function,
 * so they speak the same semantic language.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export interface CanonicalIngredient {
  canonical_name: string;
  ancestors: string[];
  attributes: Record<string, string>;
}

const CANONICALIZATION_PROMPT = `You are a Grocery Semantic Normalizer.

You convert grocery items into stable semantic representations for offline matching.

For each input item, return a JSON object with this structure:
{
  "original": "<the input string>",
  "canonical_name": "<most specific meaningful grocery concept>",
  "ancestors": ["<immediate parent concept>", "<broader concept>", ...],
  "attributes": {}
}

Return a JSON ARRAY of these objects, one per input item. No explanations, no markdown.

## Core principle

Identify WHAT the grocery item is, not what words it uses.

Normalize across languages, dialects, synonyms, spelling, singular/plural, abbreviations, brands, and regional terminology.

Equivalent descriptions MUST independently produce the same representation.

Use stable, lowercase US-English concept names.

## Hierarchy

canonical_name is the item's most specific meaningful grocery concept.

ancestors contains progressively broader concepts, from immediate parent to broadest useful parent.

Examples:

udon noodles → {"canonical_name": "udon", "ancestors": ["wheat noodles", "noodles"], "attributes": {}}
ramen noodles → {"canonical_name": "ramen", "ancestors": ["wheat noodles", "noodles"], "attributes": {}}
noodles → {"canonical_name": "noodles", "ancestors": [], "attributes": {}}

Thus a request for "noodles" can match "udon", while a request for "udon" cannot match "ramen".

More examples:

oat milk → {"canonical_name": "milk", "ancestors": [], "attributes": {"source": "oat"}}
milk → {"canonical_name": "milk", "ancestors": [], "attributes": {}}
garlic powder → {"canonical_name": "garlic", "ancestors": [], "attributes": {"state": "dry", "form": "fine"}}
garlic granules → {"canonical_name": "garlic", "ancestors": [], "attributes": {"state": "dry", "form": "fine"}}

When a subtype can be represented as an attribute rather than a distinct concept, prefer the broader concept plus the attribute.

For example:
russet potato → potato + variety:russet
red bell pepper → bell pepper + color:red
oat milk → milk + source:oat

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
chilli flakes / chili flakes / crushed red pepper / red pepper flakes → chili pepper + dry + crushed
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
chili flakes / chilli flakes / red pepper flakes / crushed red pepper → chili pepper + dry + crushed
garlic powder / garlic granules → garlic + dry + fine
ground cumin / cumin powder → cumin + dry + fine

Do not collapse meaningful distinctions:
fresh garlic ≠ dry garlic
garlic powder ≠ garlic paste
chili flakes ≠ chili powder
oat milk ≠ soy milk
tomato ≠ tomato paste
butter ≠ margarine
olive oil ≠ vegetable oil
chicken breast ≠ chicken thigh

## Attributes

Use attributes for meaningful properties that should affect matching.

Possible attributes: state, form, type, variety, source, color, flavor, diet, preparation, etc.

Normalize different wording describing the same property.

Do not invent unspecified attributes.

A broad item MUST remain broad:
milk → milk (attributes: {})
cheese → cheese (attributes: {})
noodles → noodles (attributes: {})
potato → potato (attributes: {})

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
2. Specific subtypes have a broader ancestor.
3. Meaningful distinctions are preserved as attributes or child concepts.
4. Unspecified properties remain unspecified.
5. Singular, lowercase, stable terminology is used.
6. The representation would allow an offline matcher to walk from the specific concept toward its ancestors and find the most specific compatible item.`;

/**
 * Canonicalize a list of ingredient names using Gemini.
 * Returns a Map from original name → CanonicalIngredient.
 */
export async function canonicalizeNames(names: string[]): Promise<Map<string, CanonicalIngredient>> {
  const result = new Map<string, CanonicalIngredient>();

  if (names.length === 0) return result;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
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

    let parsed: Array<{ original: string; canonical_name: string; ancestors: string[]; attributes: Record<string, string> }>;
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
        result.set(item.original, {
          canonical_name: item.canonical_name.toLowerCase().trim(),
          ancestors: (item.ancestors || []).map((a) => a.toLowerCase().trim()),
          attributes: normalizeAttributes(item.attributes || {}),
        });
      }
    }

    // Fill in any missing names with fallback.
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
 */
export async function canonicalizeName(name: string): Promise<CanonicalIngredient> {
  const map = await canonicalizeNames([name]);
  return map.get(name) || simpleNormalize(name);
}

/**
 * Normalize attribute keys and values to lowercase strings.
 */
function normalizeAttributes(attrs: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) {
      result[key.toLowerCase().trim()] = String(value).toLowerCase().trim();
    }
  }
  return result;
}

/**
 * Simple client-side fallback.
 * No synonym mapping or hierarchy — just basic normalization.
 */
export function simpleNormalize(name: string): CanonicalIngredient {
  if (!name) return { canonical_name: '', ancestors: [], attributes: {} };
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
  return { canonical_name: n.trim(), ancestors: [], attributes: {} };
}

/**
 * Check if a pantry item satisfies a recipe ingredient.
 *
 * Directional matching: walk UP the pantry item's concept path.
 * If the recipe's canonical_name is found in the pantry's path
 * (canonical_name + ancestors), it's a concept match.
 * Then check that all recipe attributes are satisfied by pantry attributes.
 *
 * Examples:
 *   Recipe: "noodles", Pantry: "udon" (ancestors: [wheat noodles, noodles])
 *   → "noodles" is in pantry's path → MATCH
 *
 *   Recipe: "udon", Pantry: "noodles" (ancestors: [])
 *   → "udon" is NOT in pantry's path → NO MATCH (can't walk downward)
 *
 *   Recipe: "red bell pepper" (attr: color:red), Pantry: "bell pepper" (attr: {})
 *   → Concept matches, but pantry doesn't have color:red → NO MATCH
 *
 *   Recipe: "bell pepper" (attr: {}), Pantry: "red bell pepper" (attr: color:red)
 *   → Concept matches, recipe has no attributes → MATCH (pantry is more specific)
 */
export function isIngredientMatch(
  recipe: CanonicalIngredient,
  pantry: CanonicalIngredient,
): boolean {
  if (!recipe.canonical_name || !pantry.canonical_name) return false;

  // Build the pantry item's concept path: [canonical_name, ...ancestors]
  const pantryConcepts = [pantry.canonical_name, ...pantry.ancestors];

  // Does the pantry's concept path include the recipe's canonical_name?
  if (!pantryConcepts.includes(recipe.canonical_name)) {
    return false;
  }

  // Concept match! Now check attribute compatibility.
  // Every recipe attribute must be present in the pantry with the same value.
  // (Recipe is the "requirement", pantry is the "actual".)
  for (const [key, value] of Object.entries(recipe.attributes)) {
    if (pantry.attributes[key] !== value) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// COMBINED FUNCTIONS — canonicalize + enrich + match in one Gemini call
// =============================================================================
//
// These functions reduce API calls by asking Gemini for everything we need
// in a single request:
//   - canonicalizeAndEnrich: canonical structure + category + expiry + quantity
//   - scanMatchAndEnrich: canonical + enrich + which shopping list item to tick off

export interface EnrichedIngredient extends CanonicalIngredient {
  category: string;
  expiryDate: string | null; // YYYY-MM-DD format
  quantity: string | null;
}

const FOOD_CATEGORIES = [
  'Produce', 'Dairy', 'Meat & Fish', 'Bakery', 'Pantry', 'Grains', 'Pasta',
  'Sauces', 'Spices', 'Canned Goods', 'Frozen', 'Snacks', 'Beverages',
  'Condiments', 'Oils & Vinegars', 'Baking', 'Other',
];

/**
 * Canonicalize + enrich a single product in one Gemini call.
 * Returns the canonical structure + category + expiry + quantity.
 *
 * Used by:
 *   - /api/pantry/enrich (pantry add via scan or manual)
 *   - shopping list manual tick (to prepare item for pantry)
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

    return {
      canonical_name: (parsed.canonical_name || productName).toLowerCase().trim(),
      ancestors: (parsed.ancestors || []).map((a) => a.toLowerCase().trim()),
      attributes: normalizeAttributes(parsed.attributes || {}),
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
 * Scan-match-and-enrich: in ONE Gemini call, canonicalize the scanned product,
 * enrich it (category/expiry/quantity), AND determine which shopping list item
 * it should tick off.
 *
 * Matching rules (same as the recipe/pantry matcher, but evaluated by Gemini):
 *   - If the scanned product matches a specific shopping list item, tick that off.
 *   - If it matches a more general item, tick that off.
 *   - Specific beats general: if both "udon" and "noodles" are on the list,
 *     and the scan is "udon", tick "udon" (not "noodles").
 *   - If nothing matches, don't tick anything off.
 *
 * Returns:
 *   - canonical: the full canonical structure for pantry storage
 *   - category, expiryDate, quantity: for pantry storage
 *   - matchedItemId: the ID of the shopping list item to tick off (or null)
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

  // Build the shopping list for Gemini to match against.
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
   - If multiple items match, prefer the MOST SPECIFIC match (e.g. if list has both "udon" and "noodles", and scan is "udon", match "udon").
   - If no item matches, set matchedItemId to null.
   - Do not match already-irrelevant items (different ingredients entirely).

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

    // Validate that matchedItemId is actually in the shopping list.
    const matchedId = parsed.matchedItemId && shoppingListItems.some((i) => i.id === parsed.matchedItemId)
      ? parsed.matchedItemId
      : null;

    return {
      canonical_name: (parsed.canonical_name || productName).toLowerCase().trim(),
      ancestors: (parsed.ancestors || []).map((a) => a.toLowerCase().trim()),
      attributes: normalizeAttributes(parsed.attributes || {}),
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
