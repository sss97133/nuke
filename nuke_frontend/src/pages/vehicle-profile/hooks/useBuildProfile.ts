import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';

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
  const [manifest, setManifest] = useState<ManifestDevice[]>([]);
  const [snapshots, setSnapshots] = useState<BuildSnapshot[]>([]);
  const [spendProfile, setSpendProfile] = useState<SpendProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId || vehicleId.length < 20) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        // Parallel fetch all three data sources
        const [manifestRes, snapshotRes, spendRes] = await Promise.all([
          supabase
            .from('vehicle_build_manifest')
            .select('id, device_name, device_category, manufacturer, supplier, price, price_source, purchased, status, invoice_ref, location_zone, pct_complete')
            .eq('vehicle_id', vehicleId!)
            .order('device_category')
            .order('device_name'),
          supabase
            .from('build_activity_snapshots')
            .select('month, total_spend, vehicle_part_spend, tool_spend, vendor_count, top_vendors, photo_count, spending_intensity, photo_density, activity_score')
            .eq('vehicle_id', vehicleId!)
            .order('month'),
          supabase.rpc('compute_build_spend_profile', { p_vehicle_id: vehicleId }),
        ]);

        if (cancelled) return;

        if (manifestRes.error) throw new Error(manifestRes.error.message);
        if (snapshotRes.error) throw new Error(snapshotRes.error.message);

        setManifest((manifestRes.data || []) as ManifestDevice[]);
        setSnapshots((snapshotRes.data || []) as BuildSnapshot[]);
        setSpendProfile(spendRes.data as SpendProfile | null);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [vehicleId]);

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
    loading,
    error,
  };
}
