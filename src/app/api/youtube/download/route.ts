import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createReadStream } from 'fs';
import { stat, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { YTDLP, commonArgs } from '@/lib/youtube';

export const runtime = 'nodejs';
export const maxDuration = 300; // honored by hosts that allow long requests (Railway/Render)

const execFileP = promisify(execFile);

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const id = sp.get('id') || '';
  const kind = sp.get('kind') || 'video';
  const q = sp.get('q') || '1080';
  const format = sp.get('format') || 'mp3';

  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid video id' }, { status: 400 });
  }
  const height = parseInt(q, 10);
  if (kind === 'video' && (!Number.isFinite(height) || height < 1 || height > 4320)) {
    return NextResponse.json({ error: 'Invalid quality' }, { status: 400 });
  }
  if (kind === 'audio' && format !== 'mp3' && format !== 'm4a') {
    return NextResponse.json({ error: 'Invalid audio format' }, { status: 400 });
  }

  const url = `https://www.youtube.com/watch?v=${id}`;
  const base = join(tmpdir(), `yt_${id}_${randomUUID()}`);

  let outPath: string;
  let contentType: string;
  let ext: string;
  const args = [...commonArgs(), '--no-progress'];

  if (kind === 'audio') {
    ext = format;
    outPath = `${base}.${ext}`;
    contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
    args.push(
      '-f', 'bestaudio/best',
      '-x', '--audio-format', format, '--audio-quality', '0',
      '-o', `${base}.%(ext)s`,
      url
    );
  } else {
    ext = 'mp4';
    outPath = `${base}.mp4`;
    contentType = 'video/mp4';
    // Best video up to the chosen height + best audio, merged to mp4.
    args.push(
      '-f', `bv*[height<=${height}]+ba/b[height<=${height}]/bv*+ba/b`,
      '--merge-output-format', 'mp4',
      '-o', `${base}.%(ext)s`,
      url
    );
  }

  // Run yt-dlp (downloads + merges via ffmpeg).
  try {
    await execFileP(YTDLP, args, { maxBuffer: 16 * 1024 * 1024, timeout: 280000 });
  } catch (e) {
    const msg = (e as { stderr?: string }).stderr || (e as Error).message || '';
    console.error('[youtube/download] yt-dlp failed:', msg.slice(0, 500));
    if (/sign in to confirm|not a bot/i.test(msg)) {
      return NextResponse.json({ error: 'YouTube bot check hit on server. Configure cookies/proxy.' }, { status: 502 });
    }
    return NextResponse.json({ error: 'Download failed. The video may be unavailable or region-locked.' }, { status: 500 });
  }

  // --merge-output-format / --audio-format fix the extension, so outPath is exact.
  const filePath = outPath;
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: 'Output file missing after processing.' }, { status: 500 });
  }

  const filename = `jannatube_${id}_${kind === 'audio' ? 'audio' : height + 'p'}.${ext}`;
  const nodeStream = createReadStream(filePath);
  nodeStream.on('close', () => {
    unlink(filePath).catch(() => {});
  });

  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
