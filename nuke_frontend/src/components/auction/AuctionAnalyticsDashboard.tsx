/**
 * Auction Analytics Dashboard
 * Shows performance metrics for auctions and multi-platform exports
 */

import { useState, useEffect } from 'react';
import { ListingExportService, ExportAnalytics } from '../../services/listingExportService';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import '../../design-system.css';

interface AuctionStats {
  total_listings: number;
  active_auctions: number;
  completed_sales: number;
  total_revenue_cents: number;
  average_sale_price_cents: number;
  total_bids: number;
  conversion_rate: number;
}

export default function AuctionAnalyticsDashboard() {
  const { user } = useAuth();
  const [auctionStats, setAuctionStats] = useState<AuctionStats | null>(null);
  const [exportAnalytics, setExportAnalytics] = useState<ExportAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'auctions' | 'exports'>('overview');

  useEffect(() => {
    if (user) {
      loadAnalytics();
    }
  }, [user]);

  const loadAnalytics = async () => {
    setLoading(true);

    // Load auction stats
    const { data: listings, error: listingsError } = await supabase
      .from('vehicle_listings')
      .select('*')
      .eq('seller_id', user?.id);

    if (!listingsError && listings) {
      const stats: AuctionStats = {
        total_listings: listings.length,
        active_auctions: listings.filter(l => l.status === 'active').length,
        completed_sales: listings.filter(l => l.status === 'sold').length,
        total_revenue_cents: listings
          .filter(l => l.status === 'sold')
          .reduce((sum, l) => sum + (l.sold_price_cents || 0), 0),
        average_sale_price_cents: 0,
        total_bids: listings.reduce((sum, l) => sum + (l.bid_count || 0), 0),
        conversion_rate: 0
      };

      if (stats.completed_sales > 0) {
        stats.average_sale_price_cents = stats.total_revenue_cents / stats.completed_sales;
        stats.conversion_rate = (stats.completed_sales / stats.total_listings) * 100;
      }

      setAuctionStats(stats);
    }

    // Load export analytics
    const exportData = await ListingExportService.getExportAnalytics();
    setExportAnalytics(exportData);

    setLoading(false);
  };

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  if (loading) {
    return (
      <div className="p-6 text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="mt-4 text-gray-600">Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Auction & Export Analytics</h1>
        <button
          onClick={loadAnalytics}
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-2 px-1 border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('auctions')}
            className={`pb-2 px-1 border-b-2 transition-colors ${
              activeTab === 'auctions'
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            N-Zero Auctions
          </button>
          <button
            onClick={() => setActiveTab('exports')}
            className={`pb-2 px-1 border-b-2 transition-colors ${
              activeTab === 'exports'
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            External Platforms
          </button>
        </div>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Listings"
              value={(auctionStats?.total_listings || 0) + (exportAnalytics?.total_exports || 0)}
              subtitle="Across all platforms"
              icon="📊"
            />
            <MetricCard
              title="Active Auctions"
              value={auctionStats?.active_auctions || 0}
              subtitle="Live on N-Zero"
              icon="⚡"
            />
            <MetricCard
              title="Total Sales"
              value={(auctionStats?.completed_sales || 0) + (exportAnalytics?.total_sold || 0)}
              subtitle="All platforms combined"
              icon="✅"
            />
            <MetricCard
              title="Total Revenue"
              value={formatCurrency(
                (auctionStats?.total_revenue_cents || 0) + (exportAnalytics?.total_revenue_cents || 0)
              )}
              subtitle="All platforms"
              icon="💰"
            />
          </div>

          {/* Combined Performance */}
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h2 className="text-xl font-bold mb-4">Overall Performance</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-600 mb-1">Average Sale Price</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(auctionStats?.average_sale_price_cents || 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Overall Conversion Rate</p>
                <p className="text-2xl font-bold">
                  {formatPercent(
                    ((auctionStats?.completed_sales || 0) + (exportAnalytics?.total_sold || 0)) /
                    ((auctionStats?.total_listings || 1) + (exportAnalytics?.total_exports || 1)) * 100
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Bids Received</p>
                <p className="text-2xl font-bold">{auctionStats?.total_bids || 0}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* N-Zero Auctions Tab */}
      {activeTab === 'auctions' && auctionStats && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Listings"
              value={auctionStats.total_listings}
              subtitle="N-Zero marketplace"
              icon="🏠"
            />
            <MetricCard
              title="Active Now"
              value={auctionStats.active_auctions}
              subtitle="Live auctions"
              icon="⚡"
            />
            <MetricCard
              title="Completed Sales"
              value={auctionStats.completed_sales}
              subtitle="Successful auctions"
              icon="✅"
            />
            <MetricCard
              title="Total Bids"
              value={auctionStats.total_bids}
              subtitle="Bidding activity"
              icon="🔨"
            />
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h2 className="text-xl font-bold mb-4">N-Zero Auction Performance</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Revenue</p>
                <p className="text-2xl font-bold">{formatCurrency(auctionStats.total_revenue_cents)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Average Sale Price</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(auctionStats.average_sale_price_cents)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Conversion Rate</p>
                <p className="text-2xl font-bold">{formatPercent(auctionStats.conversion_rate)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* External Platforms Tab */}
      {activeTab === 'exports' && exportAnalytics && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Exports"
              value={exportAnalytics.total_exports}
              subtitle="All platforms"
              icon="📤"
            />
            <MetricCard
              title="Sales via Exports"
              value={exportAnalytics.total_sold}
              subtitle="External platforms"
              icon="✅"
            />
            <MetricCard
              title="Export Revenue"
              value={formatCurrency(exportAnalytics.total_revenue_cents)}
              subtitle="From external platforms"
              icon="💰"
            />
            <MetricCard
              title="Conversion Rate"
              value={formatPercent(exportAnalytics.conversion_rate)}
              subtitle="Export success rate"
              icon="📈"
            />
          </div>

          {/* Platform Breakdown */}
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h2 className="text-xl font-bold mb-4">Platform Breakdown</h2>
            <div className="space-y-3">
              {Object.entries(exportAnalytics.by_platform || {}).map(([platform, count]) => (
                <div key={platform} className="flex justify-between items-center">
                  <span className="font-medium capitalize">{platform}</span>
                  <span className="text-gray-600">{count} exports</span>
                </div>
              ))}
            </div>
          </div>

          {/* Status Breakdown */}
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <h2 className="text-xl font-bold mb-4">Export Status</h2>
            <div className="space-y-3">
              {Object.entries(exportAnalytics.by_status || {}).map(([status, count]) => (
                <div key={status} className="flex justify-between items-center">
                  <span className="font-medium capitalize">{status}</span>
                  <span className="text-gray-600">{count} exports</span>
                </div>
              ))}
            </div>
          </div>

          {/* Commission Tracking */}
          {exportAnalytics.total_commission_cents > 0 && (
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h2 className="text-xl font-bold mb-4">Commission Earned</h2>
              <p className="text-3xl font-bold text-green-600">
                {formatCurrency(exportAnalytics.total_commission_cents)}
              </p>
              <p className="text-sm text-gray-600 mt-2">
                From {exportAnalytics.total_sold} successful sales via external platforms
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle: string;
  icon: string;
}

function MetricCard({ title, value, subtitle, icon }: MetricCardProps) {
  return (
    <div className="bg-white p-6 rounded-lg border border-gray-200">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-600">{title}</h3>
        <span className="text-2xl">{icon}</span>
      </div>
      <p className="text-3xl font-bold mb-1">{value}</p>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </div>
  );
}

