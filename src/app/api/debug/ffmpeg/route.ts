/**
 * GET /api/debug/ffmpeg
 *
 * Diagnoses ffmpeg issues on Netlify. The ffmpeg binary is NOT bundled with
 * the function (ffmpeg-static + @ffmpeg-installer would add ~143MB and exceed
 * Netlify's 250MB function size limit) — it is resolved at runtime from, in
 * order: FFMPEG_PATH/FFMPEG_BIN env var, the system PATH, or a static build
 * downloaded to /tmp on first use (cached for the instance's lifetime).
 *
 * Visiting this endpoint also triggers the resolution/download, so it is a
 * handy way to warm a cold function instance before a real extraction.
 */

import { NextResponse } from 'next/server';
import {
  getFfmpegDiagnostics,
  checkFfmpegWorks,
} from '@/lib/video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const diagnostics = await getFfmpegDiagnostics();
  const versionLine = await checkFfmpegWorks();

  return NextResponse.json({
    ok: !!versionLine,
    ffmpegWorks: !!versionLine,
    version: versionLine,
    resolvedPath: diagnostics.resolvedPath,
    resolvedSource: diagnostics.resolvedSource,
    sourcesTried: diagnostics.sourcesTried,
    environment: {
      platform: diagnostics.platform,
      arch: diagnostics.arch,
      tmpDir: diagnostics.tmpDir,
      tmpBinaryExists: diagnostics.tmpBinaryExists,
      lambdaRuntime: diagnostics.lambdaRuntime,
      isNetlify: !!process.env.NETLIFY,
      nodeVersion: process.version,
    },
    hint: versionLine
      ? 'ffmpeg is working correctly.'
      : 'No ffmpeg binary could be resolved. Options: (1) set FFMPEG_PATH to a binary, (2) install ffmpeg on the system PATH, or (3) make sure the function can reach registry.npmjs.org / github.com — the static build is downloaded to /tmp on first use and cached per instance.',
  });
}
