import { NextRequest, NextResponse } from 'next/server';
import { fetchInstagramContent, parseInstagramUrl } from '@/lib/instagram';
import { DownloadResponse } from '@/types';

export async function POST(request: NextRequest): Promise<NextResponse<DownloadResponse>> {
  try {
    const body = await request.json();
    const { url } = body;

    // Debug: Check if API key is available
    const hasApiKey = !!process.env.RAPIDAPI_KEY;
    console.log('API Key available:', hasApiKey, 'Key length:', process.env.RAPIDAPI_KEY?.length || 0);

    if (!url) {
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate URL format
    const parsed = parseInstagramUrl(url);
    if (!parsed) {
      return NextResponse.json(
        { success: false, error: 'Invalid Instagram URL. Please provide a valid post, reel, or story URL.' },
        { status: 400 }
      );
    }

    const content = await fetchInstagramContent(url);

    return NextResponse.json({
      success: true,
      data: content,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
