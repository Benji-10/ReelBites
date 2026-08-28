import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RealBites — Turn Instagram Reels into Recipes",
  description:
    "Paste an Instagram reel URL and get a structured recipe with ingredients, instructions, and evidence-backed flags.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
    ],
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RealBites",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        {/* Theme init script */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* Remove Netlify badge */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Remove Netlify badge from DOM
              function removeNetlifyBadge() {
                document.querySelectorAll('.nl-wrap, .nl-badge, .nl-card, [id*="nl-"], [class*="nl-wrap"], [class*="nl-badge"]').forEach(function(el) {
                  el.remove();
                });
              }
              // Run immediately and after a delay (badge is injected async).
              removeNetlifyBadge();
              setTimeout(removeNetlifyBadge, 1000);
              setTimeout(removeNetlifyBadge, 3000);
              // Also use MutationObserver to catch it when it appears.
              var observer = new MutationObserver(function() {
                var badge = document.querySelector('.nl-wrap, .nl-badge');
                if (badge) { removeNetlifyBadge(); }
              });
              observer.observe(document.body, { childList: true, subtree: true });
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (window.location.hash && window.location.hash.startsWith('#access_token')) {
                window.location.href = '/';
              }
            `,
          }}
        />
        {/* Self-healing: detect stale PWA cache and force reload */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // If the page is blank after 5 seconds (stale JS chunks),
                // clear all caches and force reload once.
                setTimeout(function() {
                  var main = document.querySelector('main');
                  if (main && main.children.length === 0 && !sessionStorage.getItem('_rb_reloaded')) {
                    sessionStorage.setItem('_rb_reloaded', '1');
                    console.warn('[RealBites] Page appears blank — force reloading to clear stale cache.');
                    if ('caches' in window) {
                      caches.keys().then(function(names) {
                        Promise.all(names.map(function(name) { return caches.delete(name); })).then(function() {
                          window.location.reload();
                        });
                      });
                    } else {
                      window.location.reload();
                    }
                  } else {
                    sessionStorage.removeItem('_rb_reloaded');
                  }
                }, 5000);

                // Listen for JS chunk load failures (stale cache after deploy).
                window.addEventListener('error', function(e) {
                  if (e.target && e.target.tagName === 'SCRIPT' && !sessionStorage.getItem('_rb_reloaded')) {
                    sessionStorage.setItem('_rb_reloaded', '1');
                    console.warn('[RealBites] Script load failed — clearing cache and reloading.');
                    if ('caches' in window) {
                      caches.keys().then(function(names) {
                        Promise.all(names.map(function(name) { return caches.delete(name); })).then(function() {
                          window.location.reload();
                        });
                      });
                    } else {
                      window.location.reload();
                    }
                  }
                }, true);
              })();
            `,
          }}
        />
        <ThemeProvider>
          {children}
          <Toaster />
          <SonnerToaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
