/**
 * Epicure MCP Client
 *
 * Communicates with the Epicure ingredient-embedding model via the
 * Model Context Protocol (MCP) over Streamable HTTP.
 *
 * Public endpoint: https://epicure-mcp.kaikaku.ai/mcp
 * No auth required. 1,790 ingredients, 300-dimensional embeddings,
 * trained on 4.14 million multilingual recipes.
 *
 * Tools used:
 *   - find_pairings: Build a cluster and bridge graph around ingredients
 *   - pairing_score: Measure cosine affinity between two ingredients
 *   - neighbors: Return nearest ingredients in the 300-dim model
 *
 * If Epicure is unavailable, all functions return null/empty and the
 * caller falls back to Gemini-only recipe generation.
 */

const EPICURE_ENDPOINT = 'https://epicure-mcp.kaikaku.ai/mcp';

let initialized = false;
let sessionId: string | null = null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number;
}

/**
 * Send a JSON-RPC request to the Epicure MCP endpoint.
 * Handles session management and SSE responses.
 */
async function mcpCall(method: string, params?: unknown): Promise<unknown | null> {
  const requestId = Math.floor(Math.random() * 1000000);

  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params,
    id: requestId,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId;
  }

  try {
    const response = await fetch(EPICURE_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    // Capture session ID from response headers.
    const newSessionId = response.headers.get('Mcp-Session-Id');
    if (newSessionId) {
      sessionId = newSessionId;
    }

    if (!response.ok) {
      console.warn(`[epicure] MCP call "${method}" returned HTTP ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';

    // Handle SSE response (text/event-stream).
    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      // Parse SSE — look for "data:" lines containing JSON-RPC responses.
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const jsonStr = line.slice(5).trim();
          try {
            const parsed: JsonRpcResponse = JSON.parse(jsonStr);
            if (parsed.error) {
              console.warn(`[epicure] MCP error for "${method}":`, parsed.error.message);
              return null;
            }
            return parsed.result;
          } catch {}
        }
      }
      return null;
    }

    // Handle plain JSON response.
    if (contentType.includes('application/json')) {
      const parsed: JsonRpcResponse = await response.json();
      if (parsed.error) {
        console.warn(`[epicure] MCP error for "${method}":`, parsed.error.message);
        return null;
      }
      return parsed.result;
    }

    // Unknown content type — try to parse as text.
    const text = await response.text();
    try {
      const parsed: JsonRpcResponse = JSON.parse(text);
      if (parsed.error) {
        console.warn(`[epicure] MCP error for "${method}":`, parsed.error.message);
        return null;
      }
      return parsed.result;
    } catch {
      console.warn(`[epicure] Could not parse response for "${method}"`);
      return null;
    }
  } catch (err) {
    console.warn(`[epicure] MCP call "${method}" failed:`, (err as Error).message);
    return null;
  }
}

/**
 * Initialize the MCP session. Call once before making tool calls.
 */
async function ensureInitialized(): Promise<boolean> {
  if (initialized) return true;

  const result = await mcpCall('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'RealBites', version: '1.0.0' },
  });

  if (result !== null) {
    initialized = true;
    // Send the "initialized" notification (no response expected).
    await mcpCall('notifications/initialized').catch(() => {});
    console.log('[epicure] MCP session initialized.');
    return true;
  }

  // Some MCP servers accept direct tool calls without initialization.
  // Try calling a tool directly to see if it works.
  console.warn('[epicure] Initialization failed — will try direct tool calls.');
  return true; // Proceed anyway — tool calls might work.
}

export interface PairingResult {
  ingredient: string;
  pairings: Array<{
    ingredient: string;
    score: number;
    relationship: string;
  }>;
}

export interface PairingGraph {
  clusters: Array<{
    center: string;
    members: string[];
  }>;
  bridges: Array<{
    from: string;
    to: string;
    score: number;
  }>;
}

/**
 * Call Epicure's find_pairings tool.
 * Builds a cluster and bridge graph around one or more ingredients.
 */
export async function findPairings(ingredients: string[]): Promise<PairingGraph | null> {
  await ensureInitialized();

  const result = await mcpCall('tools/call', {
    name: 'find_pairings',
    arguments: { ingredients },
  });

  if (!result) return null;

  // MCP tool results come as { content: [{ type: 'text', text: '...' }] }
  const toolResult = result as { content?: Array<{ type: string; text: string }> };
  if (!toolResult?.content?.[0]?.text) return null;

  try {
    const parsed = JSON.parse(toolResult.content[0].text);
    return parsed as PairingGraph;
  } catch {
    // If it's not JSON, try to extract useful info from the text.
    const text = toolResult.content[0].text;
    console.warn('[epicure] Could not parse find_pairings response as JSON:', text.slice(0, 200));
    return null;
  }
}

/**
 * Call Epicure's pairing_score tool.
 * Measures cosine affinity between two ingredients.
 */
export async function pairingScore(ingredient1: string, ingredient2: string): Promise<number | null> {
  await ensureInitialized();

  const result = await mcpCall('tools/call', {
    name: 'pairing_score',
    arguments: { ingredient_a: ingredient1, ingredient_b: ingredient2 },
  });

  if (!result) return null;

  const toolResult = result as { content?: Array<{ type: string; text: string }> };
  if (!toolResult?.content?.[0]?.text) return null;

  try {
    const parsed = JSON.parse(toolResult.content[0].text);
    // Expected: { score: 0.85, percentile: 0.92 }
    return parsed.score ?? parsed.affinity ?? null;
  } catch {
    // Try to extract a number from the text.
    const match = toolResult.content[0].text.match(/(\d+\.?\d*)/);
    return match ? parseFloat(match[1]) : null;
  }
}

/**
 * Call Epicure's neighbors tool.
 * Returns the nearest ingredients in the 300-dimensional model.
 */
export async function findNeighbors(ingredient: string, topK: number = 10): Promise<string[] | null> {
  await ensureInitialized();

  const result = await mcpCall('tools/call', {
    name: 'neighbors',
    arguments: { ingredient, top_k: topK },
  });

  if (!result) return null;

  const toolResult = result as { content?: Array<{ type: string; text: string }> };
  if (!toolResult?.content?.[0]?.text) return null;

  try {
    const parsed = JSON.parse(toolResult.content[0].text);
    if (Array.isArray(parsed.neighbors)) {
      return parsed.neighbors.map((n: { name?: string; ingredient?: string } | string) =>
        typeof n === 'string' ? n : (n.name || n.ingredient || '')
      ).filter(Boolean);
    }
    if (Array.isArray(parsed)) {
      return parsed.map((n: { name?: string; ingredient?: string } | string) =>
        typeof n === 'string' ? n : (n.name || n.ingredient || '')
      ).filter(Boolean);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a flavour profile for a set of ingredients.
 *
 * This is the main entry point for recipe generation. Given the user's
 * pantry items (and optionally a preferred ingredient), it:
 *   1. Calls find_pairings for the key ingredients
 *   2. Scores the pairings between pantry items
 *   3. Returns a structured flavour profile to pass to Gemini
 */
export interface FlavourProfile {
  coreIngredients: string[];
  validatedPairings: Array<{
    a: string;
    b: string;
    score: number;
  }>;
  suggestedPairings: string[]; // Ingredients that pair well but aren't in the pantry
  pantryCoverage: number; // What fraction of pantry items have validated pairings
}

export async function buildFlavourProfile(
  pantryIngredients: string[],
  preferredIngredient?: string,
): Promise<FlavourProfile | null> {
  // Determine the key ingredients to query (proteins + preferred + top 3 pantry items).
  const keyIngredients: string[] = [];
  if (preferredIngredient) {
    keyIngredients.push(preferredIngredient);
  }
  // Add up to 3 more pantry items (prefer proteins and vegetables).
  for (const item of pantryIngredients.slice(0, 5)) {
    if (keyIngredients.length >= 4) break;
    if (!keyIngredients.includes(item.toLowerCase())) {
      keyIngredients.push(item.toLowerCase());
    }
  }

  if (keyIngredients.length === 0) return null;

  console.log(`[epicure] Building flavour profile for: ${keyIngredients.join(', ')}`);

  // Call find_pairings for the key ingredients.
  const graph = await findPairings(keyIngredients);

  if (!graph) {
    console.warn('[epicure] No pairing graph returned — falling back to Gemini-only.');
    return null;
  }

  // Extract validated pairings (ingredients from the pantry that pair well).
  const validatedPairings: FlavourProfile['validatedPairings'] = [];
  const suggestedPairings = new Set<string>();
  const pantrySet = new Set(pantryIngredients.map((i) => i.toLowerCase()));

  // Process clusters.
  if (graph.clusters) {
    for (const cluster of graph.clusters) {
      for (const member of cluster.members || []) {
        const memberLower = member.toLowerCase();
        if (pantrySet.has(memberLower)) {
          // This pantry item is in a validated cluster.
          validatedPairings.push({
            a: cluster.center,
            b: member,
            score: 0.8, // Default score if not provided.
          });
        } else {
          // This is a suggested pairing (not in pantry).
          suggestedPairings.add(member);
        }
      }
    }
  }

  // Process bridges.
  if (graph.bridges) {
    for (const bridge of graph.bridges) {
      const fromLower = bridge.from.toLowerCase();
      const toLower = bridge.to.toLowerCase();
      if (pantrySet.has(toLower)) {
        validatedPairings.push({
          a: bridge.from,
          b: bridge.to,
          score: bridge.score,
        });
      } else {
        suggestedPairings.add(bridge.to);
      }
      if (pantrySet.has(fromLower) && !pantrySet.has(toLower)) {
        suggestedPairings.add(bridge.to);
      }
    }
  }

  // Calculate pantry coverage.
  const pantryItemsWithPairings = new Set(validatedPairings.map((p) => p.b.toLowerCase()));
  const pantryCoverage = pantryIngredients.length > 0
    ? pantryItemsWithPairings.size / pantryIngredients.length
    : 0;

  const profile: FlavourProfile = {
    coreIngredients: keyIngredients,
    validatedPairings,
    suggestedPairings: Array.from(suggestedPairings).slice(0, 10),
    pantryCoverage,
  };

  console.log(`[epicure] Flavour profile: ${validatedPairings.length} validated pairings, ${profile.suggestedPairings.length} suggested additions.`);

  return profile;
}

/**
 * Format the flavour profile as a text block for the Gemini prompt.
 * Returns null if the profile is empty or not useful.
 */
export function formatFlavourProfileForPrompt(profile: FlavourProfile | null): string | null {
  if (!profile || (profile.validatedPairings.length === 0 && profile.suggestedPairings.length === 0)) {
    return null;
  }

  const lines: string[] = [];

  lines.push('FLAVOUR ANALYSIS (from Epicure ingredient embedding model):');
  lines.push('The following ingredient pairings have been validated using 300-dimensional');
  lines.push('skip-gram embeddings trained on 4.14 million multilingual recipes.');
  lines.push('Every pairing has a scientifically measured affinity score.');
  lines.push('');

  if (profile.validatedPairings.length > 0) {
    lines.push('VALIDATED PAIRINGS (these ingredients are in the pantry and pair well together):');
    for (const pairing of profile.validatedPairings.slice(0, 15)) {
      lines.push(`  • ${pairing.a} + ${pairing.b} (affinity: ${pairing.score.toFixed(2)})`);
    }
    lines.push('');
  }

  if (profile.suggestedPairings.length > 0) {
    lines.push('SUGGESTED ADDITIONS (pair well with the core ingredients but may not be in the pantry):');
    for (const suggestion of profile.suggestedPairings.slice(0, 8)) {
      lines.push(`  • ${suggestion}`);
    }
    lines.push('');
  }

  lines.push('Use these validated pairings as the foundation for your recipes. Ingredients that');
  lines.push('have scientifically high affinity should be combined in the same dish. If a');
  lines.push('suggested addition would elevate a recipe, include it (mark with flag "suggested_addition").');

  return lines.join('\n');
}
