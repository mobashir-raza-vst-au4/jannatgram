import axios from 'axios';
import { InstagramContent, MediaItem, ContentType } from '@/types';

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';

export function parseInstagramUrl(
  url: string
): { type: ContentType; shortcode: string; cleanUrl: string } | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    const postMatch = pathname.match(/^\/p\/([A-Za-z0-9_-]+)/);
    if (postMatch) {
      return { type: 'post', shortcode: postMatch[1], cleanUrl: `https://www.instagram.com/p/${postMatch[1]}/` };
    }

    const reelMatch = pathname.match(/^\/reels?\/([A-Za-z0-9_-]+)/);
    if (reelMatch) {
      return { type: 'reel', shortcode: reelMatch[1], cleanUrl: `https://www.instagram.com/reel/${reelMatch[1]}/` };
    }

    const storyMatch = pathname.match(/^\/stories\/([A-Za-z0-9._]+)\/(\d+)/);
    if (storyMatch) {
      return {
        type: 'story',
        shortcode: storyMatch[2],
        cleanUrl: `https://www.instagram.com/stories/${storyMatch[1]}/${storyMatch[2]}/`,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers + a defensive parser for "media object" shaped responses.
// ---------------------------------------------------------------------------
type AnyNode = Record<string, unknown>;
type Parsed = { type: ContentType; shortcode: string; cleanUrl: string };

const clean = (u: string) => u.replace(/\\u0026/g, '&').replace(/\\/g, '');

/** Some providers wrap media behind a proxy (…?url=<encoded cdn url>). Unwrap it. */
function directUrl(u: string): string {
  try {
    const inner = new URL(u).searchParams.get('url');
    return inner || u;
  } catch {
    return u;
  }
}

const isVideoUrl = (u: string, ext?: string) =>
  /\.(mp4|mov)(\?|$)/i.test(u) || /(mp4|mov|video)/i.test(ext || '');

function firstImage(node: AnyNode): string | undefined {
  for (const k of ['display_url', 'thumbnail_url', 'image_hd', 'image', 'thumbnail_src'] as const) {
    if (typeof node[k] === 'string') return clean(node[k] as string);
  }
  const cand = ((node.image_versions2 as AnyNode | undefined)?.candidates as AnyNode[] | undefined)?.[0]?.url;
  if (typeof cand === 'string') return cand;
  return undefined;
}

function nodeToMedia(node: AnyNode): MediaItem | null {
  const mm = (typeof node.main_media_hd === 'string' && node.main_media_hd) ||
    (typeof node.main_media_sd === 'string' && node.main_media_sd);
  if (typeof mm === 'string') {
    const isVideo = node.main_media_type === 'video';
    return { url: directUrl(clean(mm)), type: isVideo ? 'video' : 'image', thumbnail: isVideo ? firstImage(node) : undefined };
  }
  const video =
    (typeof node.video_url === 'string' && node.video_url) ||
    (typeof node.video_hd === 'string' && node.video_hd) ||
    (typeof node.video === 'string' && node.video) ||
    ((node.video_versions as AnyNode[] | undefined)?.[0]?.url as string | undefined);
  if (typeof video === 'string') return { url: directUrl(clean(video)), type: 'video', thumbnail: firstImage(node) };
  const img = firstImage(node);
  if (img) return { url: directUrl(img), type: 'image' };
  return null;
}

function extractMedia(data: AnyNode): MediaItem[] {
  const media: MediaItem[] = [];
  const carousel =
    (data.carousel_media as AnyNode[] | undefined) ??
    (data.medias as AnyNode[] | undefined) ??
    (data.items as AnyNode[] | undefined) ??
    ((data.edge_sidecar_to_children as AnyNode | undefined)?.edges as AnyNode[] | undefined)?.map(
      (e) => e.node as AnyNode
    );
  if (Array.isArray(carousel) && carousel.length) {
    for (const child of carousel) {
      const m = nodeToMedia(child);
      if (m) media.push(m);
    }
    if (media.length) return media;
  }
  const single = nodeToMedia(data);
  if (single) media.push(single);
  return media;
}

function extractUsername(data: AnyNode): string {
  const user = (data.user ?? data.owner) as AnyNode | undefined;
  return (user?.username as string) || (data.username as string) || '';
}

function extractCaption(data: AnyNode): string {
  const cap = data.caption as AnyNode | string | undefined;
  if (typeof cap === 'string') return cap;
  if (cap && typeof (cap as AnyNode).text === 'string') return (cap as AnyNode).text as string;
  return '';
}

async function rapidGet(host: string, path: string, params: Record<string, string>): Promise<AnyNode> {
  const res = await axios.get(`https://${host}${path}`, {
    params,
    headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': host },
    timeout: 30000,
  });
  return res.data as AnyNode;
}

async function rapidPost(host: string, path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await axios.post(`https://${host}${path}`, body, {
    headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': host, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Providers — tried in order until one returns media. Each parses its own
// response shape and returns a full InstagramContent (or null). To add a new
// one when an API dies: subscribe on RapidAPI and add an entry here.
// ---------------------------------------------------------------------------
interface Provider {
  name: string;
  enabled: boolean;
  fetch: (p: Parsed) => Promise<InstagramContent | null>;
}

const PROVIDERS: Provider[] = [
  {
    name: 'instagram-public-bulk-scraper',
    enabled: true,
    fetch: async ({ type, cleanUrl, shortcode }) => {
      const host = 'instagram-public-bulk-scraper.p.rapidapi.com';
      let r = await rapidGet(host, '/v1/download_media', { code_or_id_or_url: cleanUrl });
      if (r?.status !== 'ok' || !r?.data) r = await rapidGet(host, '/v1/download_media', { code_or_id_or_url: shortcode });
      const data = r?.status === 'ok' && r?.data ? (r.data as AnyNode) : null;
      if (!data) return null;
      const media = extractMedia(data);
      if (!media.length) return null;
      return { type, username: extractUsername(data), caption: extractCaption(data), media };
    },
  },
  {
    name: 'instagram120',
    enabled: true,
    fetch: async ({ type, cleanUrl }) => {
      const host = 'instagram120.p.rapidapi.com';
      const arr = (await rapidPost(host, '/api/instagram/links', { url: cleanUrl })) as AnyNode[];
      if (!Array.isArray(arr) || arr.length === 0) return null;
      const media: MediaItem[] = [];
      let caption = '';
      for (const item of arr) {
        const urls = item?.urls as AnyNode[] | undefined;
        const first = urls?.[0];
        const u = first?.url as string | undefined;
        if (!u) continue;
        media.push({
          url: u,
          type: isVideoUrl(u, first?.extension as string | undefined) ? 'video' : 'image',
          thumbnail: (item.pictureUrl as string) || undefined,
        });
        const title = (item.meta as AnyNode | undefined)?.title;
        if (!caption && typeof title === 'string') caption = title;
      }
      if (!media.length) return null;
      return { type, username: '', caption, media };
    },
  },
];

/** Story path (bulk-scraper). Stories generally require login and often fail. */
async function fetchStory(storyUrl: string, type: ContentType): Promise<InstagramContent | null> {
  try {
    const r = await rapidGet('instagram-public-bulk-scraper.p.rapidapi.com', '/v1/download_story_by_url', { url: storyUrl });
    const data = r?.status === 'ok' && r?.data ? (r.data as AnyNode) : null;
    if (!data) return null;
    const media = extractMedia(data);
    if (!media.length) return null;
    return { type, username: extractUsername(data), caption: '', media };
  } catch {
    return null;
  }
}

/** Last-resort direct scrape (usually blocked on server IPs). */
async function fetchWithScraping(shortcode: string, type: ContentType): Promise<InstagramContent | null> {
  try {
    const postUrl =
      type === 'reel' ? `https://www.instagram.com/reel/${shortcode}/` : `https://www.instagram.com/p/${shortcode}/`;
    const response = await axios.get(postUrl, {
      headers: { 'User-Agent': 'Instagram 219.0.0.12.117 Android', Accept: '*/*' },
      timeout: 15000,
    });
    const html = response.data as string;
    const video = html.match(/"video_url":"([^"]+)"/)?.[1];
    const image = html.match(/"display_url":"([^"]+)"/)?.[1];
    const username = html.match(/"username":"([^"]+)"/)?.[1] || '';
    const media: MediaItem[] = [];
    if (video) media.push({ url: clean(video), type: 'video' });
    else if (image && type !== 'reel') media.push({ url: clean(image), type: 'image' });
    if (!media.length) return null;
    return { type, username, caption: '', media };
  } catch {
    return null;
  }
}

/** Debug helper — returns each provider's outcome so you can diagnose a
 *  changed API without redeploying (send { debug: true } to /api/download). */
export async function debugFetch(url: string): Promise<unknown> {
  const parsed = parseInstagramUrl(url);
  if (!parsed) return { error: 'invalid url' };
  const out: unknown[] = [];
  for (const p of PROVIDERS) {
    try {
      const c = await p.fetch(parsed);
      out.push({ provider: p.name, enabled: p.enabled, ok: !!c?.media.length, media: c?.media.length ?? 0 });
    } catch (e) {
      const err = e as { response?: { status?: number; data?: unknown } };
      out.push({ provider: p.name, enabled: p.enabled, error: true, status: err.response?.status, body: err.response?.data });
    }
  }
  return out;
}

export async function fetchInstagramContent(url: string): Promise<InstagramContent> {
  const parsed = parseInstagramUrl(url);
  if (!parsed) throw new Error('Invalid Instagram URL. Please provide a valid post, reel, or story URL.');
  if (!RAPIDAPI_KEY) throw new Error('API key required. Please configure RAPIDAPI_KEY on the server.');

  const { type, shortcode, cleanUrl } = parsed;

  let content: InstagramContent | null = null;

  if (type === 'story') {
    content = await fetchStory(cleanUrl, type);
  } else {
    for (const p of PROVIDERS) {
      if (!p.enabled) continue;
      try {
        const c = await p.fetch(parsed);
        if (c && c.media.length > 0) {
          content = c;
          break;
        }
        console.warn(`[instagram] provider "${p.name}" returned no usable media`);
      } catch (e) {
        const err = e as { response?: { status?: number; data?: { message?: string } } };
        console.error(`[instagram] provider "${p.name}" failed:`, err.response?.status, err.response?.data?.message || (e as Error).message);
      }
    }
    if (!content) content = await fetchWithScraping(shortcode, type);
  }

  if (!content || content.media.length === 0) {
    throw new Error('Unable to fetch content. The post may be private/deleted, or the scraper APIs changed — send { "debug": true } to inspect.');
  }
  if (type === 'reel' && content.media.every((m) => m.type === 'image')) {
    throw new Error('Could not extract video. The reel may be private or restricted.');
  }
  return content;
}
