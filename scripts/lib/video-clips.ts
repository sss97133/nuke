/**
 * Video Clip URL Builder
 *
 * Creates deep links to specific moments in auction broadcast videos.
 * Supports YouTube timestamps and embed parameters.
 */

export interface VideoClip {
  videoId: string;
  videoUrl: string;
  startTime: number;      // Seconds
  endTime: number;        // Seconds
  duration: number;       // Seconds

  // Formatted times
  startFormatted: string; // "1:45:03"
  endFormatted: string;   // "1:45:44"

  // URLs
  watchUrl: string;       // YouTube watch with timestamp
  embedUrl: string;       // Embed URL with start time
  clipDescription: string; // "1:45:03 - 1:45:44 (41s)"
}

/**
 * Format seconds to H:MM:SS or M:SS
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse various YouTube URL formats to extract video ID
 */
export function parseYouTubeUrl(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Create a video clip with all URL formats
 */
export function createVideoClip(
  videoUrl: string,
  startTime: number,
  endTime: number
): VideoClip {
  const videoId = parseYouTubeUrl(videoUrl) || videoUrl;
  const duration = endTime - startTime;

  const startFormatted = formatTimestamp(startTime);
  const endFormatted = formatTimestamp(endTime);

  // YouTube URL with start timestamp
  // Note: YouTube doesn't support end time in URL, but we store it for our player
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(startTime)}s`;

  // Embed URL with start parameter
  const embedUrl = `https://www.youtube.com/embed/${videoId}?start=${Math.floor(startTime)}&autoplay=1`;

  return {
    videoId,
    videoUrl,
    startTime,
    endTime,
    duration,
    startFormatted,
    endFormatted,
    watchUrl,
    embedUrl,
    clipDescription: `${startFormatted} - ${endFormatted} (${Math.round(duration)}s)`,
  };
}

/**
 * Create a shareable clip URL with both start and end (for custom player)
 */
export function createClipShareUrl(
  baseUrl: string,
  videoId: string,
  startTime: number,
  endTime: number
): string {
  // For our own player that supports start/end
  return `${baseUrl}/clip/${videoId}?start=${startTime}&end=${endTime}`;
}
