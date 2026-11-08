/**
 * Epicure MCP client for flavour pairing analysis.
 *
 * Talks to the Epicure MCP server (https://epicure-mcp.kaikaku.ai/mcp) using
 * JSON-RPC 2.0 over Streamable HTTP. Epicure's model has 300-dim ingredient
 * embeddings trained on 4.14M recipes — we use it to validate and extend the
 * flavour pairings for pantry-based recipe generation.
 *
 * Protocol notes (Streamable HTTP transport):
 *   1. POST an `initialize` request. The server may return a session id in
 *      the `mcp-session-id` response header.
 *   2. POST a `notifications/initialized` notification (fire-and-forget).
 *   3. POST `tools/call` with the `find_pairings` tool.
 *
 * The server responds with an SSE-style stream (`text/event-stream`); we parse
 * the `data:` lines to extract the JSON-RPC result.
 *
 * EVERYTHING here fails soft: any error returns null so callers can fall back
 * to Gemini-only recipe generation.
 */

const EPICURE_MCP_URL = 'https://epicure-mcp.kaikaku.ai/mcp';
const REQUEST_TIMEOUT_MS = 15000;

/** Incrementing JSON-RPC request ID (module-level counter). */
let nextRequestId = 1;

export interface FlavourProfile {
  /** The core pantry ingredients the pairings are based on. */
  coreIngredients: string[];
  /** Pairings validated against the pantry (these combos are known-good). */
  validatedPairings: string[];
  /** Suggested additions — ingredients that pair well but aren't in the pantry. */
  suggestedPairings: string[];
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    [key: string]: unknown;
  };
  error?: { code: number; message: string };
}

/**
 * POST a single JSON-RPC 2.0 message to the Epicure MCP server and parse the
 * SSE-style response into a JsonRpcResponse.
 *
 * Returns null on ANY failure (network, timeout, bad JSON, JSON-RPC error).
 */
async function rpcCall(
  method: string,
  params?: unknown,
  sessionId?: string,
): Promise<JsonRpcResponse | null> {
  const id = nextRequestId++;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(EPICURE_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[epicure] ${method} returned HTTP ${response.status}.`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();

    // The server usually answers with an SSE stream: lines like `data: {...}`.
    // Some MCP servers reply with plain JSON instead — handle both.
    let jsonText: string | null = null;

    if (contentType.includes('text/event-stream') || raw.includes('data:')) {
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data) as JsonRpcResponse;
            // Skip responses that are JSON-RPC errors.
            if (parsed.error) {
              console.warn(`[epicure] ${method} JSON-RPC error:`, parsed.error.message);
              return null;
            }
            // Match on id when present (notifications have none).
            if (parsed.id === undefined || parsed.id === id) {
              jsonText = data;
              break;
            }
          } catch {
            // Not JSON (e.g. a keep-alive comment) — keep scanning.
          }
        }
      }
    } else {
      jsonText = raw.trim();
    }

    if (!jsonText) {
      console.warn(`[epicure] ${method}: no JSON-RPC payload found in response.`);
      return null;
    }

    try {
      const parsed = JSON.parse(jsonText) as JsonRpcResponse;
      if (parsed.error) {
        console.warn(`[epicure] ${method} JSON-RPC error:`, parsed.error.message);
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn(`[epicure] ${method}: failed to parse JSON payload:`, err);
      return null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[epicure] ${method} request failed:`, message);
    return null;
  }
}

/**
 * Extract the tool result text from an MCP tools/call response.
 * MCP wraps tool output as result.content[] — we want the first text part.
 */
function extractToolText(response: JsonRpcResponse): string | null {
  const content = response.result?.content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (part && part.type === 'text' && typeof part.text === 'string') {
      return part.text;
    }
  }
  return null;
}

/**
 * Build a flavour profile for the user's pantry using Epicure's
 * `find_pairings` tool.
 *
 * @param pantryIngredients - ingredient names from the pantry (canonical
 *   names preferred, falls back to display names).
 * @param preferredIngredient - optional ingredient the user wants to cook
 *   with; validated against the pairing model.
 * @returns A FlavourProfile, or null on ANY error (server down, timeout,
 *   unparsable response...). Callers must handle null gracefully.
 */
export async function buildFlavourProfile(
  pantryIngredients: string[],
  preferredIngredient?: string,
): Promise<FlavourProfile | null> {
  // Need at least one ingredient to work with.
  const ingredients = pantryIngredients
    .map((i) => i?.toLowerCase().trim())
    .filter(Boolean);
  if (ingredients.length === 0) return null;

  const preferred = preferredIngredient?.toLowerCase().trim() || undefined;

  try {
    // --- MCP handshake -----------------------------------------------------
    const initResponse = await rpcCall('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'realbites', version: '1.0.0' },
    });
    if (!initResponse) return null;

    // The session id (if the server uses one) comes back as a header, but
    // since rpcCall returns only the parsed body we re-derive nothing here —
    // stateless servers (the common case for this endpoint) work without it.

    // Fire-and-forget initialized notification. Some servers require it
    // before accepting tools/call; ignore failures.
    await rpcCall('notifications/initialized');

    // --- Tool call ----------------------------------------------------------
    const toolResponse = await rpcCall('tools/call', {
      name: 'find_pairings',
      arguments: {
        ingredients,
        ...(preferred ? { preferred_ingredient: preferred } : {}),
      },
    });
    if (!toolResponse) return null;

    const toolText = extractToolText(toolResponse);
    if (!toolText) {
      console.warn('[epicure] find_pairings returned no text content.');
      return null;
    }

    // The tool text is itself JSON (Epicure returns a structured payload).
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(toolText) as Record<string, unknown>;
    } catch {
      // Maybe the text is JSON embedded in prose — try to find it.
      const match = toolText.match(/\{[\s\S]*\}/);
      if (!match) {
        console.warn('[epicure] find_pairings text was not JSON:', toolText.slice(0, 200));
        return null;
      }
      try {
        payload = JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        console.warn('[epicure] could not parse embedded JSON from find_pairings.');
        return null;
      }
    }

    const toStringArray = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : [];

    // Epicure returns different shapes depending on version; accept the
    // documented keys with sensible fallbacks.
    const coreIngredients = toStringArray(
      payload.coreIngredients ?? payload.core_ingredients ?? payload.ingredients,
    );
    const validatedPairings = toStringArray(
      payload.validatedPairings ?? payload.validated_pairings ?? payload.pairings,
    );
    const suggestedPairings = toStringArray(
      payload.suggestedPairings ?? payload.suggested_pairings ?? payload.suggestions,
    );

    if (coreIngredients.length === 0 && validatedPairings.length === 0 && suggestedPairings.length === 0) {
      console.warn('[epicure] find_pairings returned an empty profile.');
      return null;
    }

    return { coreIngredients, validatedPairings, suggestedPairings };
  } catch (err) {
    // Should never happen (rpcCall catches its own errors), but be safe.
    console.warn('[epicure] buildFlavourProfile failed:', err);
    return null;
  }
}

/**
 * Format a FlavourProfile for inclusion in a Gemini prompt.
 *
 * @returns A human-readable prompt section, or null if the profile is null
 *   (so callers can skip the section entirely).
 */
export function formatFlavourProfileForPrompt(profile: FlavourProfile | null): string | null {
  if (!profile) return null;

  const lines: string[] = ['FLAVOUR PAIRING ANALYSIS (Epicure — 4.14M recipe corpus):'];

  if (profile.coreIngredients.length > 0) {
    lines.push(`Core ingredients: ${profile.coreIngredients.join(', ')}`);
  }
  if (profile.validatedPairings.length > 0) {
    lines.push(
      `Validated pairings (known-good flavour combinations from the pantry): ${profile.validatedPairings.join('; ')}`,
    );
  }
  if (profile.suggestedPairings.length > 0) {
    lines.push(
      `Suggested additions (pair well with the pantry but might not be in it): ${profile.suggestedPairings.join('; ')}`,
    );
  }

  lines.push(
    'Use the validated pairings as the flavour backbone of the recipes. ' +
      'Treat suggested additions as optional inspirations (only in inspiration mode).',
  );

  return lines.join('\n');
}
