/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Download a static ffmpeg binary for Linux x64 into ./bin/ffmpeg
 *
 * This runs during the Netlify build (via the build command) to ensure
 * a working ffmpeg binary is available in the function bundle without
 * relying on ffmpeg-static's path resolution (which breaks on Netlify).
 *
 * The binary is downloaded from the johnvansickle.com static builds,
 * which are statically linked and work on any Linux x64 system
 * (including AWS Lambda / Netlify Functions).
 */

const { createWriteStream, existsSync, mkdirSync, chmodSync, statSync, unlinkSync } = require('fs');
const { join } = require('path');
const { execSync } = require('child_process');

const BIN_DIR = join(process.cwd(), 'bin');
const FFMPEG_PATH = join(BIN_DIR, 'ffmpeg');

// Static ffmpeg build from johnvansickle.com (trusted, statically linked, ~70MB).
const FFMPEG_URL =
  'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';

async function downloadFfmpeg() {
  // If the binary already exists and is executable, skip download.
  if (existsSync(FFMPEG_PATH)) {
    try {
      const stats = statSync(FFMPEG_PATH);
      if (stats.size > 1000000) {
        // > 1MB, assume it's valid.
        chmodSync(FFMPEG_PATH, 0o755);
        console.log('[setup:ffmpeg] Binary already exists at:', FFMPEG_PATH);
        return;
      }
    } catch {
      // File exists but may be corrupted — re-download.
    }
  }

  console.log('[setup:ffmpeg] Creating bin directory...');
  mkdirSync(BIN_DIR, { recursive: true });

  console.log('[setup:ffmpeg] Downloading static ffmpeg from johnvansickle.com...');
  console.log('[setup:ffmpeg] URL:', FFMPEG_URL);

  // Download to a temp tar.xz file.
  const tarPath = join(BIN_DIR, 'ffmpeg-static.tar.xz');

  try {
    const response = await fetch(FFMPEG_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
    let downloadedSize = 0;
    let lastLog = 0;

    const fileStream = createWriteStream(tarPath);
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
      downloadedSize += value.length;
      if (totalSize > 0 && downloadedSize - lastLog > 5 * 1024 * 1024) {
        const percent = Math.floor((downloadedSize / totalSize) * 100);
        console.log(
          `[setup:ffmpeg] Downloading... ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(1)} MB)`,
        );
        lastLog = downloadedSize;
      }
    }

    fileStream.end();
    await new Promise((resolve) => fileStream.on('finish', resolve));

    console.log('[setup:ffmpeg] Download complete. Extracting...');

    // Extract the tar.xz file. Use system tar with xz support.
    // The archive contains a folder like ffmpeg-7.0.2-amd64-static/ffmpeg
    // We use --strip-components=1 to extract just the ffmpeg binary.
    try {
      execSync(
        `tar -xf "${tarPath}" -C "${BIN_DIR}" --strip-components=1 --wildcards "*/ffmpeg"`,
        { stdio: 'inherit' },
      );
    } catch (extractErr) {
      // Fallback: try extracting everything and then find ffmpeg.
      console.log('[setup:ffmpeg] Wildcard extraction failed, trying full extract...');
      execSync(`tar -xf "${tarPath}" -C "${BIN_DIR}"`, { stdio: 'inherit' });

      // Find the ffmpeg binary in the extracted folder.
      const findResult = execSync(`find "${BIN_DIR}" -name "ffmpeg" -type f | head -1`, {
        encoding: 'utf8',
      }).trim();
      if (findResult) {
        // Move it to the expected location.
        execSync(`mv "${findResult}" "${FFMPEG_PATH}"`, { stdio: 'inherit' });
        // Clean up the extracted folder.
        execSync(`rm -rf "${BIN_DIR}/ffmpeg-"*`, { stdio: 'inherit' });
      }
    }

    // Verify the binary exists.
    if (!existsSync(FFMPEG_PATH)) {
      throw new Error('ffmpeg binary not found after extraction');
    }

    // Make it executable.
    chmodSync(FFMPEG_PATH, 0o755);

    // Clean up the tar file.
    try {
      unlinkSync(tarPath);
    } catch {
      // Best-effort cleanup.
    }

    const stats = statSync(FFMPEG_PATH);
    console.log(
      `[setup:ffmpeg] ffmpeg binary ready at: ${FFMPEG_PATH} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`,
    );

    // Verify it runs.
    try {
      const version = execSync(`"${FFMPEG_PATH}" -version`, { encoding: 'utf8' });
      console.log('[setup:ffmpeg] Version:', version.split('\n')[0]);
    } catch {
      console.warn('[setup:ffmpeg] Warning: could not run ffmpeg -version (may not work on this platform)');
    }
  } catch (err) {
    console.error('[setup:ffmpeg] Failed to download ffmpeg:', err.message);
    console.error('[setup:ffmpeg] The app will fall back to system ffmpeg if available.');
    console.error('[setup:ffmpeg] You can manually download ffmpeg and place it at:', FFMPEG_PATH);

    // Clean up partial files.
    try {
      unlinkSync(tarPath);
    } catch {
      // Ignore.
    }

    // Don't fail the build — the app has fallbacks.
    process.exit(0);
  }
}

downloadFfmpeg().catch((err) => {
  console.error('[setup:ffmpeg] Unexpected error:', err);
  process.exit(0);
});
