/**
 * GET /api/cron/expiry-check
 *
 * Scheduled endpoint that checks all pantry items for upcoming expiries
 * and sends push notifications at three intervals:
 *   - 7 days before expiry: "Expiring in a week"
 *   - 3 days before expiry: "Expiring in 3 days"
 *   - 1 day before expiry: "Expiring tomorrow"
 *   - Day of expiry: "Expires today"
 *
 * Uses the NotifiedItem table to prevent duplicate notifications — each
 * (userId, pantryItemId, alertType) combination is only sent once.
 *
 * Setup:
 *   - Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in your env
 *   - Generate keys: npx web-push generate-vapid-keys
 *   - Add a Netlify scheduled function or external cron to hit this endpoint daily
 *
 * Security: protected by a CRON_SECRET env var. Pass it as ?secret=<CRON_SECRET>.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import webpush from 'web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Configure web-push with VAPID keys.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hello@realbites.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

interface PantryItemWithExpiry {
  id: string;
  userId: string;
  name: string;
  expiryDate: Date | null;
  quantity: string | null;
}

function daysUntil(expiryDate: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  const diffMs = expiry.getTime() - now.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function getAlertType(daysLeft: number): string | null {
  if (daysLeft === 7) return 'week_before';
  if (daysLeft === 3) return 'three_days_before';
  if (daysLeft === 1) return 'day_before';
  if (daysLeft === 0) return 'day_of';
  return null;
}

function getAlertMessage(daysLeft: number, itemName: string): { title: string; body: string } {
  if (daysLeft === 7) {
    return {
      title: '📦 Expiring in a week',
      body: `"${itemName}" expires in 7 days. Time to plan a meal around it!`,
    };
  }
  if (daysLeft === 3) {
    return {
      title: '⏰ Expiring in 3 days',
      body: `"${itemName}" expires in 3 days. Use it soon!`,
    };
  }
  if (daysLeft === 1) {
    return {
      title: '⚠️ Expiring tomorrow',
      body: `"${itemName}" expires tomorrow. Don't let it go to waste!`,
    };
  }
  if (daysLeft === 0) {
    return {
      title: '🚨 Expires today!',
      body: `"${itemName}" expires today. Use it or lose it!`,
    };
  }
  return { title: 'RealBites', body: '' };
}

async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; tag?: string; data?: { url: string } },
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return true;
  } catch (err) {
    console.error('[expiry-check] Push failed:', (err as Error).message);
    // If the subscription is no longer valid (410 Gone), delete it.
    if ((err as { statusCode?: number }).statusCode === 410) {
      try {
        await db.pushSubscription.delete({ where: { endpoint: subscription.endpoint } });
        console.log('[expiry-check] Deleted expired subscription:', subscription.endpoint.slice(0, 50));
      } catch {}
    }
    return false;
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Security check — protect with a secret.
  const secret = request.nextUrl.searchParams.get('secret');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID keys not configured.' }, { status: 500 });
  }

  console.log('[expiry-check] Starting expiry check...');

  const stats = {
    itemsChecked: 0,
    notificationsSent: 0,
    notificationsSkipped: 0,
    errors: 0,
  };

  try {
    // Fetch all pantry items with expiry dates.
    const items = await db.pantryItem.findMany({
      where: { expiryDate: { not: null } },
      select: { id: true, userId: true, name: true, expiryDate: true, quantity: true },
    });
    stats.itemsChecked = items.length;

    console.log(`[expiry-check] Found ${items.length} items with expiry dates.`);

    // Group by user to batch subscription lookups.
    const itemsByUser = new Map<string, PantryItemWithExpiry[]>();
    for (const item of items) {
      const arr = itemsByUser.get(item.userId) || [];
      arr.push(item as PantryItemWithExpiry);
      itemsByUser.set(item.userId, arr);
    }

    for (const [userId, userItems] of itemsByUser) {
      // Get this user's push subscriptions.
      const subscriptions = await db.pushSubscription.findMany({
        where: { userId },
        select: { endpoint: true, p256dh: true, auth: true },
      });

      if (subscriptions.length === 0) {
        // No subscriptions — skip this user.
        continue;
      }

      for (const item of userItems) {
        if (!item.expiryDate) continue;

        const daysLeft = daysUntil(item.expiryDate);
        const alertType = getAlertType(daysLeft);

        if (!alertType) continue; // Not a notification day.

        // Check if we already notified for this item + alert type.
        const alreadyNotified = await db.notifiedItem.findUnique({
          where: {
            userId_pantryItemId_alertType: {
              userId: item.userId,
              pantryItemId: item.id,
              alertType,
            },
          },
        }).catch(() => null);

        if (alreadyNotified) {
          stats.notificationsSkipped++;
          continue;
        }

        const { title, body } = getAlertMessage(daysLeft, item.name);
        const payload = {
          title,
          body,
          tag: `expiry-${item.id}-${alertType}`,
          data: { url: '/pantry' },
        };

        console.log(`[expiry-check] Sending "${alertType}" for "${item.name}" (days left: ${daysLeft})`);

        // Send to all of this user's subscriptions.
        let sent = false;
        for (const sub of subscriptions) {
          const success = await sendPushNotification(sub, payload);
          if (success) sent = true;
        }

        if (sent) {
          // Record that we notified.
          try {
            await db.notifiedItem.create({
              data: {
                userId: item.userId,
                pantryItemId: item.id,
                alertType,
              },
            });
          } catch (err) {
            // Unique constraint violation = already notified, which is fine.
            if ((err as { code?: string }).code !== 'P2002') {
              console.error('[expiry-check] Failed to record notification:', err);
            }
          }
          stats.notificationsSent++;
        } else {
          stats.errors++;
        }
      }
    }
  } catch (err) {
    console.error('[expiry-check] Failed:', err);
    stats.errors++;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`[expiry-check] Complete in ${duration}s:`, stats);

  return NextResponse.json({
    message: 'Expiry check complete',
    duration: `${duration}s`,
    stats,
  });
}
