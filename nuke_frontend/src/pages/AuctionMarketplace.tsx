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
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'var(--space-4)' }}>
        {/* Header + filters */}
        <section className="section">
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '14pt', fontWeight: 700 }}>Auction Marketplace</h1>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Browse live and upcoming auctions across the network.
                </div>
              </div>
              {user && (
                <button
                  onClick={() => navigate('/list-vehicle')}
                  className="button button-primary"
                  style={{ fontSize: '9pt' }}
                >
                  List Your Vehicle
                </button>
              )}
            </div>
            <div className="card-body">
              {/* Search */}
              <div style={{ marginBottom: '12px' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by make, model, year..."
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--border)',
                    fontSize: '9pt'
                  }}
                />
              </div>

              {/* Filters + Sort */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '12px',
                  alignItems: 'center'
                }}
              >
                {/* Filter buttons */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[
                    { id: 'all', label: 'All Auctions' },
                    { id: 'ending_soon', label: 'Ending Soon' },
                    { id: 'no_reserve', label: 'No Reserve' },
                    { id: 'new_listings', label: 'New Listings' }
                  ].map(option => (
                    <button
                      key={option.id}
                      onClick={() => setFilter(option.id as FilterType)}
                      style={{
                        padding: '4px 10px',
                        fontSize: '8pt',
                        border: filter === option.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: filter === option.id ? 'var(--accent-dim)' : 'var(--white)',
                        color: filter === option.id ? 'var(--accent)' : 'var(--text)',
                        cursor: 'pointer',
                        borderRadius: '2px',
                        fontWeight: filter === option.id ? 700 : 400
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {/* Sort dropdown */}
                <div style={{ marginLeft: 'auto', minWidth: '180px' }}>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortType)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
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
        </section>

        {/* Listings */}
        <section className="section">
          <div className="card">
            <div className="card-body">
              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', fontSize: '9pt', color: 'var(--text-muted)' }}>
                  Loading auctions...
                </div>
              ) : filteredListings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <div style={{ fontSize: '10pt', marginBottom: '8px' }}>No active auctions found</div>
                  {user && (
                    <button
                      onClick={() => navigate('/list-vehicle')}
                      className="button button-primary"
                      style={{ fontSize: '9pt' }}
                    >
                      List the First Vehicle
                    </button>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '16px'
                  }}
                >
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
        </section>
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
      style={{
        display: 'block',
        background: 'var(--white)',
        border: '2px solid var(--border)',
        borderRadius: '4px',
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.12s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--text)';
        e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Image */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          paddingBottom: '75%',
          backgroundColor: '#e5e5e5',
          overflow: 'hidden',
        }}
      >
        {vehicle.primary_image_url ? (
          <img
            src={vehicle.primary_image_url}
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10pt',
              color: 'var(--text-muted)',
            }}
          >
            No Image
          </div>
        )}

        {/* NEW badge */}
        {listing.bid_count === 0 && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              background: '#16a34a',
              color: '#fff',
              padding: '3px 8px',
              borderRadius: '3px',
              fontSize: '7pt',
              fontWeight: 700,
            }}
          >
            NEW
          </div>
        )}

        {/* No Reserve badge */}
        {!hasReserve && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: '6px',
              background: '#ea580c',
              color: '#fff',
              padding: '3px 8px',
              borderRadius: '3px',
              fontSize: '7pt',
              fontWeight: 700,
            }}
          >
            NO RESERVE
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '10px 12px' }}>
        <h3
          style={{
            fontSize: '10pt',
            fontWeight: 700,
            margin: '0 0 4px 0',
          }}
        >
          {vehicle.year} {vehicle.make} {vehicle.model}
          {vehicle.trim && ` ${vehicle.trim}`}
        </h3>

        {vehicle.mileage && (
          <div
            style={{
              fontSize: '8pt',
              color: 'var(--text-secondary)',
              marginBottom: '6px',
            }}
          >
            {vehicle.mileage.toLocaleString()} miles
          </div>
        )}

        {/* Bid + time row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '6px',
            borderTop: '1px solid var(--border-light)',
            marginTop: '4px',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '7pt',
                color: 'var(--text-muted)',
                marginBottom: '2px',
              }}
            >
              Current Bid
            </div>
            <div
              style={{
                fontSize: '11pt',
                fontWeight: 700,
                color: '#1d4ed8',
              }}
            >
              {formatCurrency(listing.current_high_bid_cents)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: '7pt',
                color: 'var(--text-muted)',
                marginBottom: '2px',
              }}
            >
              Time Left
            </div>
            <div
              style={{
                fontSize: '8pt',
                fontWeight: 600,
              }}
              className={getTimeRemainingColor(listing.auction_end_time)}
            >
              {formatTimeRemaining(listing.auction_end_time)}
            </div>
          </div>
        </div>

        {/* Footer row with bids / reserve */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '6px',
            fontSize: '8pt',
            color: 'var(--text-secondary)',
          }}
        >
          <span>
            {listing.bid_count} {listing.bid_count === 1 ? 'bid' : 'bids'}
          </span>
          {hasReserve && <span>Reserve</span>}
        </div>
      </div>
    </Link>
  );
}

