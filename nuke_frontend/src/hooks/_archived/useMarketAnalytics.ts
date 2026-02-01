/**
 * Market Analytics Hook
 *
 * Fetches and caches market analytics data for an offering.
 * Provides VWAP, TWAP, volatility, market impact, and momentum indicators.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase, getSupabaseFunctionsUrl } from '../lib/supabase';

export type Timeframe = '1h' | '4h' | '1d' | '7d' | '30d';

export interface PriceMetrics {
  current_price: number | null;
  vwap: number | null;
  twap: number | null;
  high: number | null;
  low: number | null;
  price_change: number | null;
  price_change_pct: number | null;
}

export interface VolumeMetrics {
  total_volume: number;
  trade_count: number;
  average_daily_volume: number;
  average_trade_size: number;
}

export interface RiskMetrics {
  volatility_annualized: number | null;
  volatility_daily: number | null;
  high_low_range: number | null;
}

export interface MomentumIndicators {
  momentum_pct: number | null;
  rsi: number | null;
}

export interface MarketImpact {
  shares: number;
  impact_pct: number;
}

export interface LiquidityMetrics {
  bid_ask_spread: number | null;
  bid_ask_spread_pct: number | null;
  bid_depth: number;
  ask_depth: number;
  estimated_market_impact: {
    small: MarketImpact;
    medium: MarketImpact;
    large: MarketImpact;
  };
}

export interface TradingAnalytics {
  offering_id: string;
  timeframe: string;
  period: {
    start: string;
    end: string;
  };
  price_metrics: PriceMetrics;
  volume_metrics: VolumeMetrics;
  risk_metrics: RiskMetrics;
  momentum_indicators: MomentumIndicators;
  liquidity_metrics: LiquidityMetrics;
}

interface UseMarketAnalyticsState {
  analytics: TradingAnalytics | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

interface UseMarketAnalyticsOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;  // in milliseconds
}

export function useMarketAnalytics(
  offeringId: string | null,
  timeframe: Timeframe = '1d',
  options: UseMarketAnalyticsOptions = {}
): UseMarketAnalyticsState & {
  refresh: () => Promise<void>;
  setTimeframe: (tf: Timeframe) => void;
} {
  const { autoRefresh = false, refreshInterval = 60000 } = options;

  const [state, setState] = useState<UseMarketAnalyticsState>({
    analytics: null,
    loading: false,
    error: null,
    lastUpdated: null,
  });

  const [currentTimeframe, setCurrentTimeframe] = useState<Timeframe>(timeframe);

  const fetchAnalytics = useCallback(async () => {
    if (!offeringId) {
      setState(prev => ({ ...prev, analytics: null, loading: false }));
      return;
    }

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      const response = await fetch(
        `${getSupabaseFunctionsUrl()}/market-analytics?type=trading&offering_id=${offeringId}&timeframe=${currentTimeframe}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch analytics');
      }

      setState({
        analytics: data as TradingAnalytics,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (err) {
      console.error('Failed to fetch market analytics:', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: (err as Error).message,
      }));
    }
  }, [offeringId, currentTimeframe]);

  // Initial fetch
  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !offeringId) return;

    const interval = setInterval(fetchAnalytics, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchAnalytics, offeringId]);

  const handleSetTimeframe = useCallback((tf: Timeframe) => {
    setCurrentTimeframe(tf);
  }, []);

  return {
    ...state,
    refresh: fetchAnalytics,
    setTimeframe: handleSetTimeframe,
  };
}

/**
 * Helper function to format analytics values for display
 */
export const formatAnalyticsValue = (
  value: number | null | undefined,
  type: 'currency' | 'percent' | 'number' | 'volume' = 'number',
  decimals: number = 2
): string => {
  if (value === null || value === undefined) return '-';

  switch (type) {
    case 'currency':
      return `$${value.toFixed(decimals)}`;
    case 'percent':
      return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
    case 'volume':
      return value.toLocaleString();
    default:
      return value.toFixed(decimals);
  }
};

/**
 * Get a simple trading signal based on analytics
 */
export const getTradeSignal = (
  analytics: TradingAnalytics | null
): { signal: 'buy' | 'sell' | 'hold'; strength: 'strong' | 'moderate' | 'weak'; reasons: string[] } => {
  if (!analytics) {
    return { signal: 'hold', strength: 'weak', reasons: ['No data available'] };
  }

  const reasons: string[] = [];
  let buyScore = 0;
  let sellScore = 0;

  const { price_metrics, momentum_indicators, risk_metrics } = analytics;

  // VWAP comparison
  if (price_metrics.current_price && price_metrics.vwap) {
    if (price_metrics.current_price < price_metrics.vwap * 0.98) {
      buyScore += 2;
      reasons.push('Price below VWAP (potential value)');
    } else if (price_metrics.current_price > price_metrics.vwap * 1.02) {
      sellScore += 2;
      reasons.push('Price above VWAP (potentially overbought)');
    }
  }

  // RSI
  if (momentum_indicators.rsi !== null) {
    if (momentum_indicators.rsi < 30) {
      buyScore += 3;
      reasons.push(`RSI oversold (${momentum_indicators.rsi.toFixed(0)})`);
    } else if (momentum_indicators.rsi > 70) {
      sellScore += 3;
      reasons.push(`RSI overbought (${momentum_indicators.rsi.toFixed(0)})`);
    }
  }

  // Momentum
  if (momentum_indicators.momentum_pct !== null) {
    if (momentum_indicators.momentum_pct < -5) {
      buyScore += 1;
      reasons.push('Negative momentum (potential reversal)');
    } else if (momentum_indicators.momentum_pct > 5) {
      sellScore += 1;
      reasons.push('Strong positive momentum');
    }
  }

  // Volatility consideration
  if (risk_metrics.volatility_annualized !== null && risk_metrics.volatility_annualized > 50) {
    reasons.push('High volatility - consider smaller position size');
  }

  const netScore = buyScore - sellScore;
  let signal: 'buy' | 'sell' | 'hold';
  let strength: 'strong' | 'moderate' | 'weak';

  if (netScore >= 3) {
    signal = 'buy';
    strength = netScore >= 5 ? 'strong' : 'moderate';
  } else if (netScore <= -3) {
    signal = 'sell';
    strength = netScore <= -5 ? 'strong' : 'moderate';
  } else {
    signal = 'hold';
    strength = 'weak';
  }

  if (reasons.length === 0) {
    reasons.push('No strong signals detected');
  }

  return { signal, strength, reasons };
};

export default useMarketAnalytics;
