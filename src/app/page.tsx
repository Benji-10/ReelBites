'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { AppShell } from '@/components/recipe/app-shell';
import { toast } from 'sonner';

function HomeWithSearch() {
  const searchParams = useSearchParams();
  const { startExtraction, view } = useStore();

  useEffect(() => {
    let extractedUrl: string | null = null;

    // Method 1: Check URL query parameter (?url=...)
    const urlParam = searchParams.get('url');
    if (urlParam) {
      const match = urlParam.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/);
      if (match) {
        extractedUrl = match[0];
        console.log('[home] Found Instagram URL in query param:', extractedUrl);
      }
    }

    // Method 2: Check if the full URL contains an Instagram link
    // (e.g. when opened from Safari with the full URL pasted)
    if (!extractedUrl) {
      const fullUrl = window.location.href;
      const match = fullUrl.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/);
      if (match) {
        extractedUrl = match[0];
        console.log('[home] Found Instagram URL in full URL:', extractedUrl);
      }
    }

    // Method 3: Check clipboard for an Instagram URL (PWA fallback).
    // iOS Shortcuts can copy the URL to clipboard before opening the PWA.
    // The PWA reads the clipboard on launch and auto-starts extraction.
    if (!extractedUrl && navigator.clipboard) {
      navigator.clipboard.readText().then((clipText) => {
        if (clipText) {
          const match = clipText.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/);
          if (match) {
            extractedUrl = match[0];
            console.log('[home] Found Instagram URL in clipboard:', extractedUrl);
            if (view.name === 'extract') {
              startExtraction(extractedUrl);
              toast.success('Starting extraction from clipboard!');
              // Clear clipboard so it doesn't re-trigger on refresh.
              navigator.clipboard.writeText('');
            }
          }
        }
      }).catch((err) => {
        // Clipboard read can fail if the PWA doesn't have permission.
        // This is expected — the user needs to grant clipboard permission.
        console.log('[home] Clipboard read failed:', err.message);
      });
    }

    // If we found a URL via methods 1 or 2, start extraction.
    if (extractedUrl && view.name === 'extract') {
      startExtraction(extractedUrl);
      toast.success('Starting extraction from shared link!');
    }
  }, [searchParams, startExtraction, view.name]);

  return <AppShell />;
}

export default function Home() {
  return (
    <Suspense fallback={<AppShell />}>
      <HomeWithSearch />
    </Suspense>
  );
}
