/**
 * Authentication helper for Netlify Identity.
 *
 * Netlify Identity uses GoTrue under the hood. The client receives a JWT
 * after login, which it sends in the Authorization header. On the server,
 * we decode the JWT to get the user's ID and email.
 *
 * For local development without Netlify Identity configured, we fall back
 * to a "dev user" so the app can be tested end-to-end. In production
 * (NETLIFY_IDENTITY_URL is set), auth is required.
 *
 * NOTE: This decodes the JWT without signature verification for simplicity.
 * For a production app with sensitive data, you should verify the JWT
 * signature using the GoTrue JWT secret from your Netlify dashboard.
 * See: https://docs.netlify.com/visitor-access/identity/#jwt-tokens
 */

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

const DEV_USER: AuthUser = {
  id: 'dev-user',
  email: 'dev@localhost',
  name: 'Developer',
};

function isProductionAuth(): boolean {
  // In production, NETLIFY_IDENTITY_URL is set by Netlify automatically,
  // or by the user in .env.
  return !!process.env.NETLIFY_IDENTITY_URL;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // JWT base64 is URL-safe and may lack padding.
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
 * Returns null if:
 *   - No Authorization header is present, OR
 *   - The token is invalid, AND we're in production mode.
 *
 * In dev mode (no NETLIFY_IDENTITY_URL), returns a dev user so the app
 * can be tested without auth.
 */
export function getUserFromRequest(request: Request): AuthUser | null {
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

  // Dev mode fallback.
  if (!isProductionAuth()) {
    return DEV_USER;
  }

  return null;
}

/**
 * Require authentication. Throws a 401 error if no user is found.
 */
export function requireUser(request: Request): AuthUser {
  const user = getUserFromRequest(request);
  if (!user) {
    throw new Response(
      JSON.stringify({ error: 'Authentication required. Please log in.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
  return user;
}

/**
 * Ensure the user exists in the database (creates if not).
 * This is called after auth to sync the user record.
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
    // If the DB isn't available (e.g. local dev without Neon), just continue.
    console.warn('Could not sync user to DB:', (err as Error).message);
  }
}
