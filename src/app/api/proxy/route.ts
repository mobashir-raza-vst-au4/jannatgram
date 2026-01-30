import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get('url');
    const download = searchParams.get('download') === 'true';

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate that the URL is from Instagram CDN or proxy
    const allowedDomains = [
      'cdninstagram.com',
      'scontent.cdninstagram.com',
      'scontent',
      'fbcdn.net',
      'instagram.com',
      'elfsightcdn.com', // Story proxy domain
    ];

    const urlObj = new URL(url);
    const isAllowed = allowedDomains.some(domain => urlObj.hostname.includes(domain));

    if (!isAllowed) {
      return NextResponse.json({ error: 'Invalid URL domain' }, { status: 400 });
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'image/*, video/*, */*',
      },
      timeout: 30000,
      maxRedirects: 5,
    });

    const contentType = response.headers['content-type'] || 'application/octet-stream';

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    };

    // Only add download disposition if explicitly requested
    if (download) {
      headers['Content-Disposition'] = 'attachment';
    }

    return new NextResponse(response.data, { headers });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 });
  }
}
