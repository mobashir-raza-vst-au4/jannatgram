"use client";

import { useEffect, useState } from "react";
import { InstagramContent, MediaItem, YouTubeContent, YouTubeFormat } from "@/types";

// When set (e.g. on the Vercel site, which can't run yt-dlp), YouTube fetches
// hand off to the app that can (Railway). Unset on the backend host itself.
const YT_REDIRECT = process.env.NEXT_PUBLIC_YT_REDIRECT_HOST;

const DownloadIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
    />
  </svg>
);

const Spinner = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24">
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
      fill="none"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

type Tab = "instagram" | "youtube";

export default function Home() {
  const [tab, setTab] = useState<Tab>("instagram");

  // Instagram state
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [content, setContent] = useState<InstagramContent | null>(null);
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  // YouTube state
  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState("");
  const [ytContent, setYtContent] = useState<YouTubeContent | null>(null);
  const [ytDownloadingKey, setYtDownloadingKey] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setContent(null);

    if (!url.trim()) {
      setError("Please enter an Instagram URL");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || "Failed to fetch content");
        return;
      }

      setContent(data.data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const getProxyUrl = (url: string, forDownload = false) => {
    const base = `/api/proxy?url=${encodeURIComponent(url)}`;
    return forDownload ? `${base}&download=true` : base;
  };

  const downloadMedia = async (media: MediaItem, index: number, trackState = true) => {
    if (trackState) setDownloadingIndex(index);
    try {
      const proxyUrl = getProxyUrl(media.url, true);
      const response = await fetch(proxyUrl);
      const blob = await response.blob();

      const extension = media.type === "video" ? "mp4" : "jpg";
      const filename = `jannatgram_${content?.username || "download"}_${index + 1}.${extension}`;

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch {
      // Fallback: open in new tab
      window.open(media.url, "_blank");
    } finally {
      if (trackState) setDownloadingIndex(null);
    }
  };

  const downloadAll = async () => {
    if (!content) return;
    setDownloadingAll(true);
    try {
      for (let i = 0; i < content.media.length; i++) {
        await downloadMedia(content.media[i], i, false);
        // Small delay between downloads
        if (i < content.media.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } finally {
      setDownloadingAll(false);
    }
  };

  // ---- YouTube handlers ----
  const runYtFetch = async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    setYtError("");
    setYtContent(null);

    if (!trimmed) {
      setYtError("Please enter a YouTube URL");
      return;
    }

    // This host has no backend (Vercel) — send the user to the downloader app.
    if (YT_REDIRECT) {
      window.location.href = `${YT_REDIRECT.replace(/\/$/, "")}/?ytUrl=${encodeURIComponent(trimmed)}`;
      return;
    }

    setYtLoading(true);
    try {
      const response = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await response.json();
      if (!data.success) {
        setYtError(data.error || "Failed to fetch video");
        return;
      }
      setYtContent(data.data);
    } catch {
      setYtError("Network error. Please try again.");
    } finally {
      setYtLoading(false);
    }
  };

  const handleYtSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runYtFetch(ytUrl);
  };

  // If arriving with ?ytUrl=… (handed off from the Vercel site), open the
  // YouTube tab, prefill, and auto-fetch — then clean the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const yt = params.get("ytUrl");
    if (yt) {
      setTab("youtube");
      setYtUrl(yt);
      runYtFetch(yt);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const sanitize = (name: string) =>
    name.replace(/[^\w\-. ]+/g, "").trim().slice(0, 80) || "youtube";

  const downloadYtFormat = async (fmt: YouTubeFormat, key: string) => {
    setYtDownloadingKey(key);
    try {
      // fmt.url is our own /api/youtube/download endpoint — it runs yt-dlp +
      // ffmpeg server-side and streams back a merged file. Can take a while.
      const response = await fetch(fmt.url);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Download failed");
      }
      const blob = await response.blob();

      const base = sanitize(ytContent?.title || "youtube");
      const suffix = fmt.kind === "audio" ? fmt.extension : fmt.quality;
      const filename = `${base}_${suffix}.${fmt.extension}`;

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e) {
      setYtError(e instanceof Error ? e.message : "Download failed. Please try again.");
    } finally {
      setYtDownloadingKey(null);
    }
  };

  const anyYtDownloading = ytDownloadingKey !== null;

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-rose-400 via-pink-500 to-purple-600">
      {/* YouTube gradient cross-fades in over the base gradient on tab switch */}
      <div
        className={`pointer-events-none fixed inset-0 bg-gradient-to-br from-red-500 via-rose-600 to-purple-800 transition-opacity duration-700 ease-in-out ${
          tab === "youtube" ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="relative container mx-auto px-4 py-12">
        {/* Header */}
        <header className="text-center mb-12">
          {/* Custom Logo for Jannat */}
          <div className="inline-flex items-center justify-center w-24 h-24 bg-white rounded-3xl shadow-2xl mb-6 relative overflow-hidden">
            <svg
              className="w-16 h-16"
              viewBox="0 0 100 100"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient
                  id="jannat-gradient"
                  x1="0%"
                  y1="100%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="#f43f5e" />
                  <stop offset="50%" stopColor="#ec4899" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
              {/* Letter J with elegant curve */}
              <path
                d="M55 20 L55 60 Q55 75 40 75 Q25 75 25 60"
                stroke="url(#jannat-gradient)"
                strokeWidth="8"
                strokeLinecap="round"
                fill="none"
              />
              {/* Heart symbol */}
              <path
                d="M70 35 C70 28 77 25 82 30 C87 25 94 28 94 35 C94 45 82 55 82 55 C82 55 70 45 70 35Z"
                fill="url(#jannat-gradient)"
              />
              {/* Download arrow */}
              <path
                d="M50 82 L50 65 M42 74 L50 82 L58 74"
                stroke="url(#jannat-gradient)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            {/* Sparkle effects */}
            <div className="absolute top-2 right-2 w-2 h-2 bg-pink-400 rounded-full animate-pulse"></div>
            <div className="absolute bottom-3 left-3 w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse delay-300"></div>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-pink-100 to-white">
              {tab === "youtube" ? "JannaTube" : "JannatGram"}
            </span>
          </h1>
          <p className="text-lg text-pink-100 mb-4 italic">
            &quot;Jannat&quot; means Paradise - Save your precious moments
          </p>
          <p className="text-xl text-white/90 max-w-2xl mx-auto">
            Download Instagram posts &amp; reels and YouTube videos in high quality
          </p>
        </header>

        {/* Main Card */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-3xl shadow-2xl p-8">
            {/* Tab Switcher */}
            <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-xl">
              <button
                type="button"
                onClick={() => setTab("instagram")}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
                  tab === "instagram"
                    ? "bg-white text-pink-600 shadow"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                </svg>
                Instagram
              </button>
              <button
                type="button"
                onClick={() => setTab("youtube")}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all ${
                  tab === "youtube"
                    ? "bg-white text-red-600 shadow"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
                YouTube
              </button>
            </div>

            {/* ===================== INSTAGRAM TAB ===================== */}
            {tab === "instagram" && (
              <>
                {/* URL Input Form */}
                <form onSubmit={handleSubmit} className="mb-6">
                  <label
                    htmlFor="url"
                    className="block text-gray-700 font-semibold mb-3"
                  >
                    Paste Instagram URL
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      id="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://www.instagram.com/p/..."
                      className="flex-1 px-5 py-4 border-2 border-gray-200 rounded-xl focus:border-pink-500 focus:outline-none transition-colors text-gray-800 placeholder-gray-400"
                      disabled={loading}
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-8 py-4 bg-gradient-to-r from-rose-500 to-pink-600 text-white font-semibold rounded-xl hover:from-rose-600 hover:to-pink-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <Spinner />
                          Loading...
                        </span>
                      ) : (
                        "Download"
                      )}
                    </button>
                  </div>
                </form>

                {/* Error Message */}
                {error && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600">
                    <div className="flex items-start gap-3">
                      <svg
                        className="w-5 h-5 mt-0.5 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <p>{error}</p>
                    </div>
                  </div>
                )}

                {/* Results */}
                {content && (
                  <div className="border-t border-gray-100 pt-6">
                    {/* User Info */}
                    {content.username && (
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold">
                          {content.username.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800">
                            @{content.username}
                          </p>
                          <p className="text-sm text-gray-500 capitalize">
                            {content.type}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Caption */}
                    {content.caption && (
                      <p className="text-gray-600 mb-6 line-clamp-3">
                        {content.caption}
                      </p>
                    )}

                    {/* Media Grid */}
                    <div
                      className={`grid gap-4 mb-6 ${
                        content.media.length === 1
                          ? "grid-cols-1"
                          : "grid-cols-2"
                      }`}
                    >
                      {content.media.map((media, index) => (
                        <div
                          key={index}
                          className="relative group rounded-xl overflow-hidden bg-gray-100"
                        >
                          {media.type === "video" ? (
                            <div className="relative aspect-square bg-gray-900">
                              {media.thumbnail ? (
                                <img
                                  src={getProxyUrl(media.thumbnail)}
                                  alt={`Media ${index + 1}`}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              ) : null}
                              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-900/50 to-pink-900/50">
                                <svg
                                  className="w-16 h-16 text-white/80"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                                </svg>
                              </div>
                            </div>
                          ) : (
                            <img
                              src={getProxyUrl(media.url)}
                              alt={`Media ${index + 1}`}
                              className="w-full aspect-square object-cover"
                              onError={(e) => {
                                e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23ddd" width="100" height="100"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23999">Image</text></svg>';
                              }}
                            />
                          )}

                          {/* Download Button Overlay */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <button
                              onClick={() => downloadMedia(media, index)}
                              disabled={downloadingIndex === index || downloadingAll}
                              className="px-4 py-2 bg-white rounded-lg font-semibold text-gray-800 hover:bg-gray-100 transition-colors flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                              {downloadingIndex === index ? (
                                <>
                                  <Spinner />
                                  Downloading...
                                </>
                              ) : (
                                <>
                                  <DownloadIcon />
                                  Download
                                </>
                              )}
                            </button>
                          </div>

                          {/* Media Type Badge */}
                          <div className="absolute top-2 right-2">
                            <span
                              className={`px-2 py-1 rounded text-xs font-semibold ${
                                media.type === "video"
                                  ? "bg-red-500 text-white"
                                  : "bg-blue-500 text-white"
                              }`}
                            >
                              {media.type === "video" ? "VIDEO" : "PHOTO"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Download All Button */}
                    <button
                      onClick={downloadAll}
                      disabled={downloadingAll || downloadingIndex !== null}
                      className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-xl hover:from-green-600 hover:to-emerald-600 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {downloadingAll ? (
                        <>
                          <Spinner />
                          Downloading...
                        </>
                      ) : (
                        <>
                          <DownloadIcon />
                          Download All ({content.media.length}{" "}
                          {content.media.length === 1 ? "file" : "files"})
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Supported Formats */}
                {!content && !error && (
                  <div className="border-t border-gray-100 pt-6">
                    <p className="text-center text-gray-500 mb-4">
                      Supported content types:
                    </p>
                    <div className="flex flex-wrap justify-center gap-3">
                      {[
                        { name: "Posts", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
                        { name: "Reels", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
                        { name: "Stories", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
                      ].map((item) => (
                        <div
                          key={item.name}
                          className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-full text-gray-700"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d={item.icon}
                            />
                          </svg>
                          {item.name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ===================== YOUTUBE TAB ===================== */}
            {tab === "youtube" && (
              <>
                <form onSubmit={handleYtSubmit} className="mb-6">
                  <label
                    htmlFor="yturl"
                    className="block text-gray-700 font-semibold mb-3"
                  >
                    Paste YouTube URL
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      id="yturl"
                      value={ytUrl}
                      onChange={(e) => setYtUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="flex-1 px-5 py-4 border-2 border-gray-200 rounded-xl focus:border-red-500 focus:outline-none transition-colors text-gray-800 placeholder-gray-400"
                      disabled={ytLoading}
                    />
                    <button
                      type="submit"
                      disabled={ytLoading}
                      className="px-8 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold rounded-xl hover:from-red-600 hover:to-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                    >
                      {ytLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <Spinner />
                          Loading...
                        </span>
                      ) : YT_REDIRECT ? (
                        "Fetch →"
                      ) : (
                        "Fetch"
                      )}
                    </button>
                  </div>
                  {YT_REDIRECT && (
                    <p className="text-xs text-gray-400 mt-2">
                      YouTube downloads open in our downloader app for the best
                      quality and speed.
                    </p>
                  )}
                </form>

                {/* Error Message */}
                {ytError && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600">
                    <div className="flex items-start gap-3">
                      <svg
                        className="w-5 h-5 mt-0.5 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <p>{ytError}</p>
                    </div>
                  </div>
                )}

                {/* Results */}
                {ytContent && (
                  <div className="border-t border-gray-100 pt-6">
                    {/* Video info */}
                    <div className="flex gap-4 mb-6">
                      {ytContent.thumbnail && (
                        <img
                          src={getProxyUrl(ytContent.thumbnail)}
                          alt="thumbnail"
                          className="w-40 aspect-video object-cover rounded-lg bg-gray-100 flex-shrink-0"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 line-clamp-2">
                          {ytContent.title}
                        </p>
                        {ytContent.author && (
                          <p className="text-sm text-gray-500 mt-1">
                            {ytContent.author}
                          </p>
                        )}
                        {ytContent.lengthSeconds ? (
                          <p className="text-sm text-gray-400 mt-1">
                            {formatDuration(ytContent.lengthSeconds)}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {/* Video formats */}
                    {ytContent.videoFormats.length > 0 && (
                      <div className="mb-6">
                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                          Video
                        </h3>
                        <div className="space-y-2">
                          {ytContent.videoFormats.map((fmt, i) => {
                            const key = `v-${i}`;
                            return (
                              <div
                                key={key}
                                className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-xl"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="px-2.5 py-1 bg-gray-800 text-white rounded-lg text-sm font-bold flex-shrink-0">
                                    {fmt.quality}
                                  </span>
                                  <span className="text-xs uppercase text-gray-400 font-semibold">
                                    {fmt.extension}
                                  </span>
                                  {fmt.sizeText && (
                                    <span className="text-sm text-gray-500">
                                      {fmt.sizeText}
                                    </span>
                                  )}
                                  <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                                    with audio
                                  </span>
                                </div>
                                <button
                                  onClick={() => downloadYtFormat(fmt, key)}
                                  disabled={anyYtDownloading}
                                  className="px-4 py-2 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-lg font-semibold hover:from-red-600 hover:to-red-700 transition-all flex items-center gap-2 flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {ytDownloadingKey === key ? (
                                    <>
                                      <Spinner className="w-4 h-4" />
                                      <span className="hidden sm:inline">Downloading...</span>
                                    </>
                                  ) : (
                                    <>
                                      <DownloadIcon className="w-4 h-4" />
                                      <span className="hidden sm:inline">Download</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          Every resolution downloads as one MP4 with audio (merged on
                          the server), so higher qualities take a few extra seconds.
                        </p>
                      </div>
                    )}

                    {/* Audio formats */}
                    {ytContent.audioFormats.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                          Audio only
                        </h3>
                        <div className="space-y-2">
                          {ytContent.audioFormats.map((fmt, i) => {
                            const key = `a-${i}`;
                            return (
                              <div
                                key={key}
                                className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-xl"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="px-2.5 py-1 bg-purple-600 text-white rounded-lg text-sm font-bold flex-shrink-0">
                                    {fmt.quality}
                                  </span>
                                  <span className="text-xs uppercase text-gray-400 font-semibold">
                                    {fmt.extension}
                                  </span>
                                  {fmt.sizeText && (
                                    <span className="text-sm text-gray-500">
                                      {fmt.sizeText}
                                    </span>
                                  )}
                                </div>
                                <button
                                  onClick={() => downloadYtFormat(fmt, key)}
                                  disabled={anyYtDownloading}
                                  className="px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-semibold hover:from-purple-600 hover:to-purple-700 transition-all flex items-center gap-2 flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {ytDownloadingKey === key ? (
                                    <>
                                      <Spinner className="w-4 h-4" />
                                      <span className="hidden sm:inline">Downloading...</span>
                                    </>
                                  ) : (
                                    <>
                                      <DownloadIcon className="w-4 h-4" />
                                      <span className="hidden sm:inline">Download</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Placeholder */}
                {!ytContent && !ytError && (
                  <div className="border-t border-gray-100 pt-6">
                    <p className="text-center text-gray-500 mb-4">
                      Paste any YouTube link — videos, Shorts, or youtu.be — and pick your quality.
                    </p>
                    <div className="flex flex-wrap justify-center gap-3">
                      {["4K / 1080p", "720p / 480p", "Audio (M4A)"].map((label) => (
                        <div
                          key={label}
                          className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-full text-gray-700"
                        >
                          <DownloadIcon />
                          {label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* How to Use */}
          <div className="mt-8 bg-white/10 backdrop-blur rounded-2xl p-6 text-white">
            <h2 className="text-xl font-bold mb-4">How to Use</h2>
            <ol className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-white/20 rounded-full flex items-center justify-center text-sm font-bold">
                  1
                </span>
                <span>
                  Choose the Instagram or YouTube tab and copy the link
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-white/20 rounded-full flex items-center justify-center text-sm font-bold">
                  2
                </span>
                <span>Paste the URL in the input field above</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-white/20 rounded-full flex items-center justify-center text-sm font-bold">
                  3
                </span>
                <span>
                  Pick your quality and save your content
                </span>
              </li>
            </ol>
          </div>

          {/* API Setup Guide */}
          <div className="mt-4 bg-white/10 backdrop-blur rounded-2xl p-6 text-white">
            <h2 className="text-xl font-bold mb-4">API Setup (Required)</h2>
            <ol className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-white/20 rounded-full flex items-center justify-center text-xs font-bold">
                  1
                </span>
                <span>
                  Sign up on{" "}
                  <a
                    href="https://rapidapi.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold hover:text-pink-200"
                  >
                    RapidAPI
                  </a>{" "}
                  (free)
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-white/20 rounded-full flex items-center justify-center text-xs font-bold">
                  2
                </span>
                <span>
                  Subscribe to an Instagram scraper API and the{" "}
                  <a
                    href="https://rapidapi.com/ytjar/api/youtube-media-downloader"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold hover:text-pink-200"
                  >
                    YouTube Media Downloader
                  </a>{" "}
                  API (free tiers available)
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-white/20 rounded-full flex items-center justify-center text-xs font-bold">
                  3
                </span>
                <span>Copy your RapidAPI key from the dashboard</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-white/20 rounded-full flex items-center justify-center text-xs font-bold">
                  4
                </span>
                <span>
                  Add it to <code className="bg-white/20 px-2 py-0.5 rounded">.env.local</code> file:
                  <code className="block mt-1 bg-white/20 px-3 py-2 rounded text-xs">
                    RAPIDAPI_KEY=your_key_here
                  </code>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-white/20 rounded-full flex items-center justify-center text-xs font-bold">
                  5
                </span>
                <span>Restart the development server</span>
              </li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center">
          {/* Love Message */}
          <div className="mb-6 inline-flex items-center gap-2 px-6 py-3 bg-white/10 backdrop-blur rounded-full">
            <span className="text-white font-medium">Made with</span>
            <svg
              className="w-5 h-5 text-red-400 animate-pulse"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-white font-medium">by</span>
            <span className="text-pink-200 font-bold">Mobashir</span>
            <span className="text-white font-medium">for</span>
            <span className="text-pink-200 font-bold">Jannat</span>
          </div>

          <p className="text-white/60 text-sm">
            This tool is for personal use only. Please respect content
            creators and their rights.
          </p>

          <p className="text-white/40 text-xs mt-2">
            JannatGram &copy; {new Date().getFullYear()} - Your Paradise for saving memories
          </p>
        </footer>
      </div>
    </div>
  );
}
