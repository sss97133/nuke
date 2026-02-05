import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface MyVehicle {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  acquisition_date: string | null;
  ownership_role: string;
  confidence_score: number;
  interaction_score: number;
  last_activity_date: string | null;
  event_count: number;
  image_count: number;
  current_value: number | null;
  purchase_price: number | null;
  primary_image_url: string | null;
}

export interface ClientVehicle {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  last_service_date: string | null;
  days_since_service: number | null;
  service_count: number;
  total_labor_hours: number;
  confidence_score: number;
  interaction_score: number;
}

export interface BusinessFleetVehicle {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  fleet_role: string | null;
  confidence_score: number;
  interaction_score: number;
}

export interface BusinessFleet {
  business_id: string;
  business_name: string;
  vehicle_count: number;
  vehicles: BusinessFleetVehicle[];
}

export interface DashboardSummary {
  total_my_vehicles: number;
  total_client_vehicles: number;
  total_business_vehicles: number;
  recent_activity_30d: number;
}

export interface DashboardData {
  my_vehicles: MyVehicle[];
  client_vehicles: ClientVehicle[];
  business_fleets: BusinessFleet[];
  summary: DashboardSummary;
}

export function useVehiclesDashboard(userId: string | undefined) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: result, error: rpcError } = await supabase
        .rpc('get_user_vehicles_dashboard', { p_user_id: userId });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      setData(result as DashboardData);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setError(err instanceof Error ? err : new Error('Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh on focus
  useEffect(() => {
    const handleFocus = () => {
      fetchData();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchData]);

  return {
    data,
    loading,
    error,
    refresh: fetchData
  };
}
