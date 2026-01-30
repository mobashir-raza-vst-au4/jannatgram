import axios from 'axios';
import { InstagramContent, MediaItem, ContentType } from '@/types';

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const RAPIDAPI_HOST = 'instagram-public-bulk-scraper.p.rapidapi.com';

export function parseInstagramUrl(url: string): { type: ContentType; shortcode: string; cleanUrl: string } | null {
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
        cleanUrl: `https://www.instagram.com/stories/${storyMatch[1]}/${storyMatch[2]}/`
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Fetch story using the download_story_by_url endpoint
async function fetchStory(storyUrl: string): Promise<InstagramContent | null> {
  if (!RAPIDAPI_KEY) return null;

  try {
    const response = await axios.get(`https://${RAPIDAPI_HOST}/v1/download_story_by_url`, {
      params: { url: storyUrl },
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST,
      },
      timeout: 30000,
    });

    const result = response.data;
    if (!result || result.status !== 'ok' || !result.data) {
      return null;
    }

    const data = result.data;
    const media: MediaItem[] = [];
    const username = data.owner?.username || '';

    if (data.video_hd) {
      media.push({
        url: data.video_hd,
        type: 'video',
        thumbnail: data.image_hd,
      });
    } else if (data.image_hd) {
      media.push({
        url: data.image_hd,
        type: 'image',
      });
    }

    if (media.length > 0) {
      return { type: 'story', username, caption: '', media };
    }

    return null;
  } catch {
    return null;
  }
}

// Fetch post/reel using media_info endpoint
async function fetchWithBulkScraper(shortcode: string, type: ContentType): Promise<InstagramContent | null> {
  if (!RAPIDAPI_KEY) return null;

  try {
    const response = await axios.get(`https://${RAPIDAPI_HOST}/v1/media_info`, {
      params: { code_or_id_or_url: shortcode },
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST,
      },
      timeout: 30000,
    });

    const result = response.data;
    if (!result || result.status === 'error' || !result.data) {
      return null;
    }

    const data = result.data;
    const media: MediaItem[] = [];
    const username = data.owner?.username || '';
    const caption = data.edge_media_to_caption?.edges?.[0]?.node?.text || '';

    if (data.is_video && data.video_url) {
      media.push({
        url: data.video_url,
        type: 'video',
        thumbnail: data.display_url || data.thumbnail_src,
      });
    } else if (data.edge_sidecar_to_children?.edges) {
      for (const edge of data.edge_sidecar_to_children.edges) {
        const node = edge.node;
        if (node.is_video && node.video_url) {
          media.push({
            url: node.video_url,
            type: 'video',
            thumbnail: node.display_url,
          });
        } else if (node.display_url) {
          media.push({
            url: node.display_url,
            type: 'image',
          });
        }
      }
    } else if (data.display_url) {
      media.push({
        url: data.display_url,
        type: 'image',
      });
    }

    if (media.length > 0) {
      return { type, username, caption, media };
    }

    return null;
  } catch {
    return null;
  }
}

// Fallback: Direct scraping
async function fetchWithScraping(shortcode: string, type: ContentType): Promise<InstagramContent | null> {
  try {
    const postUrl = type === 'reel'
      ? `https://www.instagram.com/reel/${shortcode}/`
      : `https://www.instagram.com/p/${shortcode}/`;

    const response = await axios.get(postUrl, {
      headers: {
        'User-Agent': 'Instagram 219.0.0.12.117 Android',
        'Accept': '*/*',
      },
      timeout: 15000,
    });

    const html = response.data;
    const media: MediaItem[] = [];

    const videoMatch = html.match(/"video_url":"([^"]+)"/);
    if (videoMatch) {
      media.push({
        url: videoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, ''),
        type: 'video',
      });
    }

    if (media.length === 0 && type !== 'reel') {
      const imgMatch = html.match(/"display_url":"([^"]+)"/);
      if (imgMatch) {
        media.push({
          url: imgMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, ''),
          type: 'image',
        });
      }
    }

    const usernameMatch = html.match(/"username":"([^"]+)"/);
    if (media.length > 0) {
      return { type, username: usernameMatch?.[1] || '', caption: '', media };
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchInstagramContent(url: string): Promise<InstagramContent> {
  const parsed = parseInstagramUrl(url);

  if (!parsed) {
    throw new Error('Invalid Instagram URL. Please provide a valid post, reel, or story URL.');
  }

  const { type, shortcode, cleanUrl } = parsed;

  if (!RAPIDAPI_KEY) {
    throw new Error('API key required. Please configure the server.');
  }

  let content: InstagramContent | null = null;

  if (type === 'story') {
    content = await fetchStory(cleanUrl);
  } else {
    content = await fetchWithBulkScraper(shortcode, type);

    if (!content) {
      content = await fetchWithScraping(shortcode, type);
    }
  }

  if (content && type === 'reel' && content.media.every(m => m.type === 'image')) {
    throw new Error('Could not extract video. The reel may be private or restricted.');
  }

  if (!content || content.media.length === 0) {
    throw new Error('Unable to fetch content. The content may be private, expired, or unavailable.');
  }

  return content;
}
