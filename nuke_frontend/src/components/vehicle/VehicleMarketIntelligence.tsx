import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { TrendingUp, MapPin, Database, AlertCircle } from 'lucide-react';
import '../../design-system.css';

interface VehicleMarketIntelligenceProps {
  vehicle: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    vin?: string;
    current_value?: number;
  };
  userLocation?: {
    lat: number;
    lng: number;
    city?: string;
    state?: string;
  };
}

interface RarityData {
  total_in_database: number;
  rarity_score: number;
  rarity_level: 'ULTRA_RARE' | 'RARE' | 'UNCOMMON' | 'COMMON';
  same_make_model: number;
  same_year: number;
}

interface RegionalMarketData {
  nearby_count: number;
  nearby_for_sale: number;
  avg_price_regional?: number;
  avg_price_national?: number;
  price_range_low?: number;
  price_range_high?: number;
  radius_miles: number;
}

interface ComparableVehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  price?: number;
  distance_miles?: number;
  is_for_sale: boolean;
}

const VehicleMarketIntelligence = ({ vehicle, userLocation }: VehicleMarketIntelligenceProps) => {
  const [rarityData, setRarityData] = useState<RarityData | null>(null);
  const [regionalData, setRegionalData] = useState<RegionalMarketData | null>(null);
  const [comparables, setComparables] = useState<ComparableVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (vehicle.id) {
      loadMarketIntelligence();
    }
  }, [vehicle.id, userLocation]);

  const loadMarketIntelligence = async () => {
    try {
      setLoading(true);

      // Compute rarity based on year/make/model combo
      await computeRarity();

      // Get regional market data if user location available
      if (userLocation) {
        await computeRegionalMarket();
      }

      // Find comparable vehicles
      await findComparables();

    } catch (error) {
      console.error('Error loading market intelligence:', error);
    } finally {
      setLoading(false);
    }
  };

  const computeRarity = async () => {
    if (!vehicle.year || !vehicle.make || !vehicle.model) return;

    try {
      // Get all vehicles to compute rarity
      const { data: allVehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .limit(1000);

      if (!allVehicles) return;

      // Count exact matches
      const exactMatches = allVehicles.filter(v =>
        v.year === vehicle.year &&
        v.make?.toLowerCase() === vehicle.make?.toLowerCase() &&
        v.model?.toLowerCase() === vehicle.model?.toLowerCase()
      );

      // Count make/model matches (any year)
      const makeModelMatches = allVehicles.filter(v =>
        v.make?.toLowerCase() === vehicle.make?.toLowerCase() &&
        v.model?.toLowerCase() === vehicle.model?.toLowerCase()
      );

      // Count year matches (any make/model)
      const yearMatches = allVehicles.filter(v => v.year === vehicle.year);

      const totalCount = exactMatches.length;
      const rarityScore = Math.round((1 / Math.max(totalCount, 1)) * 100);

      // Proper rarity calculation based on actual market data, not database count
      let rarityLevel: RarityData['rarity_level'] = 'COMMON';
      
      // Only consider rarity if we have sufficient data (at least 50 vehicles in database)
      if (allVehicles.length >= 50) {
        // Calculate rarity based on production numbers and market data
        const rarityPercentage = (totalCount / allVehicles.length) * 100;
        
        if (rarityPercentage < 0.1) rarityLevel = 'ULTRA_RARE';  // Less than 0.1% of database
        else if (rarityPercentage < 0.5) rarityLevel = 'RARE';   // Less than 0.5% of database  
        else if (rarityPercentage < 2.0) rarityLevel = 'UNCOMMON'; // Less than 2% of database
        else rarityLevel = 'COMMON';
      } else {
        // Insufficient data - default to common until we have more vehicles
        rarityLevel = 'COMMON';
      }

      setRarityData({
        total_in_database: totalCount,
        rarity_score: rarityScore,
        rarity_level: rarityLevel,
        same_make_model: makeModelMatches.length,
        same_year: yearMatches.length
      });
    } catch (error) {
      console.error('Error computing rarity:', error);
    }
  };

  const computeRegionalMarket = async () => {
    if (!vehicle.year || !vehicle.make || !vehicle.model || !userLocation) return;

    try {
      const radius = 150; // miles

      // Get vehicles within radius
      // Note: For production, use PostGIS for proper distance calculation
      // For now, doing a simple query and filtering client-side
      const { data: regionalVehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, current_value, asking_price, is_for_sale, latitude, longitude')
        .eq('make', vehicle.make)
        .eq('model', vehicle.model)
        .limit(500);

      if (!regionalVehicles) return;

      // Filter by distance (simple approximation)
      const nearbyVehicles = regionalVehicles.filter(v => {
        if (!v.latitude || !v.longitude) return false;
        const distance = calculateDistance(
          userLocation.lat,
          userLocation.lng,
          v.latitude,
          v.longitude
        );
        return distance <= radius;
      });

      const forSaleNearby = nearbyVehicles.filter(v => v.is_for_sale);

      // Calculate price statistics
      const prices = nearbyVehicles
        .map(v => v.current_value || v.asking_price)
        .filter(p => p !== null && p !== undefined) as number[];

      const avgPriceRegional = prices.length > 0
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : undefined;

      const priceRangeLow = prices.length > 0 ? Math.min(...prices) : undefined;
      const priceRangeHigh = prices.length > 0 ? Math.max(...prices) : undefined;

      // Get national average
      const { data: nationalVehicles } = await supabase
        .from('vehicles')
        .select('current_value, asking_price')
        .eq('make', vehicle.make)
        .eq('model', vehicle.model)
        .limit(1000);

      const nationalPrices = (nationalVehicles || [])
        .map(v => v.current_value || v.asking_price)
        .filter(p => p !== null && p !== undefined) as number[];

      const avgPriceNational = nationalPrices.length > 0
        ? Math.round(nationalPrices.reduce((a, b) => a + b, 0) / nationalPrices.length)
        : undefined;

      setRegionalData({
        nearby_count: nearbyVehicles.length,
        nearby_for_sale: forSaleNearby.length,
        avg_price_regional: avgPriceRegional,
        avg_price_national: avgPriceNational,
        price_range_low: priceRangeLow,
        price_range_high: priceRangeHigh,
        radius_miles: radius
      });
    } catch (error) {
      console.error('Error computing regional market:', error);
    }
  };

  const findComparables = async () => {
    if (!vehicle.year || !vehicle.make || !vehicle.model) return;

    try {
      // Find similar vehicles (same make/model, +/- 2 years)
      const yearMin = vehicle.year - 2;
      const yearMax = vehicle.year + 2;

      const { data: similarVehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, current_value, asking_price, is_for_sale, latitude, longitude')
        .eq('make', vehicle.make)
        .eq('model', vehicle.model)
        .gte('year', yearMin)
        .lte('year', yearMax)
        .neq('id', vehicle.id)
        .limit(10);

      if (!similarVehicles) return;

      const comparablesWithDistance = similarVehicles.map(v => {
        let distance: number | undefined;
        if (userLocation && v.latitude && v.longitude) {
          distance = calculateDistance(
            userLocation.lat,
            userLocation.lng,
            v.latitude,
            v.longitude
          );
        }

        return {
          id: v.id,
          year: v.year,
          make: v.make,
          model: v.model,
          price: v.asking_price || v.current_value,
          distance_miles: distance ? Math.round(distance) : undefined,
          is_for_sale: v.is_for_sale || false
        };
      });

      // Sort by distance if available
      comparablesWithDistance.sort((a, b) => {
        if (a.distance_miles && b.distance_miles) {
          return a.distance_miles - b.distance_miles;
        }
        return 0;
      });

      setComparables(comparablesWithDistance.slice(0, 5));
    } catch (error) {
      console.error('Error finding comparables:', error);
    }
  };

  // Haversine formula for distance calculation
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

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const getRarityColor = (level: RarityData['rarity_level']): string => {
    switch (level) {
      case 'ULTRA_RARE': return '#dc2626';
      case 'RARE': return '#ea580c';
      case 'UNCOMMON': return '#ca8a04';
      case 'COMMON': return '#65a30d';
      default: return '#6b7280';
    }
  };

  const getRarityLabel = (level: RarityData['rarity_level']): string => {
    switch (level) {
      case 'ULTRA_RARE': return 'Ultra Rare';
      case 'RARE': return 'Rare';
      case 'UNCOMMON': return 'Uncommon';
      case 'COMMON': return 'Common';
      default: return 'Unknown';
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ border: '1px solid #c0c0c0', padding: '16px' }}>
        <div style={{ textAlign: 'center', color: '#666', fontSize: '10pt' }}>
          Loading market intelligence...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Rarity Intelligence */}
      {rarityData && (
        <div className="card" style={{ border: '1px solid #c0c0c0', overflow: 'hidden' }}>
          <div style={{
            background: '#f3f4f6',
            borderBottom: '1px solid #c0c0c0',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Database size={14} />
            <span style={{ fontWeight: 600, fontSize: '10pt' }}>Rarity Analysis</span>
          </div>
          <div style={{ padding: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{
                background: getRarityColor(rarityData.rarity_level),
                color: 'white',
                padding: '6px 12px',
                borderRadius: '2px',
                fontWeight: 'bold',
                fontSize: '10pt'
              }}>
                {getRarityLabel(rarityData.rarity_level)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12pt', fontWeight: 'bold', fontFamily: 'monospace' }}>
                  {rarityData.total_in_database} {rarityData.total_in_database === 1 ? 'vehicle' : 'vehicles'} in database
                </div>
                <div style={{ fontSize: '8pt', color: '#666' }}>
                  Rarity Score: {rarityData.rarity_score}/100
                </div>
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '8pt' }}>
              <div style={{ background: '#f9fafb', padding: '8px', border: '1px solid #e5e7eb', borderRadius: '2px' }}>
                <div style={{ color: '#666', marginBottom: '2px' }}>Same Make/Model (Any Year)</div>
                <div style={{ fontSize: '12pt', fontWeight: 'bold' }}>{rarityData.same_make_model}</div>
              </div>
              <div style={{ background: '#f9fafb', padding: '8px', border: '1px solid #e5e7eb', borderRadius: '2px' }}>
                <div style={{ color: '#666', marginBottom: '2px' }}>Same Year (Any Make/Model)</div>
                <div style={{ fontSize: '12pt', fontWeight: 'bold' }}>{rarityData.same_year}</div>
              </div>
            </div>

            {rarityData.rarity_level === 'ULTRA_RARE' && rarityData.total_in_database > 1 && (
              <div style={{
                marginTop: '12px',
                padding: '8px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '2px',
                display: 'flex',
                alignItems: 'start',
                gap: '8px',
                fontSize: '8pt'
              }}>
                <AlertCircle size={14} style={{ color: '#dc2626', flexShrink: 0, marginTop: '1px' }} />
                <div style={{ color: '#7f1d1d' }}>
                  <strong>Ultra Rare:</strong> This {vehicle.year} {vehicle.make} {vehicle.model} represents less than 0.1% of vehicles in our database, indicating exceptional rarity.
                </div>
              </div>
            )}

            {rarityData.total_in_database === 1 && (
              <div style={{
                marginTop: '12px',
                padding: '8px',
                background: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '2px',
                display: 'flex',
                alignItems: 'start',
                gap: '8px',
                fontSize: '8pt'
              }}>
                <AlertCircle size={14} style={{ color: '#0369a1', flexShrink: 0, marginTop: '1px' }} />
                <div style={{ color: '#0c4a6e' }}>
                  <strong>Limited Data:</strong> This is the only {vehicle.year} {vehicle.make} {vehicle.model} in our database. Rarity assessment requires more comprehensive market data.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Regional Market Stats */}
      {regionalData && userLocation && (
        <div className="card" style={{ border: '1px solid #c0c0c0', overflow: 'hidden' }}>
          <div style={{
            background: '#f3f4f6',
            borderBottom: '1px solid #c0c0c0',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <MapPin size={14} />
            <span style={{ fontWeight: 600, fontSize: '10pt' }}>
              Regional Market ({userLocation.city || userLocation.state || 'Your Area'})
            </span>
          </div>
          <div style={{ padding: '12px' }}>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '8pt', color: '#666', marginBottom: '4px' }}>
                Within {regionalData.radius_miles} miles
              </div>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
                <div>
                  <span style={{ fontSize: '14pt', fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {regionalData.nearby_count}
                  </span>
                  <span style={{ fontSize: '8pt', color: '#666', marginLeft: '4px' }}>similar vehicles</span>
                </div>
                {regionalData.nearby_for_sale > 0 && (
                  <div>
                    <span style={{ fontSize: '12pt', fontWeight: 'bold', color: '#16a34a' }}>
                      {regionalData.nearby_for_sale}
                    </span>
                    <span style={{ fontSize: '8pt', color: '#666', marginLeft: '4px' }}>for sale</span>
                  </div>
                )}
              </div>
            </div>

            {/* Price Comparison */}
            {(regionalData.avg_price_regional || regionalData.avg_price_national) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '8pt' }}>
                {regionalData.avg_price_regional && (
                  <div style={{ background: '#f9fafb', padding: '8px', border: '1px solid #e5e7eb', borderRadius: '2px' }}>
                    <div style={{ color: '#666', marginBottom: '2px' }}>Regional Avg Price</div>
                    <div style={{ fontSize: '12pt', fontWeight: 'bold', fontFamily: 'monospace' }}>
                      {formatCurrency(regionalData.avg_price_regional)}
                    </div>
                  </div>
                )}
                {regionalData.avg_price_national && (
                  <div style={{ background: '#f9fafb', padding: '8px', border: '1px solid #e5e7eb', borderRadius: '2px' }}>
                    <div style={{ color: '#666', marginBottom: '2px' }}>National Avg Price</div>
                    <div style={{ fontSize: '12pt', fontWeight: 'bold', fontFamily: 'monospace' }}>
                      {formatCurrency(regionalData.avg_price_national)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Price Range */}
            {regionalData.price_range_low && regionalData.price_range_high && (
              <div style={{ marginTop: '8px', fontSize: '8pt' }}>
                <div style={{ color: '#666', marginBottom: '4px' }}>Regional Price Range</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {formatCurrency(regionalData.price_range_low)}
                  </span>
                  <div style={{ flex: 1, height: '4px', background: 'linear-gradient(to right, #3b82f6, #10b981)', borderRadius: '2px' }} />
                  <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {formatCurrency(regionalData.price_range_high)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Comparable Vehicles */}
      {comparables.length > 0 && (
        <div className="card" style={{ border: '1px solid #c0c0c0', overflow: 'hidden' }}>
          <div style={{
            background: '#f3f4f6',
            borderBottom: '1px solid #c0c0c0',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <TrendingUp size={14} />
            <span style={{ fontWeight: 600, fontSize: '10pt' }}>Comparable Vehicles</span>
          </div>
          <div style={{ padding: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {comparables.map(comp => (
                <div
                  key={comp.id}
                  style={{
                    padding: '8px',
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: '2px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onClick={() => window.open(`/vehicle/${comp.id}`, '_blank')}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f3f4f6';
                    e.currentTarget.style.borderColor = '#3b82f6';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#e5e7eb';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '10pt', fontWeight: 'bold' }}>
                        {comp.year} {comp.make} {comp.model}
                      </div>
                      <div style={{ fontSize: '8pt', color: '#666', marginTop: '2px' }}>
                        {comp.distance_miles && `${comp.distance_miles} miles away • `}
                        {comp.is_for_sale ? (
                          <span style={{ color: '#16a34a', fontWeight: 600 }}>For Sale</span>
                        ) : (
                          <span>Not for sale</span>
                        )}
                      </div>
                    </div>
                    {comp.price && (
                      <div style={{ fontSize: '12pt', fontWeight: 'bold', fontFamily: 'monospace' }}>
                        {formatCurrency(comp.price)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleMarketIntelligence;

