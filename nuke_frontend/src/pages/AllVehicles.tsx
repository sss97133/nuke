import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
// AppLayout now provided globally by App.tsx
import VehicleThumbnail from '../components/VehicleThumbnail';
import AdvancedVehicleSearch from '../components/search/AdvancedVehicleSearch';
import MarketPulse from '../components/MarketPulse';
import { VehicleSearchService, type VehicleSearchResult, type SearchFilters } from '../services/vehicleSearchService';
import { VehicleDiscoveryService } from '../services/vehicleDiscoveryService';
import { SearchHelpers } from '../utils/searchHelpers';
import '../design-system.css';

interface ActivityItem {
  id: string;
  type: 'vehicle_added' | 'vehicle_updated' | 'user_joined';
  title: string;
  subtitle: string;
  timestamp: string;
  link?: string;
  user?: string;
}

const AllVehicles: React.FC = () => {
  const [vehicles, setVehicles] = useState<VehicleSearchResult[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<VehicleSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [currentFilters, setCurrentFilters] = useState<SearchFilters>({});
  const [totalMatchingVehicles, setTotalMatchingVehicles] = useState<number | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [stats, setStats] = useState({
    totalVehicles: 0,
    totalUsers: 0,
    vehiclesForSale: 0,
    recentlyAdded: 0
  });
  const [searchSummary, setSearchSummary] = useState<string>('All vehicles');
  const [session, setSession] = useState<any>(null);
  const navigate = useNavigate();

  // Check authentication status
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadInitialData();
      if (cancelled) return;

      // Check for URL parameters and apply them as initial filters (after the initial load to avoid race conditions)
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.toString()) {
        const urlFilters = SearchHelpers.parseUrlFilters(urlParams);
        if (Object.keys(urlFilters).length > 0) {
          await handleSearch(urlFilters);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const canComputeTotalCountForFilters = (filters: SearchFilters) => {
    // We currently compute totals only for make/model (plus "no filters").
    // If other filters are active, the total count can diverge from visible results.
    return !(
      filters.yearFrom ||
      filters.yearTo ||
      filters.priceFrom ||
      filters.priceTo ||
      filters.zipCode ||
      filters.radius ||
      filters.forSale ||
      filters.textSearch
    );
  };

  const loadTotalCountForFilters = async (filters: SearchFilters) => {
    if (!canComputeTotalCountForFilters(filters)) {
      setTotalMatchingVehicles(null);
      return;
    }

    try {
      const makePrefix = filters.make ? String(filters.make).trim() : null;
      const modelContains = filters.model ? String(filters.model).trim() : null;

      const { data, error } = await supabase.rpc('get_total_vehicle_count', {
        make_prefix: makePrefix && makePrefix.length > 0 ? makePrefix : null,
        model_contains: modelContains && modelContains.length > 0 ? modelContains : null
      });

      if (error) {
        console.warn('Failed to load total vehicle count:', error);
        setTotalMatchingVehicles(null);
        return;
      }

      const n = data == null ? null : Number(data);
      setTotalMatchingVehicles(n != null && Number.isFinite(n) ? n : null);
    } catch (e) {
      console.warn('Failed to load total vehicle count:', e);
      setTotalMatchingVehicles(null);
    }
  };

  const loadInitialData = async () => {
    try {
      setLoading(true);
      
      // Load all vehicles for initial display
      const vehicles = await VehicleSearchService.searchVehicles({});
      setVehicles(vehicles);
      setFilteredVehicles(vehicles);
      loadTotalCountForFilters({});
      
      // Load platform statistics
      await loadPlatformStats();
      
      // Load recent activity
      await loadRecentActivity();
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPlatformStats = async () => {
    try {
      const [vehicleCount, userCount, forSaleCount, recentCount] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact' }).eq('is_public', true),
        supabase.from('profiles').select('id', { count: 'exact' }),
        supabase.from('vehicles').select('id', { count: 'exact' }).eq('is_for_sale', true),
        supabase.from('vehicles').select('id', { count: 'exact' })
          .eq('is_public', true)
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      ]);

      setStats({
        totalVehicles: vehicleCount.count || 0,
        totalUsers: userCount.count || 0,
        vehiclesForSale: forSaleCount.count || 0,
        recentlyAdded: recentCount.count || 0
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const loadRecentActivity = async () => {
    try {
      const { data: recentVehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, normalized_model, created_at, updated_at, user_id')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(10);

      if (recentVehicles && recentVehicles.length > 0) {
        const userIds = Array.from(new Set(recentVehicles.map((v: any) => v.user_id).filter(Boolean)));
        let profileMap = new Map<string, { username: string | null; full_name: string | null }>();
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username, full_name')
            .in('id', userIds);
          if (profiles) {
            profileMap = new Map(profiles.map((p: any) => [p.id, { username: p.username ?? null, full_name: p.full_name ?? null }]));
          }
        }

        const activity: ActivityItem[] = recentVehicles.map((vehicle: any) => ({
          id: vehicle.id,
          type: 'vehicle_added' as const,
          title: `${vehicle.year} ${vehicle.make} ${vehicle.normalized_model || vehicle.model}`,
          subtitle: `Added by ${getUserDisplayFromProfile(profileMap.get(vehicle.user_id))}`,
          timestamp: vehicle.created_at,
          link: `/vehicle/${vehicle.id}`
        }));

        setRecentActivity(activity);
      }
    } catch (error) {
      console.error('Error loading recent activity:', error);
    }
  };

  const getUserDisplayFromProfile = (profile: any) => {
    if (profile?.username) return `@${profile.username}`;
    if (profile?.full_name) return profile.full_name;
    return 'Anonymous User';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getUserDisplay = (vehicle: VehicleSearchResult) => {
    if (vehicle.profiles?.username) {
      return `@${vehicle.profiles.username}`;
    } else if (vehicle.profiles?.full_name) {
      return vehicle.profiles.full_name;
    } else {
      return 'Anonymous User';
    }
  };

  const handleSearch = async (filters: SearchFilters) => {
    try {
      setSearchLoading(true);
      setCurrentFilters(filters);
      
      // Validate filters
      const validation = SearchHelpers.validateFilters(filters);
      if (!validation.valid) {
        console.warn('Search validation errors:', validation.errors);
        // Could show user-friendly error messages here
      }
      
      const results = await VehicleSearchService.searchVehicles(filters);
      setFilteredVehicles(results);
      setSearchSummary(SearchHelpers.formatSearchSummary(filters));
      loadTotalCountForFilters(filters);
      
      // Update URL with search parameters for sharing
      const searchUrl = SearchHelpers.generateSearchUrl(filters);
      window.history.replaceState({}, '', searchUrl);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleResetSearch = () => {
    setCurrentFilters({});
    setFilteredVehicles(vehicles);
    setSearchSummary('All vehicles');
    window.history.replaceState({}, '', '/all-vehicles');
    loadTotalCountForFilters({});
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    // After 30 days (720 hours), show actual date
    if (diffInHours >= 720) {
      return date.toLocaleDateString();
    }

    // Within 30 days, show relative time
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return `${Math.floor(diffInHours / 168)}w ago`;
  };

  const calculateHype = (vehicle: VehicleSearchResult) => {
    let hype = 0;

    // Base rarity score (older/rarer = more hype)
    const currentYear = new Date().getFullYear();
    const age = currentYear - (vehicle.year || currentYear);
    if (age > 50) hype += 30;      // Classic
    else if (age > 25) hype += 20; // Modern classic
    else if (age > 10) hype += 10; // Appreciating

    // Brand/Model rarity (simplified)
    const rareBrands = ['Ferrari', 'Lamborghini', 'McLaren', 'Porsche', 'Aston Martin', 'Bentley'];
    const premiumBrands = ['BMW', 'Mercedes', 'Audi', 'Lexus', 'Acura'];

    if (rareBrands.some(brand => vehicle.make?.includes(brand))) hype += 25;
    else if (premiumBrands.some(brand => vehicle.make?.includes(brand))) hype += 10;

    // Market activity
    if (vehicle.is_for_sale) hype += 15;           // For sale = market interest
    if (vehicle.sale_price && vehicle.sale_price > 100000) hype += 10; // High value

    // Recent activity (new additions get temporary boost)
    const hoursAgo = Math.floor((new Date().getTime() - new Date(vehicle.created_at).getTime()) / (1000 * 60 * 60));
    if (hoursAgo < 24) hype += 20;       // New today
    else if (hoursAgo < 168) hype += 10; // This week

    // Verification status
    if (vehicle.ownership_verified) hype += 5;

    // Live streaming (major boost)
    if (vehicle.is_streaming) hype += 35;

    // Cap at 100% and ensure minimum of 5%
    return Math.min(Math.max(hype, 5), 100);
  };


  return (
    <div className="fade-in">

        {/* Discovery Welcome Section for Non-Authenticated Users */}
        {!session && (
          <section className="section">
            <div className="card">
              <div className="card-body text-center" style={{ padding: '32px 24px' }}>
                <h1 className="text font-bold" style={{ marginBottom: '12px' }}>
                  Discover Amazing Vehicles
                </h1>
                <p className="text-small text-muted" style={{ marginBottom: '24px' }}>
                  Explore {stats.totalVehicles} vehicles from {stats.totalUsers} enthusiasts. Browse, discover, and connect with the community.
                </p>
                <div className="flex justify-center gap-3">
                  <Link to="/login" className="button button-primary">
                    Join the Community
                  </Link>
                  <Link to="/live-feed" className="button button-secondary">
                    View Live Feed
                  </Link>
                </div>
                <div className="flex justify-center gap-6 mt-4 text-small text-muted">
                  <span>{stats.vehiclesForSale} for sale</span>
                  <span>{stats.recentlyAdded} added this week</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Advanced Search */}
        <section className="section">
          <AdvancedVehicleSearch 
            onSearch={handleSearch}
            onReset={handleResetSearch}
            loading={searchLoading}
          />
        </section>

        {/* Results and Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Results */}
          <div className="lg:col-span-3">
            <section className="section">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-xs font-semibold text-black">Search Results</h2>
                  {(() => {
                    const visible = filteredVehicles.length;
                    const total = totalMatchingVehicles;
                    const hidden = total != null ? Math.max(0, total - visible) : 0;
                    const showTotal = total != null && total >= visible;
                    return (
                      <div className="mb-4">
                        <p className="text-xs text-black">
                          Found{' '}
                          {showTotal
                            ? `${visible.toLocaleString()} of ${total.toLocaleString()}`
                            : visible.toLocaleString()}{' '}
                          vehicle{(showTotal ? total : visible) !== 1 ? 's' : ''}
                        </p>
                        {hidden > 0 && (
                          <p className="text-xs text-black mt-1">
                            {hidden.toLocaleString()} private/non-public vehicle{hidden !== 1 ? 's' : ''} shown blurred
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  <p className="text-xs text-black mt-1">
                    {searchSummary}
                  </p>
                </div>
                <div className="flex gap-2">
                  {session ? (
                    <>
                      <button 
                        className="button button-small button-secondary"
                        onClick={() => navigate('/add-vehicle')}
                      >
                        Add Vehicle
                      </button>
                      <button 
                        className="button button-small button-secondary"
                        onClick={() => navigate('/vehicles')}
                      >
                        My Vehicles
                      </button>
                    </>
                  ) : (
                    <>
                      <Link to="/login" className="button button-small button-primary">
                        Sign In to Add Vehicle
                      </Link>
                      <Link to="/live-feed" className="button button-small button-secondary">
                        Live Feed
                      </Link>
                    </>
                  )}
                </div>
              </div>

              {/* Loading State */}
              {loading || searchLoading ? (
                <div className="card">
                  <div className="card-body text-center py-12">
                    <div className="loading-spinner mx-auto mb-4"></div>
                    <p className="text-muted">{loading ? 'Loading vehicles...' : 'Searching...'}</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Empty State */}
                  {(() => {
                    const visible = filteredVehicles.length;
                    const total = totalMatchingVehicles;
                    const hidden = total != null ? Math.max(0, total - visible) : 0;
                    return visible === 0 && hidden === 0;
                  })() ? (
                    <div className="card">
                      <div className="card-body text-center py-12">
                        <div className="text-xs mb-4 text-black">No Results</div>
                        <h3 className="text-xs font-semibold text-black mb-2">
                          {Object.keys(currentFilters).length > 0 ? 'No vehicles match your search' : 'No vehicles yet'}
                        </h3>
                        <p className="text-xs text-black mb-6">
                          {Object.keys(currentFilters).length > 0
                            ? 'Try adjusting your search criteria.'
                            : 'Be the first to add a vehicle to the platform!'
                          }
                        </p>
                        {Object.keys(currentFilters).length === 0 && (
                          session ? (
                            <button 
                              className="button button-primary"
                              onClick={() => navigate('/add-vehicle')}
                            >
                              Add Vehicle
                            </button>
                          ) : (
                            <Link to="/login" className="button button-primary">
                              Join to Add Vehicles
                            </Link>
                          )
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Vehicle Grid */
                    <div className="vehicle-grid">
                      {(() => {
                        const visible = filteredVehicles.length;
                        const total = totalMatchingVehicles;
                        const hidden = total != null ? Math.max(0, total - visible) : 0;
                        const placeholderCap = 12;
                        const placeholderCount = Math.min(hidden, placeholderCap);
                        const remaining = Math.max(0, hidden - placeholderCount);
                        const showLoginLink = !session;

                        const PlaceholderCard = ({ idx }: { idx: number }) => (
                          <div
                            key={`private-placeholder-${idx}`}
                            className="vehicle-card vehicle-card-compact"
                            style={{ cursor: showLoginLink ? 'pointer' : 'default' }}
                            onClick={() => {
                              if (showLoginLink) navigate('/login');
                            }}
                            title={showLoginLink ? 'Sign in to request access' : 'Private vehicle'}
                          >
                            <div className="vehicle-thumbnail-link" style={{ position: 'relative' }}>
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  backgroundImage: 'url(/n-zero.png)',
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center',
                                  filter: 'blur(18px)',
                                  opacity: 0.45,
                                }}
                              />
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'rgba(0,0,0,0.35)',
                                }}
                              />
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'white',
                                  fontWeight: 700,
                                  fontSize: '10px',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                PRIVATE
                              </div>
                            </div>
                            <div className="vehicle-info-compact">
                              <h3 className="vehicle-title-compact" style={{ filter: 'blur(2px)', userSelect: 'none' }}>
                                Private Vehicle
                              </h3>
                              <div className="text-xs text-black" style={{ opacity: 0.7 }}>
                                {showLoginLink ? 'Sign in to unlock' : 'Access restricted'}
                              </div>
                            </div>
                          </div>
                        );

                        const RemainingCard = () => (
                          <div
                            key="private-placeholder-remaining"
                            className="vehicle-card vehicle-card-compact"
                            style={{ cursor: 'default' }}
                          >
                            <div className="vehicle-thumbnail-link" style={{ position: 'relative' }}>
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'linear-gradient(135deg, rgba(0,0,0,0.75), rgba(0,0,0,0.35))',
                                }}
                              />
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'white',
                                  fontWeight: 800,
                                  fontSize: '10px',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                +{remaining.toLocaleString()} MORE
                              </div>
                            </div>
                            <div className="vehicle-info-compact">
                              <h3 className="vehicle-title-compact" style={{ filter: 'blur(2px)', userSelect: 'none' }}>
                                Private Vehicles
                              </h3>
                              <div className="text-xs text-black" style={{ opacity: 0.7 }}>
                                Not shown individually
                              </div>
                            </div>
                          </div>
                        );

                        return (
                          <>
                            {filteredVehicles.map((vehicle) => (
                              <div key={vehicle.id} className="vehicle-card vehicle-card-compact">
                                <Link to={`/vehicle/${vehicle.id}`} className="vehicle-thumbnail-link">
                                  {/* Private vehicle thumbnail blur */}
                                  <div
                                    style={{
                                      position: 'absolute',
                                      inset: 0,
                                      filter: vehicle.is_public === false ? 'blur(10px)' : undefined,
                                      opacity: vehicle.is_public === false ? 0.8 : 1,
                                    }}
                                  >
                                    <VehicleThumbnail vehicleId={vehicle.id} />
                                  </div>

                                  {vehicle.is_public === false && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        top: 4,
                                        left: 4,
                                        background: 'rgba(0,0,0,0.75)',
                                        color: 'white',
                                        padding: '2px 6px',
                                        borderRadius: 2,
                                        fontSize: 8,
                                        fontWeight: 800,
                                        letterSpacing: '0.04em',
                                      }}
                                    >
                                      PRIVATE
                                    </div>
                                  )}

                                  {/* Live Stream Status */}
                                  {vehicle.is_streaming && (
                                    <div className="live-indicator">
                                      <span className="live-dot"></span>
                                      LIVE
                                    </div>
                                  )}
                                </Link>

                                <div className="vehicle-info-compact">
                                  {/* YMM - Year Make Model (core info) - prefer normalized_model */}
                                  <h3 className="vehicle-title-compact">
                                    {vehicle.year} {vehicle.make} {vehicle.normalized_model || vehicle.model}
                                  </h3>

                                  {/* Owner (clickable), Price, Hype */}
                                  <div className="vehicle-meta-row">
                                    <Link
                                      to={`/profile/${vehicle.profiles?.username || vehicle.uploaded_by}`}
                                      className="owner-link"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {getUserDisplay(vehicle)}
                                    </Link>

                                    {/* Price */}
                                    <span className="price-display">
                                      {(() => {
                                        // Use proper price hierarchy: sale_price > asking_price > current_value > purchase_price > msrp
                                        const price = vehicle.sale_price 
                                          || (vehicle.is_for_sale && vehicle.asking_price)
                                          || vehicle.current_value
                                          || vehicle.purchase_price
                                          || vehicle.msrp;
                                        
                                        if (price) {
                                          return `$${price.toLocaleString()}`;
                                        }
                                        
                                        if (vehicle.is_for_sale) {
                                          return 'Price TBA';
                                        }
                                        
                                        return '';
                                      })()}
                                    </span>
                                  </div>

                                  {/* Compact metrics row */}
                                  <div className="vehicle-metrics-compact">
                                    {/* Hype Meter */}
                                    <div className="hype-meter">
                                      <div
                                        className="hype-bar"
                                        style={{width: `${calculateHype(vehicle)}%`}}
                                        title={`Hype: ${calculateHype(vehicle)}%`}
                                      ></div>
                                      <span className="hype-text">🔥</span>
                                    </div>

                                    {/* Date (smart formatting) */}
                                    <span className="date-compact">
                                      {formatTimeAgo(vehicle.created_at)}
                                    </span>

                                    {/* Status badges */}
                                    <div className="status-badges">
                                      {vehicle.is_for_sale && <span className="status-sale">$</span>}
                                      {vehicle.ownership_verified && <span className="status-verified">✓</span>}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}

                            {hidden > 0 &&
                              Array.from({ length: placeholderCount }).map((_, i) => (
                                <PlaceholderCard idx={i} key={`ph-${i}`} />
                              ))}

                            {remaining > 0 && <RemainingCard />}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>

          {/* Market Pulse Sidebar */}
          <div className="lg:col-span-1">
            <MarketPulse />
          </div>
        </div>
      </div>
  );
};

export default AllVehicles;
