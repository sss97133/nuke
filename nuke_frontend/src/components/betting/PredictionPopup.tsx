import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

interface BetHistory {
  timestamp: Date;
  yesPercent: number;
  noPercent: number;
  totalPool: number;
}

interface PredictionPopupProps {
  marketId: string;
  title: string;
  description: string;
  lineValue: number;
  yesAmount: number;
  noAmount: number;
  totalBettors: number;
  locksAt: string;
  userPrediction?: 'over' | 'under' | null;
  userAmount?: number;
  isLive?: boolean;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  onClose: () => void;
  onPredict: (side: 'over' | 'under', amount: number) => void;
}

export function PredictionPopup({
  marketId,
  title,
  description,
  lineValue,
  yesAmount,
  noAmount,
  totalBettors,
  locksAt,
  userPrediction,
  userAmount,
  isLive,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  onClose,
  onPredict,
}: PredictionPopupProps) {
  const [history, setHistory] = useState<BetHistory[]>([]);
  const [selectedSide, setSelectedSide] = useState<'over' | 'under'>(userPrediction || 'over');
  const [amount, setAmount] = useState(userAmount ? userAmount / 100 : 10);
  const [confirming, setConfirming] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pool = yesAmount + noAmount;
  const yesPercent = pool > 0 ? (yesAmount / pool) * 100 : 50;
  const noPercent = 100 - yesPercent;

  // Generate mock history for visualization (in production, fetch from DB)
  useEffect(() => {
    const mockHistory: BetHistory[] = [];
    const now = Date.now();
    const hourMs = 3600000;

    // Generate 24 hours of history
    for (let i = 24; i >= 0; i--) {
      const variance = Math.random() * 20 - 10;
      mockHistory.push({
        timestamp: new Date(now - i * hourMs),
        yesPercent: Math.max(10, Math.min(90, yesPercent + variance)),
        noPercent: Math.max(10, Math.min(90, noPercent - variance)),
        totalPool: pool * (0.5 + (24 - i) / 48),
      });
    }
    setHistory(mockHistory);
  }, [yesPercent, noPercent, pool]);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 20;

    // Clear
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (height - padding * 2) * (i / 4);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // Draw 50% line
    ctx.strokeStyle = '#666';
    ctx.setLineDash([5, 5]);
    const midY = padding + (height - padding * 2) / 2;
    ctx.beginPath();
    ctx.moveTo(padding, midY);
    ctx.lineTo(width - padding, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Over line (green)
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    history.forEach((h, i) => {
      const x = padding + (width - padding * 2) * (i / (history.length - 1));
      const y = padding + (height - padding * 2) * (1 - h.yesPercent / 100);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw Under line (red)
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    history.forEach((h, i) => {
      const x = padding + (width - padding * 2) * (i / (history.length - 1));
      const y = padding + (height - padding * 2) * (1 - h.noPercent / 100);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Current dots
    const lastH = history[history.length - 1];
    const lastX = width - padding;

    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(lastX, padding + (height - padding * 2) * (1 - lastH.yesPercent / 100), 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(lastX, padding + (height - padding * 2) * (1 - lastH.noPercent / 100), 5, 0, Math.PI * 2);
    ctx.fill();

  }, [history]);

  const formatLine = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toLocaleString()}`;
  };

  const timeUntilLock = () => {
    const diff = new Date(locksAt).getTime() - Date.now();
    if (diff <= 0) return 'Locked';
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const handleConfirm = () => {
    if (confirming) {
      onPredict(selectedSide, amount * 100);
      onClose();
    } else {
      setConfirming(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl w-full max-w-md mx-4 overflow-hidden shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex items-start justify-between">
          <div>
            {vehicleYear && vehicleMake && (
              <div className="text-xs text-gray-500 mb-1">
                {vehicleYear} {vehicleMake} {vehicleModel}
              </div>
            )}
            <h2 className="font-bold text-white text-lg leading-tight">{title}</h2>
            <p className="text-sm text-gray-400 mt-1">{description}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>

        {/* Chart */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex justify-between text-xs text-gray-500 mb-2">
            <span>24h Odds Movement</span>
            <div className="flex gap-4">
              <span className="text-green-500">● Over</span>
              <span className="text-red-500">● Under</span>
            </div>
          </div>
          <canvas
            ref={canvasRef}
            width={360}
            height={120}
            className="w-full rounded bg-gray-950"
          />
        </div>

        {/* Current Odds */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex justify-between items-center mb-3">
            <span className="text-gray-400 text-sm">Line</span>
            <span className="font-mono font-bold text-white text-xl">{formatLine(lineValue)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setSelectedSide('over')}
              className={cn(
                "p-3 rounded-lg transition-all text-center",
                selectedSide === 'over'
                  ? "bg-green-500 text-white ring-2 ring-green-300"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              )}
            >
              <div className="text-2xl font-bold">{yesPercent.toFixed(0)}%</div>
              <div className="text-xs opacity-75">OVER</div>
              <div className="text-xs mt-1 opacity-60">${(yesAmount / 100).toLocaleString()}</div>
            </button>

            <button
              onClick={() => setSelectedSide('under')}
              className={cn(
                "p-3 rounded-lg transition-all text-center",
                selectedSide === 'under'
                  ? "bg-red-500 text-white ring-2 ring-red-300"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              )}
            >
              <div className="text-2xl font-bold">{noPercent.toFixed(0)}%</div>
              <div className="text-xs opacity-75">UNDER</div>
              <div className="text-xs mt-1 opacity-60">${(noAmount / 100).toLocaleString()}</div>
            </button>
          </div>
        </div>

        {/* Prediction Input */}
        <div className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-7 pr-3 py-2 text-white"
                  min={1}
                  step={1}
                />
              </div>
            </div>
            <div className="flex gap-1">
              {[5, 10, 25, 50].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(v)}
                  className={cn(
                    "px-2 py-1 text-xs rounded transition-colors",
                    amount === v
                      ? "bg-blue-500 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  )}
                >
                  ${v}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleConfirm}
            disabled={amount <= 0}
            className={cn(
              "w-full py-3 rounded-lg font-bold transition-all",
              confirming
                ? "bg-yellow-500 text-black hover:bg-yellow-400"
                : selectedSide === 'over'
                ? "bg-green-500 text-white hover:bg-green-400"
                : "bg-red-500 text-white hover:bg-red-400",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {confirming
              ? `Confirm $${amount} on ${selectedSide.toUpperCase()}?`
              : `Predict ${selectedSide.toUpperCase()} • $${amount}`}
          </button>

          {userPrediction && (
            <div className="mt-3 text-center text-sm text-gray-500">
              You predicted {userPrediction.toUpperCase()} with ${(userAmount || 0) / 100}
            </div>
          )}

          <div className="mt-3 flex justify-between text-xs text-gray-500">
            <span>{totalBettors} predictors</span>
            <span>{isLive ? '🔴 LIVE' : `Locks in ${timeUntilLock()}`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
