/**
 * Platform Status Hook
 *
 * Provides access to platform configuration including:
 * - Demo mode status
 * - Regulatory approval status
 * - Feature flags
 *
 * Used to gate functionality based on regulatory compliance.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface DemoModeConfig {
  enabled: boolean;
  message: string;
  allow_real_deposits: boolean;
  show_demo_banner: boolean;
}

export interface RegulatoryStatus {
  sec_approved: boolean;
  finra_approved: boolean;
  last_updated: string | null;
  approval_notes: string | null;
}

export interface PlatformFeatures {
  trading_enabled: boolean;
  real_money_enabled: boolean;
  kyc_required: boolean;
  accreditation_required: boolean;
}

export interface PlatformStatus {
  demo_mode: DemoModeConfig;
  regulatory_status: RegulatoryStatus;
  features: PlatformFeatures;
  is_live: boolean;
  timestamp: string;
}

interface UsePlatformStatusResult {
  status: PlatformStatus | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  isDemoMode: boolean;
  isLive: boolean;
  canTrade: boolean;
  logMetric: (
    metricType: string,
    entityType?: string,
    entityId?: string,
    metadata?: Record<string, any>
  ) => Promise<void>;
}

const defaultStatus: PlatformStatus = {
  demo_mode: {
    enabled: true,
    message: 'Paper Trading Mode',
    allow_real_deposits: false,
    show_demo_banner: true,
  },
  regulatory_status: {
    sec_approved: false,
    finra_approved: false,
    last_updated: null,
    approval_notes: null,
  },
  features: {
    trading_enabled: true,
    real_money_enabled: false,
    kyc_required: false,
    accreditation_required: false,
  },
  is_live: false,
  timestamp: new Date().toISOString(),
};

export function usePlatformStatus(): UsePlatformStatusResult {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Try the edge function first
      const { data, error: fnError } = await supabase.functions.invoke('platform-status');

      if (fnError) {
        // Fallback to direct RPC call
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_platform_status');

        if (rpcError) {
          console.warn('Platform status fetch failed, using defaults:', rpcError);
          setStatus(defaultStatus);
          return;
        }

        setStatus(rpcData as PlatformStatus);
        return;
      }

      setStatus(data as PlatformStatus);
    } catch (err) {
      console.error('Error fetching platform status:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch platform status'));
      setStatus(defaultStatus);
    } finally {
      setLoading(false);
    }
  }, []);

  const logMetric = useCallback(
    async (
      metricType: string,
      entityType?: string,
      entityId?: string,
      metadata?: Record<string, any>
    ) => {
      try {
        await supabase.rpc('log_usage_metric', {
          p_metric_type: metricType,
          p_entity_type: entityType || null,
          p_entity_id: entityId || null,
          p_metadata: metadata || {},
        });
      } catch (err) {
        // Silent fail - metrics logging shouldn't break the app
        console.warn('Failed to log usage metric:', err);
      }
    },
    []
  );

  useEffect(() => {
    fetchStatus();

    // Refresh status every 5 minutes
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  const isDemoMode = status?.demo_mode.enabled ?? true;
  const isLive = status?.is_live ?? false;
  const canTrade = status?.features.trading_enabled ?? false;

  return {
    status,
    loading,
    error,
    refetch: fetchStatus,
    isDemoMode,
    isLive,
    canTrade,
    logMetric,
  };
}

export default usePlatformStatus;
