/**
 * GET /api/debug/ffmpeg
 *
 * Debug endpoint that checks whether ffmpeg is available in the Netlify
 * function environment. Useful for diagnosing "ffmpeg binary not found" errors.
 *
 * Returns:
 *   - Whether ffmpeg-static is installed and where
 *   - Whether the binary file exists on disk
 *   - The binary's file size and permissions
 *   - Whether system ffmpeg is available
 *   - The resolved ffmpeg path
 */

import { NextResponse } from 'next/server';
import { existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const debug: {
    ffmpegStatic: {
      loaded: boolean;
      path: string | null;
      exists: boolean;
      size?: number;
      mode?: string;
      isExecutable?: boolean;
      error?: string;
    };
    systemFfmpeg: {
      path: string | null;
      version: string | null;
    };
    resolvedPath: string | null;
    tmpDir: string;
    env: {
      NODE_ENV: string;
      AWS_LAMBDA_FUNCTION_NAME?: string;
      NETLIFY?: string;
    };
  } = {
    ffmpegStatic: {
      loaded: false,
      path: null,
      exists: false,
    },
    systemFfmpeg: {
      path: null,
      version: null,
    },
    resolvedPath: null,
    tmpDir: '',
    env: {
      NODE_ENV: process.env.NODE_ENV || 'unknown',
    },
  };

  // Check ffmpeg-static.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    debug.ffmpegStatic.loaded = true;
    debug.ffmpegStatic.path = ffmpegStatic;

    if (ffmpegStatic && typeof ffmpegStatic === 'string') {
      debug.ffmpegStatic.exists = existsSync(ffmpegStatic);
      if (debug.ffmpegStatic.exists) {
        const stats = statSync(ffmpegStatic);
        debug.ffmpegStatic.size = stats.size;
        debug.ffmpegStatic.mode = (stats.mode & 0o777).toString(8);
        debug.ffmpegStatic.isExecutable = (stats.mode & 0o111) !== 0;
        debug.resolvedPath = ffmpegStatic;
      }
    }
  } catch (err) {
    debug.ffmpegStatic.error = (err as Error).message;
  }

  // Check system ffmpeg.
  const systemPaths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/bin/ffmpeg'];
  for (const p of systemPaths) {
    if (existsSync(p)) {
      debug.systemFfmpeg.path = p;
      try {
        debug.systemFfmpeg.version = execSync(`${p} -version`, { encoding: 'utf8' })
          .split('\n')[0]
          .trim();
      } catch {
        debug.systemFfmpeg.version = '(could not get version)';
      }
      if (!debug.resolvedPath) {
        debug.resolvedPath = p;
      }
      break;
    }
  }

  // Check if ffmpeg is on PATH.
  if (!debug.systemFfmpeg.path) {
    try {
      const which = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
      if (which) {
        debug.systemFfmpeg.path = which;
        debug.systemFfmpeg.version = execSync('ffmpeg -version', { encoding: 'utf8' })
          .split('\n')[0]
          .trim();
        if (!debug.resolvedPath) {
          debug.resolvedPath = which;
        }
      }
    } catch {
      // ffmpeg not on PATH.
    }
  }

  // Temp directory.
  debug.tmpDir = tmpdir();

  // Environment.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    debug.env.AWS_LAMBDA_FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME;
  }
  if (process.env.NETLIFY) {
    debug.env.NETLIFY = process.env.NETLIFY;
  }

  return NextResponse.json(debug, { status: 200 });
}
