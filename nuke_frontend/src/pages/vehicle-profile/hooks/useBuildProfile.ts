import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import type { BuildManifestOwnerFields } from '../../../lib/buildManifestColumns';

export interface ManifestDevice {
  id: string;
  device_name: string;
  device_category: string;
  manufacturer: string | null;
  supplier: string | null;
  price: number | null;
  price_source: string | null;
  purchased: boolean;
  status: string | null;
  invoice_ref: string | null;
  location_zone: string | null;
  pct_complete: number | null;
}

export interface BuildSnapshot {
  month: string;
  total_spend: number;
  vehicle_part_spend: number;
  tool_spend: number;
  vendor_count: number;
  top_vendors: { name: string; spend: number }[];
  photo_count: number;
  spending_intensity: number;
  photo_density: number;
  activity_score: number;
}

export interface SpendProfile {
  total_documented_spend: number;
  attributed_spend: number;
  unattributed_spend: number;
  high_confidence_spend: number;
  total_transactions: number;
  by_category: Record<string, { count: number; spend: number }>;
  by_vendor: { vendor: string; spend: number; count: number; avg_confidence: number }[];
  manifest: {
    total_devices: number;
    purchased: number;
    priced: number;
    total_value: number;
    purchased_value: number;
    purchased_pct: number;
    priced_pct: number;
  };
}

export function useBuildProfile(vehicleId: string | undefined) {
  const { data: rawData, isLoading, error } = useQuery({
    queryKey: ['build-profile', vehicleId],
    queryFn: async () => {
      if (!vehicleId) return null;

      // Parallel fetch. Prices and invoice refs are owner-only: the owner-fields RPC returns no rows to anyone else.
      const [manifestRes, ownerRes, snapshotRes, spendRes] = await Promise.all([
        supabase
          .from('vehicle_build_manifest')
          .select('id, device_name, device_category, manufacturer, supplier, purchased, status, location_zone, pct_complete')
          .eq('vehicle_id', vehicleId)
          .order('device_category')
          .order('device_name'),
        supabase.rpc('vehicle_build_manifest_owner_fields', { p_vehicle_id: vehicleId }),
        supabase
          .from('build_activity_snapshots')
          .select('month, total_spend, vehicle_part_spend, tool_spend, vendor_count, top_vendors, photo_count, spending_intensity, photo_density, activity_score')
          .eq('vehicle_id', vehicleId)
          .order('month'),
        supabase.rpc('compute_build_spend_profile', { p_vehicle_id: vehicleId }),
      ]);

      if (manifestRes.error) throw new Error(manifestRes.error.message);
      if (snapshotRes.error) throw new Error(snapshotRes.error.message);

      const owned = new Map(((ownerRes.data || []) as BuildManifestOwnerFields[]).map(o => [o.id, o]));
      const manifest = ((manifestRes.data || []) as Omit<ManifestDevice, 'price' | 'price_source' | 'invoice_ref'>[]).map(d => {
        const o = owned.get(d.id);
        return { ...d, price: o?.price ?? null, price_source: o?.price_source ?? null, invoice_ref: o?.invoice_ref ?? null };
      });

      return {
        manifest,
        snapshots: (snapshotRes.data || []) as BuildSnapshot[],
        spendProfile: (spendRes.data as SpendProfile | null),
      };
    },
    enabled: !!vehicleId && vehicleId.length >= 20,
    staleTime: 10 * 60 * 1000, // 10 min
  });

  const manifest = rawData?.manifest ?? [];
  const snapshots = rawData?.snapshots ?? [];
  const spendProfile = rawData?.spendProfile ?? null;

  // Group manifest by category
  const manifestByCategory = useMemo(() => {
    const groups: Record<string, ManifestDevice[]> = {};
    for (const d of manifest) {
      const cat = d.device_category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(d);
    }
    return groups;
  }, [manifest]);

  const manifestStats = useMemo(() => {
    const total = manifest.length;
    const purchased = manifest.filter(d => d.purchased).length;
    const priced = manifest.filter(d => d.price != null).length;
    const totalValue = manifest.reduce((s, d) => s + (d.price || 0), 0);
    return { total, purchased, priced, totalValue, purchasedPct: total ? Math.round(purchased / total * 100) : 0 };
  }, [manifest]);

  return {
    manifest,
    manifestByCategory,
    manifestStats,
    snapshots,
    spendProfile,
    loading: isLoading,
    error: error?.message ?? null,
  };
}
