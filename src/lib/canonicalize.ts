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
