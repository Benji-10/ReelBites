import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: [
    'fluent-ffmpeg',
    'ffmpeg-static',
    '@ffmpeg-installer/ffmpeg',
  ],
};

export default nextConfig;
