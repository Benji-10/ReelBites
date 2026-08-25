/**
 * POST /api/transcribe
 *
 * Receives an audio file (base64-encoded) and transcribes it using Whisper
 * via the HuggingFace Inference API.
 *
 * DEBUG: This version includes detailed error reporting with debug logs.
 * Once the issue is resolved, we can simplify the error handling.
 *
 * Request:  { "audio": "<base64-encoded MP3>", "mimeType": "audio/mpeg" }
 * Response: { "transcript": "..." }
 * Error:    { "error": "...", "debug": [...], "hint": "..." }
 */

import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudioFromBuffer, getDebugLogs, clearDebugLogs } from '@/lib/whisper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  // Clear any previous debug logs.
  clearDebugLogs();

  let body: { audio?: string; mimeType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { audio, mimeType } = body;
  if (!audio || typeof audio !== 'string') {
    return NextResponse.json(
      { error: 'Missing "audio" field (base64-encoded audio data).' },
      { status: 400 },
    );
  }

  // Log the incoming request size.
  console.log('[transcribe] Received audio', {
    base64Length: audio.length,
    mimeType: mimeType || 'audio/mpeg',
    estimatedBytes: Math.round((audio.length * 3) / 4),
  });

  try {
    // Convert base64 to buffer.
    const audioBuffer = Buffer.from(audio, 'base64');
    console.log('[transcribe] Decoded audio buffer', {
      bufferBytes: audioBuffer.length,
      bufferKB: Math.round(audioBuffer.length / 1024),
    });

    const transcript = await transcribeAudioFromBuffer(audioBuffer, mimeType || 'audio/mpeg');

    console.log('[transcribe] Success', {
      transcriptLength: transcript.length,
      preview: transcript.slice(0, 100),
    });

    return NextResponse.json({ transcript });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    const debugLogs = getDebugLogs();

    console.error('[transcribe] Failed:', message);
    console.error('[transcribe] Debug logs:', JSON.stringify(debugLogs, null, 2));

    // Provide a helpful hint based on the error.
    let hint = '';
    if (message.includes('fetch failed')) {
      hint =
        'The "fetch failed" error usually means a network/DNS issue. ' +
        'Groq\'s API should be reachable from Netlify. If you still see ENOTFOUND, ' +
        'verify your GROQ_API_KEY is set at https://console.groq.com/keys';
    } else if (message.includes('401') || message.includes('403')) {
      hint =
        'Authentication failed. Your GROQ_API_KEY may be invalid or expired. ' +
        'Generate a new one at https://console.groq.com/keys';
    } else if (message.includes('429')) {
      hint =
        'Rate limited. Groq free tier allows 200 requests/hour. ' +
        'Wait a minute and try again.';
    }

    return NextResponse.json(
      {
        error: message,
        hint,
        debug: debugLogs,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/transcribe
 *
 * Returns debug info about the transcribe endpoint configuration.
 * Useful for diagnosing issues without making an actual API call.
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/transcribe',
    method: 'POST',
    expectedBody: {
      audio: 'base64-encoded audio string',
      mimeType: 'audio/mpeg (optional)',
    },
    config: {
      hasGroqKey: !!process.env.GROQ_API_KEY,
      groqApiKeyPrefix: process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.slice(0, 6) + '...' : null,
      whisperModel: process.env.WHISPER_MODEL || 'whisper-large-v3',
      maxDuration: 120,
    },
    hint:
      'Get a free Groq API key at https://console.groq.com/keys. ' +
      'Set it as GROQ_API_KEY in your Netlify environment variables.',
  });
}
