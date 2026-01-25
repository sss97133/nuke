import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { usePlatformStatus } from '../hooks/usePlatformStatus';
import { DemoWatermark } from '../components/compliance/DemoModeBanner';

interface Index {
  id: string;
  code: string;
  name: string;
  description: string;
  current_price: number;
  volume: number;
  as_of: string;
  metadata: any;
}

interface Holding {
  id: string;
  type: 'index' | 'vehicle';
  index_code?: string;
  index_name?: string;
  vehicle_name?: string;
  shares: number;
  cost_basis: number;
  current_value: number;
  gain_loss: number;
  gain_loss_pct: number;
}

interface Portfolio {
  cash_balance: number;
  total_invested: number;
  total_current_value: number;
  total_gain_loss: number;
  total_gain_loss_pct: number;
  total_portfolio_value: number;
  holdings: Holding[];
}

interface Transaction {
  id: string;
  type: string;
  asset: { type: string; code?: string; name: string } | null;
  shares: number;
  price_per_share: number;
  total_amount: number;
  fee: number;
  balance_after: number;
  status: string;
  timestamp: string;
}

export default function Invest() {
  const [indexes, setIndexes] = useState<Index[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'indexes' | 'portfolio' | 'history'>('indexes');
  const [selectedIndex, setSelectedIndex] = useState<Index | null>(null);
  const [tradeModal, setTradeModal] = useState<{
    open: boolean;
    action: 'buy' | 'sell';
    index: Index | null;
  }>({ open: false, action: 'buy', index: null });
  const [tradeAmount, setTradeAmount] = useState('');
  const [trading, setTrading] = useState(false);
  const [drilldown, setDrilldown] = useState<{ type: string; data: any } | null>(null);

  // Platform status for demo mode
  const { isDemoMode, logMetric } = usePlatformStatus();

  // Log page view on mount
  useEffect(() => {
    logMetric('page_viewed', 'invest', undefined, { tab: 'indexes' });
  }, [logMetric]);

  // Log tab changes
  useEffect(() => {
    logMetric('tab_changed', 'invest', undefined, { tab: activeTab });
  }, [activeTab, logMetric]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [indexRes, portfolioRes, historyRes] = await Promise.all([
        supabase.functions.invoke('trading', { body: null, method: 'GET' }),
        supabase.functions.invoke('trading', { body: null, method: 'GET' }),
        supabase.functions.invoke('trading', { body: null, method: 'GET' })
      ].map((_, i) => {
        const action = ['indexes', 'portfolio', 'history'][i];
        return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trading?action=${action}`, {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          }
        }).then(r => r.json());
      }));

      if (indexRes.indexes) setIndexes(indexRes.indexes);
      if (portfolioRes.portfolio) setPortfolio(portfolioRes.portfolio);
      if (historyRes.transactions) setTransactions(historyRes.transactions);
    } catch (e) {
      console.error('Failed to load data:', e);
    }
    setLoading(false);
  }

  async function executeTrade() {
    if (!tradeModal.index || !tradeAmount) return;

    // Log trade attempt
    logMetric('trade_attempted', 'index', tradeModal.index.id, {
      action: tradeModal.action,
      amount: parseFloat(tradeAmount),
      index_code: tradeModal.index.code,
      is_demo: isDemoMode,
    });

    setTrading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trading`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: tradeModal.action,
          index_id: tradeModal.index.id,
          amount: parseFloat(tradeAmount)
        })
      });

      const result = await response.json();

      if (result.success) {
        // Log successful trade
        logMetric('trade_completed', 'index', tradeModal.index.id, {
          action: tradeModal.action,
          amount: parseFloat(tradeAmount),
          shares: result.shares,
          is_demo: isDemoMode,
        });
        setPortfolio(result.portfolio);
        setTradeModal({ open: false, action: 'buy', index: null });
        setTradeAmount('');
        loadData(); // Refresh all data
      } else {
        // Log failed trade
        logMetric('trade_failed', 'index', tradeModal.index.id, {
          action: tradeModal.action,
          error: result.error,
          is_demo: isDemoMode,
        });
        alert(result.error || 'Trade failed');
      }
    } catch (e: any) {
      logMetric('trade_error', 'index', tradeModal.index?.id, {
        error: e.message,
        is_demo: isDemoMode,
      });
      alert(e.message);
    }
    setTrading(false);
  }

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  function formatPct(value: number): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  }

  async function showIndexDrilldown(index: Index) {
    // Log index view
    logMetric('index_viewed', 'index', index.id, {
      index_code: index.code,
      index_name: index.name,
    });

    // Fetch the components that make up this index
    try {
      const { data } = await supabase
        .from('index_components_snapshot')
        .select('*, vehicles(year, make, model, discovery_url)')
        .eq('index_id', index.id)
        .order('price', { ascending: false })
        .limit(50);

      setDrilldown({
        type: 'index',
        data: {
          index,
          components: data || [],
          methodology: index.metadata
        }
      });
    } catch (e) {
      // If no components snapshot, show the index metadata
      setDrilldown({
        type: 'index',
        data: {
          index,
          components: [],
          methodology: index.metadata
        }
      });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="animate-pulse">Loading investment platform...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Demo watermark overlay */}
      {isDemoMode && <DemoWatermark />}

      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Squarebody Investment Platform</h1>
            {isDemoMode && (
              <span className="bg-amber-500 text-black text-xs font-bold px-2 py-1 rounded">
                DEMO
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm mt-1">
            {isDemoMode ? 'Paper trading' : 'Live trading'} • Full transparency • Every number is auditable
          </p>
        </div>
      </div>

      {/* Portfolio Summary Bar */}
      {portfolio && (
        <div className="border-b border-gray-800 bg-gray-950/50">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <div className="text-gray-400 text-xs uppercase">Cash</div>
                <div className="text-xl font-mono">{formatCurrency(portfolio.cash_balance)}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs uppercase">Invested</div>
                <div className="text-xl font-mono">{formatCurrency(portfolio.total_current_value)}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs uppercase">Total Value</div>
                <div className="text-xl font-mono">{formatCurrency(portfolio.total_portfolio_value)}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs uppercase">Gain/Loss</div>
                <div className={`text-xl font-mono ${portfolio.total_gain_loss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(portfolio.total_gain_loss)}
                </div>
              </div>
              <div>
                <div className="text-gray-400 text-xs uppercase">Return</div>
                <div className={`text-xl font-mono ${portfolio.total_gain_loss_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatPct(portfolio.total_gain_loss_pct)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-4">
            {(['indexes', 'portfolio', 'history'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 px-1 border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                {tab === 'indexes' ? 'Market Indexes' : tab === 'portfolio' ? 'My Holdings' : 'Transaction History'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'indexes' && (
          <div className="space-y-4">
            <p className="text-gray-400 text-sm">
              Click any index to see its components. Click "Buy" to invest.
            </p>
            <div className="grid gap-4">
              {indexes.map(index => (
                <div
                  key={index.id}
                  className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors cursor-pointer"
                  onClick={() => showIndexDrilldown(index)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-blue-400">{index.code}</span>
                        <span className="text-gray-300">{index.name}</span>
                      </div>
                      <p className="text-gray-500 text-sm mt-1">{index.description}</p>
                      <div className="flex gap-4 mt-2 text-sm">
                        <span className="text-gray-400">
                          Volume: <span className="text-white">{index.volume}</span> vehicles
                        </span>
                        <span className="text-gray-400">
                          As of: <span className="text-white">{index.as_of}</span>
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-mono">{formatCurrency(index.current_price)}</div>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTradeModal({ open: true, action: 'buy', index });
                          }}
                          className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm"
                        >
                          Buy
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            showIndexDrilldown(index);
                          }}
                          className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'portfolio' && portfolio && (
          <div className="space-y-4">
            {portfolio.holdings.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p>No holdings yet</p>
                <button
                  onClick={() => setActiveTab('indexes')}
                  className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
                >
                  Browse Indexes
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {portfolio.holdings.map(holding => (
                  <div key={holding.id} className="bg-gray-800 rounded-lg p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-mono text-blue-400">
                          {holding.index_code || holding.vehicle_name}
                        </div>
                        <div className="text-gray-400 text-sm">
                          {holding.index_name}
                        </div>
                        <div className="text-gray-500 text-sm mt-1">
                          {holding.shares.toFixed(4)} shares @ {formatCurrency(holding.cost_basis / holding.shares)} avg
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-mono">{formatCurrency(holding.current_value)}</div>
                        <div className={`text-sm ${holding.gain_loss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatCurrency(holding.gain_loss)} ({formatPct(holding.gain_loss_pct)})
                        </div>
                        <button
                          onClick={() => {
                            const idx = indexes.find(i => i.id === holding.index_code);
                            if (idx) {
                              setTradeModal({ open: true, action: 'sell', index: idx });
                            }
                          }}
                          className="mt-2 px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm"
                        >
                          Sell
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-2">
            {transactions.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                No transactions yet
              </div>
            ) : (
              <table className="w-full">
                <thead className="text-left text-gray-400 text-sm">
                  <tr>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Asset</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {transactions.map(tx => (
                    <tr key={tx.id} className="border-t border-gray-800">
                      <td className="py-2 text-gray-400">
                        {new Date(tx.timestamp).toLocaleDateString()}
                      </td>
                      <td className={`py-2 ${
                        tx.type === 'buy' ? 'text-green-400' :
                        tx.type === 'sell' ? 'text-red-400' :
                        tx.type === 'deposit' ? 'text-blue-400' : 'text-gray-400'
                      }`}>
                        {tx.type.toUpperCase()}
                      </td>
                      <td className="py-2">
                        {tx.asset?.code || tx.asset?.name || '-'}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {formatCurrency(tx.total_amount)}
                      </td>
                      <td className="py-2 text-right font-mono text-gray-400">
                        {formatCurrency(tx.balance_after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Trade Modal */}
      {tradeModal.open && tradeModal.index && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            {/* Demo indicator in modal */}
            {isDemoMode && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2 mb-4 flex items-center gap-2">
                <span className="bg-amber-500 text-black text-xs font-bold px-1.5 py-0.5 rounded">DEMO</span>
                <span className="text-amber-400 text-sm">This is a simulated trade. No real money.</span>
              </div>
            )}
            <h3 className="text-xl font-bold mb-4">
              {tradeModal.action === 'buy' ? 'Buy' : 'Sell'} {tradeModal.index.code}
            </h3>
            <div className="space-y-4">
              <div>
                <div className="text-gray-400 text-sm">Current Price</div>
                <div className="text-2xl font-mono">{formatCurrency(tradeModal.index.current_price)}</div>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Amount (USD)</label>
                <input
                  type="number"
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(e.target.value)}
                  placeholder="1000"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
                />
              </div>
              {tradeAmount && (
                <div className="text-gray-400 text-sm">
                  ≈ {(parseFloat(tradeAmount) / tradeModal.index.current_price).toFixed(4)} shares
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setTradeModal({ open: false, action: 'buy', index: null })}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={executeTrade}
                  disabled={trading || !tradeAmount}
                  className={`flex-1 px-4 py-2 rounded ${
                    tradeModal.action === 'buy'
                      ? 'bg-green-600 hover:bg-green-500'
                      : 'bg-red-600 hover:bg-red-500'
                  } disabled:opacity-50`}
                >
                  {trading ? 'Processing...' : `${tradeModal.action === 'buy' ? 'Buy' : 'Sell'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drilldown Modal */}
      {drilldown && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 overflow-auto">
          <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full mx-4 my-8 max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-bold">{drilldown.data.index.name}</h3>
                <div className="text-gray-400 text-sm">{drilldown.data.index.code}</div>
              </div>
              <button
                onClick={() => setDrilldown(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              {/* Index Value */}
              <div className="bg-gray-900 rounded p-4">
                <div className="text-gray-400 text-sm">Current Value</div>
                <div className="text-3xl font-mono">{formatCurrency(drilldown.data.index.current_price)}</div>
                <div className="text-gray-500 text-sm mt-1">
                  Based on {drilldown.data.index.volume} component vehicles
                </div>
              </div>

              {/* Methodology */}
              {drilldown.data.methodology && (
                <div>
                  <h4 className="font-bold mb-2">Calculation Methodology</h4>
                  <div className="bg-gray-900 rounded p-4 text-sm font-mono">
                    <pre className="whitespace-pre-wrap">
                      {JSON.stringify(drilldown.data.methodology, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Components */}
              {drilldown.data.components.length > 0 && (
                <div>
                  <h4 className="font-bold mb-2">Component Vehicles</h4>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {drilldown.data.components.map((comp: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-gray-900 rounded p-2 text-sm">
                        <div>
                          <span className="text-white">
                            {comp.vehicles?.year} {comp.vehicles?.make} {comp.vehicles?.model}
                          </span>
                          {comp.vehicles?.discovery_url && (
                            <a
                              href={comp.vehicles.discovery_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-blue-400 hover:underline"
                            >
                              Source →
                            </a>
                          )}
                        </div>
                        <div className="font-mono">{formatCurrency(comp.price)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-gray-500 text-xs">
                All data sourced from verified auctions and dealer listings.
                Click source links to verify individual transactions.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
