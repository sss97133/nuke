/**
 * Performance Metrics Component
 *
 * Displays institutional-grade performance metrics:
 * - Returns (Total, Annualized, IRR, TWR)
 * - Risk (Volatility, VaR, Max Drawdown)
 * - Risk-Adjusted (Sharpe, Sortino, Calmar)
 * - Benchmark Comparison (Alpha, Beta, R-squared)
 */

import React, { useState, useEffect } from 'react';
import { MarketIndexService, AdvancedMetrics, AssetPerformanceMetrics } from '../../services/marketIndexService';

interface PerformanceMetricsProps {
  assetType: 'index' | 'portfolio';
  assetId?: string;
  userId?: string;
  compact?: boolean;
  showBenchmarkComparison?: boolean;
  className?: string;
}

const PERIOD_LABELS: Record<string, string> = {
  '1d': '1 Day',
  '1w': '1 Week',
  '1m': '1 Month',
  '3m': '3 Months',
  '6m': '6 Months',
  'ytd': 'YTD',
  '1y': '1 Year',
  '3y': '3 Years',
  '5y': '5 Years',
  'since_inception': 'Since Inception'
};

function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(decimals)}%`;
}

function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '-';
  return value.toFixed(decimals);
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

export function PerformanceMetrics({
  assetType,
  assetId,
  userId,
  compact = false,
  showBenchmarkComparison = true,
  className = ''
}: PerformanceMetricsProps) {
  const [metrics, setMetrics] = useState<AssetPerformanceMetrics | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('1y');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMetrics() {
      setLoading(true);
      setError(null);

      try {
        if (assetType === 'index' && assetId) {
          const data = await MarketIndexService.getAdvancedMetrics(assetId);
          setMetrics(data);
        }
      } catch (err) {
        console.error('Failed to load metrics:', err);
        setError('Failed to load performance metrics');
      } finally {
        setLoading(false);
      }
    }

    loadMetrics();
  }, [assetType, assetId, userId]);

  if (loading) {
    return (
      <div className={`bg-gray-800 rounded-lg p-4 ${className}`}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-16 bg-gray-700 rounded"></div>
            <div className="h-16 bg-gray-700 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-gray-800 rounded-lg p-4 ${className}`}>
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    );
  }

  if (!metrics || Object.keys(metrics.periods).length === 0) {
    return (
      <div className={`bg-gray-800 rounded-lg p-4 ${className}`}>
        <div className="text-gray-400 text-sm">No performance data available</div>
      </div>
    );
  }

  const availablePeriods = Object.keys(metrics.periods);
  const currentPeriod = metrics.periods[selectedPeriod] || metrics.periods[availablePeriods[0]];

  if (compact) {
    return (
      <CompactMetrics
        metrics={currentPeriod}
        className={className}
      />
    );
  }

  return (
    <div className={`bg-gray-800 rounded-lg p-4 ${className}`}>
      {/* Header with period selector */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Performance Metrics</h3>
        <div className="flex gap-1">
          {availablePeriods.map(period => (
            <button
              key={period}
              onClick={() => setSelectedPeriod(period)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                selectedPeriod === period
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              {PERIOD_LABELS[period] || period}
            </button>
          ))}
        </div>
      </div>

      {/* Returns Section */}
      <div className="mb-6">
        <h4 className="text-sm font-semibold text-gray-400 uppercase mb-2">Returns</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Total Return"
            value={formatPercent(currentPeriod.total_return)}
            isPositive={currentPeriod.total_return >= 0}
          />
          <MetricCard
            label="Annualized Return"
            value={formatPercent(currentPeriod.annualized_return)}
            isPositive={currentPeriod.annualized_return >= 0}
          />
          <MetricCard
            label="TWR"
            value={formatPercent(currentPeriod.twr_return)}
            isPositive={(currentPeriod.twr_return ?? 0) >= 0}
            tooltip="Time-Weighted Return"
          />
          <MetricCard
            label="IRR"
            value={formatPercent(currentPeriod.irr)}
            isPositive={(currentPeriod.irr ?? 0) >= 0}
            tooltip="Internal Rate of Return"
          />
        </div>
      </div>

      {/* Risk Section */}
      <div className="mb-6">
        <h4 className="text-sm font-semibold text-gray-400 uppercase mb-2">Risk</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Volatility"
            value={formatPercent(currentPeriod.volatility_annualized)}
            neutral
            tooltip="Annualized standard deviation of returns"
          />
          <MetricCard
            label="Max Drawdown"
            value={formatPercent(currentPeriod.max_drawdown)}
            isPositive={false}
            tooltip="Maximum peak-to-trough decline"
          />
          <MetricCard
            label="VaR (95%)"
            value={formatCurrency(currentPeriod.var_95_1d)}
            neutral
            tooltip="1-day Value at Risk at 95% confidence"
          />
          <MetricCard
            label="CVaR (95%)"
            value={formatCurrency(currentPeriod.cvar_95_1d)}
            neutral
            tooltip="Expected Shortfall beyond VaR"
          />
        </div>
      </div>

      {/* Risk-Adjusted Returns */}
      <div className="mb-6">
        <h4 className="text-sm font-semibold text-gray-400 uppercase mb-2">Risk-Adjusted Returns</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricCard
            label="Sharpe Ratio"
            value={formatNumber(currentPeriod.sharpe_ratio)}
            isPositive={currentPeriod.sharpe_ratio > 0}
            tooltip="Excess return per unit of volatility"
          />
          <MetricCard
            label="Sortino Ratio"
            value={formatNumber(currentPeriod.sortino_ratio)}
            isPositive={currentPeriod.sortino_ratio > 0}
            tooltip="Excess return per unit of downside risk"
          />
          <MetricCard
            label="Data Points"
            value={currentPeriod.data_points?.toString() || '-'}
            neutral
            tooltip="Number of observations used"
          />
        </div>
      </div>

      {/* Benchmark Comparison */}
      {showBenchmarkComparison && (currentPeriod.alpha !== null || currentPeriod.beta !== null) && (
        <div>
          <h4 className="text-sm font-semibold text-gray-400 uppercase mb-2">vs. Benchmark</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard
              label="Alpha"
              value={formatPercent(currentPeriod.alpha)}
              isPositive={(currentPeriod.alpha ?? 0) >= 0}
              tooltip="Excess return vs benchmark"
            />
            <MetricCard
              label="Beta"
              value={formatNumber(currentPeriod.beta)}
              neutral
              tooltip="Sensitivity to benchmark movements"
            />
            <MetricCard
              label="R-squared"
              value={formatPercent(currentPeriod.r_squared)}
              neutral
              tooltip="Correlation with benchmark"
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
        <span>Last calculated: {metrics.latest_calculation}</span>
        <span>Risk-free rate: 5.00%</span>
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  isPositive?: boolean;
  neutral?: boolean;
  tooltip?: string;
}

function MetricCard({ label, value, isPositive, neutral, tooltip }: MetricCardProps) {
  const valueColor = neutral
    ? 'text-white'
    : isPositive
    ? 'text-green-400'
    : 'text-red-400';

  return (
    <div
      className="bg-gray-900 rounded p-3"
      title={tooltip}
    >
      <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
        {label}
        {tooltip && (
          <span className="text-gray-600 cursor-help">?</span>
        )}
      </div>
      <div className={`text-lg font-mono ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}

interface CompactMetricsProps {
  metrics: AdvancedMetrics;
  className?: string;
}

function CompactMetrics({ metrics, className = '' }: CompactMetricsProps) {
  return (
    <div className={`flex flex-wrap gap-4 text-sm ${className}`}>
      <div>
        <span className="text-gray-400">Return: </span>
        <span className={metrics.total_return >= 0 ? 'text-green-400' : 'text-red-400'}>
          {formatPercent(metrics.total_return)}
        </span>
      </div>
      <div>
        <span className="text-gray-400">Vol: </span>
        <span className="text-white">{formatPercent(metrics.volatility_annualized)}</span>
      </div>
      <div>
        <span className="text-gray-400">Sharpe: </span>
        <span className="text-white">{formatNumber(metrics.sharpe_ratio)}</span>
      </div>
      <div>
        <span className="text-gray-400">Max DD: </span>
        <span className="text-red-400">{formatPercent(metrics.max_drawdown)}</span>
      </div>
      {metrics.alpha !== null && (
        <div>
          <span className="text-gray-400">Alpha: </span>
          <span className={metrics.alpha >= 0 ? 'text-green-400' : 'text-red-400'}>
            {formatPercent(metrics.alpha)}
          </span>
        </div>
      )}
    </div>
  );
}

export default PerformanceMetrics;
