import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface SimilarSale {
  vehicle_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  sale_price: number;
  mileage: number | null;
  color: string | null;
  image_url: string | null;
  location: string | null;
  listing_url: string | null;
  platform: string | null;
  platform_raw: string | null;
  sold_date: string | null;
  source_type: 'auction_event' | 'vehicle_record';
}

interface SalesSummary {
  count: number;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
  auction_event_count: number;
}

export function useSimilarSales(vehicleId: string, vehicleMake: string) {
  return useQuery({
    queryKey: ['similar-sales', vehicleId],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string;

      if (!supabaseUrl) throw new Error('Configuration error');

      const params = new URLSearchParams({
        vehicle_id: vehicleId,
        year_range: '2',
        limit: '20',
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(
        `${supabaseUrl}/functions/v1/api-v1-comps?${params.toString()}`,
        { headers }
      );

      if (!res.ok) {
        const errBody = await res.text();
        console.error('Similar sales API error:', errBody);
        throw new Error('Unable to load comparable sales');
      }

      const json = await res.json();
      return {
        sales: (json.data ?? []) as SimilarSale[],
        summary: (json.summary ?? null) as SalesSummary | null,
      };
    },
    enabled: !!vehicleId && !!vehicleMake,
    staleTime: 5 * 60 * 1000,
  });
}

export type { SimilarSale, SalesSummary };
