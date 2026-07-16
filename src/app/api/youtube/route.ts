import { NextRequest, NextResponse } from 'next/server';
import { fetchYouTubeContent, parseYouTubeUrl, debugFetchYouTube } from '@/lib/youtube';
import { YouTubeResponse } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest): Promise<NextResponse<YouTubeResponse>> {
  try {
    const body = await request.json();
    const { url, debug } = body;

    if (!url) {
      return NextResponse.json({ success: false, error: 'URL is required' }, { status: 400 });
    }

    if (debug) {
      return NextResponse.json({ success: true, debug: await debugFetchYouTube(url) });
    }

    const parsed = parseYouTubeUrl(url);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'Invalid YouTube URL. Paste a video, Shorts, or youtu.be link.' },
        { status: 400 }
      );
    }

    const data = await fetchYouTubeContent(url);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
