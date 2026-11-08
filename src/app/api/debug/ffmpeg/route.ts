/**
 * GET /api/debug/ffmpeg
 *
 * Diagnoses ffmpeg issues on Netlify. Returns which ffmpeg binary sources
 * were tried (ffmpeg-static, @ffmpeg-installer/ffmpeg, system PATH), the
 * resolved path, environment info, and whether `ffmpeg -version` runs.
 */

import { NextResponse } from 'next/server';
import {
  getFfmpegDiagnostics,
  checkFfmpegWorks,
} from '@/lib/video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const diagnostics = getFfmpegDiagnostics();
  const versionLine = await checkFfmpegWorks();

  return NextResponse.json({
    ok: !!versionLine,
    ffmpegWorks: !!versionLine,
    version: versionLine,
    sourcesTried: diagnostics.sourcesTried,
    resolvedPath: diagnostics.resolvedPath,
    environment: {
      platform: diagnostics.platform,
      arch: diagnostics.arch,
      tmpDir: diagnostics.tmpDir,
      lambdaRuntime: diagnostics.lambdaRuntime,
      isNetlify: !!process.env.NETLIFY,
      nodeVersion: process.version,
    },
    hint: versionLine
      ? 'ffmpeg is working correctly.'
      : 'ffmpeg binary not found or not executable. Check that ffmpeg-static is in dependencies and serverExternalPackages includes it in next.config.ts.',
  });
}
