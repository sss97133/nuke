import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WatchMomentButtonProps {
  videoId: string;
  timestampStart: number;
  timestampEnd?: number;
  variant?: 'default' | 'compact' | 'inline';
  className?: string;
}

export function WatchMomentButton({
  videoId,
  timestampStart,
  timestampEnd,
  variant = 'default',
  className,
}: WatchMomentButtonProps) {
  const duration = timestampEnd ? timestampEnd - timestampStart : null;
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}&t=${timestampStart}`;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  if (variant === 'inline') {
    return (
      <a
        href={youtubeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1 text-red-500 hover:text-red-400 text-sm",
          className
        )}
      >
        <Play size={14} className="fill-current" />
        Watch
      </a>
    );
  }

  if (variant === 'compact') {
    return (
      <a
        href={youtubeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors",
          className
        )}
      >
        <Play size={12} className="fill-current" />
        {formatTime(timestampStart)}
      </a>
    );
  }

  return (
    <a
      href={youtubeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors",
        className
      )}
    >
      <Play size={18} className="fill-current" />
      <div className="text-left">
        <div className="text-sm">Watch the Moment</div>
        {duration && (
          <div className="text-xs opacity-75">
            {formatTime(timestampStart)} • {Math.round(duration / 60)} min
          </div>
        )}
      </div>
    </a>
  );
}

// Embed player for inline viewing
export function MomentPlayer({
  videoId,
  timestampStart,
  timestampEnd,
  autoplay = false,
}: {
  videoId: string;
  timestampStart: number;
  timestampEnd?: number;
  autoplay?: boolean;
}) {
  const endParam = timestampEnd ? `&end=${timestampEnd}` : '';
  const embedUrl = `https://www.youtube.com/embed/${videoId}?start=${timestampStart}${endParam}${autoplay ? '&autoplay=1' : ''}`;

  return (
    <div className="relative aspect-video rounded-lg overflow-hidden bg-black">
      <iframe
        src={embedUrl}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
}

// Thumbnail preview with play button overlay
export function MomentThumbnail({
  videoId,
  timestampStart,
  onClick,
  className,
}: {
  videoId: string;
  timestampStart: number;
  onClick?: () => void;
  className?: string;
}) {
  // YouTube thumbnail at specific time (closest keyframe)
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative group rounded-lg overflow-hidden bg-gray-900",
        className
      )}
    >
      <img
        src={thumbnailUrl}
        alt="Auction moment"
        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center group-hover:scale-110 transition-transform">
          <Play size={20} className="fill-white text-white ml-1" />
        </div>
      </div>
      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 text-white text-xs">
        {Math.floor(timestampStart / 60)}:{String(timestampStart % 60).padStart(2, '0')}
      </div>
    </button>
  );
}
