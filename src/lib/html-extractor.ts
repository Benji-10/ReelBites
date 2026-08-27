/**
 * Extracts readable text content or structured recipe data from HTML.
 *
 * Strategy:
 *   1. Search the ORIGINAL html for all <script type="application/ld+json"> blocks
 *      (before stripping scripts). Use matchAll() to find every block.
 *   2. Parse each block, handling @graph, arrays, and @type as string or array.
 *   3. If a Recipe is found, return its JSON string.
 *   4. If no JSON-LD recipe is found, clean the HTML (strip scripts/styles/nav)
 *      and return the text content as a fallback.
 */

interface RecipeExtractionResult {
  /** The text to send to Gemini. */
  content: string;
  /** True if structured JSON-LD recipe data was found. */
  isStructured: boolean;
}

export function extractRecipeContent(html: string): RecipeExtractionResult {
  // --- Path 1: JSON-LD structured data ---
  // Search the ORIGINAL html, before we strip <script> tags.
  // Allow single or double quotes around the type attribute.
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const matches = [...html.matchAll(jsonLdRegex)];

  for (const match of matches) {
    const rawJson = match[1].trim();
    if (!rawJson) continue;

    try {
      const parsed = JSON.parse(rawJson);
      const recipe = findRecipeInJsonLd(parsed);

      if (recipe) {
        // Found structured recipe data — return it as a JSON string.
        return {
          content: JSON.stringify(recipe, null, 2),
          isStructured: true,
        };
      }
    } catch {
      // This block wasn't valid JSON — try the next one.
      continue;
    }
  }

  // --- Path 2: Cleaned HTML text (fallback) ---
  const cleanedText = cleanHtmlToText(html);
  return { content: cleanedText, isStructured: false };
}

/**
 * Recursively search a parsed JSON-LD object for a Recipe.
 * Handles @graph, arrays, and @type as string or array.
 */
function findRecipeInJsonLd(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;

  // Handle arrays — check each element.
  if (Array.isArray(node)) {
    for (const item of node) {
      const recipe = findRecipeInJsonLd(item);
      if (recipe) return recipe;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;

  // Check @type — can be a string or an array of strings.
  const type = obj['@type'];
  if (type) {
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === 'string' && t.toLowerCase() === 'recipe')) {
      return obj;
    }
  }

  // Check @graph — common pattern where multiple entities are nested.
  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) {
      const recipe = findRecipeInJsonLd(item);
      if (recipe) return recipe;
    }
  }

  // Check common nesting keys.
  if (obj['mainEntity']) {
    const recipe = findRecipeInJsonLd(obj['mainEntity']);
    if (recipe) return recipe;
  }

  return null;
}

/**
 * Strip scripts, styles, nav, footer from HTML and return plain text.
 */
function cleanHtmlToText(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Look for recipe container elements.
  const recipeContainerMatch = text.match(/<div[^>]*class="[^"]*(?:recipe|ingredients|instructions)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (recipeContainerMatch) {
    text = recipeContainerMatch[1];
  }

  // Convert HTML to text.
  const clean = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return clean;
}
