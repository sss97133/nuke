/**
 * Institutional Dashboard
 *
 * Portfolio view with institutional-grade metrics:
 * - IRR, TWR, Sharpe, Sortino
 * - VaR and CVaR
 * - Benchmark comparison (Alpha, Beta)
 * - Performance attribution
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { usePlatformStatus } from '../../hooks/usePlatformStatus';
import { MarketIndexService } from '../../services/marketIndexService';
import { PerformanceMetrics } from './PerformanceMetrics';

interface PortfolioMetrics {
  total_value: number;
  cash_balance: number;
  invested_value: number;
  return_1d: number | null;
  return_1m: number | null;
  return_ytd: number | null;
  return_1y: number | null;
  portfolio_volatility: number | null;
  portfolio_sharpe: number | null;
  portfolio_var_95: number | null;
}

interface Holding {
  id: string;
  type: 'index' | 'vehicle';
  name: string;
  code?: string;
  shares: number;
  cost_basis: number;
  current_value: number;
  gain_loss: number;
  gain_loss_pct: number;
  weight: number;
}

interface InstitutionalDashboardProps {
  userId: string;
  className?: string;
}

export function InstitutionalDashboard({ userId, className = '' }: InstitutionalDashboardProps) {
  const { isDemoMode, logMetric } = usePlatformStatus();
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<'1d' | '1m' | '3m' | 'ytd' | '1y'>('1m');
  const [activeView, setActiveView] = useState<'overview' | 'holdings' | 'metrics'>('overview');

  useEffect(() => {
    loadPortfolioData();
    logMetric('dashboard_viewed', 'portfolio', userId);
  }, [userId, logMetric]);

  async function loadPortfolioData() {
    setLoading(true);
    try {
      // Get portfolio summary
      const { data: portfolioData } = await supabase
        .rpc('get_portfolio_summary', { p_user_id: userId });

      if (portfolioData) {
        const totalValue = portfolioData.total_portfolio_value || 0;
        setHoldings(
          (portfolioData.holdings || []).map((h: any) => ({
            ...h,
            weight: totalValue > 0 ? (h.current_value / totalValue) * 100 : 0
          }))
        );
      }

      // Get advanced metrics
      const { data: metricsData } = await supabase
        .from('user_portfolio_metrics')
        .select('*')
        .eq('user_id', userId)
        .order('calculation_date', { ascending: false })
        .limit(1)
        .single();

      if (metricsData) {
        setMetrics(metricsData);
      } else if (portfolioData) {
        // Fallback to basic metrics
        setMetrics({
          total_value: portfolioData.total_portfolio_value,
          cash_balance: portfolioData.cash_balance,
          invested_value: portfolioData.total_current_value,
          return_1d: null,
          return_1m: null,
          return_ytd: null,
          return_1y: null,
          portfolio_volatility: null,
          portfolio_sharpe: null,
          portfolio_var_95: null
        });
      }
    } catch (error) {
      console.error('Error loading portfolio data:', error);
    }
    setLoading(false);
  }

  function formatCurrency(value: number | null): string {
    if (value === null) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  function formatPercent(value: number | null, decimals = 2): string {
    if (value === null) return '-';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${(value * 100).toFixed(decimals)}%`;
  }

  if (loading) {
    return (
      <div className={`bg-gray-800 rounded-lg p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-700 rounded w-1/3"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Portfolio Dashboard</h2>
          <p className="text-gray-400 text-sm">
            Institutional-grade analytics
            {isDemoMode && <span className="text-amber-400 ml-2">(Demo Mode)</span>}
          </p>
        </div>

        <div className="flex gap-2">
          {(['overview', 'holdings', 'metrics'] as const).map(view => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`px-4 py-2 rounded text-sm ${
                activeView === view
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              {view.charAt(0).toUpperCase() + view.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Portfolio Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Portfolio Value"
          value={formatCurrency(metrics?.total_value || 0)}
          className="bg-gray-800"
        />
        <MetricCard
          label="Cash Balance"
          value={formatCurrency(metrics?.cash_balance || 0)}
          className="bg-gray-800"
        />
        <MetricCard
          label="Invested"
          value={formatCurrency(metrics?.invested_value || 0)}
          className="bg-gray-800"
        />
        <MetricCard
          label={`Return (${selectedPeriod.toUpperCase()})`}
          value={formatPercent(
            selectedPeriod === '1d' ? metrics?.return_1d :
            selectedPeriod === '1m' ? metrics?.return_1m :
            selectedPeriod === 'ytd' ? metrics?.return_ytd :
            metrics?.return_1y
          )}
          valueColor={
            ((selectedPeriod === '1d' ? metrics?.return_1d :
              selectedPeriod === '1m' ? metrics?.return_1m :
              metrics?.return_ytd) || 0) >= 0
              ? 'text-green-400'
              : 'text-red-400'
          }
          className="bg-gray-800"
        />
      </div>

      {/* Period selector */}
      <div className="flex gap-2 mb-6">
        {(['1d', '1m', '3m', 'ytd', '1y'] as const).map(period => (
          <button
            key={period}
            onClick={() => setSelectedPeriod(period)}
            className={`px-3 py-1 rounded text-sm ${
              selectedPeriod === period
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:text-white'
            }`}
          >
            {period.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Active view content */}
      {activeView === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Risk Metrics */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Risk Metrics</h3>
            <div className="grid grid-cols-2 gap-4">
              <MetricCard
                label="Volatility"
                value={formatPercent(metrics?.portfolio_volatility)}
                small
              />
              <MetricCard
                label="Sharpe Ratio"
                value={metrics?.portfolio_sharpe?.toFixed(2) || '-'}
                small
              />
              <MetricCard
                label="VaR (95%)"
                value={formatCurrency(metrics?.portfolio_var_95)}
                small
              />
              <MetricCard
                label="Max Drawdown"
                value="-"
                small
              />
            </div>
          </div>

          {/* Allocation Chart */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Allocation</h3>
            <div className="space-y-2">
              {holdings.slice(0, 5).map(holding => (
                <div key={holding.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-white">{holding.code || holding.name}</span>
                      <span className="text-gray-400">{holding.weight.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${holding.weight}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {holdings.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">
                  No holdings yet
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeView === 'holdings' && (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-900">
              <tr className="text-left text-gray-400 text-sm">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3 text-right">Shares</th>
                <th className="px-4 py-3 text-right">Cost Basis</th>
                <th className="px-4 py-3 text-right">Current Value</th>
                <th className="px-4 py-3 text-right">Gain/Loss</th>
                <th className="px-4 py-3 text-right">Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {holdings.map(holding => (
                <tr key={holding.id} className="hover:bg-gray-750">
                  <td className="px-4 py-3">
                    <div>
                      <div className="text-white font-medium">{holding.code || holding.name}</div>
                      <div className="text-gray-400 text-sm">{holding.name}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white">
                    {holding.shares.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">
                    {formatCurrency(holding.cost_basis)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white">
                    {formatCurrency(holding.current_value)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${
                    holding.gain_loss >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {formatCurrency(holding.gain_loss)} ({formatPercent(holding.gain_loss_pct / 100)})
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">
                    {holding.weight.toFixed(1)}%
                  </td>
                </tr>
              ))}
              {holdings.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    No holdings yet. Start investing to build your portfolio.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeView === 'metrics' && (
        <div className="space-y-6">
          {holdings.filter(h => h.type === 'index').map(holding => (
            <div key={holding.id}>
              <h3 className="text-lg font-semibold text-white mb-3">
                {holding.code} - {holding.name}
              </h3>
              <PerformanceMetrics
                assetType="index"
                assetId={holding.id}
                showBenchmarkComparison
              />
            </div>
          ))}
          {holdings.filter(h => h.type === 'index').length === 0 && (
            <div className="bg-gray-800 rounded-lg p-8 text-center">
              <p className="text-gray-400">
                No index holdings to display metrics for.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Footer disclaimer */}
      <div className="mt-6 text-gray-500 text-xs">
        <p>
          Performance metrics are calculated using industry-standard methodologies.
          Past performance does not guarantee future results.
          {isDemoMode && ' All values shown are simulated for demonstration purposes.'}
        </p>
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  valueColor?: string;
  className?: string;
  small?: boolean;
}

function MetricCard({ label, value, valueColor = 'text-white', className = '', small = false }: MetricCardProps) {
  return (
    <div className={`rounded-lg p-4 ${className || 'bg-gray-900'}`}>
      <div className={`text-gray-400 ${small ? 'text-xs' : 'text-sm'}`}>{label}</div>
      <div className={`font-mono ${valueColor} ${small ? 'text-lg' : 'text-2xl'}`}>{value}</div>
    </div>
  );
}

export default InstitutionalDashboard;
