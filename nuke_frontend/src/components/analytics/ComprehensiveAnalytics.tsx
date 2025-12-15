import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import SpendingDashboard from './SpendingDashboard';
import '../../design-system.css';

interface AnalyticsData {
  vehicles: {
    total: number;
    active_builds: number;
    completed_builds: number;
    stagnant_builds: number;
  };
  timeline: {
    total_events: number;
    recent_activity: number;
    avg_events_per_build: number;
  };
  social: {
    total_images: number;
    total_likes: number;
    followers: number;
    following: number;
  };
  marketplace: {
    active_auctions: number;
    won_auctions: number;
    total_bids: number;
    avg_bid_amount: number;
  };
  streams: {
    hosted_streams: number;
    total_viewers: number;
    avg_duration: number;
  };
}

const ComprehensiveAnalytics = () => {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<string>('month');
  const [selectedTab, setSelectedTab] = useState<string>('overview');

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'builds', label: 'Build Analytics', icon: '🔧' },
    { id: 'social', label: 'Social Stats', icon: '👥' },
    { id: 'marketplace', label: 'Marketplace', icon: '🏁' },
    { id: 'streaming', label: 'Streaming', icon: '📺' },
    { id: 'spending', label: 'Spending', icon: '💰' }
  ];

  const timeRanges = [
    { value: 'week', label: 'Last 7 Days' },
    { value: 'month', label: 'Last 30 Days' },
    { value: 'quarter', label: 'Last 3 Months' },
    { value: 'year', label: 'Last Year' },
    { value: 'all', label: 'All Time' }
  ];

  useEffect(() => {
    if (user) {
      loadAnalytics();
    }
  }, [user, timeRange]);

  const loadAnalytics = async () => {
    if (!user) return;

    setLoading(true);

    try {
      const dateRanges = {
        week: 7,
        month: 30,
        quarter: 90,
        year: 365,
        all: 999999
      };

      const days = dateRanges[timeRange as keyof typeof dateRanges];
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Load vehicle analytics
      const { data: vehicleData } = await supabase
        .from('vehicles')
        .select('id, created_at, build_status')
        .eq('owner_id', user.id);

      // Load timeline analytics
      const { data: timelineData } = await supabase
        .from('vehicle_timeline_events')
        .select('id, created_at, vehicle_id')
        .eq('user_id', user.id)
        .gte('created_at', startDate.toISOString());

      // Load social analytics
      const { data: imageData } = await supabase
        .from('vehicle_images')
        .select('id, created_at, likes_count')
        .eq('uploaded_by', user.id)
        .gte('created_at', startDate.toISOString());

      // Load follow counts
      const [{ count: followersCount }, { count: followingCount }] = await Promise.all([
        supabase
          .from('user_follows')
          .select('*', { count: 'exact', head: true })
          .eq('following_id', user.id),
        supabase
          .from('user_follows')
          .select('*', { count: 'exact', head: true })
          .eq('follower_id', user.id)
      ]);

      // Load marketplace analytics
      const { data: auctionData } = await supabase
        .from('auction_listings')
        .select('id, status, current_bid')
        .eq('seller_id', user.id)
        .gte('created_at', startDate.toISOString());

      const { data: bidData } = await supabase
        .from('auction_bids')
        .select('id, bid_amount, status')
        .eq('bidder_id', user.id)
        .gte('created_at', startDate.toISOString());

      // Load streaming analytics
      const { data: streamData } = await supabase
        .from('live_streams')
        .select('id, duration_seconds, total_viewers')
        .eq('streamer_id', user.id)
        .gte('created_at', startDate.toISOString());

      // Calculate analytics
      const vehicles = vehicleData || [];
      const timeline = timelineData || [];
      const images = imageData || [];
      const auctions = auctionData || [];
      const bids = bidData || [];
      const streams = streamData || [];

      setAnalytics({
        vehicles: {
          total: vehicles.length,
          active_builds: vehicles.filter(v => v.build_status === 'in_progress').length,
          completed_builds: vehicles.filter(v => v.build_status === 'completed').length,
          stagnant_builds: vehicles.filter(v => v.build_status === 'stagnant').length
        },
        timeline: {
          total_events: timeline.length,
          recent_activity: timeline.filter(t =>
            new Date(t.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          ).length,
          avg_events_per_build: vehicles.length > 0 ? Math.round(timeline.length / vehicles.length) : 0
        },
        social: {
          total_images: images.length,
          total_likes: images.reduce((sum, img) => sum + (img.likes_count || 0), 0),
          followers: followersCount || 0,
          following: followingCount || 0
        },
        marketplace: {
          active_auctions: auctions.filter(a => a.status === 'active').length,
          won_auctions: bids.filter(b => b.status === 'won').length,
          total_bids: bids.length,
          avg_bid_amount: bids.length > 0 ?
            Math.round(bids.reduce((sum, b) => sum + b.bid_amount, 0) / bids.length) : 0
        },
        streams: {
          hosted_streams: streams.length,
          total_viewers: streams.reduce((sum, s) => sum + (s.total_viewers || 0), 0),
          avg_duration: streams.length > 0 ?
            Math.round(streams.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / streams.length / 60) : 0
        }
      });

    } catch (error) {
      console.error('Analytics error:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const renderOverview = () => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '12px'
    }}>
      {/* Vehicle Stats */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '12px'
      }}>
        <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
          🚗 Vehicle Portfolio
        </h4>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
          {analytics?.vehicles.total || 0}
        </div>
        <div style={{ fontSize: '7pt', color: '#6b7280' }}>
          {analytics?.vehicles.active_builds} active, {analytics?.vehicles.completed_builds} completed
        </div>
      </div>

      {/* Activity Stats */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '12px'
      }}>
        <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
          📈 Recent Activity
        </h4>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
          {analytics?.timeline.recent_activity || 0}
        </div>
        <div style={{ fontSize: '7pt', color: '#6b7280' }}>
          events in last 7 days
        </div>
      </div>

      {/* Social Stats */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '12px'
      }}>
        <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
          👥 Social Engagement
        </h4>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
          {formatNumber(analytics?.social.total_likes || 0)}
        </div>
        <div style={{ fontSize: '7pt', color: '#6b7280' }}>
          total likes, {analytics?.social.followers} followers
        </div>
      </div>

      {/* Marketplace Stats */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '12px'
      }}>
        <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
          🏁 Marketplace Activity
        </h4>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
          {analytics?.marketplace.total_bids || 0}
        </div>
        <div style={{ fontSize: '7pt', color: '#6b7280' }}>
          total bids, {analytics?.marketplace.won_auctions} won
        </div>
      </div>
    </div>
  );

  const renderBuildAnalytics = () => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: '12px'
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '12px'
      }}>
        <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
          Build Status Breakdown
        </h4>
        <div style={{ fontSize: '8pt' }}>
          <div style={{ marginBottom: '4px' }}>
            Active: <strong>{analytics?.vehicles.active_builds}</strong>
          </div>
          <div style={{ marginBottom: '4px' }}>
            Completed: <strong>{analytics?.vehicles.completed_builds}</strong>
          </div>
          <div style={{ marginBottom: '4px' }}>
            Stagnant: <strong>{analytics?.vehicles.stagnant_builds}</strong>
          </div>
        </div>
      </div>

      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '12px'
      }}>
        <h4 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 8px 0' }}>
          Documentation Rate
        </h4>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '4px' }}>
          {analytics?.timeline.avg_events_per_build || 0}
        </div>
        <div style={{ fontSize: '7pt', color: '#6b7280' }}>
          avg events per build
        </div>
      </div>
    </div>
  );

  if (!user) {
    return (
      <div style={{
        background: 'var(--bg)',
        border: '1px solid #bdbdbd',
        padding: '16px',
        margin: '16px',
        fontSize: '8pt',
        textAlign: 'center'
      }}>
        Please log in to view analytics
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid #bdbdbd',
      padding: '16px',
      margin: '16px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h3 style={{ fontSize: '8pt', fontWeight: 'bold', margin: '0 0 12px 0' }}>
        📊 Analytics Dashboard
      </h3>

      {/* Time Range Selector */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '8px',
        marginBottom: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ fontSize: '8pt', fontWeight: 'bold' }}>
          Time Period:
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          style={{
            padding: '4px',
            border: '1px solid #bdbdbd',
            borderRadius: '0px',
            fontSize: '8pt'
          }}
        >
          {timeRanges.map(range => (
            <option key={range.value} value={range.value}>
              {range.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tab Navigation */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid #bdbdbd',
        padding: '8px',
        marginBottom: '12px'
      }}>
        <div style={{
          display: 'flex',
          gap: '4px',
          flexWrap: 'wrap'
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id)}
              style={{
                padding: '6px 12px',
                fontSize: '8pt',
                border: '1px solid #bdbdbd',
                background: selectedTab === tab.id ? '#424242' : '#f5f5f5',
                color: selectedTab === tab.id ? 'white' : '#424242',
                borderRadius: '0px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span style={{ fontSize: '7pt' }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
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
          Loading analytics...
        </div>
      )}

      {/* Tab Content */}
      {!loading && analytics && (
        <div>
          {selectedTab === 'overview' && renderOverview()}
          {selectedTab === 'builds' && renderBuildAnalytics()}
          {selectedTab === 'spending' && <SpendingDashboard />}
          {selectedTab === 'social' && (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid #bdbdbd',
              padding: '12px',
              textAlign: 'center',
              fontSize: '8pt',
              color: '#757575'
            }}>
              Social analytics coming soon...
            </div>
          )}
          {selectedTab === 'marketplace' && (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid #bdbdbd',
              padding: '12px',
              textAlign: 'center',
              fontSize: '8pt',
              color: '#757575'
            }}>
              Marketplace analytics coming soon...
            </div>
          )}
          {selectedTab === 'streaming' && (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid #bdbdbd',
              padding: '12px',
              textAlign: 'center',
              fontSize: '8pt',
              color: '#757575'
            }}>
              Streaming analytics coming soon...
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ComprehensiveAnalytics;