import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MyAuctionsService, type UnifiedListing, type AuctionStats } from '../services/myAuctionsService';
import ListingCard from '../components/auction/ListingCard';
import '../design-system.css';

const MyAuctions: React.FC = () => {
  const navigate = useNavigate();
  const [listings, setListings] = useState<UnifiedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{
    status?: string;
    platform?: string;
    scope?: 'all' | 'personal' | 'organization';
    sortBy: 'ending_soon' | 'newest' | 'highest_bid' | 'most_views' | 'most_bids';
  }>({
    sortBy: 'ending_soon',
    scope: 'all',
  });
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadListings();
  }, [filters]);

  const loadListings = async () => {
    try {
      setLoading(true);
      const data = await MyAuctionsService.getMyListings(filters);
      // Apply scope filter client-side (supabase OR conditions vary by schema)
      const scoped = (filters.scope && filters.scope !== 'all')
        ? data.filter(l => (l.scope || 'personal') === filters.scope)
        : data;
      setListings(scoped);
    } catch (error) {
      console.error('Error loading listings:', error);
    } finally {
      setLoading(false);
    }
  };

  const computeStats = (rows: UnifiedListing[]): AuctionStats & {
    sold_this_month_count: number;
    sold_this_month_value: number;
    personal: AuctionStats;
    organizations: AuctionStats & { by_org: Record<string, AuctionStats & { org_name?: string; org_role?: string }> };
  } => {
    const empty: AuctionStats = {
      total_listings: 0,
      active_listings: 0,
      sold_listings: 0,
      total_value: 0,
      total_views: 0,
      total_bids: 0,
      by_platform: {},
    };

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const isSold = (l: UnifiedListing) => l.listing_status === 'sold' || (l.listing_status === 'ended' && !!l.sold_at);
    const isActive = (l: UnifiedListing) => l.listing_status === 'active';

    const addTo = (agg: AuctionStats, l: UnifiedListing) => {
      agg.total_listings += 1;
      if (isActive(l)) agg.active_listings += 1;
      if (isSold(l)) {
        agg.sold_listings += 1;
        agg.total_value += l.final_price || 0;
      }
      agg.total_views += l.view_count || 0;
      agg.total_bids += l.bid_count || 0;

      const platform = l.platform || 'unknown';
      if (!agg.by_platform[platform]) agg.by_platform[platform] = { count: 0, sold: 0, value: 0 };
      agg.by_platform[platform].count += 1;
      if (isSold(l)) {
        agg.by_platform[platform].sold += 1;
        agg.by_platform[platform].value += l.final_price || 0;
      }
    };

    const total: AuctionStats = { ...empty, by_platform: {} };
    const personal: AuctionStats = { ...empty, by_platform: {} };
    const organizations: AuctionStats & { by_org: Record<string, AuctionStats & { org_name?: string; org_role?: string }> } = {
      ...empty,
      by_platform: {},
      by_org: {},
    };

    let soldThisMonthCount = 0;
    let soldThisMonthValue = 0;

    for (const l of rows) {
      addTo(total, l);

      const scope = l.scope || 'personal';
      if (scope === 'organization') {
        addTo(organizations, l);
        const orgKey = l.organization_id || 'unknown_org';
        if (!organizations.by_org[orgKey]) {
          organizations.by_org[orgKey] = { ...empty, by_platform: {}, org_name: l.organization_name, org_role: l.access_role };
        }
        addTo(organizations.by_org[orgKey], l);
      } else {
        addTo(personal, l);
      }

      if (isSold(l)) {
        const soldAt = l.sold_at ? new Date(l.sold_at) : (l.end_date ? new Date(l.end_date) : null);
        if (soldAt && !Number.isNaN(soldAt.getTime()) && soldAt >= monthStart) {
          soldThisMonthCount += 1;
          soldThisMonthValue += l.final_price || 0;
        }
      }
    }

    return {
      ...total,
      sold_this_month_count: soldThisMonthCount,
      sold_this_month_value: soldThisMonthValue,
      personal,
      organizations,
    };
  };

  const stats = React.useMemo(() => computeStats(listings), [listings]);

  const handleSync = async (listingId: string, listingSource: 'native' | 'external' | 'export', platform: string) => {
    setSyncing(true);
    try {
      const result = await MyAuctionsService.syncListing(listingId, listingSource, platform);
      if (result.success) {
        await loadListings();
        alert('Listing synced successfully');
      } else {
        alert(result.error || 'Failed to sync listing');
      }
    } catch (error) {
      console.error('Error syncing listing:', error);
      alert('Failed to sync listing');
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAll = async () => {
    if (!confirm('Sync all active listings? This may take a moment.')) return;
    setSyncing(true);
    try {
      const result = await MyAuctionsService.syncAllListings();
      if (result.success) {
        await loadListings();
        alert(`Synced ${result.synced} listings. ${result.failed} failed.`);
      } else {
        alert('Failed to sync listings');
      }
    } catch (error) {
      console.error('Error syncing all listings:', error);
      alert('Failed to sync listings');
    } finally {
      setSyncing(false);
    }
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
        Loading auctions...
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h1 className="heading-1" style={{ marginBottom: 'var(--space-2)' }}>
          My Auctions
        </h1>
        <p style={{ color: '#666', fontSize: '14px' }}>
          Track all your vehicle listings across all platforms
        </p>
      </div>

      {/* Summary Stats */}
      <div
        className="card"
        style={{
          marginBottom: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'rgba(59, 130, 246, 0.05)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          fontSize: '12px',
          color: '#555',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: '4px', color: '#333' }}>Attribution & Permissions</div>
        <div>
          This dashboard separates <strong>Personal</strong> auctions from <strong>Organization-access</strong> auctions.
          Organization auctions may be visible because you are an active org contributor (e.g. board member) and <strong>do not imply personal profit</strong>.
          Margin/payouts are intentionally not shown here.
        </div>
      </div>

      <div
        className="card"
        style={{
          marginBottom: 'var(--space-4)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)',
        }}
      >
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Active Listings
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.active_listings}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Total Views
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {stats.total_views.toLocaleString()}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Total Bids
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.total_bids}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Gross Sold Value
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {formatCurrency(stats.total_value)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Sold This Month
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {stats.sold_this_month_count} ({formatCurrency(stats.sold_this_month_value)})
          </div>
        </div>
      </div>

      {/* Scope Breakdown */}
      <div
        className="card"
        style={{
          marginBottom: 'var(--space-4)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)',
        }}
      >
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '6px', fontWeight: 700 }}>
            Personal (Your vehicles / your exports)
          </div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            Sold: <strong style={{ color: '#111' }}>{stats.personal.sold_listings}</strong>{' '}
            · Gross: <strong style={{ color: '#111' }}>{formatCurrency(stats.personal.total_value)}</strong>{' '}
            · Views: <strong style={{ color: '#111' }}>{stats.personal.total_views.toLocaleString()}</strong>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '6px', fontWeight: 700 }}>
            Organization-access (based on your org role)
          </div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            Sold: <strong style={{ color: '#111' }}>{stats.organizations.sold_listings}</strong>{' '}
            · Gross: <strong style={{ color: '#111' }}>{formatCurrency(stats.organizations.total_value)}</strong>{' '}
            · Views: <strong style={{ color: '#111' }}>{stats.organizations.total_views.toLocaleString()}</strong>
          </div>
        </div>
      </div>

      {/* Filters & Sort */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <select
          value={filters.scope || 'all'}
          onChange={(e) =>
            setFilters({ ...filters, scope: (e.target.value as any) === 'all' ? 'all' : (e.target.value as any) })
          }
          style={{
            padding: '6px 12px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          <option value="all">All (Accessible)</option>
          <option value="personal">Personal</option>
          <option value="organization">Organization-access</option>
        </select>

        <select
          value={filters.status || 'all'}
          onChange={(e) =>
            setFilters({ ...filters, status: e.target.value === 'all' ? undefined : e.target.value })
          }
          style={{
            padding: '6px 12px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="sold">Sold</option>
          <option value="expired">Expired</option>
        </select>

        <select
          value={filters.platform || 'all'}
          onChange={(e) =>
            setFilters({ ...filters, platform: e.target.value === 'all' ? undefined : e.target.value })
          }
          style={{
            padding: '6px 12px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          <option value="all">All Platforms</option>
          <option value="nzero">n-zero</option>
          <option value="bat">Bring a Trailer</option>
          <option value="ebay">eBay Motors</option>
          <option value="cars_and_bids">Cars & Bids</option>
          <option value="hemmings">Hemmings</option>
          <option value="autotrader">AutoTrader</option>
          <option value="facebook_marketplace">Facebook Marketplace</option>
        </select>

        <select
          value={filters.sortBy}
          onChange={(e) =>
            setFilters({
              ...filters,
              sortBy: e.target.value as 'ending_soon' | 'newest' | 'highest_bid' | 'most_views' | 'most_bids',
            })
          }
          style={{
            padding: '6px 12px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          <option value="ending_soon">Ending Soon</option>
          <option value="newest">Newest</option>
          <option value="highest_bid">Highest Bid</option>
          <option value="most_views">Most Views</option>
          <option value="most_bids">Most Bids</option>
        </select>

        <div style={{ flex: 1 }} />

        <button
          className="cursor-button"
          onClick={handleSyncAll}
          disabled={syncing}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            backgroundColor: '#666',
            opacity: syncing ? 0.5 : 1,
          }}
        >
          {syncing ? 'SYNCING...' : 'SYNC ALL'}
        </button>

        <button
          className="cursor-button"
          onClick={() => navigate('/auctions')}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            backgroundColor: '#0000ff',
          }}
        >
          BROWSE AUCTIONS
        </button>
      </div>

      {/* Listings Grid */}
      {listings.length === 0 ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
          <div style={{ fontSize: '18px', marginBottom: '10px' }}>No Listings Found</div>
          <div style={{ fontSize: '14px', marginBottom: '20px' }}>
            {filters.status === 'active'
              ? 'You have no active listings.'
              : 'Start listing vehicles to track them here.'}
          </div>
          <button
            className="cursor-button"
            onClick={() => navigate('/auctions')}
            style={{ padding: '10px 20px' }}
          >
            Browse Auctions
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {listings.map((listing) => (
            <ListingCard key={`${listing.listing_source}-${listing.listing_id}`} listing={listing} onSync={handleSync} />
          ))}
        </div>
      )}
    </div>
  );
};

export default MyAuctions;



