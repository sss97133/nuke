// Organizations Directory - Browse all organizations
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { OrganizationSearchService } from '../services/organizationSearch';

interface Organization {
  id: string;
  business_name: string;
  legal_name?: string;
  business_type: string;
  description?: string;
  logo_url?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  website?: string;
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
                // Load those organizations
                const { data, error: orgError } = await supabase
                  .from('businesses')
                  .select('id, business_name, business_type, description, logo_url, city, state, latitude, longitude, is_tradable, stock_symbol, total_vehicles, total_images, total_events, labor_rate, created_at')
                  .eq('is_public', true)
                  .in('id', orgIds);
                
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
              .select('id, business_name, business_type, description, logo_url, city, state, latitude, longitude, is_tradable, stock_symbol, total_vehicles, total_images, total_events, labor_rate, created_at')
              .eq('is_public', true)
              .in('id', orgIds);
            
            if (!orgError) {
              orgs = data || [];
            }
          }
        }
      } else {
        // No search - load all organizations
        const { data, error: orgError } = await supabase
          .from('businesses')
          .select('id, business_name, business_type, description, logo_url, city, state, is_tradable, stock_symbol, total_vehicles, total_images, total_events, labor_rate, created_at')
          .eq('is_public', true)
          .order('created_at', { ascending: false });
        
        if (orgError) throw orgError;
        orgs = data || [];
      }

      if (error) throw error;

      // Load primary images for all orgs
      const orgIds = orgs?.map(o => o.id) || [];
      if (orgIds.length > 0) {
        const { data: images } = await supabase
          .from('organization_images')
          .select('id, organization_id, image_url, large_url, category')
          .in('organization_id', orgIds)
          .eq('category', 'logo')
          .limit(orgIds.length);

        const imageMap: Record<string, OrgImage | null> = {};
        images?.forEach(img => {
          imageMap[img.organization_id] = img;
        });
        setOrgImages(imageMap);
      }

      // Load user following status if logged in
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

      // OPTIMIZED: Batch load all stats in 3 queries instead of N*3
      const [contributorData, inventoryData, followerData] = await Promise.all([
        // Get all contributors grouped by org
        supabase
          .from('organization_contributors')
          .select('organization_id')
          .in('organization_id', orgIds),
        
        // Get all inventory grouped by org
        supabase
          .from('organization_inventory')
          .select('organization_id')
          .in('organization_id', orgIds),
        
        // Get all followers grouped by org
        supabase
          .from('organization_followers')
          .select('organization_id')
          .in('organization_id', orgIds)
      ]);

      // Build count maps
      const contributorCounts: Record<string, number> = {};
      const inventoryCounts: Record<string, number> = {};
      const followerCounts: Record<string, number> = {};

      contributorData.data?.forEach(c => {
        contributorCounts[c.organization_id] = (contributorCounts[c.organization_id] || 0) + 1;
      });

      inventoryData.data?.forEach(i => {
        inventoryCounts[i.organization_id] = (inventoryCounts[i.organization_id] || 0) + 1;
      });

      followerData.data?.forEach(f => {
        followerCounts[f.organization_id] = (followerCounts[f.organization_id] || 0) + 1;
      });

      // Enrich orgs with counts (no async loops!)
      const enriched = (orgs || []).map(org => ({
        ...org,
        total_inventory: inventoryCounts[org.id] || 0,
        contributor_count: contributorCounts[org.id] || 0,
        followers: followerCounts[org.id] || 0,
        current_viewers: 0,
        recent_work_orders: 0
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

        {/* Results count */}
        <div style={{ marginTop: '12px', fontSize: '8pt', color: 'var(--text-muted)' }}>
          Showing {filteredOrgs.length} of {organizations.length} organizations
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
                border: '1px solid var(--border)',
                borderRadius: '4px',
                overflow: 'hidden',
                cursor: 'pointer',
                transition: '0.12s',
                display: 'flex',
                flexDirection: 'column'
              }}
              className="hover-lift"
            >
              {/* Primary Image - LARGER */}
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
                      background: isFollowing ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.95)',
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
                {/* Header */}
                <div style={{ marginBottom: '6px' }}>
                  <h3 style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '3px' }}>
                    {org.business_name}
                  </h3>
                  
                  {/* Type & Location */}
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
                    {org.city && org.state && (
                      <div style={{
                        fontSize: '7pt',
                        color: 'var(--text-muted)',
                        background: 'var(--surface)',
                        padding: '2px 6px',
                        borderRadius: '2px'
                      }}>
                        {org.city}, {org.state}
                      </div>
                    )}
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

                {/* Key Metrics Row */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                  marginBottom: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-light)'
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11pt', fontWeight: 700, color: 'var(--accent)' }}>
                      {org.total_events || 0}
                    </div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                      Work Orders
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11pt', fontWeight: 700, color: 'var(--accent)' }}>
                      {org.labor_rate ? `$${org.labor_rate}` : '—'}
                    </div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                      Labor/hr
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11pt', fontWeight: 700, color: 'var(--accent)' }}>
                      {org.followers || 0}
                    </div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                      Followers
                    </div>
                  </div>
                </div>

                {/* Activity indicators */}
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  fontSize: '7pt',
                  color: 'var(--text-muted)',
                  paddingTop: '6px',
                  borderTop: '1px solid var(--border-light)'
                }}>
                  {org.current_viewers > 0 && (
                    <span>{org.current_viewers} viewing</span>
                  )}
                  <span>{org.total_images || 0} images</span>
                  <span>{org.total_inventory || 0} inventory</span>
                </div>
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}


