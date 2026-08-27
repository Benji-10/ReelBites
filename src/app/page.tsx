'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { AppShell } from '@/components/recipe/app-shell';
import { toast } from 'sonner';

function HomeWithSearch() {
  const searchParams = useSearchParams();
  const { startExtraction } = useStore();

  useEffect(() => {
    const urlParam = searchParams.get('url');
    if (urlParam) {
      const match = urlParam.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/);
      if (match) {
        console.log('[home] Found Instagram URL in query param:', match[0]);
        startExtraction(match[0]);
        toast.success('Starting extraction from shared link!');
      }
    }
  }, [searchParams, startExtraction]);

  return <AppShell initialView="extract" />;
}

export default function Home() {
  return (
    <Suspense fallback={<AppShell initialView="extract" />}>
      <HomeWithSearch />
    </Suspense>
  );
}
