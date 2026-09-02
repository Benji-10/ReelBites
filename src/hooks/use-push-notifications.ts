'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for managing Web Push notification subscriptions.
 *
 * Handles:
 *   - Registering the service worker
 *   - Subscribing to push notifications
 *   - Storing the subscription in the DB
 *   - Checking if notifications are enabled
 */

const SW_PATH = '/sw.js';
// VAPID public key is fetched from the API at runtime.

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications(authToken: string | null) {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  // Check if push is supported and fetch the VAPID key.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }
    setIsSupported(true);
    setPermission(Notification.permission);

    // Fetch the VAPID public key.
    fetch('/api/push/subscribe', {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.publicKey) setVapidKey(data.publicKey);
        if (data.subscriptions?.length > 0) setIsSubscribed(true);
      })
      .catch(() => {});
  }, [authToken]);

  // Register the service worker.
  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.register(SW_PATH).catch((err) => {
      console.error('[push] SW registration failed:', err);
    });
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !vapidKey) return false;
    setLoading(true);

    try {
      const permission = await Notification.requestPermission();
      setPermission(permission);
      if (permission !== 'granted') {
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }

      // Send the subscription to the server.
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: subscription.toJSON().keys,
          expirationTime: subscription.expirationTime,
          // Capture the user's timezone so alerts come at 9am local time.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }),
      });

      if (!res.ok) throw new Error('Failed to save subscription.');
      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error('[push] Subscribe failed:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [isSupported, vapidKey, authToken]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return false;
    setLoading(true);

    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
          method: 'DELETE',
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
      }
      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.error('[push] Unsubscribe failed:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [isSupported, authToken]);

  const sendTest = useCallback(async () => {
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await res.json();
      return data;
    } catch (err) {
      console.error('[push] Test failed:', err);
      return { error: 'Test failed' };
    }
  }, [authToken]);

  return {
    isSupported,
    permission,
    isSubscribed,
    loading,
    subscribe,
    unsubscribe,
    sendTest,
  };
}
