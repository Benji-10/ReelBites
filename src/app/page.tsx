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
    // Check for a URL in the query string (from iOS Shortcut or manual link).
    const urlParam = searchParams.get('url');
    if (urlParam) {
      // Try to extract an Instagram URL.
      const instagramMatch = urlParam.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/);
      if (instagramMatch && view.name === 'extract') {
        const reelUrl = instagramMatch[0];
        console.log('[home] Auto-starting extraction from URL param:', reelUrl);
        startExtraction(reelUrl);
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
