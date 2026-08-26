'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';

function ShareHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { startExtraction, updateExtraction, resetExtraction } = useStore();

  useEffect(() => {
    // The share sheet sends the URL in one of these params.
    const url = searchParams.get('url') || searchParams.get('text') || searchParams.get('title') || '';

    // Try to extract an Instagram URL from the shared text.
    const instagramMatch = url.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/);

    if (instagramMatch) {
      const reelUrl = instagramMatch[0];
      console.log('[share] Received Instagram URL:', reelUrl);

      // Navigate to the extract page and auto-start extraction.
      router.push('/');

      // Wait a tick for the page to load, then start extraction.
      setTimeout(() => {
        startExtraction(reelUrl);
        toast.success('Starting extraction from shared link!');
      }, 500);
    } else {
      // No Instagram URL found — just go to the home page.
      console.log('[share] No Instagram URL found in shared text:', url);
      router.push('/');
      toast.info('No Instagram reel URL found in the shared content.');
    }
  }, [searchParams, router, startExtraction]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
        <p className="text-sm text-muted-foreground">Processing shared link...</p>
      </div>
    </div>
  );
}

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      }
    >
      <ShareHandler />
    </Suspense>
  );
}
