'use client';

import { Heart } from 'lucide-react';

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-4">
        <p className="text-center text-xs sm:text-sm text-muted-foreground flex items-center justify-center gap-1.5">
          Built with
          <Heart className="h-3.5 w-3.5 text-primary fill-primary" />
          using Apify, Groq Whisper & Gemini Vision
        </p>
      </div>
    </footer>
  );
}
