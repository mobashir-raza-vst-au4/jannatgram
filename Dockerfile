# JannatGram / JannaTube — Next.js app with yt-dlp + ffmpeg for YouTube downloads.
FROM node:22-bookworm-slim

# System deps: ffmpeg (merge/convert) + python3 & curl (for yt-dlp).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install node deps first for better layer caching.
COPY package*.json ./
RUN npm ci

# Build the app.
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

ENV NODE_ENV=production
# yt-dlp is on PATH; make it explicit for the app.
ENV YTDLP_PATH=/usr/local/bin/yt-dlp

EXPOSE 3000
# Next reads $PORT (Railway/Render set it); binds all interfaces.
CMD ["npm", "run", "start"]
