import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { PredictionBadge } from './PredictionBadge';
import { PredictionPopup } from './PredictionPopup';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

interface LiveLot {
  id: string;
  vehicleId: string;
  year: number;
  make: string;
  model: string;
  lotNumber: string;
  currentBid: number;
  lineValue: number;
  yesPercent: number;
  noPercent: number;
  totalPool: number;
  totalBettors: number;
  status: 'upcoming' | 'active' | 'sold' | 'no_sale';
  imageUrl?: string;
}

interface BidUpdate {
  lotNumber: string;
  amount: number;
  timestamp: Date;
}

export function LiveAuctionView() {
  const { user } = useAuth();
  const [currentLot, setCurrentLot] = useState<LiveLot | null>(null);
  const [upcomingLots, setUpcomingLots] = useState<LiveLot[]>([]);
  const [recentBids, setRecentBids] = useState<BidUpdate[]>([]);
  const [expandedMarket, setExpandedMarket] = useState<string | null>(null);
  const [userPredictions, setUserPredictions] = useState<Record<string, 'over' | 'under'>>({});
  const bidFeedRef = useRef<HTMLDivElement>(null);

  // Simulated live feed - in production this would connect to real-time source
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentLot && currentLot.status === 'active') {
        // Simulate bid increases
        const newBid = currentLot.currentBid + Math.floor(Math.random() * 5000) + 1000;
        setCurrentLot(prev => prev ? { ...prev, currentBid: newBid } : null);

        // Add to bid feed
        setRecentBids(prev => [{
          lotNumber: currentLot.lotNumber,
          amount: newBid,
          timestamp: new Date(),
        }, ...prev.slice(0, 9)]);

        // Update odds based on bid proximity to line
        const ratio = newBid / currentLot.lineValue;
        const yesChance = Math.min(95, Math.max(5, 50 + (ratio - 1) * 100));
        setCurrentLot(prev => prev ? {
          ...prev,
          yesPercent: yesChance,
          noPercent: 100 - yesChance,
        } : null);
      }
    }, 2000 + Math.random() * 3000); // Random 2-5 second intervals

    return () => clearInterval(interval);
  }, [currentLot]);

  // Load initial data
  useEffect(() => {
    loadLiveData();
  }, []);

  async function loadLiveData() {
    // Get active markets with vehicle data
    const { data: markets } = await supabase
      .from('betting_markets')
      .select(`
        id, title, line_value, total_yes_amount, total_no_amount, total_bettors,
        vehicles(id, year, make, model, vehicle_images(url))
      `)
      .eq('status', 'open')
      .order('locks_at', { ascending: true })
      .limit(10);

    if (markets?.length) {
      const lots: LiveLot[] = markets.map((m: any, i: number) => {
        const pool = m.total_yes_amount + m.total_no_amount;
        return {
          id: m.id,
          vehicleId: m.vehicles?.id,
          year: m.vehicles?.year || 2024,
          make: m.vehicles?.make || 'Unknown',
          model: m.vehicles?.model || 'Vehicle',
          lotNumber: `S${1150000 + i}`,
          currentBid: Math.floor(m.line_value * (0.3 + Math.random() * 0.5)),
          lineValue: m.line_value,
          yesPercent: pool > 0 ? (m.total_yes_amount / pool) * 100 : 50,
          noPercent: pool > 0 ? (m.total_no_amount / pool) * 100 : 50,
          totalPool: pool,
          totalBettors: m.total_bettors,
          status: i === 0 ? 'active' : 'upcoming',
          imageUrl: m.vehicles?.vehicle_images?.[0]?.url,
        };
      });

      setCurrentLot(lots[0]);
      setUpcomingLots(lots.slice(1));
    }
  }

  const handleTogglePrediction = async (lotId: string, side: 'over' | 'under') => {
    if (!user) return;

    // Toggle prediction
    setUserPredictions(prev => ({
      ...prev,
      [lotId]: prev[lotId] === side ? undefined : side,
    } as any));
  };

  const handlePredict = async (side: 'over' | 'under', amount: number) => {
    if (!user || !expandedMarket) return;

    const { error } = await supabase.rpc('place_bet', {
      p_user_id: user.id,
      p_market_id: expandedMarket,
      p_side: side === 'over' ? 'yes' : 'no',
      p_amount: amount,
    });

    if (!error) {
      setUserPredictions(prev => ({ ...prev, [expandedMarket]: side }));
      loadLiveData();
    }
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${Math.floor(value / 1000)}K`;
    return `$${value.toLocaleString()}`;
  };

  if (!currentLot) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading live auction...
      </div>
    );
  }

  return (
    <div className="bg-black text-white min-h-screen">
      {/* Main Stage - Current Lot */}
      <div className="relative">
        {/* Video/Image area */}
        <div className="aspect-video bg-gray-900 relative overflow-hidden">
          {currentLot.imageUrl ? (
            <img
              src={currentLot.imageUrl}
              alt={`${currentLot.year} ${currentLot.make} ${currentLot.model}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-4xl text-gray-700">
              🚗
            </div>
          )}

          {/* Live indicator */}
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
              LIVE
            </span>
            <span className="bg-black/70 text-white text-sm px-2 py-1 rounded">
              Lot {currentLot.lotNumber}
            </span>
          </div>

          {/* Current bid overlay */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent p-4">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-2xl font-bold">
                  {currentLot.year} {currentLot.make} {currentLot.model}
                </h2>
                <div className="text-gray-400 text-sm mt-1">
                  Mecum Kissimmee 2026
                </div>
              </div>

              <div className="text-right">
                <div className="text-gray-400 text-sm">Current Bid</div>
                <div className={cn(
                  "text-4xl font-mono font-bold transition-all",
                  currentLot.currentBid > currentLot.lineValue
                    ? "text-green-400"
                    : "text-white"
                )}>
                  {formatCurrency(currentLot.currentBid)}
                </div>
              </div>
            </div>
          </div>

          {/* Prediction badge overlay */}
          <div className="absolute top-4 right-4">
            <PredictionBadge
              marketId={currentLot.id}
              title={`${currentLot.make} ${currentLot.model}`}
              lineValue={currentLot.lineValue}
              yesPercent={currentLot.yesPercent}
              noPercent={currentLot.noPercent}
              userPrediction={userPredictions[currentLot.id]}
              totalPool={currentLot.totalPool}
              isLive={true}
              onToggle={(side) => handleTogglePrediction(currentLot.id, side)}
              onExpand={() => setExpandedMarket(currentLot.id)}
            />
          </div>
        </div>

        {/* Bid Progress Bar */}
        <div className="h-2 bg-gray-800 relative">
          <div
            className={cn(
              "h-full transition-all duration-500",
              currentLot.currentBid >= currentLot.lineValue
                ? "bg-green-500"
                : "bg-blue-500"
            )}
            style={{
              width: `${Math.min(100, (currentLot.currentBid / currentLot.lineValue) * 100)}%`
            }}
          />
          {/* Line marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-yellow-400"
            style={{ left: '100%', transform: 'translateX(-1px)' }}
          />
          <div className="absolute -top-6 right-0 text-xs text-yellow-400">
            Line: {formatCurrency(currentLot.lineValue)}
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-3 gap-4 p-4">
        {/* Bid Feed */}
        <div className="bg-gray-900 rounded-lg p-3">
          <h3 className="text-sm font-bold text-gray-400 mb-2">BID ACTIVITY</h3>
          <div ref={bidFeedRef} className="space-y-1 max-h-48 overflow-y-auto">
            {recentBids.map((bid, i) => (
              <div
                key={i}
                className={cn(
                  "flex justify-between text-sm py-1 px-2 rounded",
                  i === 0 && "bg-blue-900/50 animate-pulse"
                )}
              >
                <span className="text-gray-500">
                  {bid.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="font-mono font-bold text-green-400">
                  {formatCurrency(bid.amount)}
                </span>
              </div>
            ))}
            {recentBids.length === 0 && (
              <div className="text-gray-600 text-sm text-center py-4">
                Waiting for bids...
              </div>
            )}
          </div>
        </div>

        {/* Up Next */}
        <div className="bg-gray-900 rounded-lg p-3 col-span-2">
          <h3 className="text-sm font-bold text-gray-400 mb-2">UP NEXT</h3>
          <div className="grid grid-cols-2 gap-2">
            {upcomingLots.slice(0, 4).map((lot) => (
              <div
                key={lot.id}
                className="bg-gray-800 rounded p-2 flex items-center gap-2"
              >
                <div className="w-16 h-12 bg-gray-700 rounded overflow-hidden flex-shrink-0">
                  {lot.imageUrl ? (
                    <img src={lot.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600">🚗</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-500">{lot.lotNumber}</div>
                  <div className="text-sm font-medium truncate">
                    {lot.year} {lot.make}
                  </div>
                </div>
                <PredictionBadge
                  marketId={lot.id}
                  title={lot.make}
                  lineValue={lot.lineValue}
                  yesPercent={lot.yesPercent}
                  noPercent={lot.noPercent}
                  userPrediction={userPredictions[lot.id]}
                  totalPool={lot.totalPool}
                  onToggle={(side) => handleTogglePrediction(lot.id, side)}
                  onExpand={() => setExpandedMarket(lot.id)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Expanded Popup */}
      {expandedMarket && (
        <PredictionPopup
          marketId={expandedMarket}
          title={currentLot.id === expandedMarket
            ? `${currentLot.year} ${currentLot.make} ${currentLot.model}`
            : upcomingLots.find(l => l.id === expandedMarket)?.make || 'Vehicle'}
          description={`Over/Under ${formatCurrency(currentLot.lineValue)}`}
          lineValue={currentLot.lineValue}
          yesAmount={Math.floor(currentLot.totalPool * currentLot.yesPercent / 100)}
          noAmount={Math.floor(currentLot.totalPool * currentLot.noPercent / 100)}
          totalBettors={currentLot.totalBettors}
          locksAt={new Date(Date.now() + 300000).toISOString()}
          userPrediction={userPredictions[expandedMarket]}
          isLive={currentLot.id === expandedMarket}
          vehicleYear={currentLot.year}
          vehicleMake={currentLot.make}
          vehicleModel={currentLot.model}
          onClose={() => setExpandedMarket(null)}
          onPredict={handlePredict}
        />
      )}
    </div>
  );
}
