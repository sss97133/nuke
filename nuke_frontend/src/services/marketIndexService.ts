/**
 * Market Index Service
 *
 * Handles all interactions with the Market Intelligence system:
 * - Fetch market indexes and their current values
 * - Get historical index data (time series)
 * - Retrieve index components and composition
 * - Track index performance over time
 */

import { supabase } from '../lib/supabase';

// =====================================================
// TYPES
// =====================================================

export interface MarketIndex {
  id: string;
  index_code: string;
  index_name: string;
  description: string | null;
  calculation_method: any;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MarketIndexValue {
  id: string;
  index_id: string;
  value_date: string;
  open_value: number | null;
  close_value: number | null;
  high_value: number | null;
  low_value: number | null;
  volume: number | null;
  components_snapshot: any;
  calculation_metadata: any;
  created_at: string;
}

export interface IndexWithLatestValue extends MarketIndex {
  latest_value: number | null;
  latest_date: string | null;
  change_1d: number | null;
  change_7d: number | null;
  change_30d: number | null;
}

export interface IndexComponent {
  id: string;
  index_id: string;
  component_type: string;
  component_filter: any;
  weight: number;
  added_at: string;
  is_active: boolean;
}

export interface IndexPerformance {
  index_code: string;
  index_name: string;
  current_value: number;
  change_1d: number;
  change_7d: number;
  change_30d: number;
  volume_7d: number;
  trend: 'up' | 'down' | 'flat';
  history: MarketIndexValue[];
}

export interface AdvancedMetrics {
  period: string;
  total_return: number;
  annualized_return: number;
  twr_return: number | null;
  irr: number | null;
  volatility_annualized: number;
  max_drawdown: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  var_95_1d: number;
  cvar_95_1d: number;
  alpha: number | null;
  beta: number | null;
  r_squared: number | null;
  data_points: number;
}

export interface AssetPerformanceMetrics {
  latest_calculation: string;
  periods: Record<string, AdvancedMetrics>;
}

// =====================================================
// MARKET INDEX SERVICE
// =====================================================

export class MarketIndexService {
  /**
   * Get all active market indexes
   */
  static async getIndexes(): Promise<MarketIndex[]> {
    try {
      const { data, error } = await supabase
        .from('market_indexes')
        .select('*')
        .eq('is_active', true)
        .order('index_code');

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching market indexes:', error);
      throw error;
    }
  }

  /**
   * Get a specific index by code
   */
  static async getIndexByCode(indexCode: string): Promise<MarketIndex | null> {
    try {
      const { data, error } = await supabase
        .from('market_indexes')
        .select('*')
        .eq('index_code', indexCode)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error fetching index by code:', error);
      throw error;
    }
  }

  /**
   * Get latest values for all indexes
   */
  static async getLatestIndexValues(): Promise<IndexWithLatestValue[]> {
    try {
      // Get all indexes
      const indexes = await this.getIndexes();

      // Get latest value for each index
      const indexesWithValues = await Promise.all(
        indexes.map(async (index) => {
          const latestValue = await this.getLatestValue(index.id);
          const history = await this.getIndexHistory(index.id, 30);

          // Calculate changes
          const change1d = this.calculateChange(history, 1);
          const change7d = this.calculateChange(history, 7);
          const change30d = this.calculateChange(history, 30);

          return {
            ...index,
            latest_value: latestValue?.close_value || null,
            latest_date: latestValue?.value_date || null,
            change_1d: change1d,
            change_7d: change7d,
            change_30d: change30d
          };
        })
      );

      return indexesWithValues;
    } catch (error) {
      console.error('Error fetching latest index values:', error);
      throw error;
    }
  }

  /**
   * Get latest value for a specific index
   */
  static async getLatestValue(indexId: string): Promise<MarketIndexValue | null> {
    try {
      const { data, error } = await supabase
        .from('market_index_values')
        .select('*')
        .eq('index_id', indexId)
        .order('value_date', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error fetching latest index value:', error);
      throw error;
    }
  }

  /**
   * Get index history for a given number of days
   */
  static async getIndexHistory(
    indexId: string,
    days: number = 30
  ): Promise<MarketIndexValue[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('market_index_values')
        .select('*')
        .eq('index_id', indexId)
        .gte('value_date', startDate.toISOString().split('T')[0])
        .order('value_date', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching index history:', error);
      throw error;
    }
  }

  /**
   * Get index history by code
   */
  static async getIndexHistoryByCode(
    indexCode: string,
    days: number = 30
  ): Promise<MarketIndexValue[]> {
    try {
      const index = await this.getIndexByCode(indexCode);
      if (!index) return [];

      return await this.getIndexHistory(index.id, days);
    } catch (error) {
      console.error('Error fetching index history by code:', error);
      throw error;
    }
  }

  /**
   * Get index components
   */
  static async getIndexComponents(indexId: string): Promise<IndexComponent[]> {
    try {
      const { data, error } = await supabase
        .from('market_index_components')
        .select('*')
        .eq('index_id', indexId)
        .eq('is_active', true)
        .order('weight', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching index components:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive index performance data
   */
  static async getIndexPerformance(indexCode: string): Promise<IndexPerformance | null> {
    try {
      const index = await this.getIndexByCode(indexCode);
      if (!index) return null;

      const history = await this.getIndexHistory(index.id, 30);
      if (history.length === 0) return null;

      const latest = history[history.length - 1];
      const currentValue = latest.close_value || 0;

      const change1d = this.calculateChange(history, 1);
      const change7d = this.calculateChange(history, 7);
      const change30d = this.calculateChange(history, 30);

      // Calculate 7-day volume
      const volume7d = history
        .slice(-7)
        .reduce((sum, val) => sum + (val.volume || 0), 0);

      // Determine trend
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (change7d > 1) trend = 'up';
      else if (change7d < -1) trend = 'down';

      return {
        index_code: indexCode,
        index_name: index.index_name,
        current_value: currentValue,
        change_1d: change1d,
        change_7d: change7d,
        change_30d: change30d,
        volume_7d: volume7d,
        trend,
        history
      };
    } catch (error) {
      console.error('Error fetching index performance:', error);
      throw error;
    }
  }

  /**
   * Calculate percentage change over N days
   */
  private static calculateChange(history: MarketIndexValue[], days: number): number {
    if (history.length < 2) return 0;

    const latest = history[history.length - 1];
    const past = history[Math.max(0, history.length - 1 - days)];

    const currentValue = latest.close_value || 0;
    const pastValue = past.close_value || 0;

    if (pastValue === 0) return 0;

    return ((currentValue - pastValue) / pastValue) * 100;
  }

  /**
   * Trigger index recalculation (calls edge function)
   */
  static async recalculateIndexes(indexCode?: string): Promise<any> {
    try {
      const { data, error } = await supabase.functions.invoke('calculate-market-indexes', {
        body: {
          index_code: indexCode || null
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error triggering index recalculation:', error);
      throw error;
    }
  }

  /**
   * Get index summary stats
   */
  static async getIndexStats(): Promise<{
    total_indexes: number;
    active_indexes: number;
    total_data_points: number;
    latest_calculation: string | null;
  }> {
    try {
      // Count indexes
      const { count: totalIndexes, error: indexError } = await supabase
        .from('market_indexes')
        .select('*', { count: 'exact', head: true });

      const { count: activeIndexes, error: activeError } = await supabase
        .from('market_indexes')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      // Count data points
      const { count: dataPoints, error: dataError } = await supabase
        .from('market_index_values')
        .select('*', { count: 'exact', head: true });

      // Get latest calculation date
      const { data: latestData, error: latestError } = await supabase
        .from('market_index_values')
        .select('value_date')
        .order('value_date', { ascending: false })
        .limit(1)
        .single();

      if (indexError) throw indexError;
      if (activeError) throw activeError;
      if (dataError) throw dataError;

      return {
        total_indexes: totalIndexes || 0,
        active_indexes: activeIndexes || 0,
        total_data_points: dataPoints || 0,
        latest_calculation: latestData?.value_date || null
      };
    } catch (error) {
      console.error('Error fetching index stats:', error);
      throw error;
    }
  }

  /**
   * Get advanced metrics for an index
   */
  static async getAdvancedMetrics(indexId: string): Promise<AssetPerformanceMetrics | null> {
    try {
      const { data, error } = await supabase
        .from('asset_performance_metrics')
        .select('*')
        .eq('asset_type', 'index')
        .eq('asset_id', indexId)
        .order('calculation_date', { ascending: false })
        .limit(10);

      if (error) throw error;
      if (!data || data.length === 0) return null;

      // Group by period
      const byPeriod: Record<string, AdvancedMetrics> = {};
      for (const m of data) {
        if (!byPeriod[m.period]) {
          byPeriod[m.period] = {
            period: m.period,
            total_return: m.total_return,
            annualized_return: m.annualized_return,
            twr_return: m.twr_return,
            irr: m.irr,
            volatility_annualized: m.volatility_annualized,
            max_drawdown: m.max_drawdown,
            sharpe_ratio: m.sharpe_ratio,
            sortino_ratio: m.sortino_ratio,
            var_95_1d: m.var_95_1d,
            cvar_95_1d: m.cvar_95_1d,
            alpha: m.alpha,
            beta: m.beta,
            r_squared: m.r_squared,
            data_points: m.data_points
          };
        }
      }

      return {
        latest_calculation: data[0].calculation_date,
        periods: byPeriod
      };
    } catch (error) {
      console.error('Error fetching advanced metrics:', error);
      return null;
    }
  }

  /**
   * Trigger advanced metrics calculation
   */
  static async calculateAdvancedMetrics(
    assetType: 'index' | 'portfolio',
    assetId?: string,
    userId?: string
  ): Promise<any> {
    try {
      const { data, error } = await supabase.functions.invoke('calculate-advanced-metrics', {
        body: {
          asset_type: assetType,
          asset_id: assetId,
          user_id: userId,
          periods: ['1m', '3m', '6m', 'ytd', '1y']
        }
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error calculating advanced metrics:', error);
      throw error;
    }
  }

  /**
   * Get benchmarks
   */
  static async getBenchmarks(): Promise<Array<{
    id: string;
    benchmark_code: string;
    benchmark_name: string;
    benchmark_type: string;
    is_active: boolean;
  }>> {
    try {
      const { data, error } = await supabase
        .from('market_benchmarks')
        .select('id, benchmark_code, benchmark_name, benchmark_type, is_active')
        .eq('is_active', true)
        .order('benchmark_code');

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching benchmarks:', error);
      return [];
    }
  }
}
