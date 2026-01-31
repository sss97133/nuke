import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

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
  min_bet: number;
  max_bet: number;
  rake_percent: number;
  vehicle_id?: string;
}

interface Bet {
  id: string;
  side: 'yes' | 'no';
  amount: number;
  status: string;
  potential_payout: number;
  created_at: string;
}

export default function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [market, setMarket] = useState<Market | null>(null);
  const [userBets, setUserBets] = useState<Bet[]>([]);
  const [balance, setBalance] = useState(0);
  const [betAmount, setBetAmount] = useState('');
  const [betSide, setBetSide] = useState<'yes' | 'no'>('yes');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadMarket();
    if (user) {
      loadUserData();
    }
  }, [id, user]);

  async function loadMarket() {
    const { data } = await supabase
      .from('betting_markets')
      .select('*')
      .eq('id', id)
      .single();
    setMarket(data);
  }

  async function loadUserData() {
    // Load wallet
    const { data: wallet } = await supabase
      .from('betting_wallets')
      .select('balance')
      .eq('user_id', user?.id)
      .single();
    setBalance(wallet?.balance || 0);

    // Load user's bets on this market
    const { data: bets } = await supabase
      .from('bets')
      .select('*')
      .eq('market_id', id)
      .eq('user_id', user?.id);
    setUserBets(bets || []);
  }

  async function placeBet() {
    if (!user || !market) return;

    const amount = Math.round(parseFloat(betAmount) * 100);
    if (isNaN(amount) || amount < market.min_bet) {
      setError(`Minimum bet is $${(market.min_bet / 100).toFixed(2)}`);
      return;
    }
    if (amount > market.max_bet) {
      setError(`Maximum bet is $${(market.max_bet / 100).toFixed(2)}`);
      return;
    }
    if (amount > balance) {
      setError('Insufficient balance');
      return;
    }

    setPlacing(true);
    setError('');

    const { data, error: rpcError } = await supabase.rpc('place_bet', {
      p_user_id: user.id,
      p_market_id: market.id,
      p_side: betSide,
      p_amount: amount,
    });

    setPlacing(false);

    if (rpcError || !data?.success) {
      setError(data?.error || rpcError?.message || 'Failed to place bet');
      return;
    }

    // Refresh data
    setBetAmount('');
    loadMarket();
    loadUserData();
  }

  if (!market) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  const pool = market.total_yes_amount + market.total_no_amount;
  const yesPercent = pool > 0 ? (market.total_yes_amount / pool) * 100 : 50;
  const noPercent = 100 - yesPercent;

  // Calculate potential payout
  const betAmountCents = Math.round(parseFloat(betAmount || '0') * 100);
  let potentialPayout = 0;
  if (betAmountCents > 0 && pool > 0) {
    const opposingPool = betSide === 'yes' ? market.total_no_amount : market.total_yes_amount;
    const myPool = betSide === 'yes' ? market.total_yes_amount : market.total_no_amount;
    const shareOfWinnings = (betAmountCents / (myPool + betAmountCents)) * opposingPool;
    potentialPayout = (betAmountCents + shareOfWinnings) * (1 - market.rake_percent / 100);
  }

  const isLocked = new Date(market.locks_at) < new Date();

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Link to="/betting" className="text-blue-600 hover:underline mb-4 block">
        ← Back to markets
      </Link>

      <div className="bg-white border rounded-lg p-6">
        <h1 className="text-2xl font-bold">{market.title}</h1>
        <p className="text-gray-600 mt-2">{market.description}</p>

        {/* Status */}
        <div className="mt-4 flex items-center gap-4 text-sm">
          <span className={`px-3 py-1 rounded-full ${
            market.status === 'open' ? 'bg-green-100 text-green-800' :
            market.status === 'locked' ? 'bg-yellow-100 text-yellow-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {market.status.toUpperCase()}
          </span>
          <span className="text-gray-500">
            {isLocked ? 'Locked' : `Locks ${new Date(market.locks_at).toLocaleString()}`}
          </span>
        </div>

        {/* Odds display */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <button
            onClick={() => setBetSide('yes')}
            className={`p-4 rounded-lg border-2 transition ${
              betSide === 'yes'
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 hover:border-green-300'
            }`}
          >
            <div className="text-lg font-bold text-green-600">OVER</div>
            <div className="text-3xl font-bold">{yesPercent.toFixed(0)}%</div>
            <div className="text-sm text-gray-500">
              ${(market.total_yes_amount / 100).toLocaleString()} wagered
            </div>
          </button>

          <button
            onClick={() => setBetSide('no')}
            className={`p-4 rounded-lg border-2 transition ${
              betSide === 'no'
                ? 'border-red-500 bg-red-50'
                : 'border-gray-200 hover:border-red-300'
            }`}
          >
            <div className="text-lg font-bold text-red-600">UNDER</div>
            <div className="text-3xl font-bold">{noPercent.toFixed(0)}%</div>
            <div className="text-sm text-gray-500">
              ${(market.total_no_amount / 100).toLocaleString()} wagered
            </div>
          </button>
        </div>

        {/* Bet form */}
        {user && !isLocked && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bet Amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">$</span>
                  <input
                    type="number"
                    value={betAmount}
                    onChange={e => setBetAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-2 border rounded-lg"
                    min={market.min_bet / 100}
                    max={market.max_bet / 100}
                    step="0.01"
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Balance: ${(balance / 100).toFixed(2)} •
                  Min: ${(market.min_bet / 100).toFixed(2)} •
                  Max: ${(market.max_bet / 100).toFixed(2)}
                </div>
              </div>

              <button
                onClick={placeBet}
                disabled={placing || !betAmount}
                className={`px-6 py-3 rounded-lg font-semibold ${
                  betSide === 'yes'
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                } disabled:opacity-50`}
              >
                {placing ? 'Placing...' : `Bet ${betSide === 'yes' ? 'OVER' : 'UNDER'}`}
              </button>
            </div>

            {betAmountCents > 0 && (
              <div className="mt-3 text-sm text-gray-600">
                Potential payout: <span className="font-bold text-green-600">
                  ${(potentialPayout / 100).toFixed(2)}
                </span>
                <span className="text-gray-400 ml-1">({market.rake_percent}% rake)</span>
              </div>
            )}

            {error && (
              <div className="mt-3 text-sm text-red-600">{error}</div>
            )}
          </div>
        )}

        {!user && (
          <div className="mt-6 p-4 bg-blue-50 rounded-lg text-center">
            <Link to="/login" className="text-blue-600 font-semibold hover:underline">
              Sign in to place bets
            </Link>
          </div>
        )}

        {isLocked && (
          <div className="mt-6 p-4 bg-yellow-50 rounded-lg text-center text-yellow-800">
            Betting is closed for this market
          </div>
        )}

        {/* User's bets */}
        {userBets.length > 0 && (
          <div className="mt-6">
            <h3 className="font-semibold mb-3">Your Bets</h3>
            <div className="space-y-2">
              {userBets.map(bet => (
                <div
                  key={bet.id}
                  className="flex justify-between items-center p-3 bg-gray-50 rounded"
                >
                  <div>
                    <span className={`font-medium ${
                      bet.side === 'yes' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {bet.side === 'yes' ? 'OVER' : 'UNDER'}
                    </span>
                    <span className="text-gray-600 ml-2">
                      ${(bet.amount / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">
                    {bet.status === 'active' ? 'Active' : bet.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Market info */}
        <div className="mt-6 pt-6 border-t text-sm text-gray-500">
          <div>Total pool: ${(pool / 100).toLocaleString()}</div>
          <div>Bettors: {market.total_bettors}</div>
          <div>House rake: {market.rake_percent}%</div>
        </div>
      </div>
    </div>
  );
}
