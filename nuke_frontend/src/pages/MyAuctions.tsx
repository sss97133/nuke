import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MyAuctionsService, type UnifiedListing, type AuctionStats } from '../services/myAuctionsService';
import ListingCard from '../components/auction/ListingCard';
import { supabase } from '../lib/supabase';
import '../design-system.css';

// Modal component for stats details
interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'active_listings' | 'total_views' | 'total_bids' | 'gross_sold_value' | 'sold_this_month';
  listings: UnifiedListing[];
  stats: ReturnType<typeof computeStats>;
}

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

const StatsModal: React.FC<StatsModalProps> = ({ isOpen, onClose, type, listings, stats }) => {
  if (!isOpen) return null;

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  };

  // Get vehicle financial data (purchase price, expenses) for ROI calculation
  const getVehicleFinancials = async (vehicleId: string) => {
    try {
      // Query vehicle_transaction_events for purchase/sale data
      const { data: transactions } = await supabase
        .from('vehicle_transaction_events')
        .select('transaction_type, amount_usd, transaction_date')
        .eq('vehicle_id', vehicleId)
        .in('transaction_type', ['purchase', 'sale'])
        .order('transaction_date', { ascending: false });

      const purchase = transactions?.find(t => t.transaction_type === 'purchase');
      const sale = transactions?.find(t => t.transaction_type === 'sale');

      // Query receipts for total expenses
      const { data: receipts } = await supabase
        .from('receipts')
        .select('total_amount_usd')
        .eq('vehicle_id', vehicleId);

      const totalExpenses = receipts?.reduce((sum, r) => sum + (Number(r.total_amount_usd) || 0), 0) || 0;
      const purchasePrice = purchase ? Number(purchase.amount_usd) : null;
      const salePrice = sale ? Number(sale.amount_usd) : null;

      const totalCost = purchasePrice ? purchasePrice + totalExpenses : null;
      const margin = salePrice && totalCost ? salePrice - totalCost : null;
      const roi = salePrice && purchasePrice && purchasePrice > 0 
        ? ((salePrice - purchasePrice - totalExpenses) / purchasePrice) * 100 
        : null;

      return { purchasePrice, salePrice, totalExpenses, totalCost, margin, roi };
    } catch (error) {
      console.error('Error fetching vehicle financials:', error);
      return { purchasePrice: null, salePrice: null, totalExpenses: null, totalCost: null, margin: null, roi: null };
    }
  };

  // Render pie chart (SVG)
  const renderPieChart = (data: Array<{ label: string; value: number; color: string }>) => {
    const size = 200;
    const radius = 80;
    const center = size / 2;
    
    let currentAngle = -90; // Start at top
    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) return <div style={{ padding: 'var(--space-5)', color: 'var(--text-muted)' }}>No data available</div>;
    
    const paths = data.map((item) => {
      const percentage = (item.value / total) * 100;
      const angle = (percentage / 100) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      
      const x1 = center + radius * Math.cos((startAngle * Math.PI) / 180);
      const y1 = center + radius * Math.sin((startAngle * Math.PI) / 180);
      const x2 = center + radius * Math.cos((endAngle * Math.PI) / 180);
      const y2 = center + radius * Math.sin((endAngle * Math.PI) / 180);
      
      const largeArc = angle > 180 ? 1 : 0;
      
      const pathData = [
        `M ${center} ${center}`,
        `L ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
        'Z'
      ].join(' ');
      
      currentAngle = endAngle;
      
      return { pathData, percentage, ...item };
    });

    return (
      <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'center', flexWrap: 'wrap' }}>
        <svg width={size} height={size}>
          {paths.map((path, i) => (
            <path
              key={i}
              d={path.pathData}
              fill={path.color}
              stroke="var(--surface)"
              strokeWidth="2"
            />
          ))}
        </svg>
        <div style={{ flex: 1, minWidth: '200px' }}>
          {paths.map((path, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <div style={{ width: '12px', height: '12px', backgroundColor: path.color, borderRadius: '2px' }} />
              <span style={{ fontSize: 'var(--font-size-small)', flex: 1 }}>{path.label}</span>
              <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 'bold' }}>
                {path.value.toLocaleString()} ({path.percentage.toFixed(1)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render bar chart (SVG)
  const renderBarChart = (data: Array<{ label: string; value: number; color: string }>) => {
    const width = 400;
    const height = 200;
    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    const maxValue = Math.max(...data.map(d => d.value), 1);
    const barWidth = chartWidth / data.length - 10;
    
    return (
      <svg width={width} height={height} style={{ border: '1px solid var(--border-light)' }}>
        {data.map((item, i) => {
          const barHeight = (item.value / maxValue) * chartHeight;
          const x = padding.left + i * (chartWidth / data.length);
          const y = padding.top + chartHeight - barHeight;
          
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={item.color}
              />
              <text
                x={x + barWidth / 2}
                y={y - 5}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-muted)"
              >
                {item.value.toLocaleString()}
              </text>
              <text
                x={x + barWidth / 2}
                y={height - padding.bottom + 15}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-muted)"
                transform={`rotate(-45 ${x + barWidth / 2} ${height - padding.bottom + 15})`}
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  const platformColors: Record<string, string> = {
    nzero: '#0000ff',
    bat: '#8b0000',
    ebay: '#0064d2',
    cars_and_bids: '#ff6b35',
    hemmings: '#000000',
    autotrader: '#00a0df',
    facebook_marketplace: '#1877f2',
    craigslist: '#800080',
    carscom: '#ff6600',
  };

  const getTitle = () => {
    switch (type) {
      case 'active_listings':
        return 'Active Listings';
      case 'total_views':
        return 'Total Views by Platform';
      case 'total_bids':
        return 'Total Bids by Platform';
      case 'gross_sold_value':
        return 'Gross Sold Value Breakdown';
      case 'sold_this_month':
        return 'Sold This Month';
      default:
        return 'Details';
    }
  };

  const renderContent = () => {
    switch (type) {
      case 'active_listings': {
        const activeListings = listings.filter(l => l.listing_status === 'active');
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
            {activeListings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-muted)' }}>
                No active listings
              </div>
            ) : (
              activeListings.map((listing) => (
                <ListingCard key={`${listing.listing_source}-${listing.listing_id}`} listing={listing} />
              ))
            )}
          </div>
        );
      }

      case 'total_views': {
        const viewsByPlatform = Object.entries(stats.by_platform).map(([platform, data]) => ({
          platform,
          label: platform === 'nzero' ? 'n-zero' : platform.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: listings
            .filter(l => l.platform === platform)
            .reduce((sum, l) => sum + (l.view_count || 0), 0),
          color: platformColors[platform] || '#666',
        })).filter(d => d.value > 0);

        return (
          <div>
            <p style={{ marginBottom: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
              Views distribution across platforms
            </p>
            {viewsByPlatform.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-muted)' }}>No views data available</div>
            ) : (
              <>
                {renderBarChart(viewsByPlatform)}
                <div style={{ marginTop: 'var(--space-5)' }}>
                  <h3 style={{ fontSize: 'var(--font-size)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>Listings by Platform</h3>
                  {viewsByPlatform.map((item) => {
                    const platformListings = listings.filter(l => l.platform === item.platform);
                    return (
                      <div key={item.label} style={{ marginBottom: 'var(--space-4)' }}>
                        <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, marginBottom: 'var(--space-2)', color: item.color }}>
                          {item.label} ({item.value.toLocaleString()} views)
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-3)' }}>
                          {platformListings.slice(0, 5).map((listing) => (
                            <div key={`${listing.listing_source}-${listing.listing_id}`} className="card" style={{ padding: 'var(--space-3)' }}>
                              <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700 }}>{listing.vehicle ? `${listing.vehicle.year} ${listing.vehicle.make} ${listing.vehicle.model}` : 'Unknown'}</div>
                              <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                                Views: {listing.view_count?.toLocaleString() || 0}
                              </div>
                            </div>
                          ))}
                          {platformListings.length > 5 && (
                            <div className="card" style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
                              +{platformListings.length - 5} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      }

      case 'total_bids': {
        const bidsByPlatform = Object.entries(stats.by_platform).map(([platform, data]) => ({
          platform,
          label: platform === 'nzero' ? 'n-zero' : platform.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: listings
            .filter(l => l.platform === platform)
            .reduce((sum, l) => sum + (l.bid_count || 0), 0),
          color: platformColors[platform] || '#666',
        })).filter(d => d.value > 0);

        return (
          <div>
            <p style={{ marginBottom: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
              Distribution of bids across platforms
            </p>
            {bidsByPlatform.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-muted)' }}>No bids data available</div>
            ) : (
              <>
                {renderPieChart(bidsByPlatform)}
                <div style={{ marginTop: 'var(--space-5)' }}>
                  <h3 style={{ fontSize: 'var(--font-size)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>Listings by Platform</h3>
                  {bidsByPlatform.map((item) => {
                    const platformListings = listings.filter(l => l.platform === item.platform)
                      .sort((a, b) => (b.bid_count || 0) - (a.bid_count || 0));
                    return (
                      <div key={item.label} style={{ marginBottom: 'var(--space-4)' }}>
                        <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700, marginBottom: 'var(--space-2)', color: item.color }}>
                          {item.label} ({item.value.toLocaleString()} bids)
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-3)' }}>
                          {platformListings.slice(0, 5).map((listing) => (
                            <div key={`${listing.listing_source}-${listing.listing_id}`} className="card" style={{ padding: 'var(--space-3)' }}>
                              <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700 }}>{listing.vehicle ? `${listing.vehicle.year} ${listing.vehicle.make} ${listing.vehicle.model}` : 'Unknown'}</div>
                              <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                                Bids: {listing.bid_count?.toLocaleString() || 0}
                              </div>
                            </div>
                          ))}
                          {platformListings.length > 5 && (
                            <div className="card" style={{ padding: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
                              +{platformListings.length - 5} more
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      }

      case 'gross_sold_value': {
        const soldListings = listings.filter(l => l.listing_status === 'sold' || (l.listing_status === 'ended' && l.sold_at));
        
        return (
          <div>
            <p style={{ marginBottom: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
              Sold vehicles with value breakdowns. Margin and ROI are shown when expenses are logged.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 'var(--space-4)' }}>
              {soldListings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-muted)' }}>No sold listings</div>
              ) : (
                soldListings.map((listing) => (
                  <SoldVehicleCard key={`${listing.listing_source}-${listing.listing_id}`} listing={listing} formatCurrency={formatCurrency} getVehicleFinancials={getVehicleFinancials} />
                ))
              )}
            </div>
          </div>
        );
      }

      case 'sold_this_month': {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const soldThisMonth = listings.filter(l => {
          const isSold = l.listing_status === 'sold' || (l.listing_status === 'ended' && !!l.sold_at);
          if (!isSold) return false;
          const soldAt = l.sold_at ? new Date(l.sold_at) : (l.end_date ? new Date(l.end_date) : null);
          return soldAt && !Number.isNaN(soldAt.getTime()) && soldAt >= monthStart;
        });

        return (
          <div>
            <p style={{ marginBottom: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
              Vehicles sold in {now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
              {soldThisMonth.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--text-muted)' }}>
                  No vehicles sold this month
                </div>
              ) : (
                soldThisMonth.map((listing) => (
                  <ListingCard key={`${listing.listing_source}-${listing.listing_id}`} listing={listing} />
                ))
              )}
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--space-4)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '1200px',
          maxHeight: '90vh',
          overflow: 'auto',
          background: 'var(--surface)',
          border: '2px solid var(--border-light)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-4)' }}>
          <span style={{ fontSize: 'var(--font-size)', fontWeight: 700 }}>{getTitle()}</span>
          <button
            className="button button-small"
            onClick={onClose}
            style={{
              padding: 'var(--space-1) var(--space-2)',
              fontSize: 'var(--font-size-small)',
              minWidth: 'auto',
            }}
          >
            CLOSE
          </button>
        </div>
        <div className="card-body" style={{ padding: 'var(--space-4)' }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

// Component for sold vehicle card with financials
const SoldVehicleCard: React.FC<{
  listing: UnifiedListing;
  formatCurrency: (value: number) => string;
  getVehicleFinancials: (vehicleId: string) => Promise<{
    purchasePrice: number | null;
    salePrice: number | null;
    totalExpenses: number | null;
    totalCost: number | null;
    margin: number | null;
    roi: number | null;
  }>;
}> = ({ listing, formatCurrency, getVehicleFinancials }) => {
  const [financials, setFinancials] = React.useState<{
    purchasePrice: number | null;
    salePrice: number | null;
    totalExpenses: number | null;
    totalCost: number | null;
    margin: number | null;
    roi: number | null;
  } | null>(null);
  const [loadingFinancials, setLoadingFinancials] = React.useState(false);
  const fetchedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (listing.vehicle_id && fetchedRef.current !== listing.vehicle_id) {
      fetchedRef.current = listing.vehicle_id;
      setLoadingFinancials(true);
      getVehicleFinancials(listing.vehicle_id).then(f => {
        setFinancials(f);
        setLoadingFinancials(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.vehicle_id]);

  const hasExpenses = financials && (financials.purchasePrice !== null || financials.totalExpenses !== null);

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 700 }}>
          {listing.vehicle ? `${listing.vehicle.year} ${listing.vehicle.make} ${listing.vehicle.model}` : 'Unknown Vehicle'}
        </div>
      </div>
      <div className="card-body">
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>Sale Price</div>
          <div style={{ fontSize: 'var(--font-size)', fontWeight: 'bold' }}>
            {formatCurrency(listing.final_price || 0)}
          </div>
        </div>

        {loadingFinancials ? (
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-disabled)' }}>Loading financial data...</div>
        ) : hasExpenses ? (
          <div style={{ padding: 'var(--space-2)', backgroundColor: 'var(--bg)', fontSize: 'var(--font-size-small)' }}>
            {financials.purchasePrice !== null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Purchase Price:</span>
                <span>{formatCurrency(financials.purchasePrice)}</span>
              </div>
            )}
            {financials.totalExpenses !== null && financials.totalExpenses > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Expenses:</span>
                <span>{formatCurrency(financials.totalExpenses)}</span>
              </div>
            )}
            {financials.totalCost !== null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)', borderTop: '1px solid var(--border-light)', paddingTop: 'var(--space-1)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Cost:</span>
                <span style={{ fontWeight: 700 }}>{formatCurrency(financials.totalCost)}</span>
              </div>
            )}
            {financials.margin !== null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Margin:</span>
                <span style={{ fontWeight: 700, color: financials.margin >= 0 ? 'var(--success)' : 'var(--error)' }}>
                  {formatCurrency(financials.margin)} ({financials.margin >= 0 ? '+' : ''}{((financials.margin / (financials.totalCost || 1)) * 100).toFixed(1)}%)
                </span>
              </div>
            )}
            {financials.roi !== null && financials.purchasePrice !== null && financials.purchasePrice > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-light)', paddingTop: 'var(--space-1)' }}>
                <span style={{ color: 'var(--text-muted)' }}>ROI:</span>
                <span style={{ fontWeight: 700, color: financials.roi >= 0 ? 'var(--success)' : 'var(--error)' }}>
                  {financials.roi >= 0 ? '+' : ''}{financials.roi.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-disabled)', fontStyle: 'italic' }}>
            Expense data not available. Log purchase price and expenses to see margin and ROI.
          </div>
        )}

        <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
          Platform: {listing.platform === 'nzero' ? 'n-zero' : listing.platform.replace(/_/g, ' ')}
          {listing.sold_at && ` • Sold: ${new Date(listing.sold_at).toLocaleDateString()}`}
        </div>
      </div>
    </div>
  );
};

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
  const [modalType, setModalType] = useState<'active_listings' | 'total_views' | 'total_bids' | 'gross_sold_value' | 'sold_this_month' | null>(null);

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
        <div
          style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          onClick={() => setModalType('active_listings')}
        >
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
            Active Listings
          </div>
          <div className="stat-number" style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text)' }}>{stats.active_listings}</div>
        </div>
        <div
          style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          onClick={() => setModalType('total_views')}
        >
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
            Total Views
          </div>
          <div className="stat-number" style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text)' }}>
            {stats.total_views.toLocaleString()}
          </div>
        </div>
        <div
          style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          onClick={() => setModalType('total_bids')}
        >
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
            Total Bids
          </div>
          <div className="stat-number" style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text)' }}>{stats.total_bids}</div>
        </div>
        <div
          style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          onClick={() => setModalType('gross_sold_value')}
        >
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
            Gross Sold Value
          </div>
          <div className="stat-number" style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text)' }}>
            {formatCurrency(stats.total_value)}
          </div>
        </div>
        <div
          style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          onClick={() => setModalType('sold_this_month')}
        >
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
            Sold This Month
          </div>
          <div className="stat-number" style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text)' }}>
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
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', fontWeight: 700 }}>
            Personal (Your vehicles / your exports)
          </div>
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
            Sold: <strong style={{ color: 'var(--text)' }}>{stats.personal.sold_listings}</strong>{' '}
            · Gross: <strong style={{ color: 'var(--text)' }}>{formatCurrency(stats.personal.total_value)}</strong>{' '}
            · Views: <strong style={{ color: 'var(--text)' }}>{stats.personal.total_views.toLocaleString()}</strong>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', fontWeight: 700 }}>
            Organization-access (based on your org role)
          </div>
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
            Sold: <strong style={{ color: 'var(--text)' }}>{stats.organizations.sold_listings}</strong>{' '}
            · Gross: <strong style={{ color: 'var(--text)' }}>{formatCurrency(stats.organizations.total_value)}</strong>{' '}
            · Views: <strong style={{ color: 'var(--text)' }}>{stats.organizations.total_views.toLocaleString()}</strong>
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

      {/* Stats Modal */}
      {modalType && (
        <StatsModal
          isOpen={!!modalType}
          onClose={() => setModalType(null)}
          type={modalType}
          listings={listings}
          stats={stats}
        />
      )}
    </div>
  );
};

export default MyAuctions;



