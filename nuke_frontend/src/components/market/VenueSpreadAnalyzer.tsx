/**
 * Venue Spread Analyzer
 *
 * Interactive visualization of auction venue transaction costs.
 * The "Bloomberg Terminal" view for car market spreads.
 */

import { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

interface VenueSpread {
  venue_slug: string;
  venue_name: string;
  venue_type: string;
  buyer_fee: number;
  seller_fee: number;
  total_spread: number;
  effective_rate_pct: number;
  savings_vs_worst: number;
}

interface VenueData {
  slug: string;
  name: string;
  venue_type: string;
  buyer_premium_pct: number;
  buyer_premium_cap: number | null;
  seller_commission_pct: number;
  seller_listing_fee: number;
}

const PRICE_PRESETS = [
  { label: '$25K', value: 25000 },
  { label: '$50K', value: 50000 },
  { label: '$100K', value: 100000 },
  { label: '$250K', value: 250000 },
  { label: '$500K', value: 500000 },
  { label: '$1M', value: 1000000 },
  { label: '$2M', value: 2000000 },
];

const VENUE_COLORS: Record<string, string> = {
  'bat': '#10B981',
  'carsandbids': '#3B82F6',
  'pcarmarket': '#8B5CF6',
  'rmsothebys': '#EF4444',
  'mecum': '#F59E0B',
  'gooding': '#EC4899',
  'bonhams': '#6366F1',
  'barrett-jackson': '#F97316',
  'hagerty': '#14B8A6',
};

export default function VenueSpreadAnalyzer() {
  const [selectedPrice, setSelectedPrice] = useState(250000);
  const [customPrice, setCustomPrice] = useState('');

  // Fetch venue data
  const { data: venues } = useQuery({
    queryKey: ['auction-venues'],
    queryFn: async () => {
      const { data } = await supabase
        .from('auction_venues')
        .select('*')
        .order('name');
      return data as VenueData[];
    },
  });

  // Fetch spread data for selected price
  const { data: spreads, isLoading } = useQuery({
    queryKey: ['venue-spreads', selectedPrice],
    queryFn: async () => {
      const { data } = await supabase
        .rpc('calculate_venue_spread', { hammer_price: selectedPrice });
      return data as VenueSpread[];
    },
    enabled: selectedPrice > 0,
  });

  // Calculate spread comparison across all price points
  const priceComparison = useMemo(() => {
    if (!venues) return [];

    return PRICE_PRESETS.map(preset => {
      const spreadsAtPrice = venues.map(v => {
        const rawBuyerFee = preset.value * (v.buyer_premium_pct / 100);
        const buyerFee = v.buyer_premium_cap
          ? Math.min(rawBuyerFee, v.buyer_premium_cap)
          : rawBuyerFee;
        const sellerFee = (v.seller_listing_fee || 0) + preset.value * ((v.seller_commission_pct || 0) / 100);
        const total = buyerFee + sellerFee;
        const rate = (total / preset.value) * 100;

        return {
          venue: v.slug,
          name: v.name,
          total,
          rate,
        };
      });

      return {
        price: preset.value,
        label: preset.label,
        spreads: spreadsAtPrice.sort((a, b) => a.total - b.total),
      };
    });
  }, [venues]);

  const handlePriceChange = (value: number) => {
    setSelectedPrice(value);
    setCustomPrice('');
  };

  const handleCustomPrice = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseFloat(customPrice.replace(/[^0-9.]/g, ''));
    if (value > 0) {
      setSelectedPrice(value);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  // Find optimal venue
  const optimalVenue = spreads?.[0];
  const worstVenue = spreads?.[spreads.length - 1];
  const potentialSavings = optimalVenue && worstVenue
    ? worstVenue.total_spread - optimalVenue.total_spread
    : 0;

  return (
    <div className="bg-gray-900 rounded-xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Market Spread Analyzer</h2>
          <p className="text-gray-400 text-sm">Transaction costs across auction venues</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-400">Analyzing</div>
          <div className="text-2xl font-bold text-green-400">{formatCurrency(selectedPrice)}</div>
        </div>
      </div>

      {/* Price Selector */}
      <div className="flex flex-wrap gap-2">
        {PRICE_PRESETS.map(preset => (
          <button
            key={preset.value}
            onClick={() => handlePriceChange(preset.value)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              selectedPrice === preset.value
                ? 'bg-green-500 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {preset.label}
          </button>
        ))}
        <form onSubmit={handleCustomPrice} className="flex">
          <input
            type="text"
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)}
            placeholder="Custom..."
            className="px-3 py-2 rounded-lg bg-gray-800 text-white border border-gray-700 w-28"
          />
        </form>
      </div>

      {/* Key Insight */}
      {optimalVenue && (
        <div className="bg-gradient-to-r from-green-900/50 to-gray-900 rounded-lg p-4 border border-green-500/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-green-400 font-medium">Optimal Venue</div>
              <div className="text-2xl font-bold text-white">{optimalVenue.venue_name}</div>
              <div className="text-gray-400">
                {formatPercent(optimalVenue.effective_rate_pct)} effective rate
              </div>
            </div>
            <div className="text-right">
              <div className="text-gray-400 text-sm">Potential Savings</div>
              <div className="text-3xl font-bold text-green-400">
                {formatCurrency(potentialSavings)}
              </div>
              <div className="text-gray-500 text-sm">vs {worstVenue?.venue_name}</div>
            </div>
          </div>
        </div>
      )}

      {/* Spread Comparison Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Venue</th>
              <th className="text-right py-3 px-4 text-gray-400 font-medium">Type</th>
              <th className="text-right py-3 px-4 text-gray-400 font-medium">Buyer Fee</th>
              <th className="text-right py-3 px-4 text-gray-400 font-medium">Seller Fee</th>
              <th className="text-right py-3 px-4 text-gray-400 font-medium">Total Spread</th>
              <th className="text-right py-3 px-4 text-gray-400 font-medium">Rate</th>
              <th className="text-right py-3 px-4 text-gray-400 font-medium">Savings</th>
            </tr>
          </thead>
          <tbody>
            {spreads?.map((spread, idx) => (
              <tr
                key={spread.venue_slug}
                className={`border-b border-gray-800/50 ${
                  idx === 0 ? 'bg-green-900/20' : ''
                }`}
              >
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: VENUE_COLORS[spread.venue_slug] || '#666' }}
                    />
                    <span className="text-white font-medium">{spread.venue_name}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-right">
                  <span className={`px-2 py-1 rounded text-xs ${
                    spread.venue_type === 'online'
                      ? 'bg-blue-900/50 text-blue-300'
                      : spread.venue_type === 'live'
                      ? 'bg-orange-900/50 text-orange-300'
                      : 'bg-purple-900/50 text-purple-300'
                  }`}>
                    {spread.venue_type}
                  </span>
                </td>
                <td className="py-3 px-4 text-right text-gray-300">
                  {formatCurrency(spread.buyer_fee)}
                </td>
                <td className="py-3 px-4 text-right text-gray-300">
                  {formatCurrency(spread.seller_fee)}
                </td>
                <td className="py-3 px-4 text-right font-medium text-white">
                  {formatCurrency(spread.total_spread)}
                </td>
                <td className="py-3 px-4 text-right">
                  <span className={`font-medium ${
                    spread.effective_rate_pct < 5
                      ? 'text-green-400'
                      : spread.effective_rate_pct < 15
                      ? 'text-yellow-400'
                      : 'text-red-400'
                  }`}>
                    {formatPercent(spread.effective_rate_pct)}
                  </span>
                </td>
                <td className="py-3 px-4 text-right text-green-400">
                  {idx > 0 ? `+${formatCurrency(spread.savings_vs_worst)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Visual Spread Chart */}
      <div className="space-y-4">
        <h3 className="text-gray-400 font-medium">Spread Visualization</h3>
        <div className="space-y-2">
          {spreads?.map(spread => {
            const maxSpread = spreads[spreads.length - 1]?.total_spread || 1;
            const widthPct = (spread.total_spread / maxSpread) * 100;

            return (
              <div key={spread.venue_slug} className="flex items-center gap-4">
                <div className="w-32 text-sm text-gray-400 truncate">
                  {spread.venue_name}
                </div>
                <div className="flex-1 h-6 bg-gray-800 rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all duration-500"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: VENUE_COLORS[spread.venue_slug] || '#666',
                    }}
                  />
                </div>
                <div className="w-24 text-right text-sm text-white">
                  {formatCurrency(spread.total_spread)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Price Point Matrix */}
      <div className="space-y-4">
        <h3 className="text-gray-400 font-medium">Rate by Price Point</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-2 px-3 text-gray-500">Venue</th>
                {PRICE_PRESETS.map(p => (
                  <th key={p.value} className="text-right py-2 px-3 text-gray-500">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {venues?.slice(0, 5).map(venue => (
                <tr key={venue.slug} className="border-b border-gray-800/50">
                  <td className="py-2 px-3 text-gray-300">{venue.name}</td>
                  {priceComparison.map(pc => {
                    const venueSpread = pc.spreads.find(s => s.venue === venue.slug);
                    const rate = venueSpread?.rate || 0;
                    return (
                      <td
                        key={pc.price}
                        className={`text-right py-2 px-3 font-mono ${
                          rate < 3 ? 'text-green-400' :
                          rate < 10 ? 'text-yellow-400' :
                          'text-red-400'
                        }`}
                      >
                        {rate.toFixed(1)}%
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Insight */}
      <div className="text-center text-gray-500 text-sm pt-4 border-t border-gray-800">
        Fee caps make online venues dramatically cheaper at higher price points.
        At $1M+, BaT's 0.76% rate beats RM's 20% by <span className="text-green-400 font-medium">$192K</span>.
      </div>
    </div>
  );
}
