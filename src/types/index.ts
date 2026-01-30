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
}
