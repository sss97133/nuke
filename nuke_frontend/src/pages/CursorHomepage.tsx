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
type ViewMode = 'gallery' | 'grid' | 'technical';
type SortBy = 'year' | 'make' | 'model' | 'mileage' | 'newest' | 'oldest' | 'popular' | 'price_high' | 'price_low' | 'volume' | 'images' | 'events' | 'views';

// Rotating action verbs hook (inspired by Claude's thinking animation)
const useRotatingVerb = () => {
  const verbs = [
    'Wrenching',
    'Building',
    'Restoring',
    'Cruising',
    'Fabricating',
    'Tuning',
    'Spinning',
    'Racing',
    'Grinding',
    'Welding',
    'Painting',
    'Polishing',
    'Upgrading',
    'Modding',
    'Boosting',
    'Drifting',
    'Revving',
    'Detailing',
    'Collecting',
    'Showing'
  ];
  
  const [currentVerb, setCurrentVerb] = useState(verbs[0]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentVerb(prev => {
        const currentIndex = verbs.indexOf(prev);
        const nextIndex = (currentIndex + 1) % verbs.length;
        return verbs[nextIndex];
      });
    }, 2000); // Change every 2 seconds
    
    return () => clearInterval(interval);
  }, []);
  
  return currentVerb;
};

interface FilterState {
  yearMin: number | null;
  yearMax: number | null;
  makes: string[];
  priceMin: number | null;
  priceMax: number | null;
  hasImages: boolean;
  forSale: boolean;
}

const CursorHomepage: React.FC = () => {
  const rotatingVerb = useRotatingVerb();
  const [feedVehicles, setFeedVehicles] = useState<HypeVehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<HypeVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('AT');
  const [viewMode, setViewMode] = useState<ViewMode>('technical');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    yearMin: null,
    yearMax: null,
    makes: [],
    priceMin: null,
    priceMax: null,
    hasImages: false,
    forSale: false
  });
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

  // Apply filters and sorting whenever vehicles or settings change
  useEffect(() => {
    applyFiltersAndSort();
  }, [feedVehicles, filters, sortBy]);

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
        .select('id, year, make, model, current_value, purchase_price, view_count, created_at, updated_at, mileage, vin')
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
          const [recentActivity, imageCount, primaryImage] = await Promise.all([
            supabase
              .from('vehicle_timeline_events')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', v.id)
              .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
            supabase
              .from('vehicle_images')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', v.id),
            supabase
              .from('vehicle_images')
              .select('variants, image_url')
              .eq('vehicle_id', v.id)
              .order('is_primary', { ascending: false })
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle()
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

          // Use thumbnail variant for optimized loading in technical view
          const variants = primaryImage?.data?.variants;
          const fallbackImageUrl = primaryImage?.data?.image_url || null;
          const thumbnailUrl = variants?.thumbnail || variants?.medium || variants?.full || fallbackImageUrl;

          return {
            ...v,
            roi_pct: roi,
            image_count: totalImages,
            event_count: activity7d,
            activity_7d: activity7d,
            hype_score: hypeScore,
            hype_reason: hypeReason,
            primary_image_url: thumbnailUrl,
            image_url: fallbackImageUrl,
            image_variants: variants || {}
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

  const applyFiltersAndSort = () => {
    let result = [...feedVehicles];
    
    // Apply filters
    if (filters.yearMin) {
      result = result.filter(v => (v.year || 0) >= filters.yearMin!);
    }
    if (filters.yearMax) {
      result = result.filter(v => (v.year || 0) <= filters.yearMax!);
    }
    if (filters.makes.length > 0) {
      result = result.filter(v => filters.makes.some(m => 
        v.make?.toLowerCase().includes(m.toLowerCase())
      ));
    }
    if (filters.priceMin) {
      result = result.filter(v => (v.current_value || 0) >= filters.priceMin!);
    }
    if (filters.priceMax) {
      result = result.filter(v => (v.current_value || 0) <= filters.priceMax!);
    }
    if (filters.hasImages) {
      result = result.filter(v => (v.image_count || 0) > 0);
    }
    if (filters.forSale) {
      result = result.filter(v => v.is_for_sale);
    }
    
    // Apply sorting
    switch (sortBy) {
      case 'year':
        result.sort((a, b) => (b.year || 0) - (a.year || 0));
        break;
      case 'make':
        result.sort((a, b) => (a.make || '').localeCompare(b.make || ''));
        break;
      case 'model':
        result.sort((a, b) => (a.model || '').localeCompare(b.model || ''));
        break;
      case 'mileage':
        result.sort((a, b) => (a.mileage || 0) - (b.mileage || 0));
        break;
      case 'newest':
        result.sort((a, b) => 
          new Date(b.updated_at || b.created_at || 0).getTime() - 
          new Date(a.updated_at || a.created_at || 0).getTime()
        );
        break;
      case 'oldest':
        result.sort((a, b) => 
          new Date(a.updated_at || a.created_at || 0).getTime() - 
          new Date(b.updated_at || b.created_at || 0).getTime()
        );
        break;
      case 'price_high':
        result.sort((a, b) => (b.current_value || 0) - (a.current_value || 0));
        break;
      case 'price_low':
        result.sort((a, b) => (a.current_value || 0) - (b.current_value || 0));
        break;
      case 'volume':
        // TODO: Add trading volume data from share_holdings table
        result.sort((a, b) => 0); // Placeholder until we have volume data
        break;
      case 'images':
        result.sort((a, b) => (b.image_count || 0) - (a.image_count || 0));
        break;
      case 'events':
        result.sort((a, b) => (b.event_count || 0) - (a.event_count || 0));
        break;
      case 'views':
        result.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
        break;
      default:
        // Hype score (default)
        result.sort((a, b) => (b.hype_score || 0) - (a.hype_score || 0));
    }
    
    setFilteredVehicles(result);
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
              <span style={{ 
                transition: 'opacity 0.3s ease',
                display: 'inline-block'
              }}>
                {rotatingVerb}
              </span>
            </h2>
            
            {/* Time Period Selector */}
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {[
                { id: 'AT', label: 'All' },
                { id: '1Y', label: 'Yr' },
                { id: 'Q', label: 'Qtr' },
                { id: 'W', label: 'Wk' },
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
                    padding: '3px 6px',
                    fontSize: '7pt',
                    cursor: 'pointer',
                    fontWeight: timePeriod === period.id ? 'bold' : 'normal',
                    transition: 'all 0.12s'
                  }}
                >
                  {period.label}
                </button>
              ))}
            </div>

            {/* View Mode Switcher */}
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              {(['gallery', 'grid', 'technical'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    background: viewMode === mode ? 'var(--text)' : 'var(--white)',
                    color: viewMode === mode ? 'var(--white)' : 'var(--text)',
                    border: '1px solid var(--border)',
                    padding: '4px 8px',
                    fontSize: '8pt',
                    cursor: 'pointer',
                    fontWeight: viewMode === mode ? 'bold' : 'normal',
                    transition: 'all 0.12s'
                  }}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            {/* Filters Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              style={{
                background: showFilters ? 'var(--text)' : 'var(--white)',
                color: showFilters ? 'var(--white)' : 'var(--text)',
                border: '1px solid var(--border)',
                padding: '4px 8px',
                fontSize: '8pt',
                cursor: 'pointer',
                fontWeight: showFilters ? 'bold' : 'normal',
                transition: 'all 0.12s'
              }}
            >
              Filters {(filters.yearMin || filters.yearMax || filters.hasImages || filters.forSale) && '●'}
            </button>
          </div>

          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            {filteredVehicles.length} vehicles
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div style={{ 
            background: 'var(--grey-50)',
            border: '1px solid var(--border)',
            padding: '12px',
            marginBottom: '12px'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '8pt' }}>
              {/* Year Range */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Year Range</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.yearMin || ''}
                    onChange={(e) => setFilters({...filters, yearMin: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.yearMax || ''}
                    onChange={(e) => setFilters({...filters, yearMax: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                </div>
                {/* Quick presets */}
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setFilters({...filters, yearMin: 1964, yearMax: 1991})}
                    style={{
                      padding: '2px 6px',
                      background: 'var(--white)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      fontSize: '7pt'
                    }}
                  >
                    64-91
                  </button>
                  <button
                    onClick={() => setFilters({...filters, yearMin: 1992, yearMax: 2005})}
                    style={{
                      padding: '2px 6px',
                      background: 'var(--white)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      fontSize: '7pt'
                    }}
                  >
                    92-05
                  </button>
                  <button
                    onClick={() => setFilters({...filters, yearMin: 2006, yearMax: new Date().getFullYear()})}
                    style={{
                      padding: '2px 6px',
                      background: 'var(--white)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      fontSize: '7pt'
                    }}
                  >
                    Modern
                  </button>
                </div>
              </div>

              {/* Price Range */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Price Range</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters.priceMin || ''}
                    onChange={(e) => setFilters({...filters, priceMin: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '80px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                  <span>–</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters.priceMax || ''}
                    onChange={(e) => setFilters({...filters, priceMax: e.target.value ? parseInt(e.target.value) : null})}
                    style={{
                      width: '80px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                </div>
              </div>

              {/* Toggles */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Options</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={filters.hasImages}
                    onChange={(e) => setFilters({...filters, hasImages: e.target.checked})}
                  />
                  <span>Has Images</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={filters.forSale}
                    onChange={(e) => setFilters({...filters, forSale: e.target.checked})}
                  />
                  <span>For Sale</span>
                </label>
              </div>

              {/* Clear Filters */}
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  onClick={() => setFilters({
                    yearMin: null,
                    yearMax: null,
                    makes: [],
                    priceMin: null,
                    priceMax: null,
                    hasImages: false,
                    forSale: false
                  })}
                  style={{
                    padding: '4px 12px',
                    background: 'var(--white)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: '8pt',
                    fontWeight: 'bold'
                  }}
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Technical View with Sortable Columns */}
        {viewMode === 'technical' && (
          <div style={{ 
            background: 'var(--white)',
            border: '1px solid var(--border)',
            overflow: 'auto'
          }}>
            <table style={{ 
              width: '100%', 
              fontSize: '8pt', 
              borderCollapse: 'collapse'
            }}>
              <thead>
                <tr style={{ background: 'var(--grey-50)', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--border)'
                  }}>
                    Image
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'center',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy('year')}
                  >
                    Year {sortBy === 'year' && '▼'}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy('make')}
                  >
                    Make {sortBy === 'make' && '▼'}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy('model')}
                  >
                    Model {sortBy === 'model' && '▼'}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy('mileage')}
                  >
                    Mileage {sortBy === 'mileage' && '▼'}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy(sortBy === 'price_high' ? 'price_low' : 'price_high')}
                  >
                    Price {sortBy === 'price_high' && '▼'}{sortBy === 'price_low' && '▲'}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy('volume')}
                  >
                    Volume {sortBy === 'volume' && '▼'}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy('images')}
                  >
                    Images {sortBy === 'images' && '▼'}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy('events')}
                  >
                    Events {sortBy === 'events' && '▼'}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'right',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    borderRight: '1px solid var(--border)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy('views')}
                  >
                    Views {sortBy === 'views' && '▼'}
                  </th>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    userSelect: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onClick={() => setSortBy(sortBy === 'newest' ? 'oldest' : 'newest')}
                  >
                    Updated {sortBy === 'newest' && '▼'}{sortBy === 'oldest' && '▲'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map(vehicle => {
                  return (
                    <tr 
                      key={vehicle.id}
                      onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                      style={{ 
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        transition: 'background 0.12s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-50)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Image - Responsive, 100px default, scales down */}
                      <td style={{ 
                        padding: '4px',
                        borderRight: '1px solid var(--border)'
                      }}>
                        {vehicle.primary_image_url ? (
                          <img 
                            src={vehicle.primary_image_url}
                            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                            loading="lazy"
                            style={{
                              width: 'min(100px, 15vw)',
                              height: 'min(60px, 9vw)',
                              objectFit: 'cover',
                              border: '1px solid var(--border)',
                              display: 'block'
                            }}
                          />
                        ) : (
                          <div style={{
                            width: 'min(100px, 15vw)',
                            height: 'min(60px, 9vw)',
                            background: 'var(--grey-200)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '16px'
                          }}>
                            🚗
                          </div>
                        )}
                      </td>

                      {/* Year */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.year || '—'}
                      </td>

                      {/* Make */}
                      <td style={{ 
                        padding: '8px',
                        fontWeight: 'bold',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.make || '—'}
                      </td>

                      {/* Model */}
                      <td style={{ 
                        padding: '8px',
                        borderRight: '1px solid var(--border)'
                      }}>
                        {vehicle.model || '—'}
                        {vehicle.hype_reason && (
                          <div style={{ 
                            fontSize: '7pt', 
                            color: 'var(--accent)', 
                            fontWeight: 'bold',
                            marginTop: '2px'
                          }}>
                            {vehicle.hype_reason}
                          </div>
                        )}
                      </td>

                      {/* Mileage */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.mileage 
                          ? `${vehicle.mileage.toLocaleString()}` 
                          : '—'
                        }
                      </td>

                      {/* Price */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        fontWeight: 'bold',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.current_value 
                          ? `$${vehicle.current_value.toLocaleString()}` 
                          : '—'
                        }
                      </td>

                      {/* Volume (Trading Volume - placeholder) */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                        color: 'var(--text-muted)'
                      }}>
                        —
                      </td>

                      {/* Images Count */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.image_count || 0}
                      </td>

                      {/* Events Count */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.event_count || 0}
                      </td>

                      {/* Views Count */}
                      <td style={{ 
                        padding: '8px',
                        textAlign: 'right',
                        borderRight: '1px solid var(--border)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.view_count || 0}
                      </td>

                      {/* Updated */}
                      <td style={{ 
                        padding: '8px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap'
                      }}>
                        {vehicle.updated_at 
                          ? new Date(vehicle.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—'
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Gallery View */}
        {viewMode === 'gallery' && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
            gap: '4px'
          }}>
            {filteredVehicles.map((vehicle) => (
              <VehicleCardDense
                key={vehicle.id}
                vehicle={{
                  ...vehicle,
                  primary_image_url: vehicle.primary_image_url
                }}
                viewMode="gallery"
              />
            ))}
          </div>
        )}

        {/* Grid View */}
        {viewMode === 'grid' && (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '12px'
        }}>
            {filteredVehicles.map((vehicle) => (
            <VehicleCardDense
              key={vehicle.id}
              vehicle={{
                ...vehicle,
                  primary_image_url: vehicle.primary_image_url
              }}
                viewMode="grid"
            />
          ))}
        </div>
        )}

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
