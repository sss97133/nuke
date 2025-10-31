import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import { UserInteractionService } from '../services/userInteractionService';

interface HypeVehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  current_value?: number;
  purchase_price?: number;
  roi_pct?: number;
  image_count?: number;
  event_count?: number;
  activity_7d?: number;
  view_count?: number;
  primary_image_url?: string;
  hype_score?: number;
  hype_reason?: string;
  created_at?: string;
  updated_at?: string;
  image_url?: string;
  mileage?: number;
  vin?: string;
}

type TimePeriod = 'AT' | '1Y' | 'Q' | 'W' | 'D' | 'RT';

const CursorHomepage: React.FC = () => {
  const [feedVehicles, setFeedVehicles] = useState<HypeVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('AT');
  const [stats, setStats] = useState({
    totalBuilds: 0,
    totalValue: 0,
    activeToday: 0
  });
  const navigate = useNavigate();

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    // Load feed for all users (authenticated and unauthenticated)
    // Public vehicles (is_public=true) are visible to everyone
    loadHypeFeed();
  }, [timePeriod]);

  // Also reload when session changes (user logs in/out)
  useEffect(() => {
    if (session !== null) {
      loadHypeFeed();
    }
  }, [session]);

  const loadSession = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    setSession(currentSession);
    setLoading(false); // Always set loading to false after session check
    
    // Load user preference
    if (currentSession?.user) {
      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('settings')
        .eq('user_id', currentSession.user.id)
        .maybeSingle();
      
      if (prefs?.settings?.preferred_time_period) {
        setTimePeriod(prefs.settings.preferred_time_period);
      }
    }
  };

  const getTimePeriodFilter = () => {
    const now = new Date();
    switch (timePeriod) {
      case 'D':
        return new Date(now.setDate(now.getDate() - 1)).toISOString();
      case 'W':
        return new Date(now.setDate(now.getDate() - 7)).toISOString();
      case 'Q':
        return new Date(now.setMonth(now.getMonth() - 3)).toISOString();
      case '1Y':
        return new Date(now.setFullYear(now.getFullYear() - 1)).toISOString();
      case 'RT':
        return new Date(now.setHours(now.getHours() - 1)).toISOString();
      default:
        return null;
    }
  };

  const loadHypeFeed = async () => {
    try {
      setLoading(true);
      const timeFilter = getTimePeriodFilter();

      let query = supabase
        .from('vehicles')
        .select('id, year, make, model, current_value, purchase_price, view_count, primary_image_url, image_url, created_at, updated_at, mileage, vin')
        .eq('is_public', true)
        .not('current_value', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (timeFilter) {
        query = query.gte('updated_at', timeFilter);
      }

      const { data: vehicles } = await query;
      if (!vehicles) return;

      const enriched = await Promise.all(
        vehicles.map(async (v) => {
          const [recentActivity, imageCount] = await Promise.all([
            supabase
              .from('vehicle_timeline_events')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', v.id)
              .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
            supabase
              .from('vehicle_images')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', v.id)
          ]);

          const roi = v.current_value && v.purchase_price
            ? ((v.current_value - v.purchase_price) / v.purchase_price) * 100
            : 0;

          const activity7d = recentActivity.count || 0;
          const totalImages = imageCount.count || 0;
          const age_hours = (Date.now() - new Date(v.created_at).getTime()) / (1000 * 60 * 60);
          const update_hours = (Date.now() - new Date(v.updated_at).getTime()) / (1000 * 60 * 60);
          const is_new = age_hours < 24;
          const is_hot = update_hours < 1;

          let hypeScore = 0;
          let hypeReason = '';

          if (is_hot && timePeriod === 'RT') {
            hypeScore += 60;
            hypeReason = 'LIVE NOW';
          }

          if (is_new && totalImages > 10) {
            hypeScore += 50;
            hypeReason = hypeReason || 'JUST POSTED';
          }

          if (activity7d >= 5) {
            hypeScore += 30;
            hypeReason = hypeReason || 'ACTIVE BUILD';
          }

          if (roi > 100) {
            const periodMultiplier = timePeriod === 'D' ? 2 : timePeriod === 'W' ? 1.5 : 1;
            hypeScore += 40 * periodMultiplier;
            hypeReason = hypeReason || `${roi.toFixed(0)}% GAIN`;
          }

          if (totalImages > 100) {
            hypeScore += 20;
          }

          if ((v.view_count || 0) > 20) {
            hypeScore += 15;
            hypeReason = hypeReason || 'TRENDING';
          }

          return {
            ...v,
            roi_pct: roi,
            image_count: totalImages,
            event_count: activity7d,
            activity_7d: activity7d,
            hype_score: hypeScore,
            hype_reason: hypeReason
          };
        })
      );

      const sorted = enriched.sort((a, b) => (b.hype_score || 0) - (a.hype_score || 0));
      setFeedVehicles(sorted);

      const totalValue = enriched.reduce((sum, v) => sum + (v.current_value || 0), 0);
      const activeCount = enriched.filter(v => (v.activity_7d || 0) > 0).length;

      setStats({
        totalBuilds: enriched.filter(v => (v.event_count || 0) > 0).length,
        totalValue: totalValue,
        activeToday: activeCount
      });

    } catch (error) {
      console.error('Error loading hype feed:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}k`;
    }
    return `$${value.toLocaleString()}`;
  };

  const handleTimePeriodChange = async (period: TimePeriod) => {
    setTimePeriod(period);
    
    if (session?.user) {
      await UserInteractionService.logInteraction(
        session.user.id,
        'view',
        'vehicle',
        'time-period-filter',
        {
          source_page: '/homepage',
          time_period: period
        }
      );

      await supabase
        .from('user_preferences')
        .upsert({
          user_id: session.user.id,
          settings: { preferred_time_period: period }
        }, { onConflict: 'user_id' });
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Stats Bar */}
      {stats.totalBuilds > 0 && (
        <div style={{
          background: 'var(--white)',
          borderBottom: '2px solid var(--border)',
          padding: '12px var(--space-4)',
          display: 'flex',
          gap: '32px',
          justifyContent: 'center',
          fontSize: '9pt',
          color: 'var(--text-muted)'
        }}>
          <span><strong>{stats.totalBuilds}</strong> active builds</span>
          <span><strong>{formatCurrency(stats.totalValue)}</strong> in play</span>
          {stats.activeToday > 0 && <span><strong>{stats.activeToday}</strong> updated today</span>}
        </div>
      )}

      {/* Feed Section */}
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: 'var(--space-4)'
      }}>
        {/* Feed Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-3)',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '12pt', fontWeight: 'bold', margin: 0 }}>
              What's Popping
            </h2>
            
            {/* Time Period Selector */}
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              {[
                { id: 'AT', label: 'All Time' },
                { id: '1Y', label: '1 Year' },
                { id: 'Q', label: 'Quarter' },
                { id: 'W', label: 'Week' },
                { id: 'D', label: 'Day' },
                { id: 'RT', label: 'Live' }
              ].map(period => (
                <button
                  key={period.id}
                  onClick={() => handleTimePeriodChange(period.id as TimePeriod)}
                  style={{
                    background: timePeriod === period.id ? 'var(--text)' : 'var(--white)',
                    color: timePeriod === period.id ? 'var(--white)' : 'var(--text)',
                    border: '1px solid var(--border)',
                    padding: '4px 8px',
                    fontSize: '8pt',
                    cursor: 'pointer',
                    fontFamily: '"MS Sans Serif", sans-serif',
                    fontWeight: timePeriod === period.id ? 'bold' : 'normal',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={(e) => {
                    if (timePeriod !== period.id) {
                      e.currentTarget.style.borderColor = 'var(--text)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (timePeriod !== period.id) {
                      e.currentTarget.style.borderColor = 'var(--border)';
                    }
                  }}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            {feedVehicles.length} vehicles · Updated just now
          </div>
        </div>

        {/* Dense Feed List - Using VehicleCardDense component */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0'
        }}>
          {feedVehicles.map((vehicle) => (
            <VehicleCardDense
              key={vehicle.id}
              vehicle={{
                ...vehicle,
                primary_image_url: vehicle.primary_image_url || vehicle.image_url
              }}
              viewMode="list"
            />
          ))}
        </div>

        {feedVehicles.length === 0 && !loading && (
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-8)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
              No vehicles yet
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Be the first to add a build and start the hype train!
            </div>
            <button
              onClick={() => navigate('/add-vehicle')}
              style={{
                background: 'var(--text)',
                color: 'var(--white)',
                border: '2px outset var(--border)',
                padding: '8px 16px',
                fontSize: '9pt',
                cursor: 'pointer',
                fontFamily: '"MS Sans Serif", sans-serif'
              }}
            >
              Add Your First Vehicle
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CursorHomepage;
