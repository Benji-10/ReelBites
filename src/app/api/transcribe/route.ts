/**
 * POST /api/transcribe
 *
 * Receives an audio file (base64-encoded) and transcribes it using Whisper
 * via the HuggingFace Inference API. This keeps the API token server-side
 * while allowing the client to do the heavy ffmpeg processing.
 *
 * Request:  { "audio": "<base64-encoded MP3>", "mimeType": "audio/mpeg" }
 * Response: { "transcript": "..." }
 */

import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudioFromBuffer } from '@/lib/whisper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let body: { audio?: string; mimeType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { audio, mimeType } = body;
  if (!audio || typeof audio !== 'string') {
    return NextResponse.json({ error: 'Missing "audio" field (base64-encoded audio data).' }, { status: 400 });
  }

  try {
    // Convert base64 to buffer.
    const audioBuffer = Buffer.from(audio, 'base64');
    const transcript = await transcribeAudioFromBuffer(audioBuffer, mimeType || 'audio/mpeg');
    return NextResponse.json({ transcript });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
