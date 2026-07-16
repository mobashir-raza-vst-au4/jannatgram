import { NextRequest, NextResponse } from 'next/server';

// Allow long-running streams for large video files.
export const maxDuration = 60;

// Hosts we are willing to proxy media from.
const ALLOWED_DOMAINS = [
  // Instagram / Facebook CDN
  'cdninstagram.com',
  'scontent.cdninstagram.com',
  'scontent',
  'fbcdn.net',
  'instagram.com',
  'elfsightcdn.com',
  // YouTube CDN + thumbnails
  'googlevideo.com',
  'youtube.com',
  'ytimg.com',
  'ggpht.com',
];

function refererFor(hostname: string): string {
  if (/googlevideo|ytimg|youtube|ggpht/.test(hostname)) return 'https://www.youtube.com/';
  return 'https://www.instagram.com/';
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get('url');
    const download = searchParams.get('download') === 'true';

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Malformed URL' }, { status: 400 });
    }

    const isAllowed = ALLOWED_DOMAINS.some((domain) => urlObj.hostname.includes(domain));
    if (!isAllowed) {
      return NextResponse.json({ error: 'Invalid URL domain' }, { status: 400 });
    }

    // Forward Range so large videos can stream / resume.
    const range = request.headers.get('range');
    const upstream = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: refererFor(urlObj.hostname),
        Accept: 'image/*, video/*, audio/*, */*',
        ...(range ? { Range: range } : {}),
      },
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: 'Failed to fetch media' }, { status: upstream.status || 502 });
    }

    const headers = new Headers();
    const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Access-Control-Allow-Origin', '*');
    if (download) headers.set('Content-Disposition', 'attachment');

    // Stream the upstream body straight through — no buffering in memory.
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 });
  }
}
