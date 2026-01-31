import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { PredictionBadge } from '@/components/betting/PredictionBadge';
import { PredictionPopup } from '@/components/betting/PredictionPopup';
import { cn } from '@/lib/utils';

interface Market {
  id: string;
  title: string;
  description: string;
  market_type: string;
  line_value: number;
  line_description: string;
  status: string;
  locks_at: string;
  total_yes_amount: number;
  total_no_amount: number;
  total_bettors: number;
  min_bet: number;
  max_bet: number;
  rake_percent: number;
  vehicle_id?: string;
  vehicles?: {
    year: number;
    make: string;
    model: string;
    vehicle_images?: { url: string }[];
  };
}

interface UserBet {
  market_id: string;
  side: 'yes' | 'no';
  amount: number;
}

type FilterType = 'all' | 'auction_over_under' | 'auction_will_sell' | 'make_vs_make' | 'daily_gross' | 'record_breaker';

export default function BettingPage() {
  const { user } = useAuth();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [userBets, setUserBets] = useState<Record<string, UserBet>>({});
  const [balance, setBalance] = useState(0);
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedMarket, setExpandedMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMarkets();
    if (user) loadUserData();
  }, [user, filter]);

  async function loadMarkets() {
    setLoading(true);
    let query = supabase
      .from('betting_markets')
      .select(`
        *,
        vehicles(year, make, model, vehicle_images(url))
      `)
      .eq('status', 'open')
      .order('locks_at', { ascending: true });

    if (filter !== 'all') {
      query = query.eq('market_type', filter);
    }

    const { data } = await query.limit(100);
    setMarkets(data || []);
    setLoading(false);
  }

  async function loadUserData() {
    // Wallet
    const { data: wallet } = await supabase
      .from('betting_wallets')
      .select('balance')
      .eq('user_id', user?.id)
      .single();
    setBalance(wallet?.balance || 0);

    // User bets
    const { data: bets } = await supabase
      .from('bets')
      .select('market_id, side, amount')
      .eq('user_id', user?.id)
      .eq('status', 'active');

    const betsMap: Record<string, UserBet> = {};
    bets?.forEach(b => {
      betsMap[b.market_id] = b;
    });
    setUserBets(betsMap);
  }

  async function handleTogglePrediction(marketId: string, side: 'over' | 'under') {
    if (!user) {
      window.location.href = '/login';
      return;
    }

    const market = markets.find(m => m.id === marketId);
    if (!market) return;

    // Quick bet with minimum amount
    const { error } = await supabase.rpc('place_bet', {
      p_user_id: user.id,
      p_market_id: marketId,
      p_side: side === 'over' ? 'yes' : 'no',
      p_amount: market.min_bet,
    });

    if (!error) {
      loadMarkets();
      loadUserData();
    }
  }

  async function handlePredict(side: 'over' | 'under', amount: number) {
    if (!user || !expandedMarket) return;

    const { error } = await supabase.rpc('place_bet', {
      p_user_id: user.id,
      p_market_id: expandedMarket.id,
      p_side: side === 'over' ? 'yes' : 'no',
      p_amount: amount,
    });

    if (!error) {
      loadMarkets();
      loadUserData();
      setExpandedMarket(null);
    }
  }

  const filterTabs: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'auction_over_under', label: 'Price O/U' },
    { key: 'auction_will_sell', label: 'Will Sell?' },
    { key: 'make_vs_make', label: 'vs Matchups' },
    { key: 'daily_gross', label: 'Daily Totals' },
    { key: 'record_breaker', label: 'Records' },
  ];

  const groupedMarkets = markets.reduce((acc, m) => {
    const type = m.market_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(m);
    return acc;
  }, {} as Record<string, Market[]>);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold">Predictions</h1>
              <span className="text-sm text-gray-500">Mecum Kissimmee 2026</span>
              <Link
                to="/betting/live"
                className="text-xs bg-red-600 hover:bg-red-500 px-2 py-1 rounded flex items-center gap-1"
              >
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                Live View
              </Link>
            </div>

            <div className="flex items-center gap-4">
              {user ? (
                <div className="text-sm">
                  <span className="text-gray-500">Balance:</span>
                  <span className="font-mono font-bold ml-1 text-green-400">
                    ${(balance / 100).toFixed(2)}
                  </span>
                </div>
              ) : (
                <Link to="/login" className="text-sm text-blue-400 hover:underline">
                  Sign in to predict
                </Link>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mt-3 overflow-x-auto pb-1">
            {filterTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-full transition-colors whitespace-nowrap",
                  filter === tab.key
                    ? "bg-white text-black font-medium"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading markets...</div>
        ) : markets.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No markets found</div>
        ) : filter === 'all' ? (
          // Grouped view
          <div className="space-y-8">
            {Object.entries(groupedMarkets).map(([type, typeMarkets]) => (
              <section key={type}>
                <h2 className="text-lg font-bold text-gray-300 mb-3 capitalize">
                  {type.replace(/_/g, ' ')}
                  <span className="text-gray-600 font-normal ml-2">{typeMarkets.length}</span>
                </h2>
                <div className="flex flex-wrap gap-2">
                  {typeMarkets.slice(0, 20).map(market => {
                    const pool = market.total_yes_amount + market.total_no_amount;
                    const yesPercent = pool > 0 ? (market.total_yes_amount / pool) * 100 : 50;
                    const userBet = userBets[market.id];

                    return (
                      <PredictionBadge
                        key={market.id}
                        marketId={market.id}
                        title={market.vehicles
                          ? `${market.vehicles.year} ${market.vehicles.make}`
                          : market.title.slice(0, 15)}
                        lineValue={market.line_value || 0}
                        yesPercent={yesPercent}
                        noPercent={100 - yesPercent}
                        userPrediction={userBet?.side === 'yes' ? 'over' : userBet?.side === 'no' ? 'under' : undefined}
                        totalPool={pool}
                        onToggle={(side) => handleTogglePrediction(market.id, side)}
                        onExpand={() => setExpandedMarket(market)}
                      />
                    );
                  })}
                  {typeMarkets.length > 20 && (
                    <button
                      onClick={() => setFilter(type as FilterType)}
                      className="px-3 py-2 text-sm text-gray-500 hover:text-white"
                    >
                      +{typeMarkets.length - 20} more
                    </button>
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : (
          // Single category grid
          <div className="flex flex-wrap gap-3">
            {markets.map(market => {
              const pool = market.total_yes_amount + market.total_no_amount;
              const yesPercent = pool > 0 ? (market.total_yes_amount / pool) * 100 : 50;
              const userBet = userBets[market.id];

              return (
                <div key={market.id} className="flex items-center gap-2">
                  {market.vehicles && (
                    <div className="text-xs text-gray-500 max-w-[120px] truncate">
                      {market.vehicles.year} {market.vehicles.make} {market.vehicles.model}
                    </div>
                  )}
                  <PredictionBadge
                    marketId={market.id}
                    title={market.vehicles
                      ? `${market.vehicles.make}`
                      : market.title.slice(0, 12)}
                    lineValue={market.line_value || 0}
                    yesPercent={yesPercent}
                    noPercent={100 - yesPercent}
                    userPrediction={userBet?.side === 'over' ? 'over' : userBet?.side === 'no' ? 'under' : undefined}
                    totalPool={pool}
                    onToggle={(side) => handleTogglePrediction(market.id, side)}
                    onExpand={() => setExpandedMarket(market)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 py-2">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between text-xs text-gray-500">
          <div className="flex gap-4">
            <span>{markets.length} markets</span>
            <span>
              ${(markets.reduce((sum, m) => sum + m.total_yes_amount + m.total_no_amount, 0) / 100).toLocaleString()} total pool
            </span>
          </div>
          <div>
            5% rake • Pari-mutuel
          </div>
        </div>
      </div>

      {/* Expanded Popup */}
      {expandedMarket && (
        <PredictionPopup
          marketId={expandedMarket.id}
          title={expandedMarket.title}
          description={expandedMarket.description}
          lineValue={expandedMarket.line_value || 0}
          yesAmount={expandedMarket.total_yes_amount}
          noAmount={expandedMarket.total_no_amount}
          totalBettors={expandedMarket.total_bettors}
          locksAt={expandedMarket.locks_at}
          userPrediction={
            userBets[expandedMarket.id]?.side === 'yes' ? 'over' :
            userBets[expandedMarket.id]?.side === 'no' ? 'under' : undefined
          }
          userAmount={userBets[expandedMarket.id]?.amount}
          vehicleYear={expandedMarket.vehicles?.year}
          vehicleMake={expandedMarket.vehicles?.make}
          vehicleModel={expandedMarket.vehicles?.model}
          onClose={() => setExpandedMarket(null)}
          onPredict={handlePredict}
        />
      )}
    </div>
  );
}
