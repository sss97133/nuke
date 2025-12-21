import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface VehicleWithLocation {
  id: string;
  year: number;
  make: string;
  model: string;
  current_value: number;
  location: string | null;
  purchase_location: string | null;
  listing_location: string | null;
  owner_id: string;
  is_verified: boolean;
  image_count: number;
  contract_status: 'none' | 'funding_round' | 'shares_trading' | 'for_sale' | 'bonded';
}

interface MarketSegmentDetail {
  slug: string;
  name: string;
  description: string;
  vehicle_count: number;
  market_cap_usd: number;
  avg_vehicle_value: number;
  price_range_min: number;
  price_range_max: number;
  top_locations: Array<{location: string; count: number}>;
  vehicles: VehicleWithLocation[];
}

interface RealVehicleDataProps {
  segmentSlug: string;
  limit?: number;
}

const formatUSD = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);

const formatLocation = (location: string | null, purchaseLocation: string | null, listingLocation: string | null) => {
  const loc = location || purchaseLocation || listingLocation;
  if (!loc) return 'Location not specified';
  
  // Parse JSON coordinates if present
  if (loc.includes('latitude')) {
    try {
      const coords = JSON.parse(loc);
      return `${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`;
    } catch {
      return loc;
    }
  }
  
  // Parse coordinate string if present
  if (loc.includes(',') && loc.match(/^-?\d+\.?\d*, -?\d+\.?\d*$/)) {
    const [lat, lng] = loc.split(',').map(s => parseFloat(s.trim()));
    return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
  
  return loc;
};

const getContractStatus = (vehicle: VehicleWithLocation) => {
  switch (vehicle.contract_status) {
    case 'funding_round': return 'FUNDING ACTIVE';
    case 'shares_trading': return 'SHARES TRADING';
    case 'for_sale': return 'FOR SALE';
    case 'bonded': return 'BOND ISSUED';
    default: return 'NO CONTRACTS';
  }
};

export default function RealVehicleData({ segmentSlug, limit = 20 }: RealVehicleDataProps) {
  const [segmentData, setSegmentData] = useState<MarketSegmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSegmentData();
  }, [segmentSlug]);

  const loadSegmentData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get segment definition
      const { data: segment, error: segmentError } = await supabase
        .from('market_segments')
        .select('*')
        .eq('slug', segmentSlug)
        .single();

      if (segmentError) throw segmentError;

      // Get vehicles in this segment with real location data
      const { data: vehicles, error: vehicleError } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          current_value,
          location,
          purchase_location,
          listing_location,
          user_id,
          is_public,
          ownership_verified
        `)
        .eq('is_public', true)
        .not('current_value', 'is', null)
        .order('current_value', { ascending: false })
        .limit(limit);

      if (vehicleError) throw vehicleError;

      // Filter vehicles that match segment criteria
      const matchingVehicles = (vehicles || []).filter((v: any) => {
        const yearMatch = (!segment.year_min || v.year >= segment.year_min) && 
                         (!segment.year_max || v.year <= segment.year_max);
        
        const makeMatch = !segment.makes || segment.makes.some((make: string) => 
          v.make.toUpperCase().includes(make.toUpperCase())
        );
        
        const keywordMatch = !segment.model_keywords || segment.model_keywords.some((keyword: string) =>
          v.model.toUpperCase().includes(keyword.toUpperCase()) ||
          (v.trim && v.trim.toUpperCase().includes(keyword.toUpperCase()))
        );

        return yearMatch && makeMatch && keywordMatch;
      });

      // Check for investment contracts
      const vehicleIds = matchingVehicles.map((v: any) => v.id);
      
      const [fundingRounds, offerings, bonds, listings] = await Promise.all([
        supabase.from('vehicle_funding_rounds').select('vehicle_id').in('vehicle_id', vehicleIds).in('status', ['fundraising', 'active']),
        supabase.from('vehicle_offerings').select('vehicle_id').in('vehicle_id', vehicleIds).eq('status', 'trading'),
        supabase.from('vehicle_bonds').select('vehicle_id').in('vehicle_id', vehicleIds).eq('status', 'active'),
        supabase.from('market_listings').select('vehicle_id').in('vehicle_id', vehicleIds).eq('status', 'active')
      ]);

      const fundingSet = new Set((fundingRounds.data || []).map(f => f.vehicle_id));
      const offeringsSet = new Set((offerings.data || []).map(o => o.vehicle_id));
      const bondsSet = new Set((bonds.data || []).map(b => b.vehicle_id));
      const listingsSet = new Set((listings.data || []).map(l => l.vehicle_id));

      // Get image counts for each vehicle
      const { data: imageCounts } = await supabase
        .from('vehicle_images')
        .select('vehicle_id')
        .in('vehicle_id', vehicleIds);

      const imageCountMap = (imageCounts || []).reduce((acc: any, img: any) => {
        acc[img.vehicle_id] = (acc[img.vehicle_id] || 0) + 1;
        return acc;
      }, {});

      const vehiclesWithContracts = matchingVehicles.map((v: any) => ({
        id: v.id,
        year: v.year,
        make: v.make,
        model: v.model,
        current_value: Number(v.current_value),
        location: v.location,
        purchase_location: v.purchase_location,
        listing_location: v.listing_location,
        owner_id: v.user_id,
        is_verified: Boolean(v.ownership_verified),
        image_count: imageCountMap[v.id] || 0,
        contract_status: fundingSet.has(v.id) ? 'funding_round' :
                        offeringsSet.has(v.id) ? 'shares_trading' :
                        bondsSet.has(v.id) ? 'bonded' :
                        listingsSet.has(v.id) ? 'for_sale' : 'none'
      }));

      // Calculate segment statistics
      const vehicleCount = vehiclesWithContracts.length;
      const marketCap = vehiclesWithContracts.reduce((sum, v) => sum + v.current_value, 0);
      const avgValue = vehicleCount > 0 ? marketCap / vehicleCount : 0;
      const minValue = vehicleCount > 0 ? Math.min(...vehiclesWithContracts.map(v => v.current_value)) : 0;
      const maxValue = vehicleCount > 0 ? Math.max(...vehiclesWithContracts.map(v => v.current_value)) : 0;

      // Calculate location distribution
      const locationCounts: Record<string, number> = {};
      vehiclesWithContracts.forEach(v => {
        const loc = formatLocation(v.location, v.purchase_location, v.listing_location);
        locationCounts[loc] = (locationCounts[loc] || 0) + 1;
      });

      const topLocations = Object.entries(locationCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([location, count]) => ({ location, count }));

      setSegmentData({
        slug: segment.slug,
        name: segment.name,
        description: segment.description,
        vehicle_count: vehicleCount,
        market_cap_usd: marketCap,
        avg_vehicle_value: avgValue,
        price_range_min: minValue,
        price_range_max: maxValue,
        top_locations: topLocations,
        vehicles: vehiclesWithContracts
      });

    } catch (e: any) {
      console.error('Failed to load real vehicle data:', e);
      setError(e?.message || 'Failed to load segment data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading real vehicle data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: 'var(--danger, #ef4444)', fontSize: '9pt' }}>
        Error: {error}
      </div>
    );
  }

  if (!segmentData) return null;

  return (
    <div>
      {/* Segment Overview */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="heading-3">{segmentData.name} - Real Market Data</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div>
              <div style={{ fontSize: '16pt', fontWeight: 900 }}>{segmentData.vehicle_count}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Real Vehicles</div>
            </div>
            <div>
              <div style={{ fontSize: '16pt', fontWeight: 900 }}>{formatUSD(segmentData.market_cap_usd)}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Total Market Cap</div>
            </div>
            <div>
              <div style={{ fontSize: '16pt', fontWeight: 900 }}>{formatUSD(segmentData.avg_vehicle_value)}</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Average Value</div>
            </div>
            <div>
              <div style={{ fontSize: '11pt', fontWeight: 700 }}>
                {formatUSD(segmentData.price_range_min)} - {formatUSD(segmentData.price_range_max)}
              </div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Price Range</div>
            </div>
          </div>
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
            {segmentData.description}
          </div>
        </div>
      </div>

      {/* Top Locations */}
      {segmentData.top_locations.length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <h3 className="heading-3">Geographic Distribution</h3>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              {segmentData.top_locations.map((loc, index) => (
                <div key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: 'var(--surface)', borderRadius: '4px' }}>
                  <span style={{ fontSize: '9pt' }}>{loc.location}</span>
                  <span style={{ fontSize: '9pt', fontWeight: 700 }}>{loc.count} vehicles</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Real Vehicles List */}
      <div className="card">
        <div className="card-header">
          <h3 className="heading-3">Vehicles in Segment</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 120px 150px 100px 120px',
              gap: '12px',
              fontSize: '9pt',
              fontWeight: 700,
              padding: '8px',
              borderBottom: '2px solid var(--border)',
              color: 'var(--text-muted)'
            }}>
              <div>Vehicle</div>
              <div>Value</div>
              <div>Location</div>
              <div>Images</div>
              <div>Contract Status</div>
            </div>
            
            {segmentData.vehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 120px 150px 100px 120px',
                  gap: '12px',
                  fontSize: '9pt',
                  padding: '12px 8px',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.12s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '10pt' }}>
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>
                    {vehicle.is_verified ? 'VERIFIED OWNER' : 'UNVERIFIED'}
                  </div>
                </div>
                
                <div style={{ fontWeight: 700 }}>
                  {formatUSD(vehicle.current_value)}
                </div>
                
                <div style={{ fontSize: '8pt' }}>
                  {formatLocation(vehicle.location, vehicle.purchase_location, vehicle.listing_location)}
                </div>
                
                <div style={{ textAlign: 'center' }}>
                  <span style={{ 
                    fontSize: '8pt',
                    padding: '2px 6px',
                    background: vehicle.image_count > 5 ? 'var(--success, #10b981)' : 'var(--warning, #f59e0b)',
                    color: 'var(--white)',
                    borderRadius: '2px',
                    fontWeight: 700
                  }}>
                    {vehicle.image_count} IMGS
                  </span>
                </div>
                
                <div>
                  <span style={{
                    fontSize: '7pt',
                    padding: '4px 6px',
                    background: vehicle.contract_status !== 'none' ? 'var(--primary)' : 'var(--surface)',
                    color: vehicle.contract_status !== 'none' ? 'var(--white)' : 'var(--text-muted)',
                    borderRadius: '2px',
                    fontWeight: 700
                  }}>
                    {getContractStatus(vehicle)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Segment Performance Summary */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <h3 className="heading-3">Investment Opportunities</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>Funding Rounds</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                {segmentData.vehicles.filter(v => v.contract_status === 'funding_round').length} active rounds
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>Share Trading</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                {segmentData.vehicles.filter(v => v.contract_status === 'shares_trading').length} vehicles trading
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>For Sale</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                {segmentData.vehicles.filter(v => v.contract_status === 'for_sale').length} vehicles listed
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>Bond Offerings</div>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                {segmentData.vehicles.filter(v => v.contract_status === 'bonded').length} bonds available
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
