/**
 * GET /api/debug/ffmpeg
 *
 * Comprehensive debug endpoint for diagnosing ffmpeg issues on Netlify.
 * Returns:
 *   - All ffmpeg binary sources tried and their status
 *   - The resolved ffmpeg path
 *   - Environment info (Lambda runtime, tmp dir, etc.)
 *   - Whether ffmpeg can actually execute (runs `ffmpeg -version`)
 *
 * Visit this endpoint at https://your-site.netlify.app/api/debug/ffmpeg
 * to see exactly what's happening in the function environment.
 */

import { NextResponse } from 'next/server';
import { existsSync, statSync, accessSync, constants } from 'fs';
import { execSync } from 'child_process';
import { tmpdir, platform, arch } from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function tryExec(cmd: string): { success: boolean; output: string; error?: string } {
  try {
    const output = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    return { success: true, output: output.trim() };
  } catch (err) {
    return { success: false, output: '', error: (err as Error).message };
  }
}

export async function GET() {
  const results: {
    environment: {
      platform: string;
      arch: string;
      nodeVersion: string;
      tmpDir: string;
      cwd: string;
      path: string;
      isLambda: boolean;
      isNetlify: boolean;
    };
    systemPaths: Array<{ path: string; exists: boolean; isExecutable: boolean; size?: number }>;
    ffmpegStatic: {
      loaded: boolean;
      path: string | null;
      exists: boolean;
      isExecutable: boolean;
      error?: string;
    };
    ffmpegInstaller: {
      loaded: boolean;
      path: string | null;
      version: string | null;
      exists: boolean;
      isExecutable: boolean;
      error?: string;
    };
    whichFfmpeg: { success: boolean; path: string | null; error?: string };
    ffmpegVersion: { success: boolean; output: string | null; error?: string };
    resolvedPath: string | null;
    allTriedPaths: string[];
  } = {
    environment: {
      platform: platform(),
      arch: arch(),
      nodeVersion: process.version,
      tmpDir: tmpdir(),
      cwd: process.cwd(),
      path: process.env.PATH || '(not set)',
      isLambda: !!process.env.AWS_LAMBDA_FUNCTION_NAME,
      isNetlify: !!process.env.NETLIFY,
    },
    systemPaths: [],
    ffmpegStatic: {
      loaded: false,
      path: null,
      exists: false,
      isExecutable: false,
    },
    ffmpegInstaller: {
      loaded: false,
      path: null,
      version: null,
      exists: false,
      isExecutable: false,
    },
    whichFfmpeg: { success: false, path: null },
    ffmpegVersion: { success: false, output: null },
    resolvedPath: null,
    allTriedPaths: [],
  };

  // 1. Check system paths.
  const systemPaths = [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/bin/ffmpeg',
    '/var/task/bin/ffmpeg',
    '/var/task/node_modules/@ffmpeg-installer/linux-x64/ffmpeg',
  ];
  for (const p of systemPaths) {
    const entry = { path: p, exists: false, isExecutable: false, size: undefined as number | undefined };
    results.allTriedPaths.push(p);
    if (existsSync(p)) {
      entry.exists = true;
      try {
        const stats = statSync(p);
        entry.size = stats.size;
        entry.isExecutable = isExecutable(p);
        if (entry.isExecutable && !results.resolvedPath) {
          results.resolvedPath = p;
        }
      } catch {
        // stat failed.
      }
    }
    results.systemPaths.push(entry);
  }

  // 2. Check ffmpeg-static.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    results.ffmpegStatic.loaded = true;
    results.ffmpegStatic.path = ffmpegStatic;
    results.allTriedPaths.push(`ffmpeg-static → ${ffmpegStatic}`);
    if (ffmpegStatic && typeof ffmpegStatic === 'string') {
      results.ffmpegStatic.exists = existsSync(ffmpegStatic);
      if (results.ffmpegStatic.exists) {
        results.ffmpegStatic.isExecutable = isExecutable(ffmpegStatic);
        if (results.ffmpegStatic.isExecutable && !results.resolvedPath) {
          results.resolvedPath = ffmpegStatic;
        }
      }
    }
  } catch (err) {
    results.ffmpegStatic.error = (err as Error).message;
  }

  // 3. Check @ffmpeg-installer/ffmpeg.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    results.ffmpegInstaller.loaded = true;
    results.ffmpegInstaller.path = ffmpegInstaller?.path || null;
    results.ffmpegInstaller.version = ffmpegInstaller?.version || null;
    results.allTriedPaths.push(`@ffmpeg-installer → ${ffmpegInstaller?.path}`);
    if (ffmpegInstaller?.path && typeof ffmpegInstaller.path === 'string') {
      results.ffmpegInstaller.exists = existsSync(ffmpegInstaller.path);
      if (results.ffmpegInstaller.exists) {
        results.ffmpegInstaller.isExecutable = isExecutable(ffmpegInstaller.path);
        if (results.ffmpegInstaller.isExecutable && !results.resolvedPath) {
          results.resolvedPath = ffmpegInstaller.path;
        }
      }
    }
  } catch (err) {
    results.ffmpegInstaller.error = (err as Error).message;
  }

  // 4. Try `which ffmpeg`.
  const whichResult = tryExec('which ffmpeg 2>/dev/null');
  results.whichFfmpeg = {
    success: whichResult.success,
    path: whichResult.success ? whichResult.output : null,
    error: whichResult.error,
  };
  if (whichResult.success && whichResult.output && !results.resolvedPath) {
    results.resolvedPath = whichResult.output;
  }

  // 5. Try running ffmpeg -version.
  if (results.resolvedPath) {
    const versionResult = tryExec(`${results.resolvedPath} -version`);
    results.ffmpegVersion = {
      success: versionResult.success,
      output: versionResult.success ? versionResult.output.split('\n')[0] : null,
      error: versionResult.error,
    };
  }

  return NextResponse.json(results, { status: 200 });
}
