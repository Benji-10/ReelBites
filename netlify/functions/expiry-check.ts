/**
 * Netlify Scheduled Function: Expiry Check
 *
 * Runs daily at 9:00 AM UTC (adjust as needed) to check all pantry items
 * for upcoming expiries and send push notifications.
 *
 * Alerts are sent at: 7 days, 3 days, 1 day, and day-of expiry.
 * The NotifiedItem table prevents duplicate notifications.
 *
 * Setup:
 *   - This function is automatically scheduled via netlify.toml
 *   - Requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars
 *   - Requires DATABASE_URL env var
 *
 * You can also trigger it manually:
 *   curl -X POST https://your-site.netlify.app/.netlify/functions/expiry-check
 */

import { schedule } from '@netlify/functions';
import { PrismaClient } from '@prisma/client';
import webpush from 'web-push';

const prisma = new PrismaClient();

// Configure web-push with VAPID keys.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hello@realbites.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
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
    if ((err as { statusCode?: number }).statusCode === 410) {
      try {
        await prisma.pushSubscription.delete({ where: { endpoint: subscription.endpoint } });
        console.log('[expiry-check] Deleted expired subscription:', subscription.endpoint.slice(0, 50));
      } catch {}
    }
    return false;
  }
}

async function runExpiryCheck() {
  const startTime = Date.now();
  console.log('[expiry-check] Starting scheduled expiry check...');

  const stats = {
    itemsChecked: 0,
    notificationsSent: 0,
    notificationsSkipped: 0,
    errors: 0,
  };

  try {
    // Fetch all pantry items with expiry dates.
    const items = await prisma.pantryItem.findMany({
      where: { expiryDate: { not: null } },
      select: { id: true, userId: true, name: true, expiryDate: true, quantity: true },
    });
    stats.itemsChecked = items.length;
    console.log(`[expiry-check] Found ${items.length} items with expiry dates.`);

    // Group by user.
    const itemsByUser = new Map<string, typeof items>();
    for (const item of items) {
      const arr = itemsByUser.get(item.userId) || [];
      arr.push(item);
      itemsByUser.set(item.userId, arr);
    }

    for (const [userId, userItems] of itemsByUser) {
      // Get this user's push subscriptions.
      const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId },
        select: { endpoint: true, p256dh: true, auth: true },
      });

      if (subscriptions.length === 0) continue;

      for (const item of userItems) {
        if (!item.expiryDate) continue;

        const daysLeft = daysUntil(item.expiryDate);
        const alertType = getAlertType(daysLeft);

        if (!alertType) continue;

        // Check if we already notified for this item + alert type.
        const alreadyNotified = await prisma.notifiedItem.findUnique({
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

        let sent = false;
        for (const sub of subscriptions) {
          const success = await sendPushNotification(sub, payload);
          if (success) sent = true;
        }

        if (sent) {
          try {
            await prisma.notifiedItem.create({
              data: {
                userId: item.userId,
                pantryItemId: item.id,
                alertType,
              },
            });
          } catch (err) {
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
  } finally {
    await prisma.$disconnect();
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[expiry-check] Complete in ${duration}s:`, stats);

  return { duration: `${duration}s`, stats };
}

// Schedule: runs daily at 9:00 AM UTC.
// Cron expression: "0 9 * * *"
// To change the time, update the cron expression below.
// Note: times are in UTC. 9:00 UTC = 10:00 BST (summer) / 9:00 GMT (winter).
const handler = schedule('0 9 * * *', async () => {
  const result = await runExpiryCheck();

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Expiry check complete',
      ...result,
    }),
  };
});

export { handler };
