import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import { UserInteractionService } from '../services/userInteractionService';
import VehicleSearch from '../components/VehicleSearch';

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
  is_for_sale?: boolean;
  all_images?: Array<{ id: string; url: string; is_primary: boolean }>;
}

type TimePeriod = 'ALL' | 'AT' | '1Y' | 'Q' | 'W' | 'D' | 'RT';
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
  zipCode: string;
  radiusMiles: number;
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
    forSale: false,
    zipCode: '',
    radiusMiles: 50
  });
  const [stats, setStats] = useState({
    totalBuilds: 0,
    totalValue: 0,
    activeToday: 0
  });
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [filterBarMinimized, setFilterBarMinimized] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    loadSession();
    
    // Scroll listener for sticky filter bar and scroll-to-top button
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setScrollY(currentScrollY);
      
      // Show scroll-to-top button after scrolling down 500px
      setShowScrollTop(currentScrollY > 500);
      
      // Minimize filter bar after scrolling down 200px (if filters are shown)
      if (showFilters && currentScrollY > 200) {
        setFilterBarMinimized(true);
      } else if (currentScrollY < 100) {
        setFilterBarMinimized(false);
      }
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [showFilters]);

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
      case 'ALL':
        return null; // No time filter - show everything
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
      case 'AT':
      default:
        return null; // Active = no strict time filter
    }
  };

  const loadHypeFeed = async () => {
    try {
      setLoading(true);
      const timeFilter = getTimePeriodFilter();

      // OPTIMIZED: Single query with LEFT join (includes vehicles without images)
      let query = supabase
        .from('vehicles')
        .select(`
          id, year, make, model, current_value, purchase_price, view_count, created_at, updated_at, mileage, vin,
          vehicle_images(id, thumbnail_url, medium_url, image_url, is_primary, created_at)
        `)
        .eq('is_public', true)
        .order('updated_at', { ascending: false })
        .limit(timePeriod === 'ALL' ? 500 : 100);

      if (timeFilter) {
        query = query.gte('updated_at', timeFilter);
      }

      const { data: vehicles } = await query;
      if (!vehicles) return;

      // Process joined data: each vehicle has vehicle_images array
      const enriched = vehicles.map((v: any) => {
        // Extract and sort images
        const images = Array.isArray(v.vehicle_images) ? v.vehicle_images : (v.vehicle_images ? [v.vehicle_images] : []);
        
        const all_images = images
          .map((img: any) => ({
            id: img.id,
            url: img.thumbnail_url || img.medium_url || img.image_url,
            is_primary: img.is_primary,
            created_at: img.created_at
          }))
          .sort((a: any, b: any) => {
            if (a.is_primary) return -1;
            if (b.is_primary) return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          })
          .slice(0, 5); // Limit to 5 for performance

          const roi = v.current_value && v.purchase_price
            ? ((v.current_value - v.purchase_price) / v.purchase_price) * 100
            : 0;

          const activity7d = 0; // Removed for performance
          const totalImages = all_images.length;
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

          // Primary image is already sorted first
          const primaryImageUrl = all_images[0]?.url || null;

          return {
            ...v,
            roi_pct: roi,
            image_count: totalImages,
            event_count: activity7d,
            activity_7d: activity7d,
            hype_score: hypeScore,
            hype_reason: hypeReason,
            primary_image_url: primaryImageUrl,
            image_url: primaryImageUrl,
            all_images: all_images
          };
        });
      
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
    
    // Location filter (ZIP code + radius)
    // Note: This requires vehicles to have zip_code or GPS coordinates stored
    if (filters.zipCode && filters.zipCode.length === 5) {
      // For now, filter by exact ZIP match
      // TODO: Implement haversine distance calculation with GPS coordinates
      result = result.filter(v => {
        const vehicleZip = (v as any).zip_code || (v as any).location_zip;
        return vehicleZip === filters.zipCode;
      });
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
          source_page: '/homepage'
        } as any
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
        {/* Global Vehicle Search */}
        <div style={{ 
          marginBottom: 'var(--space-4)',
          display: 'flex',
          justifyContent: 'center'
        }}>
          <VehicleSearch />
        </div>

        {/* Feed Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-3)',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '12pt', fontWeight: 'bold', margin: 0, minWidth: '120px' }}>
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
                { id: 'ALL', label: 'All Time' },
                { id: 'AT', label: 'Active' },
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

        {/* Filter Panel - Sticky with minimize */}
        {showFilters && (
          <div style={{ 
            position: filterBarMinimized ? 'sticky' : 'relative',
            top: filterBarMinimized ? 0 : 'auto',
            background: filterBarMinimized ? 'rgba(255, 255, 255, 0.95)' : 'var(--grey-50)',
            backdropFilter: filterBarMinimized ? 'blur(10px)' : 'none',
            border: '1px solid var(--border)',
            padding: filterBarMinimized ? '8px 12px' : '12px',
            marginBottom: '12px',
            zIndex: 100,
            boxShadow: filterBarMinimized ? '0 2px 8px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.2s ease'
          }}>
            {/* Minimized header bar */}
            {filterBarMinimized && (
              <div 
                onClick={() => setFilterBarMinimized(false)}
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  cursor: 'pointer',
                  fontSize: '8pt',
                  fontWeight: 'bold'
                }}
              >
                <span>Filters Active ({Object.values(filters).filter(v => v && v !== '' && v !== false && (Array.isArray(v) ? v.length > 0 : true)).length})</span>
                <span style={{ fontSize: '10pt' }}>▼</span>
              </div>
            )}
            
            {/* Full filter controls */}
            <div style={{ 
              display: filterBarMinimized ? 'none' : 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
              gap: '12px', 
              fontSize: '8pt' 
            }}>
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

              {/* Location Filter */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Location</label>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '4px' }}>
                  <input
                    type="text"
                    placeholder="ZIP code"
                    value={filters.zipCode}
                    onChange={(e) => setFilters({...filters, zipCode: e.target.value})}
                    maxLength={5}
                    style={{
                      width: '70px',
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  />
                  <span>within</span>
                  <select
                    value={filters.radiusMiles}
                    onChange={(e) => setFilters({...filters, radiusMiles: parseInt(e.target.value)})}
                    style={{
                      padding: '4px 6px',
                      border: '1px solid var(--border)',
                      fontSize: '8pt'
                    }}
                  >
                    <option value="10">10 mi</option>
                    <option value="25">25 mi</option>
                    <option value="50">50 mi</option>
                    <option value="100">100 mi</option>
                    <option value="250">250 mi</option>
                    <option value="500">500 mi</option>
                  </select>
                </div>
              </div>

              {/* For Sale Toggle */}
              <div>
                <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Status</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={filters.forSale}
                    onChange={(e) => setFilters({...filters, forSale: e.target.checked})}
                  />
                  <span>For Sale Only</span>
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
                    forSale: false,
                    zipCode: '',
                    radiusMiles: 50
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
            overflow: 'auto',
            maxHeight: '80vh',
            position: 'relative'
          }}>
            <table style={{ 
              width: '100%', 
              fontSize: '8pt', 
              borderCollapse: 'collapse'
            }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr style={{ background: 'var(--grey-50)', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ 
                    padding: '8px', 
                    textAlign: 'left',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    borderRight: '1px solid var(--border)',
                    position: 'sticky',
                    left: 0,
                    background: 'var(--grey-50)',
                    zIndex: 11
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
                      {/* Image - Sticky left column */}
                      <td style={{ 
                        padding: '4px',
                        borderRight: '1px solid var(--border)',
                        position: 'sticky',
                        left: 0,
                        background: 'var(--white)',
                        zIndex: 1
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
                            justifyContent: 'center'
                          }}>
                            <img src="/n-zero.png" alt="N-Zero" style={{ width: '60%', opacity: 0.3, objectFit: 'contain' }} />
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
      
      {/* Scroll to Top Button - Appears after scrolling down */}
      {showScrollTop && (
        <button
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(10px)',
            border: '2px solid rgba(255, 255, 255, 0.3)',
            color: 'white',
            fontSize: '20px',
            fontWeight: 'bold',
            cursor: 'pointer',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.9)';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          ↑
        </button>
      )}
    </div>
  );
};

export default CursorHomepage;
