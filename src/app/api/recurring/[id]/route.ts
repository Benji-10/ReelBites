/**
 * DELETE /api/recurring/[id] — remove a recurring item
 * Also supports DELETE /api/recurring with body { id } for convenience.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest, ensureUserInDb } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = getUserFromRequest(request);
  await ensureUserInDb(user);

  // Support both /api/recurring/[id] and /api/recurring with body { id }.
  let id: string;
  const url = new URL(request.url);

  if (url.pathname.includes('/recurring/') && url.pathname.split('/').pop() !== 'recurring') {
    // Path-based ID.
    const { id: pathId } = await params;
    id = pathId;
  } else {
    // Body-based ID.
    try {
      const body = await request.json();
      id = body.id;
    } catch {
      return NextResponse.json({ error: 'Missing item ID.' }, { status: 400 });
    }
  }

  try {
    const existing = await db.recurringItem.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    await db.recurringItem.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete recurring item:', err);
    return NextResponse.json({ error: 'Could not delete.' }, { status: 500 });
  }
}
