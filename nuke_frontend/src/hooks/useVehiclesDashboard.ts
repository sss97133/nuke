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
  public_vehicles?: MyVehicle[];
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

      // Run all queries in parallel — no monolithic RPC
      const [ownedRes, permRes, publicRes] = await Promise.all([
        // 1. Vehicles via ownership_verifications
        supabase
          .from('ownership_verifications')
          .select('vehicle_id, created_at, status')
          .eq('user_id', userId)
          .eq('status', 'approved'),

        // 2. Vehicles via vehicle_user_permissions
        supabase
          .from('vehicle_user_permissions')
          .select('vehicle_id, created_at, role, is_active')
          .eq('user_id', userId)
          .in('role', ['owner', 'co_owner']),

        // 3. Public vehicles (uploaded_by — always indexed)
        supabase
          .from('vehicles')
          .select('id, year, make, model, vin, current_value, purchase_price, primary_image_url, confidence_score, heat_score, created_at, status')
          .eq('uploaded_by', userId)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      // Collect owned vehicle IDs
      const ownedIds = new Map<string, { acquired_at: string; role: string }>();

      if (ownedRes.data) {
        for (const row of ownedRes.data) {
          ownedIds.set(row.vehicle_id, {
            acquired_at: row.created_at,
            role: 'verified_owner',
          });
        }
      }

      if (permRes.data) {
        for (const row of permRes.data) {
          if (row.is_active !== false && !ownedIds.has(row.vehicle_id)) {
            ownedIds.set(row.vehicle_id, {
              acquired_at: row.created_at,
              role: row.role,
            });
          }
        }
      }

      // Fetch owned vehicle details if any
      let myVehicles: MyVehicle[] = [];
      if (ownedIds.size > 0) {
        const { data: vehicleRows } = await supabase
          .from('vehicles')
          .select('id, year, make, model, vin, current_value, purchase_price, primary_image_url, confidence_score, heat_score, created_at')
          .in('id', Array.from(ownedIds.keys()));

        if (vehicleRows) {
          myVehicles = vehicleRows.map((v) => {
            const ownership = ownedIds.get(v.id)!;
            return {
              vehicle_id: v.id,
              year: v.year,
              make: v.make,
              model: v.model,
              vin: v.vin,
              acquisition_date: ownership.acquired_at,
              ownership_role: ownership.role,
              confidence_score: v.confidence_score ?? 0,
              interaction_score: v.heat_score ?? 0,
              last_activity_date: null,
              event_count: 0,
              image_count: 0,
              current_value: v.current_value,
              purchase_price: v.purchase_price,
              primary_image_url: v.primary_image_url,
            };
          });
        }
      }

      // Build public vehicles list from uploaded_by query
      const publicVehicles: MyVehicle[] = (publicRes.data || []).map((v) => ({
        vehicle_id: v.id,
        year: v.year,
        make: v.make,
        model: v.model,
        vin: null,
        acquisition_date: v.created_at,
        ownership_role: 'uploaded_by',
        confidence_score: v.confidence_score ?? 0,
        interaction_score: v.heat_score ?? 0,
        last_activity_date: null,
        event_count: 0,
        image_count: 0,
        current_value: v.current_value,
        purchase_price: v.purchase_price,
        primary_image_url: v.primary_image_url,
      }));

      // Merge: if user has owned vehicles, show those; otherwise fall back to public
      const displayVehicles = myVehicles.length > 0 ? myVehicles : publicVehicles;

      const result: DashboardData = {
        my_vehicles: displayVehicles,
        public_vehicles: publicVehicles,
        client_vehicles: [],
        business_fleets: [],
        summary: {
          total_my_vehicles: displayVehicles.length,
          total_client_vehicles: 0,
          total_business_vehicles: 0,
          recent_activity_30d: 0,
        },
      };

      setData(result);
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
