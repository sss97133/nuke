import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import '../../design-system.css';

interface AuctionListing {
  listing_id: string;
  title: string;
  description: string;
  listing_type: string;
  current_bid: number;
  buy_now_price: number;
  time_remaining_seconds: number;
  bid_count: number;
  watcher_count: number;
  images: string[];
  seller_name: string;
  location_city: string;
  location_state: string;
  featured: boolean;
  distance_miles: number;
}

interface AuctionFeedProps {
  onListingSelect?: (listingId: string) => void;
}

const AuctionFeed = ({ onListingSelect }: AuctionFeedProps) => {
  const { user } = useAuth();
  const [listings, setListings] = useState<AuctionListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    category: 'all',
    priceMin: 0,
    priceMax: 100000,
    sortBy: 'ending_soon'
  });

  const categories = [
    'all', 'muscle_car', 'classic', 'sports_car', 'truck', 'motorcycle',
    'parts', 'tools', 'memorabilia'
  ];

  const sortOptions = [
    { value: 'ending_soon', label: 'Ending Soon' },
    { value: 'newly_listed', label: 'Newly Listed' },
    { value: 'price_low', label: 'Price: Low to High' },
    { value: 'price_high', label: 'Price: High to Low' },
    { value: 'most_bids', label: 'Most Bids' }
  ];

  useEffect(() => {
    loadAuctions();

    const subscription = supabase
      .channel('auction_listings_feed')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auction_listings'
        },
        () => {
          loadAuctions();
        }
      )
      .subscribe();

    const refreshInterval = setInterval(loadAuctions, 60000); // Refresh every minute

    return () => {
      supabase.removeChannel(subscription);
      clearInterval(refreshInterval);
    };
  }, [filters]);

  const loadAuctions = async () => {
    setLoading(true);

    try {
      const { data, error } = await supabase.rpc('get_active_auctions', {
        limit_count: 50,
        offset_count: 0,
        category_filter: filters.category === 'all' ? null : filters.category,
        price_min: filters.priceMin > 0 ? filters.priceMin : null,
        price_max: filters.priceMax < 100000 ? filters.priceMax : null
      });

      if (error) {
        console.error('Error loading auctions:', error);
      } else {
        setListings(data || []);
      }
    } catch (error) {
      console.error('Load auctions error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount || 0);
  };

  const formatTimeRemaining = (seconds: number) => {
    if (seconds <= 0) return 'Ended';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getTimeRemainingColor = (seconds: number) => {
    if (seconds <= 3600) return '#dc2626'; // Red - less than 1 hour
    if (seconds <= 86400) return '#f59e0b'; // Orange - less than 1 day
    return '#6b7280'; // Gray - more than 1 day
  };

  const handleListingClick = (listingId: string) => {
    if (onListingSelect) {
      onListingSelect(listingId);
    }
  };

  return (
    <div style={{
      background: '#f5f5f5',
      border: '1px solid #bdbdbd',
      padding: '16px',
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h3 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 12px 0' }}>
        🏁 Auction Marketplace
      </h3>

      {/* Filters */}
      <div style={{
        background: 'white',
        border: '1px solid #bdbdbd',
        padding: '8px',
        marginBottom: '12px'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '8px',
          alignItems: 'center'
        }}>
          <div>
            <label style={{ fontSize: '8pt', display: 'block', marginBottom: '2px' }}>Category:</label>
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
              style={{
                width: '100%',
                padding: '2px',
                border: '1px solid #bdbdbd',
                borderRadius: '0px',
                fontSize: '8pt'
              }}
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '8pt', display: 'block', marginBottom: '2px' }}>
              Min Price: {formatCurrency(filters.priceMin)}
            </label>
            <input
              type="range"
              min="0"
              max="50000"
              step="1000"
              value={filters.priceMin}
              onChange={(e) => setFilters({ ...filters, priceMin: parseInt(e.target.value) })}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '8pt', display: 'block', marginBottom: '2px' }}>
              Max Price: {formatCurrency(filters.priceMax)}
            </label>
            <input
              type="range"
              min="1000"
              max="100000"
              step="5000"
              value={filters.priceMax}
              onChange={(e) => setFilters({ ...filters, priceMax: parseInt(e.target.value) })}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '8pt', display: 'block', marginBottom: '2px' }}>Sort By:</label>
            <select
              value={filters.sortBy}
              onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
              style={{
                width: '100%',
                padding: '2px',
                border: '1px solid #bdbdbd',
                borderRadius: '0px',
                fontSize: '8pt'
              }}
            >
              {sortOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={{
          background: '#e7f3ff',
          border: '1px solid #b8daff',
          padding: '12px',
          textAlign: 'center',
          fontSize: '8pt',
          marginBottom: '12px'
        }}>
          Loading auctions...
        </div>
      )}

      {/* Results Summary */}
      <div style={{
        background: '#e7f3ff',
        border: '1px solid #b8daff',
        padding: '8px',
        marginBottom: '12px',
        fontSize: '8pt'
      }}>
        {loading ? 'Searching...' : `${listings.length} active auctions`}
      </div>

      {/* Auction Listings Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '12px',
        maxHeight: '600px',
        overflowY: 'auto'
      }}>
        {listings.map(listing => (
          <div
            key={listing.listing_id}
            onClick={() => handleListingClick(listing.listing_id)}
            style={{
              background: 'white',
              border: listing.featured ? '2px solid #f59e0b' : '1px solid #bdbdbd',
              padding: '0px',
              cursor: 'pointer',
              position: 'relative'
            }}
          >
            {/* Featured Badge */}
            {listing.featured && (
              <div style={{
                position: 'absolute',
                top: '4px',
                left: '4px',
                background: '#f59e0b',
                color: 'white',
                padding: '2px 6px',
                fontSize: '7pt',
                fontWeight: 'bold',
                zIndex: 1
              }}>
                ⭐ FEATURED
              </div>
            )}

            {/* Image */}
            <div style={{
              background: '#e0e0e0',
              height: '160px',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {listing.images && listing.images.length > 0 ? (
                <img
                  src={listing.images[0]}
                  alt={listing.title}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />
              ) : (
                <div style={{
                  color: '#9e9e9e',
                  fontSize: '24pt',
                  textAlign: 'center'
                }}>
                  🚗
                </div>
              )}

              {/* Time Remaining Badge */}
              <div style={{
                position: 'absolute',
                top: '4px',
                right: '4px',
                background: 'rgba(0, 0, 0, 0.8)',
                color: getTimeRemainingColor(listing.time_remaining_seconds),
                padding: '2px 6px',
                fontSize: '7pt',
                fontWeight: 'bold'
              }}>
                ⏰ {formatTimeRemaining(listing.time_remaining_seconds)}
              </div>

              {/* Listing Type Badge */}
              <div style={{
                position: 'absolute',
                bottom: '4px',
                left: '4px',
                background: listing.listing_type === 'auction' ? '#dc2626' : '#10b981',
                color: 'white',
                padding: '2px 6px',
                fontSize: '7pt',
                fontWeight: 'bold'
              }}>
                {listing.listing_type === 'auction' ? '🔨 AUCTION' : '💰 BUY NOW'}
              </div>

              {/* Image Count */}
              {listing.images && listing.images.length > 1 && (
                <div style={{
                  position: 'absolute',
                  bottom: '4px',
                  right: '4px',
                  background: 'rgba(0, 0, 0, 0.8)',
                  color: 'white',
                  padding: '2px 6px',
                  fontSize: '7pt'
                }}>
                  📷 {listing.images.length}
                </div>
              )}
            </div>

            {/* Listing Details */}
            <div style={{ padding: '12px' }}>
              <div style={{
                fontSize: '8pt',
                fontWeight: 'bold',
                marginBottom: '4px',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}>
                {listing.title}
              </div>

              {/* Current Bid / Buy Now Price */}
              <div style={{ marginBottom: '6px' }}>
                <div style={{ fontSize: '10pt', fontWeight: 'bold', color: '#424242' }}>
                  {listing.listing_type === 'auction' ? 'Current Bid:' : 'Buy Now:'} {
                    formatCurrency(listing.listing_type === 'auction' ? listing.current_bid : listing.buy_now_price)
                  }
                </div>
                {listing.listing_type === 'auction' && listing.current_bid === 0 && (
                  <div style={{ fontSize: '7pt', color: '#6b7280' }}>
                    No bids yet
                  </div>
                )}
              </div>

              {/* Bid and Watch Info */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px',
                fontSize: '8pt'
              }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <span>🔨 {listing.bid_count} bids</span>
                  <span>👁️ {listing.watcher_count} watching</span>
                </div>
              </div>

              {/* Location */}
              {(listing.location_city || listing.location_state) && (
                <div style={{ fontSize: '7pt', color: '#6b7280', marginBottom: '4px' }}>
                  📍 {listing.location_city && listing.location_state ?
                    `${listing.location_city}, ${listing.location_state}` :
                    (listing.location_city || listing.location_state)
                  }
                  {listing.distance_miles && (
                    <span> • {Math.round(listing.distance_miles)} mi away</span>
                  )}
                </div>
              )}

              {/* Seller */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '7pt',
                color: '#6b7280'
              }}>
                <div>
                  Seller: {listing.seller_name}
                </div>
              </div>

              {/* Description Preview */}
              {listing.description && (
                <div style={{
                  fontSize: '7pt',
                  color: '#6b7280',
                  marginTop: '6px',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}>
                  {listing.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* No Listings Message */}
      {!loading && listings.length === 0 && (
        <div style={{
          background: 'white',
          border: '1px solid #bdbdbd',
          padding: '24px',
          textAlign: 'center',
          fontSize: '8pt',
          color: '#757575'
        }}>
          No active auctions match your criteria
        </div>
      )}
    </div>
  );
};

export default AuctionFeed;