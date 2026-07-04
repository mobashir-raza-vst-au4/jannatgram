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
// Defensive parser — reads media from ANY of the common response shapes, so a
// provider changing field names often "just keeps working".
// ---------------------------------------------------------------------------
type AnyNode = Record<string, unknown>;

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

function firstImage(node: AnyNode): string | undefined {
  for (const k of ['display_url', 'thumbnail_url', 'image_hd', 'image', 'thumbnail_src'] as const) {
    if (typeof node[k] === 'string') return clean(node[k] as string);
  }
  const cand = ((node.image_versions2 as AnyNode | undefined)?.candidates as AnyNode[] | undefined)?.[0]?.url;
  if (typeof cand === 'string') return cand;
  return undefined;
}

function nodeToMedia(node: AnyNode): MediaItem | null {
  // 1) main_media_* (instagram-public-bulk-scraper)
  const mm = (typeof node.main_media_hd === 'string' && node.main_media_hd) ||
    (typeof node.main_media_sd === 'string' && node.main_media_sd);
  if (typeof mm === 'string') {
    const isVideo = node.main_media_type === 'video';
    return { url: directUrl(clean(mm)), type: isVideo ? 'video' : 'image', thumbnail: isVideo ? firstImage(node) : undefined };
  }
  // 2) video fields (various providers / GraphQL / private API)
  const video =
    (typeof node.video_url === 'string' && node.video_url) ||
    (typeof node.video_hd === 'string' && node.video_hd) ||
    (typeof node.video === 'string' && node.video) ||
    ((node.video_versions as AnyNode[] | undefined)?.[0]?.url as string | undefined);
  if (typeof video === 'string') {
    return { url: directUrl(clean(video)), type: 'video', thumbnail: firstImage(node) };
  }
  // 3) image fields
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
  const edge = (data.edge_media_to_caption as AnyNode | undefined)?.edges as AnyNode[] | undefined;
  const text = (edge?.[0]?.node as AnyNode | undefined)?.text;
  return typeof text === 'string' ? text : '';
}

// ---------------------------------------------------------------------------
// Providers — tried in order. To add/replace one (e.g. when an API dies),
// subscribe to it on RapidAPI and add an entry here. Each returns the media
// `data` object (or null); errors are caught and move on to the next provider.
// ---------------------------------------------------------------------------
interface Provider {
  name: string;
  enabled: boolean;
  host: string;
  fetch: (args: { shortcode: string; cleanUrl: string }) => Promise<AnyNode | null>;
}

async function rapidGet(host: string, path: string, params: Record<string, string>): Promise<AnyNode> {
  const res = await axios.get(`https://${host}${path}`, {
    params,
    headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': host },
    timeout: 30000,
  });
  return res.data as AnyNode;
}

const PROVIDERS: Provider[] = [
  {
    // Currently subscribed & working.
    name: 'instagram-public-bulk-scraper',
    enabled: true,
    host: 'instagram-public-bulk-scraper.p.rapidapi.com',
    fetch: async ({ cleanUrl, shortcode }) => {
      let r = await rapidGet('instagram-public-bulk-scraper.p.rapidapi.com', '/v1/download_media', {
        code_or_id_or_url: cleanUrl,
      });
      if (r?.status !== 'ok' || !r?.data) {
        r = await rapidGet('instagram-public-bulk-scraper.p.rapidapi.com', '/v1/download_media', {
          code_or_id_or_url: shortcode,
        });
      }
      return r?.status === 'ok' && r?.data ? (r.data as AnyNode) : null;
    },
  },
  {
    // Backup. Disabled until you subscribe to it on RapidAPI (then flip enabled).
    name: 'instagram-scraper-api2',
    enabled: false,
    host: 'instagram-scraper-api2.p.rapidapi.com',
    fetch: async ({ cleanUrl }) => {
      const r = await rapidGet('instagram-scraper-api2.p.rapidapi.com', '/v1/post_info', {
        code_or_id_or_url: cleanUrl,
      });
      return (r?.data as AnyNode) ?? null;
    },
  },
];

// Last-resort direct scrape (usually blocked on server IPs, kept as a safety net).
async function fetchWithScraping(shortcode: string, type: ContentType): Promise<AnyNode | null> {
  try {
    const postUrl =
      type === 'reel'
        ? `https://www.instagram.com/reel/${shortcode}/`
        : `https://www.instagram.com/p/${shortcode}/`;
    const response = await axios.get(postUrl, {
      headers: { 'User-Agent': 'Instagram 219.0.0.12.117 Android', Accept: '*/*' },
      timeout: 15000,
    });
    const html = response.data as string;
    const video = html.match(/"video_url":"([^"]+)"/)?.[1];
    const image = html.match(/"display_url":"([^"]+)"/)?.[1];
    const username = html.match(/"username":"([^"]+)"/)?.[1];
    if (video) return { video_url: clean(video), owner: { username } };
    if (image && type !== 'reel') return { display_url: clean(image), owner: { username } };
    return null;
  } catch {
    return null;
  }
}

async function fetchStory(storyUrl: string): Promise<AnyNode | null> {
  try {
    const r = await rapidGet('instagram-public-bulk-scraper.p.rapidapi.com', '/v1/download_story_by_url', {
      url: storyUrl,
    });
    return r?.status === 'ok' && r?.data ? (r.data as AnyNode) : null;
  } catch {
    return null;
  }
}

/** Debug helper: returns each provider's raw response so you can inspect a
 *  changed shape without redeploying (send { debug: true } to /api/download). */
export async function debugFetch(url: string): Promise<unknown> {
  const parsed = parseInstagramUrl(url);
  if (!parsed) return { error: 'invalid url' };
  const out: unknown[] = [];
  for (const p of PROVIDERS) {
    try {
      const data = await p.fetch(parsed);
      out.push({ provider: p.name, enabled: p.enabled, ok: !!data, dataKeys: data ? Object.keys(data) : null, sample: data });
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

  let data: AnyNode | null = null;

  if (type === 'story') {
    data = await fetchStory(cleanUrl);
  } else {
    // Try each enabled provider in order; fall back to direct scraping.
    for (const p of PROVIDERS) {
      if (!p.enabled) continue;
      try {
        const d = await p.fetch(parsed);
        if (d && extractMedia(d).length > 0) {
          data = d;
          break;
        }
        console.warn(`[instagram] provider "${p.name}" returned no usable media`);
      } catch (e) {
        const err = e as { response?: { status?: number; data?: { message?: string } } };
        console.error(`[instagram] provider "${p.name}" failed:`, err.response?.status, err.response?.data?.message || (e as Error).message);
      }
    }
    if (!data) data = await fetchWithScraping(shortcode, type);
  }

  const media = data ? extractMedia(data) : [];
  if (!data || media.length === 0) {
    throw new Error('Unable to fetch content. The post may be private/deleted, or the scraper API changed — try again, or send { "debug": true } to inspect the raw response.');
  }

  if (type === 'reel' && media.every((m) => m.type === 'image')) {
    throw new Error('Could not extract video. The reel may be private or restricted.');
  }

  return { type, username: extractUsername(data), caption: extractCaption(data), media };
}
