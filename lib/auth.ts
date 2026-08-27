/**
 * Authentication helper for Netlify Identity.
 *
 * If no JWT is present, we fall back to a "guest" user so the app works
 * without requiring login. When a user logs in, any recipes they created
 * as a guest are migrated to their real account.
 */

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  isGuest: boolean;
}

const GUEST_USER: AuthUser = {
  id: 'guest-user',
  email: 'guest@realbites.local',
  name: 'Guest',
  isGuest: true,
};

const GUEST_USER_ID = 'guest-user';

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
 * Falls back to guest user if no JWT is present.
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
        isGuest: false,
      };
    }
  }

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

/**
 * Migrate recipes from the guest user to a real logged-in user.
 *
 * When a user logs in for the first time, any recipes they created while
 * not logged in (saved under the "guest-user" ID) are reassigned to their
 * real account. This ensures they don't lose their recipes.
 */
export async function migrateGuestRecipes(user: AuthUser): Promise<void> {
  if (user.isGuest) return; // Don't migrate for guest users.

  try {
    const { db } = await import('./db');

    // Find all recipes belonging to the guest user.
    const guestRecipes = await db.recipe.findMany({
      where: { userId: GUEST_USER_ID },
      select: { id: true },
    });

    if (guestRecipes.length === 0) return;

    // Reassign them to the real user.
    const result = await db.recipe.updateMany({
      where: { userId: GUEST_USER_ID },
      data: { userId: user.id },
    });

    console.log(`[auth] Migrated ${result.count} guest recipes to user ${user.email}`);
  } catch (err) {
    console.warn('Could not migrate guest recipes:', (err as Error).message);
  }
}
