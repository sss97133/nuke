// Organizations Directory - Browse all organizations
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { OrganizationSearchService } from '../services/organizationSearch';
import { getOrgInvestorMetrics, type OrgMetricData } from '../utils/orgInvestorMetrics';
import { FaviconIcon } from '../components/common/FaviconIcon';

interface Organization {
  id: string;
  business_name: string;
  legal_name?: string;
  business_type: string;
  description?: string;
  logo_url?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  phone?: string;
  email?: string;
  is_tradable: boolean;
  stock_symbol?: string;
  created_at: string;
  total_vehicles?: number;
  total_images?: number;
  total_events?: number;
  total_inventory?: number;
  contributor_count?: number;
  labor_rate?: number;
  followers?: number;
  current_viewers?: number;
  recent_work_orders?: number;
  latitude?: number;
  longitude?: number;
  distance?: number;
  // Investor metrics
  primary_focus?: string;
  total_listings?: number;
  total_bids?: number;
  total_sold?: number;
  total_sales?: number;
  total_revenue?: number;
  gross_margin_pct?: number;
  inventory_turnover?: number;
  avg_days_to_sell?: number;
  project_completion_rate?: number;
  repeat_customer_rate?: number;
  repeat_customer_count?: number;
  gmv?: number;
  receipt_count?: number;
  listing_count?: number;
  total_projects?: number;
  transaction_volume?: number;
}

interface OrgImage {
  id: string;
  image_url: string;
  large_url?: string;
  category?: string;
}

export default function Organizations() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlSearchQuery = searchParams.get('search') || '';
  
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgImages, setOrgImages] = useState<Record<string, OrgImage | null>>({});
  const [session, setSession] = useState<any>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(urlSearchQuery);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedAddressOrg, setSelectedAddressOrg] = useState<string | null>(null);
  const [organizeMode, setOrganizeMode] = useState(false);
  const [selectedOrgs, setSelectedOrgs] = useState<Set<string>>(new Set());
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  useEffect(() => {
    // Get user location if "near me" is in search
    if (searchQuery.toLowerCase().includes('near me')) {
      navigator.geolocation?.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        () => {
          console.warn('Could not get user location');
        }
      );
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      loadOrganizations(session);
    });
  }, [searchQuery]);

  const loadOrganizations = async (userSession?: any) => {
    try {
      setLoading(true);

      let orgs: any[] = [];
      let error: any = null;

      // If search query exists, use intelligent search
      if (searchQuery.trim()) {
        const searchLower = searchQuery.toLowerCase();
        
        // Check if searching for specific vehicle type (squarebody, etc.)
        const isVehicleTypeSearch = /squarebody|square body|truck|suburban|blazer|gmc|chevrolet|chevy|1973|1974|1975|1976|1977|1978|1979|1980|1981|1982|1983|1984|1985|1986|1987|1988|1989|1990|1991/i.test(searchLower);
        const isNearMe = searchLower.includes('near me') || searchLower.includes('close') || searchLower.includes('local');
        
        if (isVehicleTypeSearch) {
          // Search organizations that have vehicles matching the type
          // Squarebody = 1973-1991 GM trucks/SUVs (Chevrolet/GMC)
          const squarebodyYears = [1973, 1974, 1975, 1976, 1977, 1978, 1979, 1980, 1981, 1982, 1983, 1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991];
          const squarebodyMakes = ['Chevrolet', 'Chevy', 'GMC'];
          
          // First, find vehicles matching squarebody criteria
          const { data: matchingVehicles, error: vehError } = await supabase
            .from('vehicles')
            .select('id')
            .in('year', squarebodyYears)
            .in('make', squarebodyMakes);
          
          if (!vehError && matchingVehicles && matchingVehicles.length > 0) {
            const vehicleIds = matchingVehicles.map(v => v.id);
            
            // Find organizations that have these vehicles
            const { data: orgVehicles, error: ovError } = await supabase
              .from('organization_vehicles')
              .select('organization_id')
              .eq('status', 'active')
              .in('vehicle_id', vehicleIds);
            
            if (!ovError && orgVehicles) {
              // Get unique organization IDs
              const orgIds = [...new Set(orgVehicles.map(ov => ov.organization_id))];
              
              if (orgIds.length > 0) {
                // Load those organizations (limit to 20 for card view)
                const { data, error: orgError } = await supabase
                  .from('businesses')
                  .select('id, business_name, business_type, description, logo_url, website, address, city, state, zip_code, latitude, longitude, is_tradable, stock_symbol, total_vehicles, total_images, total_events, created_at')
                  .eq('is_public', true)
                  .in('id', orgIds)
                  .limit(20);
                
                if (!orgError) {
                  orgs = data || [];
                  
                  // If "near me", filter by distance
                  if (isNearMe && userLocation) {
                    orgs = orgs
                      .filter(org => org.latitude && org.longitude)
                      .map(org => {
                        const distance = calculateDistance(
                          userLocation.lat,
                          userLocation.lng,
                          org.latitude,
                          org.longitude
                        );
                        return { ...org, distance };
                      })
                      .filter(org => org.distance <= 50) // Within 50 miles
                      .sort((a, b) => (a.distance || 0) - (b.distance || 0));
                  }
                }
              }
            }
          }
        } else {
          // Use OrganizationSearchService for general search
          const searchResults = await OrganizationSearchService.search(searchQuery, 50);
          const orgIds = searchResults.map(r => r.id);
          
          if (orgIds.length > 0) {
            const { data, error: orgError } = await supabase
              .from('businesses')
              .select('id, business_name, business_type, description, logo_url, website, address, city, state, zip_code, latitude, longitude, is_tradable, stock_symbol, total_vehicles, total_images, total_events, created_at')
              .eq('is_public', true)
              .in('id', orgIds)
              .limit(20);
            
            if (!orgError) {
              orgs = data || [];
            }
          }
        }
      } else {
        // No search - load organizations with pagination (limit to 20)
        const { data, error: orgError } = await supabase
          .from('businesses')
          .select('id, business_name, business_type, description, logo_url, website, address, city, state, zip_code, latitude, longitude, is_tradable, stock_symbol, total_vehicles, total_images, total_events, created_at')
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(20);
        
        if (orgError) throw orgError;
        orgs = data || [];
      }

      if (error) throw error;

      // Only load minimal data needed for cards - use existing total_* columns
      const orgIds = orgs?.map(o => o.id) || [];
      
      // Load primary images for all orgs (one batch query)
      if (orgIds.length > 0) {
        const { data: images } = await supabase
          .from('organization_images')
          .select('id, organization_id, image_url, large_url, category')
          .in('organization_id', orgIds)
          .eq('category', 'logo')
          .limit(orgIds.length);

        const imageMap: Record<string, OrgImage | null> = {};
        images?.forEach(img => {
          if (!imageMap[img.organization_id]) { // Only first logo per org
            imageMap[img.organization_id] = img;
          }
        });
        setOrgImages(imageMap);
      }

      // Load user following status if logged in (one batch query)
      if (userSession?.user?.id && orgIds.length > 0) {
        const { data: followData } = await supabase
          .from('organization_followers')
          .select('organization_id')
          .eq('user_id', userSession.user.id)
          .in('organization_id', orgIds);

        if (followData) {
          setFollowing(new Set(followData.map(f => f.organization_id)));
        }
      }

      // Use existing total_* columns from businesses table - no need to query related tables
      // For card display, we only need basic info and counts that are already on the org
      const enriched = (orgs || []).map(org => ({
        ...org,
        total_inventory: org.total_vehicles || 0, // Use total_vehicles as inventory count
        contributor_count: 0, // Not needed for card view
        followers: 0, // Will be shown on detail page
        current_viewers: 0,
        recent_work_orders: 0,
        vehicle_count: org.total_vehicles || 0,
        total_sales: 0 // Not needed for card view
      }));

      setOrganizations(enriched);
    } catch (error) {
      console.error('Error loading organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Get unique business types and locations
  const businessTypes = Array.from(new Set(organizations.map(o => o.business_type).filter(Boolean)));
  const locations = Array.from(new Set(organizations.map(o => o.state).filter(Boolean))).sort();

  // Filter organizations (only apply type/location filters, search is already handled in loadOrganizations)
  const filteredOrgs = organizations.filter(org => {
    // Type filter
    if (typeFilter !== 'all' && org.business_type !== typeFilter) return false;

    // Location filter
    if (locationFilter !== 'all' && org.state !== locationFilter) return false;

    return true;
  });

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading organizations...
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '6px' }}>
          Organizations
        </h1>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Browse shops, teams, and businesses in the community
        </p>
      </div>

      {/* Search & Filters */}
      <div style={{
        background: 'var(--white)',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '12px', alignItems: 'center' }}>
          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                // Trigger search by updating state (useEffect will handle it)
                setSearchQuery(e.currentTarget.value);
              }
            }}
            placeholder="Search organizations..."
            className="form-input"
            style={{ fontSize: '9pt' }}
          />

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="form-select"
            style={{ fontSize: '9pt' }}
          >
            <option value="all">All Types</option>
            {businessTypes.map(type => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </option>
            ))}
          </select>

          {/* Location filter */}
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="form-select"
            style={{ fontSize: '9pt' }}
          >
            <option value="all">All Locations</option>
            {locations.map(state => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>

          {/* Create button */}
          <button
            onClick={() => navigate('/org/create')}
            className="button button-primary"
            style={{ fontSize: '9pt', whiteSpace: 'nowrap' }}
          >
            Create Organization
          </button>
        </div>

        {/* Organize Tools */}
        {session?.user && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                setOrganizeMode(!organizeMode);
                if (organizeMode) setSelectedOrgs(new Set());
              }}
              className={organizeMode ? 'button button-secondary' : 'button button-secondary'}
              style={{ fontSize: '8pt', whiteSpace: 'nowrap' }}
            >
              {organizeMode ? 'Cancel' : 'Organize'}
            </button>
            
            {organizeMode && (
              <>
                <button
                  onClick={() => {
                    if (selectedOrgs.size === 2) {
                      const [source, target] = Array.from(selectedOrgs);
                      setMergeSource(source);
                      setMergeTarget(target);
                      setShowMergeModal(true);
                    } else {
                      alert('Select exactly 2 organizations to merge');
                    }
                  }}
                  className="button button-secondary"
                  disabled={selectedOrgs.size !== 2}
                  style={{ fontSize: '8pt', whiteSpace: 'nowrap', opacity: selectedOrgs.size !== 2 ? 0.5 : 1 }}
                >
                  Merge Selected ({selectedOrgs.size})
                </button>
                
                <button
                  onClick={async () => {
                    if (selectedOrgs.size === 0) {
                      alert('Select organizations to delete');
                      return;
                    }
                    if (!confirm(`Delete ${selectedOrgs.size} organization(s)? This cannot be undone.`)) return;
                    
                    try {
                      const { error } = await supabase
                        .from('businesses')
                        .update({ is_public: false })
                        .in('id', Array.from(selectedOrgs));
                      
                      if (error) throw error;
                      
                      setSelectedOrgs(new Set());
                      setOrganizeMode(false);
                      loadOrganizations(session);
                    } catch (error: any) {
                      alert(`Error: ${error.message}`);
                    }
                  }}
                  className="button button-secondary"
                  style={{ fontSize: '8pt', whiteSpace: 'nowrap', color: '#dc2626' }}
                >
                  Hide Selected ({selectedOrgs.size})
                </button>
              </>
            )}
          </div>
        )}

        {/* Results count */}
        <div style={{ marginTop: '12px', fontSize: '8pt', color: 'var(--text-muted)' }}>
          Showing {filteredOrgs.length} of {organizations.length} organizations
          {organizeMode && selectedOrgs.size > 0 && (
            <span style={{ marginLeft: '8px', fontWeight: 700 }}>
              • {selectedOrgs.size} selected
            </span>
          )}
        </div>
      </div>

      {/* Organizations Grid */}
      {filteredOrgs.length === 0 ? (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '4px',
          padding: '60px 20px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '8px' }}>
            {searchQuery || typeFilter !== 'all' || locationFilter !== 'all' 
              ? 'No organizations match your filters'
              : 'No organizations yet'
            }
          </div>
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
            {searchQuery || typeFilter !== 'all' || locationFilter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Be the first to create an organization profile'
            }
          </div>
          {(searchQuery || typeFilter !== 'all' || locationFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setTypeFilter('all');
                setLocationFilter('all');
              }}
              className="button button-secondary button-small"
              style={{ fontSize: '8pt' }}
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '16px'
        }}>
          {filteredOrgs.map(org => {
            const primaryImage = orgImages[org.id];
            const isFollowing = following.has(org.id);

            return (
            <div
              key={org.id}
              style={{
                background: 'var(--white)',
                border: selectedOrgs.has(org.id) 
                  ? '2px solid var(--accent)' 
                  : '1px solid var(--border)',
                borderRadius: '4px',
                overflow: 'hidden',
                cursor: organizeMode ? 'default' : 'pointer',
                transition: '0.12s',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative'
              }}
              className={organizeMode ? '' : 'hover-lift'}
            >
              {/* Selection checkbox in organize mode */}
              {organizeMode && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    const newSelected = new Set(selectedOrgs);
                    if (newSelected.has(org.id)) {
                      newSelected.delete(org.id);
                    } else {
                      newSelected.add(org.id);
                    }
                    setSelectedOrgs(newSelected);
                  }}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    left: '8px',
                    zIndex: 10,
                    width: '20px',
                    height: '20px',
                    border: '2px solid var(--border)',
                    borderRadius: '3px',
                    background: selectedOrgs.has(org.id) ? 'var(--accent)' : 'var(--white)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: selectedOrgs.has(org.id) ? 'white' : 'transparent'
                  }}
                >
                  {selectedOrgs.has(org.id) && '✓'}
                </div>
              )}
              {/* Primary Image - with Logo overlay if available */}
              <div
                onClick={() => navigate(`/org/${org.id}`)}
                style={{
                  height: '240px',
                  background: primaryImage 
                    ? `url(${primaryImage.large_url || primaryImage.image_url}) center/cover` 
                    : 'linear-gradient(135deg, var(--surface) 0%, var(--border) 100%)',
                  position: 'relative'
                }}
              >
                {/* Logo overlay (if no primary image, show logo prominently) */}
                {!primaryImage && org.logo_url && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    maxWidth: '200px',
                    maxHeight: '80px',
                    background: 'transparent',
                    padding: '12px',
                    borderRadius: '4px'
                  }}>
                    <img
                      src={org.logo_url}
                      alt=""
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain',
                        display: 'block'
                      }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
                
                {/* Stock symbol badge */}
                {org.is_tradable && org.stock_symbol && (
                  <div style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: 'rgba(0,0,0,0.8)',
                    color: '#00ff00',
                    padding: '3px 8px',
                    borderRadius: '2px',
                    fontSize: '7pt',
                    fontWeight: 700,
                    border: '1px solid rgba(0,255,0,0.3)'
                  }}>
                    ${org.stock_symbol}
                  </div>
                )}

                {/* Follow/Following badge */}
                {session && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      // TODO: Toggle follow
                      alert('Follow feature coming soon');
                    }}
                    style={{
                      position: 'absolute',
                      bottom: '8px',
                      right: '8px',
                      background: isFollowing ? 'rgba(0,0,0,0.8)' : 'var(--surface)',
                      color: isFollowing ? '#fff' : 'var(--text)',
                      padding: '4px 10px',
                      borderRadius: '2px',
                      fontSize: '7pt',
                      fontWeight: 600,
                      border: `1px solid ${isFollowing ? 'rgba(255,255,255,0.3)' : 'var(--border)'}`,
                      cursor: 'pointer'
                    }}
                  >
                    {isFollowing ? 'FOLLOWING' : 'FOLLOW'}
                  </div>
                )}
              </div>

              {/* Content */}
              <div onClick={() => navigate(`/org/${org.id}`)} style={{ padding: '10px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* Header with Logo/Favicon */}
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    {/* Logo or Favicon */}
                    {org.logo_url ? (
                      <img
                        src={org.logo_url}
                        alt=""
                        style={{
                          height: '24px',
                          maxWidth: '80px',
                          objectFit: 'contain',
                          display: 'block'
                        }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : org.website ? (
                      <FaviconIcon
                        url={org.website}
                        size={16}
                        style={{ flexShrink: 0 }}
                      />
                    ) : null}
                    
                    <h3 style={{ fontSize: '9pt', fontWeight: 700, margin: 0, flex: 1 }}>
                      {org.business_name}
                    </h3>
                  </div>
                  
                  {/* Type */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                    <div style={{
                      fontSize: '7pt',
                      color: 'var(--text-muted)',
                      background: 'var(--surface)',
                      padding: '2px 6px',
                      borderRadius: '2px'
                    }}>
                      {org.business_type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </div>
                  </div>
                </div>

                {/* Description */}
                {org.description && (
                  <div style={{
                    fontSize: '8pt',
                    color: 'var(--text-secondary)',
                    marginBottom: '10px',
                    lineHeight: 1.4,
                    flex: 1,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {org.description}
                  </div>
                )}

                {/* Address - clickable */}
                {(org.address || org.zip_code) && (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAddressOrg(org.id);
                    }}
                    style={{
                      fontSize: '7pt',
                      color: 'var(--text-secondary)',
                      marginBottom: '8px',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    {org.address || ''}{org.address && org.zip_code ? ' ' : ''}{org.zip_code || ''}
                  </div>
                )}

                {/* Key Metrics Row - Dynamic based on org type and data availability */}
                {(() => {
                  const metrics = getOrgInvestorMetrics(org as OrgMetricData, {
                    type: session?.user?.id ? 'owner' : 'public',
                    isOwner: !!session?.user?.id
                  });
                  
                  return (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '8px',
                      marginBottom: '8px',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--border-light)'
                    }}>
                      {metrics.map((metric, idx) => (
                        <div key={idx} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '11pt', fontWeight: 700, color: 'var(--accent)' }}>
                            {typeof metric.value === 'number' 
                              ? metric.value.toLocaleString() 
                              : metric.value}
                          </div>
                          <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                            {metric.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Investment-focused indicators */}
                {org.total_inventory !== undefined && org.total_inventory > 0 && (
                  <div style={{
                    display: 'flex',
                    gap: '8px',
                    fontSize: '7pt',
                    color: 'var(--text-muted)',
                    paddingTop: '6px',
                    borderTop: '1px solid var(--border-light)'
                  }}>
                    <span><strong>{org.total_inventory}</strong> inventory</span>
                    {org.total_vehicles !== undefined && org.total_vehicles > 0 && (
                      <span><strong>{org.total_vehicles}</strong> vehicles</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
          })}
        </div>
      )}

      {/* Address Card Modal */}
      {selectedAddressOrg && (() => {
        const org = organizations.find(o => o.id === selectedAddressOrg);
        if (!org) return null;
        
        return (
          <div
            onClick={() => setSelectedAddressOrg(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--white)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '20px',
                maxWidth: '400px',
                width: '90%'
              }}
            >
              <div style={{ marginBottom: '12px', fontSize: '10pt', fontWeight: 700 }}>
                {org.business_name}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {org.address && <div>{org.address}</div>}
                {(org.city || org.state) && (
                  <div>
                    {org.city && org.state ? `${org.city}, ${org.state}` : org.city || org.state}
                    {org.zip_code && ` ${org.zip_code}`}
                  </div>
                )}
                {!org.address && !org.city && org.zip_code && <div>{org.zip_code}</div>}
              </div>
              {(org.latitude && org.longitude) && (
                <a
                  href={`https://www.google.com/maps?q=${org.latitude},${org.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    marginTop: '12px',
                    fontSize: '8pt',
                    color: 'var(--accent)',
                    textDecoration: 'none'
                  }}
                >
                  View on Map →
                </a>
              )}
              <button
                onClick={() => setSelectedAddressOrg(null)}
                style={{
                  marginTop: '16px',
                  padding: '6px 12px',
                  fontSize: '8pt',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        );
      })()}

      {/* Merge Organizations Modal */}
      {showMergeModal && mergeSource && mergeTarget && (() => {
        const sourceOrg = organizations.find(o => o.id === mergeSource);
        const targetOrg = organizations.find(o => o.id === mergeTarget);
        if (!sourceOrg || !targetOrg) return null;

        return (
          <div
            onClick={() => {
              setShowMergeModal(false);
              setMergeSource(null);
              setMergeTarget(null);
            }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--white)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '20px',
                maxWidth: '500px',
                width: '90%'
              }}
            >
              <div style={{ marginBottom: '16px', fontSize: '11pt', fontWeight: 700 }}>
                Merge Organizations
              </div>
              
              <div style={{ marginBottom: '16px', fontSize: '9pt', color: 'var(--text-muted)' }}>
                This will merge <strong>{sourceOrg.business_name}</strong> into <strong>{targetOrg.business_name}</strong>.
                All vehicles, images, and data from the source will be transferred to the target.
              </div>

              <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Source (will be merged):</div>
                <div style={{ fontSize: '9pt', fontWeight: 600 }}>{sourceOrg.business_name}</div>
                {sourceOrg.city && sourceOrg.state && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{sourceOrg.city}, {sourceOrg.state}</div>
                )}
              </div>

              <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '4px' }}>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Target (will keep):</div>
                <div style={{ fontSize: '9pt', fontWeight: 600 }}>{targetOrg.business_name}</div>
                {targetOrg.city && targetOrg.state && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{targetOrg.city}, {targetOrg.state}</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setShowMergeModal(false);
                    setMergeSource(null);
                    setMergeTarget(null);
                  }}
                  className="button button-secondary"
                  style={{ fontSize: '8pt' }}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      // Merge organization_vehicles
                      const { error: vehError } = await supabase
                        .from('organization_vehicles')
                        .update({ organization_id: mergeTarget })
                        .eq('organization_id', mergeSource);
                      
                      if (vehError) throw vehError;

                      // Merge organization_images
                      const { error: imgError } = await supabase
                        .from('organization_images')
                        .update({ organization_id: mergeTarget })
                        .eq('organization_id', mergeSource);
                      
                      if (imgError) throw imgError;

                      // Merge organization_contributors
                      const { error: contribError } = await supabase
                        .from('organization_contributors')
                        .update({ organization_id: mergeTarget })
                        .eq('organization_id', mergeSource);
                      
                      if (contribError) throw contribError;

                      // Hide source organization
                      const { error: hideError } = await supabase
                        .from('businesses')
                        .update({ is_public: false })
                        .eq('id', mergeSource);
                      
                      if (hideError) throw hideError;

                      setShowMergeModal(false);
                      setMergeSource(null);
                      setMergeTarget(null);
                      setSelectedOrgs(new Set());
                      setOrganizeMode(false);
                      loadOrganizations(session);
                    } catch (error: any) {
                      alert(`Error merging organizations: ${error.message}`);
                    }
                  }}
                  className="button button-primary"
                  style={{ fontSize: '8pt' }}
                >
                  Merge Organizations
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}


