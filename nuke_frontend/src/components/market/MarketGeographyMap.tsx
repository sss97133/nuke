/**
 * Market Geography Map
 *
 * Geographic distribution of vehicle sales, prices, and venue activity.
 * Part of the "Wall Street of Car Trading" visualization suite.
 */

import { useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

interface RegionData {
  region: string;
  vehicle_count: number;
  avg_price: number;
  total_volume: number;
  top_makes: string[];
  price_trend: 'up' | 'down' | 'stable';
}

// US regions for initial mapping
const US_REGIONS = [
  { id: 'west', label: 'West Coast', states: ['CA', 'OR', 'WA', 'NV', 'AZ'] },
  { id: 'southwest', label: 'Southwest', states: ['TX', 'NM', 'OK'] },
  { id: 'midwest', label: 'Midwest', states: ['IL', 'OH', 'MI', 'IN', 'WI', 'MN'] },
  { id: 'southeast', label: 'Southeast', states: ['FL', 'GA', 'NC', 'SC', 'TN', 'AL'] },
  { id: 'northeast', label: 'Northeast', states: ['NY', 'NJ', 'PA', 'MA', 'CT'] },
  { id: 'mountain', label: 'Mountain', states: ['CO', 'UT', 'MT', 'ID', 'WY'] },
];

// Market heat colors
const HEAT_COLORS = {
  hot: '#EF4444',
  warm: '#F59E0B',
  neutral: '#10B981',
  cool: '#3B82F6',
  cold: '#6366F1',
};

interface MarketMetrics {
  total_vehicles: number;
  total_volume: number;
  avg_price: number;
  median_price: number;
  top_venue: string;
  hot_segment: string;
}

export default function MarketGeographyMap() {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [priceFilter, setPriceFilter] = useState<'all' | 'entry' | 'mid' | 'high' | 'ultra'>('all');

  // Fetch market overview
  const { data: marketOverview } = useQuery({
    queryKey: ['market-overview'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('sale_price, make, listing_url')
        .not('sale_price', 'is', null)
        .gt('sale_price', 0)
        .lt('sale_price', 10000000)
        .limit(10000);

      if (!data) return null;

      const prices = data.map(d => d.sale_price).sort((a, b) => a - b);
      const total = prices.reduce((a, b) => a + b, 0);

      // Count by venue
      const venues: Record<string, number> = {};
      data.forEach(d => {
        const url = d.listing_url || '';
        if (url.includes('bringatrailer')) venues['BaT'] = (venues['BaT'] || 0) + 1;
        else if (url.includes('carsandbids')) venues['C&B'] = (venues['C&B'] || 0) + 1;
        else if (url.includes('rmsothebys')) venues['RM'] = (venues['RM'] || 0) + 1;
        else venues['Other'] = (venues['Other'] || 0) + 1;
      });

      const topVenue = Object.entries(venues).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

      // Count by segment
      const segments = { entry: 0, mid: 0, high: 0, ultra: 0 };
      data.forEach(d => {
        if (d.sale_price >= 500000) segments.ultra++;
        else if (d.sale_price >= 100000) segments.high++;
        else if (d.sale_price >= 50000) segments.mid++;
        else segments.entry++;
      });

      const hotSegment = Object.entries(segments).sort((a, b) => b[1] - a[1])[0]?.[0] || 'entry';

      return {
        total_vehicles: data.length,
        total_volume: total,
        avg_price: Math.round(total / data.length),
        median_price: prices[Math.floor(prices.length / 2)],
        top_venue: topVenue,
        hot_segment: hotSegment,
      } as MarketMetrics;
    },
  });

  // Fetch venue distribution
  const { data: venueDistribution } = useQuery({
    queryKey: ['venue-distribution'],
    queryFn: async () => {
      const { data } = await supabase
        .from('auction_venues')
        .select('*')
        .order('name');
      return data;
    },
  });

  // Price segment breakdown
  const priceSegments = useMemo(() => [
    { id: 'ultra', label: '$500K+', color: HEAT_COLORS.hot, minPrice: 500000 },
    { id: 'high', label: '$100-500K', color: HEAT_COLORS.warm, minPrice: 100000 },
    { id: 'mid', label: '$50-100K', color: HEAT_COLORS.neutral, minPrice: 50000 },
    { id: 'entry', label: '<$50K', color: HEAT_COLORS.cool, minPrice: 0 },
  ], []);

  const formatCurrency = (value: number) => {
    if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`;
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value}`;
  };

  return (
    <div className="bg-gray-900 rounded-xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Market Geography</h2>
          <p className="text-gray-400 text-sm">Distribution of sales across venues and segments</p>
        </div>
      </div>

      {/* Market Overview Cards */}
      {marketOverview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Total Volume</div>
            <div className="text-2xl font-bold text-green-400">
              {formatCurrency(marketOverview.total_volume)}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Vehicles Tracked</div>
            <div className="text-2xl font-bold text-white">
              {marketOverview.total_vehicles.toLocaleString()}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Average Price</div>
            <div className="text-2xl font-bold text-blue-400">
              {formatCurrency(marketOverview.avg_price)}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Top Venue</div>
            <div className="text-2xl font-bold text-purple-400">
              {marketOverview.top_venue}
            </div>
          </div>
        </div>
      )}

      {/* Segment Filter */}
      <div className="flex gap-2">
        {['all', ...priceSegments.map(s => s.id)].map(segment => (
          <button
            key={segment}
            onClick={() => setPriceFilter(segment as any)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              priceFilter === segment
                ? 'bg-green-500 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {segment === 'all' ? 'All Segments' : priceSegments.find(s => s.id === segment)?.label}
          </button>
        ))}
      </div>

      {/* Venue Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {venueDistribution?.map(venue => (
          <div
            key={venue.slug}
            className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-all cursor-pointer border border-gray-700 hover:border-green-500/50"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-white">{venue.name}</div>
                <div className="text-sm text-gray-400">{venue.venue_type}</div>
              </div>
              <span className={`px-2 py-1 rounded text-xs ${
                venue.venue_type === 'online'
                  ? 'bg-blue-900/50 text-blue-300'
                  : venue.venue_type === 'live'
                  ? 'bg-orange-900/50 text-orange-300'
                  : 'bg-purple-900/50 text-purple-300'
              }`}>
                {venue.venue_type}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Buyer Premium</span>
                <span className="text-white">
                  {venue.buyer_premium_pct}%
                  {venue.buyer_premium_cap && (
                    <span className="text-green-400 ml-1">
                      (cap: {formatCurrency(venue.buyer_premium_cap)})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Seller Fee</span>
                <span className="text-white">
                  {venue.seller_commission_pct}%
                  {venue.seller_listing_fee > 0 && (
                    <span className="text-gray-500 ml-1">
                      + {formatCurrency(venue.seller_listing_fee)}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Specializations</span>
                <span className="text-gray-300">
                  {venue.specializations?.slice(0, 3).join(', ')}
                </span>
              </div>
            </div>

            {/* Cap Zone Indicator */}
            {venue.buyer_premium_cap && (
              <div className="mt-3 pt-3 border-t border-gray-700">
                <div className="text-xs text-gray-500">Cap kicks in at</div>
                <div className="text-green-400 font-medium">
                  {formatCurrency(venue.buyer_premium_cap / (venue.buyer_premium_pct / 100))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Arbitrage Opportunity Matrix */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-lg p-4 border border-gray-700">
        <h3 className="text-white font-medium mb-4">Arbitrage Opportunities</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-3xl font-bold text-green-400">$192K</div>
            <div className="text-sm text-gray-400">Savings on $1M car</div>
            <div className="text-xs text-gray-500">BaT vs RM Sotheby's</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-400">0.4%</div>
            <div className="text-sm text-gray-400">BaT rate at $1M+</div>
            <div className="text-xs text-gray-500">"Car wash" territory</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-yellow-400">$150K</div>
            <div className="text-sm text-gray-400">BaT cap zone starts</div>
            <div className="text-xs text-gray-500">Fee advantage begins</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-400">50x</div>
            <div className="text-sm text-gray-400">Fee variance</div>
            <div className="text-xs text-gray-500">Between venues</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-gray-500 text-sm pt-4 border-t border-gray-800">
        Data from {marketOverview?.total_vehicles.toLocaleString() || '—'} tracked sales.
        Updated in real-time from auction platforms.
      </div>
    </div>
  );
}
