import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reel Recipes — Turn Instagram Reels into Structured Recipes",
  description:
    "Paste an Instagram reel URL and get a structured recipe with ingredients, instructions, and evidence-backed flags. Powered by Apify, Whisper, Tesseract OCR, and Gemini.",
  keywords: [
    "recipe extractor",
    "instagram reels",
    "recipe",
    "AI",
    "Whisper",
    "OCR",
    "Gemini",
  ],
  authors: [{ name: "Reel Recipes" }],
  openGraph: {
    title: "Reel Recipes",
    description: "Turn Instagram Reels into structured recipes with AI.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Netlify Identity redirect script — redirects to the home page
            after login so the SPA can pick up the new auth state. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (window.location.hash && window.location.hash.startsWith('#access_token')) {
                window.location.href = '/';
              }
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <SonnerToaster position="top-right" richColors />
      </body>
    </html>
  );
}
