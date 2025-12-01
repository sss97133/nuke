import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface MarketStats {
  total_discovered: number;
  discovered_today: number;
  discovered_this_week: number;
  discovered_this_month: number;
  average_price: number;
  price_range: { min: number; max: number };
  regions_active: number;
  with_images: number;
  processing_rate: number;
}

interface RecentDiscovery {
  id: string;
  year: number;
  make: string;
  model: string;
  asking_price: number | null;
  location: string | null;
  image_url: string | null;
  discovered_at: string;
  listing_url: string;
}

interface PriceTrend {
  date: string;
  count: number;
  avg_price: number;
}

interface RegionActivity {
  region: string;
  count: number;
}

const SquarebodyMarketDashboard: React.FC = () => {
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [recentDiscoveries, setRecentDiscoveries] = useState<RecentDiscovery[]>([]);
  const [priceTrends, setPriceTrends] = useState<PriceTrend[]>([]);
  const [regionActivity, setRegionActivity] = useState<RegionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    loadData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      loadData();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      // Get market stats
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Total discovered (from queue complete + existing vehicles)
      const { data: queueComplete, error: queueError } = await supabase
        .from('craigslist_listing_queue')
        .select('id, processed_at, vehicle_id')
        .eq('status', 'complete');

      const { data: vehicles, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('id, created_at, asking_price, discovery_source, discovery_url')
        .eq('discovery_source', 'craigslist_scrape')
        .order('created_at', { ascending: false });

      if (vehiclesError) throw vehiclesError;

      // Calculate stats
      const totalDiscovered = vehicles?.length || 0;
      const discoveredToday = vehicles?.filter(v => 
        new Date(v.created_at) >= today
      ).length || 0;
      const discoveredThisWeek = vehicles?.filter(v => 
        new Date(v.created_at) >= weekAgo
      ).length || 0;
      const discoveredThisMonth = vehicles?.filter(v => 
        new Date(v.created_at) >= monthAgo
      ).length || 0;

      // Price stats
      const prices = vehicles
        ?.map(v => v.asking_price)
        .filter((p): p is number => p !== null && p > 0) || [];
      
      const avgPrice = prices.length > 0
        ? prices.reduce((sum, p) => sum + p, 0) / prices.length
        : 0;
      
      const priceRange = prices.length > 0
        ? { min: Math.min(...prices), max: Math.max(...prices) }
        : { min: 0, max: 0 };

      // Regions active (from discovery URLs)
      const regions = new Set<string>();
      vehicles?.forEach(v => {
        if (v.discovery_url) {
          const match = v.discovery_url.match(/https?:\/\/([^.]+)\.craigslist\.org/);
          if (match) regions.add(match[1]);
        }
      });

      // With images
      const vehicleIds = vehicles?.map(v => v.id) || [];
      const { count: imageCount } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .in('vehicle_id', vehicleIds.slice(0, 100)); // Sample first 100

      // Processing rate (vehicles per day this week)
      const processingRate = discoveredThisWeek / 7;

      setStats({
        total_discovered: totalDiscovered,
        discovered_today: discoveredToday,
        discovered_this_week: discoveredThisWeek,
        discovered_this_month: discoveredThisMonth,
        average_price: avgPrice,
        price_range: priceRange,
        regions_active: regions.size,
        with_images: imageCount || 0,
        processing_rate: processingRate
      });

      // Recent discoveries with details
      const recentVehicles = vehicles?.slice(0, 12) || [];
      const recentWithDetails = await Promise.all(
        recentVehicles.map(async (v) => {
          // Get primary image
          const { data: image } = await supabase
            .from('vehicle_images')
            .select('image_url')
            .eq('vehicle_id', v.id)
            .eq('is_primary', true)
            .limit(1)
            .maybeSingle();

          // Get vehicle details
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('year, make, model, asking_price, discovery_url')
            .eq('id', v.id)
            .single();

          // Extract location from discovery URL
          let location = null;
          if (v.discovery_url) {
            const match = v.discovery_url.match(/https?:\/\/([^.]+)\.craigslist\.org/);
            if (match) {
              location = match[1].replace(/([A-Z])/g, ' $1').trim();
            }
          }

          return {
            id: v.id,
            year: vehicle?.year || 0,
            make: vehicle?.make || '',
            model: vehicle?.model || '',
            asking_price: vehicle?.asking_price || null,
            location: location,
            image_url: image?.image_url || null,
            discovered_at: v.created_at,
            listing_url: v.discovery_url || ''
          };
        })
      );

      setRecentDiscoveries(recentWithDetails);

      // Price trends (last 7 days)
      const trendData: PriceTrend[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        
        const dayVehicles = vehicles?.filter(v => {
          const created = new Date(v.created_at);
          return created >= dayStart && created < dayEnd;
        }) || [];

        const dayPrices = dayVehicles
          .map(v => v.asking_price)
          .filter((p): p is number => p !== null && p > 0);

        trendData.push({
          date: date.toISOString().split('T')[0],
          count: dayVehicles.length,
          avg_price: dayPrices.length > 0
            ? dayPrices.reduce((sum, p) => sum + p, 0) / dayPrices.length
            : 0
        });
      }

      setPriceTrends(trendData);

      // Region activity
      const regionCounts: Record<string, number> = {};
      vehicles?.forEach(v => {
        if (v.discovery_url) {
          const match = v.discovery_url.match(/https?:\/\/([^.]+)\.craigslist\.org/);
          if (match) {
            const region = match[1];
            regionCounts[region] = (regionCounts[region] || 0) + 1;
          }
        }
      });

      const regionArray = Object.entries(regionCounts)
        .map(([region, count]) => ({ region, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      setRegionActivity(regionArray);

      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error loading market data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !stats) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '8pt' }}>Loading market data...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ 
          fontSize: '16pt', 
          fontWeight: '700', 
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          Squarebody Market Intelligence
        </h1>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Real-time tracking of 1973-1991 Chevy/GMC squarebody trucks discovered on Craigslist
        </p>
        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
          Last updated: {lastUpdate.toLocaleTimeString()} • Auto-refreshes every 30 seconds
        </div>
      </div>

      {/* Market Pulse */}
      {stats && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '16px', 
          marginBottom: '32px' 
        }}>
          <div className="card" style={{ padding: '20px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
            <div style={{ fontSize: '7pt', opacity: 0.9, marginBottom: '8px', textTransform: 'uppercase' }}>
              Total Discovered
            </div>
            <div style={{ fontSize: '24pt', fontWeight: '700' }}>
              {stats.total_discovered.toLocaleString()}
            </div>
            <div style={{ fontSize: '7pt', opacity: 0.8, marginTop: '4px' }}>
              Squarebodies tracked
            </div>
          </div>

          <div className="card" style={{ padding: '20px', background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', color: 'white' }}>
            <div style={{ fontSize: '7pt', opacity: 0.9, marginBottom: '8px', textTransform: 'uppercase' }}>
              Discovered Today
            </div>
            <div style={{ fontSize: '24pt', fontWeight: '700' }}>
              {stats.discovered_today}
            </div>
            <div style={{ fontSize: '7pt', opacity: 0.8, marginTop: '4px' }}>
              New listings found
            </div>
          </div>

          <div className="card" style={{ padding: '20px', background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', color: 'white' }}>
            <div style={{ fontSize: '7pt', opacity: 0.9, marginBottom: '8px', textTransform: 'uppercase' }}>
              This Week
            </div>
            <div style={{ fontSize: '24pt', fontWeight: '700' }}>
              {stats.discovered_this_week}
            </div>
            <div style={{ fontSize: '7pt', opacity: 0.8, marginTop: '4px' }}>
              {stats.processing_rate.toFixed(1)} per day
            </div>
          </div>

          <div className="card" style={{ padding: '20px', background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', color: 'white' }}>
            <div style={{ fontSize: '7pt', opacity: 0.9, marginBottom: '8px', textTransform: 'uppercase' }}>
              Avg Price
            </div>
            <div style={{ fontSize: '24pt', fontWeight: '700' }}>
              ${stats.average_price > 0 ? stats.average_price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : 'N/A'}
            </div>
            <div style={{ fontSize: '7pt', opacity: 0.8, marginTop: '4px' }}>
              {stats.price_range.min > 0 && stats.price_range.max > 0 
                ? `$${stats.price_range.min.toLocaleString()} - $${stats.price_range.max.toLocaleString()}`
                : 'Price range'}
            </div>
          </div>

          <div className="card" style={{ padding: '20px', background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', color: 'white' }}>
            <div style={{ fontSize: '7pt', opacity: 0.9, marginBottom: '8px', textTransform: 'uppercase' }}>
              Active Regions
            </div>
            <div style={{ fontSize: '24pt', fontWeight: '700' }}>
              {stats.regions_active}
            </div>
            <div style={{ fontSize: '7pt', opacity: 0.8, marginTop: '4px' }}>
              Markets monitored
            </div>
          </div>
        </div>
      )}

      {/* Recent Discoveries */}
      <div className="card" style={{ padding: '24px', marginBottom: '32px' }}>
        <h2 style={{ 
          fontSize: '10pt', 
          fontWeight: '700', 
          textTransform: 'uppercase', 
          letterSpacing: '0.5px',
          marginBottom: '20px'
        }}>
          Recent Discoveries
        </h2>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
          gap: '16px' 
        }}>
          {recentDiscoveries.map((discovery) => (
            <a
              key={discovery.id}
              href={discovery.listing_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: 'none',
                color: 'inherit',
                display: 'block'
              }}
            >
              <div className="card" style={{ 
                padding: '0',
                overflow: 'hidden',
                border: '2px solid var(--border)',
                transition: 'all 0.12s ease',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
              >
                {discovery.image_url ? (
                  <img
                    src={discovery.image_url}
                    alt={`${discovery.year} ${discovery.make} ${discovery.model}`}
                    style={{
                      width: '100%',
                      height: '150px',
                      objectFit: 'cover',
                      backgroundColor: 'var(--bg-secondary)'
                    }}
                  />
                ) : (
                  <div style={{
                    width: '100%',
                    height: '150px',
                    backgroundColor: 'var(--bg-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '8pt'
                  }}>
                    No Image
                  </div>
                )}
                <div style={{ padding: '12px' }}>
                  <div style={{ 
                    fontSize: '9pt', 
                    fontWeight: '700', 
                    marginBottom: '4px' 
                  }}>
                    {discovery.year} {discovery.make} {discovery.model}
                  </div>
                  {discovery.asking_price && (
                    <div style={{ 
                      fontSize: '10pt', 
                      fontWeight: '700', 
                      color: 'var(--accent)',
                      marginBottom: '4px'
                    }}>
                      ${discovery.asking_price.toLocaleString()}
                    </div>
                  )}
                  {discovery.location && (
                    <div style={{ 
                      fontSize: '7pt', 
                      color: 'var(--text-muted)',
                      textTransform: 'capitalize'
                    }}>
                      {discovery.location}
                    </div>
                  )}
                  <div style={{ 
                    fontSize: '7pt', 
                    color: 'var(--text-muted)',
                    marginTop: '4px'
                  }}>
                    {new Date(discovery.discovered_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Market Trends & Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
        {/* 7-Day Activity Trend */}
        <div className="card" style={{ padding: '24px' }}>
          <h2 style={{ 
            fontSize: '10pt', 
            fontWeight: '700', 
            textTransform: 'uppercase', 
            letterSpacing: '0.5px',
            marginBottom: '20px'
          }}>
            7-Day Discovery Trend
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {priceTrends.map((trend) => {
              const maxCount = Math.max(...priceTrends.map(t => t.count), 1);
              const barWidth = (trend.count / maxCount) * 100;
              
              return (
                <div key={trend.date}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    marginBottom: '4px',
                    fontSize: '8pt'
                  }}>
                    <span style={{ fontWeight: '700' }}>
                      {new Date(trend.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <span style={{ color: 'var(--accent)', fontWeight: '700' }}>
                      {trend.count} discovered
                    </span>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '20px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-light)'
                  }}>
                    <div style={{
                      width: `${barWidth}%`,
                      height: '100%',
                      backgroundColor: 'var(--accent)',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                  {trend.avg_price > 0 && (
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                      Avg: ${trend.avg_price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Regions */}
        <div className="card" style={{ padding: '24px' }}>
          <h2 style={{ 
            fontSize: '10pt', 
            fontWeight: '700', 
            textTransform: 'uppercase', 
            letterSpacing: '0.5px',
            marginBottom: '20px'
          }}>
            Top Markets
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {regionActivity.map((region, index) => {
              const maxCount = Math.max(...regionActivity.map(r => r.count), 1);
              const barWidth = (region.count / maxCount) * 100;
              
              return (
                <div key={region.region}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    marginBottom: '4px',
                    fontSize: '8pt'
                  }}>
                    <span style={{ fontWeight: '700', textTransform: 'capitalize' }}>
                      #{index + 1} {region.region.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <span style={{ color: 'var(--accent)', fontWeight: '700' }}>
                      {region.count}
                    </span>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '20px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-light)'
                  }}>
                    <div style={{
                      width: `${barWidth}%`,
                      height: '100%',
                      backgroundColor: index < 3 ? 'var(--accent)' : 'var(--text-muted)',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Market Health Indicator */}
      {stats && (
        <div className="card" style={{ padding: '24px', background: 'var(--bg-secondary)' }}>
          <h2 style={{ 
            fontSize: '10pt', 
            fontWeight: '700', 
            textTransform: 'uppercase', 
            letterSpacing: '0.5px',
            marginBottom: '16px'
          }}>
            Market Health
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Discovery Rate
              </div>
              <div style={{ fontSize: '12pt', fontWeight: '700' }}>
                {stats.processing_rate > 0 ? '🟢 Active' : '🔴 Idle'}
              </div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                {stats.processing_rate.toFixed(1)} listings/day
              </div>
            </div>
            <div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Market Coverage
              </div>
              <div style={{ fontSize: '12pt', fontWeight: '700' }}>
                {stats.regions_active} regions
              </div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                {((stats.regions_active / 50) * 100).toFixed(0)}% of US markets
              </div>
            </div>
            <div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Data Quality
              </div>
              <div style={{ fontSize: '12pt', fontWeight: '700' }}>
                {stats.with_images > 0 ? '🟢 Good' : '🟡 Limited'}
              </div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                {stats.with_images} with images
              </div>
            </div>
            <div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Price Visibility
              </div>
              <div style={{ fontSize: '12pt', fontWeight: '700' }}>
                {stats.average_price > 0 ? '🟢 Visible' : '🟡 Hidden'}
              </div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                ${stats.average_price > 0 ? stats.average_price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : 'N/A'} avg
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SquarebodyMarketDashboard;

