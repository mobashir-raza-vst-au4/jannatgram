export type ContentType = 'post' | 'reel' | 'story';

export interface MediaItem {
  url: string;
  type: 'image' | 'video';
  thumbnail?: string;
}

export interface InstagramContent {
  type: ContentType;
  username: string;
  caption?: string;
  media: MediaItem[];
  timestamp?: string;
}

export interface DownloadResponse {
  success: boolean;
  data?: InstagramContent;
  error?: string;
  /** Raw provider responses, returned when the request is sent with { debug: true }. */
  debug?: unknown;
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------
export interface YouTubeFormat {
  url: string;
  /** Human label: "1080p", "720p", "128kbps", etc. */
  quality: string;
  /** File extension: mp4, webm, m4a, mp3. */
  extension: string;
  /** Numeric height for video (1080, 720…); 0 for audio-only. Used for sorting. */
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
  /** Pretty size, e.g. "24.6 MB", when the provider reports it. */
  sizeText?: string;
  kind: 'video' | 'audio';
}

export interface YouTubeContent {
  videoId: string;
  title: string;
  author?: string;
  lengthSeconds?: number;
  thumbnail?: string;
  /** Video streams, sorted highest resolution first. */
  videoFormats: YouTubeFormat[];
  /** Audio-only streams, sorted best quality first. */
  audioFormats: YouTubeFormat[];
}

export interface YouTubeResponse {
  success: boolean;
  data?: YouTubeContent;
  error?: string;
  debug?: unknown;
}
