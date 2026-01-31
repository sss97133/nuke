import { useState } from 'react';
import { cn } from '@/lib/utils';

interface PredictionBadgeProps {
  marketId: string;
  title: string;
  lineValue: number;
  yesPercent: number;
  noPercent: number;
  userPrediction?: 'over' | 'under' | null;
  totalPool: number;
  isLive?: boolean;
  onToggle: (side: 'over' | 'under') => void;
  onExpand: () => void;
}

export function PredictionBadge({
  title,
  lineValue,
  yesPercent,
  noPercent,
  userPrediction,
  totalPool,
  isLive,
  onToggle,
  onExpand,
}: PredictionBadgeProps) {
  const [hovering, setHovering] = useState<'over' | 'under' | null>(null);

  const formatLine = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toLocaleString()}`;
  };

  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-lg overflow-hidden border transition-all cursor-pointer",
        "hover:shadow-md",
        isLive && "ring-2 ring-red-500 ring-offset-1 animate-pulse",
        userPrediction && "ring-2 ring-blue-500 ring-offset-1"
      )}
      onMouseEnter={() => setHovering(null)}
      onMouseLeave={() => setHovering(null)}
    >
      {/* Over button */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle('over'); }}
        onMouseEnter={() => setHovering('over')}
        onMouseLeave={() => setHovering(null)}
        className={cn(
          "px-3 py-2 text-sm font-bold transition-all flex flex-col items-center justify-center min-w-[60px]",
          userPrediction === 'over'
            ? "bg-green-500 text-white"
            : hovering === 'over'
            ? "bg-green-100 text-green-700"
            : "bg-green-50 text-green-600 hover:bg-green-100"
        )}
      >
        <span className="text-xs opacity-75">OVER</span>
        <span className="text-lg leading-none">{yesPercent.toFixed(0)}%</span>
      </button>

      {/* Center - line value (clickable for details) */}
      <button
        onClick={onExpand}
        className={cn(
          "px-3 py-2 bg-gray-900 text-white flex flex-col items-center justify-center min-w-[70px]",
          "hover:bg-gray-800 transition-colors"
        )}
      >
        <span className="text-xs text-gray-400 truncate max-w-[80px]">
          {title.length > 12 ? title.slice(0, 12) + '…' : title}
        </span>
        <span className="font-mono font-bold text-sm">{formatLine(lineValue)}</span>
        {isLive && (
          <span className="text-[10px] text-red-400 uppercase tracking-wider">Live</span>
        )}
      </button>

      {/* Under button */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle('under'); }}
        onMouseEnter={() => setHovering('under')}
        onMouseLeave={() => setHovering(null)}
        className={cn(
          "px-3 py-2 text-sm font-bold transition-all flex flex-col items-center justify-center min-w-[60px]",
          userPrediction === 'under'
            ? "bg-red-500 text-white"
            : hovering === 'under'
            ? "bg-red-100 text-red-700"
            : "bg-red-50 text-red-600 hover:bg-red-100"
        )}
      >
        <span className="text-xs opacity-75">UNDER</span>
        <span className="text-lg leading-none">{noPercent.toFixed(0)}%</span>
      </button>
    </div>
  );
}

// Compact version for inline use
export function PredictionBadgeMini({
  lineValue,
  yesPercent,
  noPercent,
  userPrediction,
  isLive,
  onToggle,
}: Omit<PredictionBadgeProps, 'title' | 'totalPool' | 'onExpand' | 'marketId'>) {
  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-md overflow-hidden text-xs",
        isLive && "ring-1 ring-red-500"
      )}
    >
      <button
        onClick={() => onToggle('over')}
        className={cn(
          "px-2 py-1 font-bold transition-all",
          userPrediction === 'over'
            ? "bg-green-500 text-white"
            : "bg-green-100 text-green-700 hover:bg-green-200"
        )}
      >
        {yesPercent.toFixed(0)}%
      </button>
      <div className="px-2 py-1 bg-gray-800 text-white font-mono">
        {lineValue >= 1000000 ? `${(lineValue/1000000).toFixed(1)}M` : `${(lineValue/1000).toFixed(0)}K`}
      </div>
      <button
        onClick={() => onToggle('under')}
        className={cn(
          "px-2 py-1 font-bold transition-all",
          userPrediction === 'under'
            ? "bg-red-500 text-white"
            : "bg-red-100 text-red-700 hover:bg-red-200"
        )}
      >
        {noPercent.toFixed(0)}%
      </button>
    </div>
  );
}
