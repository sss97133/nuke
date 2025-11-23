/**
 * Auction Marketplace - BaT-inspired auction browse interface
 * Displays active auctions with real-time bidding updates
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { Link, useNavigate } from 'react-router-dom';
import '../design-system.css';

interface AuctionListing {
  id: string;
  vehicle_id: string;
  seller_id: string;
  sale_type: string;
  current_high_bid_cents: number | null;
  reserve_price_cents: number | null;
  bid_count: number;
  auction_end_time: string | null;
  status: string;
  description: string;
  created_at: string;
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim: string | null;
    mileage: number | null;
    primary_image_url: string | null;
  };
}

type FilterType = 'all' | 'ending_soon' | 'no_reserve' | 'new_listings';
type SortType = 'ending_soon' | 'bid_count' | 'price_low' | 'price_high' | 'newest';

export default function AuctionMarketplace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('ending_soon');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadListings();
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('auction-updates')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'vehicle_listings',
        filter: 'status=eq.active'
      }, () => {
        loadListings();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [filter, sort]);

  const loadListings = async () => {
    setLoading(true);
    
    let query = supabase
      .from('vehicle_listings')
      .select(`
        *,
        vehicle:vehicles (
          id,
          year,
          make,
          model,
          trim,
          mileage,
          primary_image_url
        )
      `)
      .eq('status', 'active')
      .in('sale_type', ['auction', 'live_auction']);

    // Apply filters
    if (filter === 'ending_soon') {
      const next24Hours = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      query = query.lte('auction_end_time', next24Hours);
    } else if (filter === 'no_reserve') {
      query = query.is('reserve_price_cents', null);
    } else if (filter === 'new_listings') {
      const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', last7Days);
    }

    // Apply sorting
    switch (sort) {
      case 'ending_soon':
        query = query.order('auction_end_time', { ascending: true });
        break;
      case 'bid_count':
        query = query.order('bid_count', { ascending: false });
        break;
      case 'price_low':
        query = query.order('current_high_bid_cents', { ascending: true, nullsFirst: true });
        break;
      case 'price_high':
        query = query.order('current_high_bid_cents', { ascending: false });
        break;
      case 'newest':
        query = query.order('created_at', { ascending: false });
        break;
    }

    const { data, error } = await query.limit(50);

    if (error) {
      console.error('Error loading listings:', error);
    } else {
      setListings(data || []);
    }

    setLoading(false);
  };

  const formatCurrency = (cents: number | null) => {
    if (!cents) return 'No bids yet';
    return `$${(cents / 100).toLocaleString()}`;
  };

  const formatTimeRemaining = (endTime: string | null) => {
    if (!endTime) return 'N/A';
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) return 'Ended';

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  const getTimeRemainingColor = (endTime: string | null) => {
    if (!endTime) return 'text-gray-600';
    const now = new Date();
    const end = new Date(endTime);
    const diff = end.getTime() - now.getTime();
    const hours = diff / (60 * 60 * 1000);

    if (hours < 1) return 'text-red-600 font-bold';
    if (hours < 24) return 'text-orange-600 font-semibold';
    return 'text-gray-700';
  };

  const filteredListings = listings.filter(listing => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const vehicle = listing.vehicle;
    return (
      vehicle.year.toString().includes(query) ||
      vehicle.make.toLowerCase().includes(query) ||
      vehicle.model.toLowerCase().includes(query) ||
      (vehicle.trim && vehicle.trim.toLowerCase().includes(query))
    );
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-3xl font-bold">Auction Marketplace</h1>
            {user && (
              <button
                onClick={() => navigate('/list-vehicle')}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                List Your Vehicle
              </button>
            )}
          </div>

          {/* Search and Filters */}
          <div className="space-y-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by make, model, year..."
              className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="flex gap-4 flex-wrap">
              {/* Filter Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-4 py-2 rounded transition-colors ${
                    filter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  All Auctions
                </button>
                <button
                  onClick={() => setFilter('ending_soon')}
                  className={`px-4 py-2 rounded transition-colors ${
                    filter === 'ending_soon'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Ending Soon
                </button>
                <button
                  onClick={() => setFilter('no_reserve')}
                  className={`px-4 py-2 rounded transition-colors ${
                    filter === 'no_reserve'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  No Reserve
                </button>
                <button
                  onClick={() => setFilter('new_listings')}
                  className={`px-4 py-2 rounded transition-colors ${
                    filter === 'new_listings'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  New Listings
                </button>
              </div>

              {/* Sort Dropdown */}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortType)}
                className="px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ending_soon">Ending Soon</option>
                <option value="bid_count">Most Bids</option>
                <option value="price_low">Price: Low to High</option>
                <option value="price_high">Price: High to Low</option>
                <option value="newest">Newest First</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Listings Grid */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading auctions...</p>
          </div>
        ) : filteredListings.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">No active auctions found</p>
            {user && (
              <button
                onClick={() => navigate('/list-vehicle')}
                className="mt-4 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                List the First Vehicle
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredListings.map((listing) => (
              <AuctionCard
                key={listing.id}
                listing={listing}
                formatCurrency={formatCurrency}
                formatTimeRemaining={formatTimeRemaining}
                getTimeRemainingColor={getTimeRemainingColor}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface AuctionCardProps {
  listing: AuctionListing;
  formatCurrency: (cents: number | null) => string;
  formatTimeRemaining: (endTime: string | null) => string;
  getTimeRemainingColor: (endTime: string | null) => string;
}

function AuctionCard({ listing, formatCurrency, formatTimeRemaining, getTimeRemainingColor }: AuctionCardProps) {
  const vehicle = listing.vehicle;
  const hasReserve = listing.reserve_price_cents !== null;

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      className="block bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow border border-gray-200"
    >
      {/* Image */}
      <div className="aspect-[4/3] bg-gray-200 relative">
        {vehicle.primary_image_url ? (
          <img
            src={vehicle.primary_image_url}
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            No Image
          </div>
        )}
        {listing.bid_count === 0 && (
          <div className="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs font-bold">
            NEW
          </div>
        )}
        {!hasReserve && (
          <div className="absolute top-2 left-2 bg-orange-500 text-white px-2 py-1 rounded text-xs font-bold">
            NO RESERVE
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-2">
        <h3 className="font-bold text-lg">
          {vehicle.year} {vehicle.make} {vehicle.model}
          {vehicle.trim && ` ${vehicle.trim}`}
        </h3>

        {vehicle.mileage && (
          <p className="text-sm text-gray-600">
            {vehicle.mileage.toLocaleString()} miles
          </p>
        )}

        <div className="flex justify-between items-center pt-2 border-t border-gray-200">
          <div>
            <p className="text-xs text-gray-500">Current Bid</p>
            <p className="text-lg font-bold text-blue-600">
              {formatCurrency(listing.current_high_bid_cents)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Time Left</p>
            <p className={`text-sm font-medium ${getTimeRemainingColor(listing.auction_end_time)}`}>
              {formatTimeRemaining(listing.auction_end_time)}
            </p>
          </div>
        </div>

        <div className="flex justify-between items-center text-xs text-gray-600 pt-2">
          <span>{listing.bid_count} {listing.bid_count === 1 ? 'bid' : 'bids'}</span>
          {hasReserve && <span>Reserve</span>}
        </div>
      </div>
    </Link>
  );
}

