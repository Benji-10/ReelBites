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
    // Check URL query parameter (?url=...) — used by Android Web Share Target
    // and iOS Shortcuts that open Safari (not the PWA).
    const urlParam = searchParams.get('url');
    if (urlParam) {
      const match = urlParam.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/);
      if (match && view.name === 'extract') {
        console.log('[home] Found Instagram URL in query param:', match[0]);
        startExtraction(match[0]);
        toast.success('Starting extraction from shared link!');
      }
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
