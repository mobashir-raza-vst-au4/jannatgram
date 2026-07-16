import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { YouTubeContent, YouTubeFormat } from '@/types';

const execFileP = promisify(execFile);

/** Path to the yt-dlp binary (overridable for containers). */
export const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

/**
 * Resolves the cookies file to hand yt-dlp. Cookies are how a cloud-hosted
 * server gets past YouTube's "confirm you're not a bot" check.
 *  - YTDLP_COOKIES_FILE: an absolute path already on disk, OR
 *  - YTDLP_COOKIES_B64: base64 of a cookies.txt (decoded to /tmp once) — the
 *    easy way to inject cookies via a Railway/host variable, no secrets in git.
 */
let cookiesPath: string | null = null;
function resolveCookies(): string | undefined {
  if (process.env.YTDLP_COOKIES_FILE) return process.env.YTDLP_COOKIES_FILE;
  const b64 = process.env.YTDLP_COOKIES_B64;
  if (!b64) return undefined;
  if (cookiesPath && existsSync(cookiesPath)) return cookiesPath;
  try {
    const p = join(tmpdir(), 'yt-cookies.txt');
    writeFileSync(p, Buffer.from(b64, 'base64').toString('utf8'), { mode: 0o600 });
    cookiesPath = p;
    return p;
  } catch {
    return undefined;
  }
}

/** Args applied to every yt-dlp call — lets prod inject cookies/proxy to
 *  survive YouTube's datacenter bot checks without code changes. */
export function commonArgs(): string[] {
  const args = ['--no-playlist', '--no-warnings', '-4'];
  const cookies = resolveCookies();
  if (cookies) args.push('--cookies', cookies);
  if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
  if (process.env.YTDLP_EXTRACTOR_ARGS) args.push('--extractor-args', process.env.YTDLP_EXTRACTOR_ARGS);
  return args;
}

/**
 * Extracts the 11-char video id from any common YouTube URL form:
 *   youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID,
 *   youtube.com/embed/ID, youtube.com/live/ID, music.youtube.com/watch?v=ID
 */
export function parseYouTubeUrl(url: string): { videoId: string; cleanUrl: string } | null {
  try {
    const urlObj = new URL(url.trim());
    const host = urlObj.hostname.replace(/^www\./, '');

    let id: string | null = null;

    if (host === 'youtu.be') {
      id = urlObj.pathname.slice(1).split('/')[0] || null;
    } else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      if (urlObj.pathname === '/watch') {
        id = urlObj.searchParams.get('v');
      } else {
        const m = urlObj.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
        if (m) id = m[1];
      }
    }

    if (!id) return null;
    id = id.split('&')[0];
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;

    return { videoId: id, cleanUrl: `https://www.youtube.com/watch?v=${id}` };
  } catch {
    return null;
  }
}

interface YtFormat {
  height?: number | null;
  vcodec?: string;
  acodec?: string;
  ext?: string;
  filesize?: number | null;
  filesize_approx?: number | null;
}
interface YtDump {
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  formats?: YtFormat[];
}

function sizeText(bytes: number | undefined): string | undefined {
  if (!bytes || bytes <= 0) return undefined;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// Standard resolution ladder we surface (only those actually available appear).
const LADDER = [2160, 1440, 1080, 720, 480, 360, 240, 144];

/** Runs `yt-dlp -J` and shapes the result. Every listed video quality is
 *  merge-capable (video + audio), so all download WITH sound. */
export async function fetchYouTubeContent(url: string): Promise<YouTubeContent> {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) throw new Error('Invalid YouTube URL. Paste a video, Shorts, or youtu.be link.');

  let dump: YtDump;
  try {
    const { stdout } = await execFileP(YTDLP, [...commonArgs(), '-J', parsed.cleanUrl], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60000,
    });
    dump = JSON.parse(stdout);
  } catch (e) {
    const msg = (e as { stderr?: string }).stderr || (e as Error).message || '';
    console.error('[youtube] yt-dlp -J failed:', msg.slice(0, 800));
    if (/sign in to confirm|not a bot/i.test(msg)) {
      throw new Error('YouTube is asking this server to verify it is not a bot. Configure YTDLP_COOKIES_FILE or a proxy on the server.');
    }
    if (/private|unavailable|removed|age/i.test(msg)) {
      throw new Error('This video is unavailable (private, removed, or age-restricted).');
    }
    // Surface a trimmed reason to aid diagnosis (safe: no secrets in yt-dlp errors).
    const reason = msg.replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`Unable to read this video.${reason ? ' ' + reason : ''}`);
  }

  const formats = dump.formats || [];
  const audioFormatsRaw = formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
  const bestAudioSize =
    Math.max(0, ...audioFormatsRaw.map((f) => f.filesize || f.filesize_approx || 0)) || undefined;

  // Distinct available heights, mapped onto the standard ladder.
  const present = new Set<number>();
  for (const f of formats) {
    if (f.height && f.vcodec && f.vcodec !== 'none') {
      const rung = LADDER.find((h) => Math.abs(h - f.height!) <= 20);
      if (rung) present.add(rung);
    }
  }

  const videoFormats: YouTubeFormat[] = LADDER.filter((h) => present.has(h)).map((h) => {
    const at = formats.filter(
      (f) => f.height && Math.abs(f.height - h) <= 20 && f.vcodec && f.vcodec !== 'none'
    );
    const vSize = Math.max(0, ...at.map((f) => f.filesize || f.filesize_approx || 0)) || undefined;
    const approx = vSize ? vSize + (bestAudioSize || 0) : undefined;
    return {
      url: `/api/youtube/download?id=${parsed.videoId}&kind=video&q=${h}`,
      quality: `${h}p`,
      extension: 'mp4',
      height: h,
      hasAudio: true,
      hasVideo: true,
      sizeText: sizeText(approx),
      kind: 'video',
    };
  });

  const audioFormats: YouTubeFormat[] = [
    {
      url: `/api/youtube/download?id=${parsed.videoId}&kind=audio&format=mp3`,
      quality: 'MP3',
      extension: 'mp3',
      height: 0,
      hasAudio: true,
      hasVideo: false,
      sizeText: sizeText(bestAudioSize),
      kind: 'audio',
    },
    {
      url: `/api/youtube/download?id=${parsed.videoId}&kind=audio&format=m4a`,
      quality: 'M4A (original)',
      extension: 'm4a',
      height: 0,
      hasAudio: true,
      hasVideo: false,
      sizeText: sizeText(bestAudioSize),
      kind: 'audio',
    },
  ];

  if (!videoFormats.length && !audioFormats.length) {
    throw new Error('No downloadable formats found for this video.');
  }

  return {
    videoId: parsed.videoId,
    title: dump.title || 'YouTube video',
    author: dump.uploader || dump.channel || undefined,
    lengthSeconds: typeof dump.duration === 'number' ? dump.duration : undefined,
    thumbnail: dump.thumbnail || `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`,
    videoFormats,
    audioFormats,
  };
}

/** Debug helper — returns the raw yt-dlp error/summary without redeploying. */
export async function debugFetchYouTube(url: string): Promise<unknown> {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) return { error: 'invalid url' };
  try {
    const c = await fetchYouTubeContent(url);
    return { ok: true, videos: c.videoFormats.map((f) => f.quality), audios: c.audioFormats.map((f) => f.quality) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
