import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Link } from 'react-router-dom';

interface Market {
  id: string;
  title: string;
  description: string;
  line_value: number;
  line_description: string;
  status: string;
  locks_at: string;
  total_yes_amount: number;
  total_no_amount: number;
  total_bettors: number;
  year?: number;
  make?: string;
  model?: string;
}

interface Wallet {
  balance: number;
  total_wagered: number;
  total_won: number;
  bets_won: number;
  bets_lost: number;
}

export default function BettingPage() {
  const { user } = useAuth();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'high-value' | 'closing-soon'>('all');

  useEffect(() => {
    loadMarkets();
    if (user) loadWallet();
  }, [user]);

  async function loadMarkets() {
    const { data } = await supabase
      .from('betting_markets')
      .select('*')
      .eq('status', 'open')
      .order('locks_at', { ascending: true });

    setMarkets(data || []);
    setLoading(false);
  }

  async function loadWallet() {
    const { data } = await supabase
      .from('betting_wallets')
      .select('*')
      .eq('user_id', user?.id)
      .single();

    setWallet(data);
  }

  const filteredMarkets = markets.filter(m => {
    if (filter === 'high-value') return m.line_value >= 100000;
    if (filter === 'closing-soon') {
      const hoursLeft = (new Date(m.locks_at).getTime() - Date.now()) / 3600000;
      return hoursLeft < 24;
    }
    return true;
  });

  const totalPool = markets.reduce((s, m) => s + m.total_yes_amount + m.total_no_amount, 0);

  if (loading) {
    return <div className="p-8 text-center">Loading markets...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold">Mecum Kissimmee 2026</h1>
          <p className="text-gray-600 mt-1">Bet on auction outcomes</p>
        </div>

        {user && wallet && (
          <div className="bg-gray-100 rounded-lg p-4 text-right">
            <div className="text-sm text-gray-600">Your Balance</div>
            <div className="text-2xl font-bold text-green-600">
              ${(wallet.balance / 100).toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {wallet.bets_won}W - {wallet.bets_lost}L
            </div>
          </div>
        )}

        {!user && (
          <Link
            to="/login"
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700"
          >
            Sign in to bet
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border rounded-lg p-4">
          <div className="text-2xl font-bold">{markets.length}</div>
          <div className="text-sm text-gray-600">Open Markets</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-2xl font-bold">${(totalPool / 100).toLocaleString()}</div>
          <div className="text-sm text-gray-600">Total Pool</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-2xl font-bold">Jan 6-18</div>
          <div className="text-sm text-gray-600">Auction Dates</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {(['all', 'high-value', 'closing-soon'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-full text-sm font-medium ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'All Markets' : f === 'high-value' ? '$100k+' : 'Closing Soon'}
          </button>
        ))}
      </div>

      {/* Markets Grid */}
      <div className="grid gap-4">
        {filteredMarkets.map(market => (
          <MarketCard key={market.id} market={market} />
        ))}
      </div>

      {filteredMarkets.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No markets match your filter
        </div>
      )}
    </div>
  );
}

function MarketCard({ market }: { market: Market }) {
  const pool = market.total_yes_amount + market.total_no_amount;
  const yesPercent = pool > 0 ? (market.total_yes_amount / pool) * 100 : 50;
  const noPercent = 100 - yesPercent;

  const locksAt = new Date(market.locks_at);
  const hoursLeft = Math.max(0, (locksAt.getTime() - Date.now()) / 3600000);

  const timeDisplay = hoursLeft < 1
    ? `${Math.round(hoursLeft * 60)}m left`
    : hoursLeft < 24
      ? `${Math.round(hoursLeft)}h left`
      : locksAt.toLocaleDateString();

  return (
    <Link
      to={`/betting/${market.id}`}
      className="block bg-white border rounded-lg p-5 hover:shadow-md transition-shadow"
    >
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h3 className="font-semibold text-lg">{market.title}</h3>
          <p className="text-sm text-gray-600 mt-1">{market.line_description}</p>
        </div>

        <div className="text-right">
          <div className="text-sm text-gray-500">{timeDisplay}</div>
          <div className="text-sm font-medium mt-1">
            ${(pool / 100).toLocaleString()} pool
          </div>
        </div>
      </div>

      {/* Odds bar */}
      <div className="mt-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-green-600 font-medium">OVER {yesPercent.toFixed(0)}%</span>
          <span className="text-red-600 font-medium">UNDER {noPercent.toFixed(0)}%</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden flex">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${yesPercent}%` }}
          />
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${noPercent}%` }}
          />
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        {market.total_bettors} bettor{market.total_bettors !== 1 ? 's' : ''}
      </div>
    </Link>
  );
}
