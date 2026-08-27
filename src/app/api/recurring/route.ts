/**
 * Recurring Items API
 * GET  /api/recurring — list all recurring items
 * POST /api/recurring — add a recurring item
 * DELETE /api/recurring/[id] — remove a recurring item
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
    const items = await db.recurringItem.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  let body: { name: string; quantity?: string; genericName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body.name) {
    return NextResponse.json({ error: 'Missing "name".' }, { status: 400 });
  }

  try {
    const item = await db.recurringItem.create({
      data: {
        userId: user.id,
        name: body.name,
        genericName: body.genericName || body.name.toLowerCase(),
        quantity: body.quantity || null,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Could not create.' }, { status: 500 });
  }
}
