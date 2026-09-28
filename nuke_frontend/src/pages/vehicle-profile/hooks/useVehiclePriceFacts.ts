import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

// The vehicle's typed price (vehicle_price_facts): one price with its kind and date, plus the sold / bid / ask
// facts behind it. Every price on the vehicle page reads this, never a raw sale_price — a high bid, an unproven
// sale or an old ask is not a sale. One request per vehicle, shared by every component that asks.
export type PriceKind = 'sold' | 'bid' | 'ask' | 'estimate';

export interface PriceFacts {
  price_kind: PriceKind | null;
  price_amount: number | null;
  price_as_of: string | null;
  price_live: boolean | null;
  sold_amount: number | null;
  sold_on: string | null;
  ask_amount: number | null;
  ask_as_of: string | null;
  bid_amount: number | null;
  bid_on: string | null;
  outcome: string | null;
  platform: string | null;
  source_url: string | null;
}

const money = (x: unknown): number | null => {
  const n = Number(x);
  return x != null && Number.isFinite(n) && n > 0 ? n : null;
};

export function useVehiclePriceFacts(vehicleId: string | undefined) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['vehicle-price-facts', vehicleId],
    queryFn: async (): Promise<PriceFacts | null> => {
      if (!vehicleId) return null;
      const { data, error } = await supabase.rpc('vehicle_price_facts', { p_vehicle_ids: [vehicleId] });
      if (error) throw error;
      const r: any = Array.isArray(data) ? data[0] : null;
      if (!r) return null;
      return {
        ...r,
        price_amount: money(r.price_amount),
        sold_amount: money(r.sold_amount),
        ask_amount: money(r.ask_amount),
        bid_amount: money(r.bid_amount),
      };
    },
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
  });

  return {
    priceFacts: data ?? null,
    // settled = answered or failed; until then a reader shows no price rather than a raw one
    priceSettled: !!vehicleId && (!isLoading || isError),
  };
}

// The price as what it is: 'Sold' / 'Current bid' / 'High bid' / 'Asking'. An estimate or no price is null —
// a model estimate is never presented as the car's price.
export function priceKindLabel(p: PriceFacts | null): string | null {
  if (!p || !p.price_amount) return null;
  if (p.price_kind === 'sold') return 'Sold';
  if (p.price_kind === 'bid') return p.price_live ? 'Current bid' : 'High bid';
  if (p.price_kind === 'ask') return 'Asking';
  return null;
}
