/**
 * Authentication helper for Netlify Identity.
 *
 * Netlify Identity uses GoTrue under the hood. The client receives a JWT
 * after login, which it sends in the Authorization header. On the server,
 * we decode the JWT to get the user's ID and email.
 *
 * If no JWT is present, we fall back to a "guest" user so the app works
 * without requiring login. This makes the app usable immediately without
 * forcing users through the Netlify Identity signup flow.
 *
 * NOTE: This decodes the JWT without signature verification for simplicity.
 * For a production app with sensitive data, you should verify the JWT
 * signature using the GoTrue JWT secret from your Netlify dashboard.
 */

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

const GUEST_USER: AuthUser = {
  id: 'guest-user',
  email: 'guest@reel-recipes.local',
  name: 'Guest',
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Extract the authenticated user from a request's Authorization header.
 *
 * If a valid JWT is present, returns the decoded user.
 * Otherwise, returns a guest user so the app works without login.
 */
export function getUserFromRequest(request: Request): AuthUser {
  const authHeader = request.headers.get('authorization') ||
    request.headers.get('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = decodeJwtPayload(token);
    if (payload && payload.sub && payload.email) {
      return {
        id: payload.sub as string,
        email: payload.email as string,
        name: (payload.user_metadata as { full_name?: string } | undefined)?.full_name,
      };
    }
  }

  // Fall back to guest user — allows the app to work without login.
  return GUEST_USER;
}

/**
 * Ensure the user exists in the database (creates if not).
 */
export async function ensureUserInDb(user: AuthUser): Promise<void> {
  try {
    const { db } = await import('./db');
    await db.user.upsert({
      where: { email: user.email },
      create: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      update: {
        name: user.name,
      },
    });
  } catch (err) {
    console.warn('Could not sync user to DB:', (err as Error).message);
  }
}
