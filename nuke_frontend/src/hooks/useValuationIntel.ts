import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface ValuationIntelResult {
  valuation: any | null;
  components: any[];
  readiness: any | null;
  loading: boolean;
  error: string | null;
  refreshedAt: string | null;
}

export const useValuationIntel = (vehicleId: string | null): ValuationIntelResult => {
  const [valuation, setValuation] = useState<any | null>(null);
  const [components, setComponents] = useState<any[]>([]);
  const [readiness, setReadiness] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    let isMounted = true;
    if (!vehicleId) {
      setValuation(null);
      setComponents([]);
      setReadiness(null);
      setError(null);
      setRefreshedAt(null);
      return () => {
        isMounted = false;
      };
    }

    const fetchIntel = async () => {
      setLoading(true);
      setError(null);
      try {
        const valuationPromise = supabase
          .from('vehicle_valuations')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('valuation_date', { ascending: false, nulls: 'last' })
          .order('created_at', { ascending: false, nulls: 'last' })
          .limit(1)
          .maybeSingle();

        const componentsPromise = supabase
          .from('vehicle_valuations_components')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('estimated_value', { ascending: false, nulls: 'last' });

        const readinessPromise = supabase
          .from('financial_readiness_snapshots')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const [{ data: valuationRow, error: valuationError }, { data: componentRows, error: componentsError }, { data: readinessRow, error: readinessError }] =
          await Promise.all([valuationPromise, componentsPromise, readinessPromise]);

        if (!isMounted) return;

        if (valuationError) {
          throw valuationError;
        }
        if (componentsError) {
          throw componentsError;
        }
        if (readinessError) {
          console.warn('[useValuationIntel] readiness snapshot unavailable:', readinessError.message);
        }

        setValuation(valuationRow || null);
        setComponents(componentRows || []);
        setReadiness(readinessRow || null);
        setRefreshedAt(new Date().toISOString());
      } catch (err: any) {
        if (!isMounted) return;
        console.warn('[useValuationIntel] failed to load valuation intel:', err);
        setError(err.message || 'Unable to load valuation intel');
        setValuation(null);
        setComponents([]);
        setReadiness(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchIntel();
    return () => {
      isMounted = false;
    };
  }, [vehicleId, refreshSignal]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ vehicleId?: string }>).detail;
      const updatedVehicleId = detail?.vehicleId;
      if (!vehicleId || (updatedVehicleId && updatedVehicleId !== vehicleId)) return;
      setRefreshSignal(prev => prev + 1);
    };

    window.addEventListener('vehicle_valuation_updated', handler);
    return () => {
      window.removeEventListener('vehicle_valuation_updated', handler);
    };
  }, [vehicleId]);

  return {
    valuation,
    components,
    readiness,
    loading,
    error,
    refreshedAt
  };
};

