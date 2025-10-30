import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import { MobileHeroCarousel } from '../components/mobile/MobileHeroCarousel';
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
}

type TimePeriod = 'AT' | '1Y' | 'Q' | 'W' | 'D' | 'RT';

const CursorHomepage: React.FC = () => {
  const [hypeVehicles, setHypeVehicles] = useState<HypeVehicle[]>([]);
  const [feedVehicles, setFeedVehicles] = useState<HypeVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentHypeIndex, setCurrentHypeIndex] = useState(0);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('AT');
  const [isMobile, setIsMobile] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [stats, setStats] = useState({
    totalBuilds: 0,
    totalValue: 0,
    soldThisMonth: 0,
    activeToday: 0
  });
  const navigate = useNavigate();
  const timerRef = useRef<NodeJS.Timeout>();

  // Load session for interaction tracking
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
    });
  }, []);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    loadHypeFeed();
  }, [timePeriod]);

  // Auto-rotate hype banner every 5 seconds
  useEffect(() => {
    if (hypeVehicles.length > 1) {
      timerRef.current = setInterval(() => {
        setCurrentHypeIndex((prev) => (prev + 1) % Math.min(hypeVehicles.length, 3));
      }, 5000);
      return () => clearInterval(timerRef.current);
    }
  }, [hypeVehicles.length]);

  const getTimePeriodFilter = () => {
    const now = new Date();
    switch (timePeriod) {
      case 'RT': // Real-time - last hour
        return new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      case 'D': // Daily
        return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      case 'W': // Weekly
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      case 'Q': // Quarter (90 days)
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      case '1Y': // 1 Year
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      default: // AT - All Time
        return null;
    }
  };

  const loadHypeFeed = async () => {
    try {
      setLoading(true);

      const periodFilter = getTimePeriodFilter();

      // Get vehicles with activity metrics
      let query = supabase
        .from('vehicles')
        .select(`
          id, year, make, model, current_value, purchase_price, view_count, created_at, updated_at
        `)
        .eq('is_public', true);

      // Apply time period filter if not "All Time"
      if (periodFilter) {
        query = query.gte('updated_at', periodFilter);
      }

      const { data: vehicles, error } = await query
        .order('updated_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Enrich with image/event counts and calculate hype scores
      const enriched = await Promise.all(
        (vehicles || []).map(async (v) => {
          const [imageCount, eventCount, recentActivity] = await Promise.all([
            supabase
              .from('vehicle_images')
              .select('id, image_url, thumbnail_url', { count: 'exact', head: false })
              .eq('vehicle_id', v.id)
              .eq('is_primary', true)
              .limit(1),
            supabase
              .from('timeline_events')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', v.id),
            supabase
              .from('timeline_events')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', v.id)
              .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          ]);

          const roi = v.current_value && v.purchase_price
            ? ((v.current_value - v.purchase_price) / v.purchase_price) * 100
            : 0;

          // Calculate hype score
          const activity7d = recentActivity.count || 0;
          const totalImages = imageCount.count || 0;
          const age_hours = (Date.now() - new Date(v.created_at).getTime()) / (1000 * 60 * 60);
          const update_hours = (Date.now() - new Date(v.updated_at).getTime()) / (1000 * 60 * 60);
          const is_new = age_hours < 24;
          const is_hot = update_hours < 1; // Updated in last hour
          
          let hypeScore = 0;
          let hypeReason = '';

          // Real-time activity
          if (is_hot && timePeriod === 'RT') {
            hypeScore += 60;
            hypeReason = 'LIVE NOW';
          }

          // New and hot
          if (is_new && totalImages > 10) {
            hypeScore += 50;
            hypeReason = hypeReason || 'JUST POSTED';
          }

          // High activity (weighted by time period)
          if (activity7d >= 5) {
            hypeScore += 30;
            hypeReason = hypeReason || 'ACTIVE BUILD';
          }

          // Big ROI (weighted by time period)
          if (roi > 100) {
            const periodMultiplier = timePeriod === 'D' ? 2 : timePeriod === 'W' ? 1.5 : 1;
            hypeScore += 40 * periodMultiplier;
            hypeReason = hypeReason || `${roi.toFixed(0)}% GAIN`;
          }

          // Well documented
          if (totalImages > 100) {
            hypeScore += 20;
          }

          // High views
          if ((v.view_count || 0) > 20) {
            hypeScore += 15;
            hypeReason = hypeReason || 'TRENDING';
          }

          return {
            ...v,
            image_count: totalImages,
            event_count: eventCount.count || 0,
            activity_7d: activity7d,
            roi_pct: roi,
            primary_image_url: imageCount.data?.[0]?.thumbnail_url || imageCount.data?.[0]?.image_url || null,
            hype_score: hypeScore,
            hype_reason: hypeReason || 'DOCUMENTED'
          };
        })
      );

      // Sort by hype score
      const sorted = enriched.sort((a, b) => (b.hype_score || 0) - (a.hype_score || 0));

      // Top 3 for hype banner
      setHypeVehicles(sorted.slice(0, 3));
      
      // Rest for feed
      setFeedVehicles(sorted.slice(3));

      // Calculate stats
      const totalValue = enriched.reduce((sum, v) => sum + (v.current_value || 0), 0);
      const activeCount = enriched.filter(v => (v.activity_7d || 0) > 0).length;

      setStats({
        totalBuilds: enriched.filter(v => (v.event_count || 0) > 0).length,
        totalValue: totalValue,
        soldThisMonth: 0,
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

  const formatNumber = (value: number) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toString();
  };

  const currentHypeVehicle = hypeVehicles[currentHypeIndex];

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Loading the hype...</div>
      </div>
    );
  }

  const handleDataClick = (type: 'year' | 'make' | 'model', value: string | number) => {
    // Track ETF navigation click
    if (session?.user) {
      UserInteractionService.logInteraction(
        session.user.id,
        'view',
        'vehicle',
        'etf-navigation',
        {
          source_page: '/homepage',
          device_type: isMobile ? 'mobile' : 'desktop',
          gesture_type: 'click',
          etf_type: type,
          etf_value: String(value)
        }
      );
    }

    if (type === 'year') {
      navigate(`/market?year=${value}`);
    } else if (type === 'make') {
      navigate(`/market?make=${encodeURIComponent(String(value))}`);
    } else if (type === 'model') {
      navigate(`/market?model=${encodeURIComponent(String(value))}`);
    }
  };

  const handleTimePeriodChange = async (period: TimePeriod) => {
    setTimePeriod(period);
    
    // Track time period selection
    if (session?.user) {
      await UserInteractionService.logInteraction(
        session.user.id,
        'view',
        'vehicle',
        'time-period-filter',
        {
          source_page: '/homepage',
          device_type: isMobile ? 'mobile' : 'desktop',
          time_period: period
        }
      );

      // Save preference
      await supabase
        .from('user_preferences')
        .upsert({
          user_id: session.user.id,
          settings: { preferred_time_period: period }
        }, { onConflict: 'user_id' });
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Hype Banner - Mobile vs Desktop */}
      {isMobile && hypeVehicles.length > 0 ? (
        <MobileHeroCarousel
          vehicles={hypeVehicles}
          onNavigate={(id) => navigate(`/vehicle/${id}`)}
          onDataClick={handleDataClick}
          session={session}
        />
      ) : currentHypeVehicle && (
        <div
          onClick={() => navigate(`/vehicle/${currentHypeVehicle.id}`)}
          style={{
            position: 'relative',
            height: '400px',
            background: currentHypeVehicle.primary_image_url
              ? `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url(${currentHypeVehicle.primary_image_url})`
              : 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: 'var(--space-4)',
            borderBottom: '3px solid var(--border)',
            transition: 'transform 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.01)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          {/* Hype Badge */}
          <div style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            color: '#ffffff',
            padding: '4px 10px',
            fontSize: '9pt',
            fontWeight: '600',
            borderRadius: '4px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            letterSpacing: '0.5px'
          }}>
            {currentHypeVehicle.hype_reason}
          </div>

          {/* Pagination Dots */}
          {hypeVehicles.length > 1 && (
            <div style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              display: 'flex',
              gap: '8px'
            }}>
              {hypeVehicles.slice(0, 3).map((_, idx) => (
                <div
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentHypeIndex(idx);
                    if (timerRef.current) clearInterval(timerRef.current);
                  }}
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: idx === currentHypeIndex ? '#ffffff' : 'rgba(255,255,255,0.4)',
                    cursor: 'pointer',
                    border: '1px solid #ffffff'
                  }}
                />
              ))}
            </div>
          )}

          {/* Vehicle Info */}
          <div style={{ maxWidth: '800px' }}>
            <div style={{
              fontSize: '28pt',
              fontWeight: '600',
              color: '#ffffff',
              textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
              marginBottom: '12px',
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              alignItems: 'baseline'
            }}>
              <span 
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/market?year=${currentHypeVehicle.year}`);
                }}
                style={{ 
                  cursor: 'pointer',
                  transition: 'opacity 0.2s',
                  opacity: 0.95
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '0.95'}
              >
                {currentHypeVehicle.year}
              </span>
              <span 
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/market?make=${encodeURIComponent(currentHypeVehicle.make || '')}`);
                }}
                style={{ 
                  cursor: 'pointer',
                  transition: 'opacity 0.2s',
                  opacity: 0.95
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '0.95'}
              >
                {currentHypeVehicle.make}
              </span>
              <span 
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/market?make=${encodeURIComponent(currentHypeVehicle.make || '')}&model=${encodeURIComponent(currentHypeVehicle.model || '')}`);
                }}
                style={{ 
                  cursor: 'pointer',
                  transition: 'opacity 0.2s',
                  opacity: 0.95
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '0.95'}
              >
                {currentHypeVehicle.model}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{
                fontSize: '22pt',
                fontWeight: '700',
                color: '#ffffff',
                textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
                fontFamily: 'monospace'
              }}>
                {formatCurrency(currentHypeVehicle.current_value || 0)}
              </div>

              {currentHypeVehicle.roi_pct !== undefined && currentHypeVehicle.roi_pct !== 0 && (
                <div style={{
                  fontSize: '16pt',
                  fontWeight: '700',
                  color: currentHypeVehicle.roi_pct >= 0 ? '#4ade80' : '#f87171',
                  textShadow: '2px 2px 8px rgba(0,0,0,0.8)',
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '4px 8px',
                  borderRadius: '4px'
                }}>
                  {currentHypeVehicle.roi_pct >= 0 ? '↑' : '↓'} {Math.abs(currentHypeVehicle.roi_pct).toFixed(0)}%
                </div>
              )}
            </div>

            <div style={{
              display: 'flex',
              gap: '16px',
              fontSize: '9pt',
              color: 'rgba(255, 255, 255, 0.9)',
              textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
              fontWeight: '500'
            }}>
              <span>{currentHypeVehicle.image_count} photos</span>
              <span>{currentHypeVehicle.event_count} events</span>
              <span>{currentHypeVehicle.view_count || 0} views</span>
              {currentHypeVehicle.activity_7d! > 0 && (
                <span>{currentHypeVehicle.activity_7d} updates this week</span>
              )}
            </div>
          </div>
        </div>
      )}

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
                primary_image_url: vehicle.primary_image_url
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
