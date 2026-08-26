/**
 * GET  /api/settings — load the user's settings from the database.
 * PUT  /api/settings — save the user's settings to the database.
 *
 * Settings are stored as a JSON blob on the User record, so they sync
 * across devices when the user logs in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  try {
    const dbUser = await db.user.findUnique({ where: { id: user.id } });
    return NextResponse.json({ settings: dbUser?.settings || null });
  } catch (err) {
    console.error('Failed to load settings:', err);
    return NextResponse.json({ settings: null });
  }
}

export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    await db.user.update({
      where: { id: user.id },
      data: { settings: body as never },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to save settings:', err);
    return NextResponse.json({ error: 'Could not save settings.' }, { status: 500 });
  }
}
