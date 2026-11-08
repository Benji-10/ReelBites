import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: [
    // Pure-JS ffmpeg wrapper — safe to trace into the serverless bundle.
    'fluent-ffmpeg',
    // NOTE: do NOT add 'ffmpeg-static' or '@ffmpeg-installer/ffmpeg' here
    // (or to package.json dependencies). Their static binaries (~77MB +
    // ~66MB) get traced into the Netlify function and exceed the 250MB
    // deploy limit. The binary is resolved at runtime instead — see
    // src/lib/video.ts.
  ],
};

export default nextConfig;
