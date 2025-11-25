import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface SoldVehicle {
  id: string;
  vehicle_id: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  engine_size?: string;
  transmission?: string;
  drivetrain?: string;
  displacement?: number;
  mileage?: number;
  sale_price: number | null;
  sale_date: string | null;
  platform?: string | null;
  listing_url?: string | null;
  final_price?: number | null;
  sold_at?: string | null;
  primary_image?: string | null;
  image_count: number;
  // Proof data
  proof_url?: string | null;
  proof_platform?: string | null;
  proof_type?: string | null;
  proof_confidence?: number | null;
  bat_auction_url?: string | null;
  external_listing_id?: string | null;
  timeline_event_id?: string | null;
  timeline_bat_url?: string | null;
}

interface Props {
  organizationId: string;
}

type ViewMode = 'gallery' | 'grid' | 'technical';

export default function SoldInventoryBrowser({ organizationId }: Props) {
  const navigate = useNavigate();
  
  const [soldVehicles, setSoldVehicles] = useState<SoldVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'price' | 'year'>('date');
  const [selectedProof, setSelectedProof] = useState<SoldVehicle | null>(null);

  useEffect(() => {
    loadSoldVehicles();
  }, [organizationId]);

  const loadSoldVehicles = async () => {
    setLoading(true);
    try {
      // Fetch vehicles and organization_vehicles separately to avoid PostgREST ordering issues
      const { data: orgVehicles, error: orgError } = await supabase
        .from('organization_vehicles')
        .select('id, vehicle_id, sale_price, sale_date, listing_status')
        .eq('organization_id', organizationId)
        .eq('listing_status', 'sold')
        .order('sale_date', { ascending: false, nullsFirst: false });

      if (orgError) throw orgError;

      if (!orgVehicles || orgVehicles.length === 0) {
        setSoldVehicles([]);
        setLoading(false);
        return;
      }

      const vehicleIds = orgVehicles.map(ov => ov.vehicle_id);
      const { data, error } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          trim,
          engine_size,
          displacement,
          transmission,
          drivetrain,
          mileage
        `)
        .in('id', vehicleIds);

      if (error) throw error;

      // Create map of vehicle_id -> orgVehicle data
      const orgVehicleMap = new Map(orgVehicles.map(ov => [ov.vehicle_id, ov]));

      // Fetch proof data from sold_vehicle_proof view
      const { data: proofData } = await supabase
        .from('sold_vehicle_proof')
        .select('*')
        .eq('organization_id', organizationId);

      const proofMap = new Map((proofData || []).map((p: any) => [p.vehicle_id, p]));

      // Fetch external listing data (BaT, etc)
      const enriched = await Promise.all(
        (data || []).map(async (v: any) => {
          const orgVehicle = orgVehicleMap.get(v.id);
          if (!orgVehicle) return null;

          const proof = proofMap.get(v.id);

          // Get primary image
          const { data: img } = await supabase
            .from('vehicle_images')
            .select('image_url, thumbnail_url, medium_url')
            .eq('vehicle_id', v.id)
            .eq('is_primary', true)
            .maybeSingle();

          if (!img) {
          const { data: firstImg } = await supabase
              .from('vehicle_images')
              .select('image_url, thumbnail_url, medium_url, created_at, taken_at')
              .eq('vehicle_id', v.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (firstImg) {
              Object.assign(img || {}, firstImg);
            }
          }

          // Get image count
          const { count: imageCount } = await supabase
            .from('vehicle_images')
            .select('id', { count: 'exact', head: true })
            .eq('vehicle_id', v.id);

          // Get external listing data (fallback if proof doesn't have it)
          const { data: externalListing } = await supabase
            .from('external_listings')
            .select('platform, listing_url, final_price, sold_at')
            .eq('vehicle_id', v.id)
            .maybeSingle();
          
          return {
            id: orgVehicle.id,
            vehicle_id: v.id,
            year: v.year,
            make: v.make,
            model: v.model,
            trim: v.trim,
            engine_size: v.engine_size,
            displacement: v.displacement,
            transmission: v.transmission,
            drivetrain: v.drivetrain,
            mileage: v.mileage,
            sale_price: orgVehicle.sale_price ? parseFloat(orgVehicle.sale_price) : null,
            sale_date: orgVehicle.sale_date,
            platform: proof?.proof_platform || externalListing?.platform,
            listing_url: proof?.proof_url || externalListing?.listing_url,
            final_price: externalListing?.final_price,
            sold_at: externalListing?.sold_at,
            primary_image: img?.thumbnail_url || img?.medium_url || img?.image_url,
            image_count: imageCount || 0,
            // Proof data
            proof_url: proof?.proof_url,
            proof_platform: proof?.proof_platform,
            proof_type: proof?.proof_type,
            proof_confidence: proof?.proof_confidence,
            bat_auction_url: proof?.bat_auction_url,
            external_listing_id: proof?.external_listing_id,
            timeline_event_id: proof?.timeline_event_id,
            timeline_bat_url: proof?.timeline_bat_url
          };
        })
      );

      // Filter out nulls and sort by sale_date
      const validEnriched = enriched.filter(v => v !== null) as SoldVehicle[];
      validEnriched.sort((a, b) => {
        const dateA = a.sale_date ? new Date(a.sale_date).getTime() : 0;
        const dateB = b.sale_date ? new Date(b.sale_date).getTime() : 0;
        return dateB - dateA; // Descending
      });

      setSoldVehicles(validEnriched);
    } catch (error) {
      console.error('Failed to load sold vehicles:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredVehicles = soldVehicles
    .filter(v => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        `${v.year} ${v.make} ${v.model}`.toLowerCase().includes(query) ||
        v.trim?.toLowerCase().includes(query) ||
        v.platform?.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.sale_date || 0).getTime() - new Date(a.sale_date || 0).getTime();
      } else if (sortBy === 'price') {
        return (b.sale_price || b.final_price || 0) - (a.sale_price || a.final_price || 0);
      } else if (sortBy === 'year') {
        return b.year - a.year;
      }
      return 0;
    });

  const formatPrice = (vehicle: SoldVehicle) => {
    const price = vehicle.sale_price || vehicle.final_price;
    if (!price || price === 0) return 'Price not disclosed';
    return `$${price.toLocaleString()}`;
  };

  const formatPlatform = (vehicle: SoldVehicle) => {
    // Use proof_platform if available (most accurate)
    const platform = vehicle.proof_platform || vehicle.platform;
    
    if (!platform || platform === 'unknown') {
      // Check if we have any proof at all
      if (vehicle.proof_url || vehicle.bat_auction_url || vehicle.timeline_bat_url) {
        return 'Bring a Trailer'; // Likely BaT if we have a URL
      }
      return 'Private Sale';
    }
    
    const platforms: Record<string, string> = {
      'bat': 'Bring a Trailer',
      'ebay_motors': 'eBay Motors',
      'ebay': 'eBay Motors',
      'cars_and_bids': 'Cars & Bids',
      'cars_bids': 'Cars & Bids',
      'hemmings': 'Hemmings',
      'classic_com': 'Classic.com',
      'autotrader': 'AutoTrader',
      'facebook_marketplace': 'Facebook Marketplace'
    };
    return platforms[platform] || platform;
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading sold inventory...
      </div>
    );
  }

  if (soldVehicles.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '9pt' }}>
        No sold vehicles yet
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '16px' }}>
      {/* Header with search, sort, and view controls */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '16px',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search sold inventory..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: '1 1 250px',
            padding: '6px 10px',
            border: '1px solid var(--border)',
            borderRadius: '3px',
            fontSize: '9pt'
          }}
        />

        {/* Controls */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'price' | 'year')}
            style={{
              padding: '6px 8px',
              border: '1px solid var(--border)',
              borderRadius: '3px',
              fontSize: '8pt',
              cursor: 'pointer'
            }}
          >
            <option value="date">Sort by Date</option>
            <option value="price">Sort by Price</option>
            <option value="year">Sort by Year</option>
          </select>

          {/* View mode buttons */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
            {(['gallery', 'grid', 'technical'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  background: viewMode === mode ? 'var(--accent)' : 'transparent',
                  color: viewMode === mode ? 'white' : 'var(--text)',
                  fontSize: '8pt',
                  cursor: 'pointer',
                  fontWeight: viewMode === mode ? 600 : 400,
                  textTransform: 'capitalize',
                  borderRight: mode !== 'technical' ? '1px solid var(--border)' : 'none'
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results count */}
      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
        Showing {filteredVehicles.length} of {soldVehicles.length} sold vehicles
      </div>

      {/* GALLERY VIEW */}
      {viewMode === 'gallery' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '16px'
        }}>
          {filteredVehicles.map(vehicle => (
            <div
              key={vehicle.id}
              onClick={() => navigate(`/vehicle/${vehicle.vehicle_id}`)}
              style={{
                border: '1px solid var(--border)',
                borderRadius: '4px',
                overflow: 'hidden',
                background: 'var(--white)',
                cursor: 'pointer',
                transition: 'transform 0.12s, box-shadow 0.12s'
              }}
              className="hover-lift"
            >
              {/* Image */}
              <div style={{
                aspectRatio: '4/3',
                background: vehicle.primary_image
                  ? `url(${vehicle.primary_image}) center/cover`
                  : 'var(--grey-200)',
                position: 'relative'
              }}>
                {/* Sold badge - clickable to show proof */}
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedProof(vehicle);
                  }}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    left: '8px',
                    background: 'rgba(220, 38, 38, 0.95)',
                    color: 'white',
                    padding: '4px 10px',
                    borderRadius: '2px',
                    fontSize: '7pt',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                    zIndex: 10
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(220, 38, 38, 1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(220, 38, 38, 0.95)'}
                  title="Click to view sale proof"
                >
                  SOLD
                </div>

                {/* Image count */}
                {vehicle.image_count > 0 && (
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    background: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    padding: '4px 8px',
                    borderRadius: '2px',
                    fontSize: '7pt',
                    fontWeight: 600
                  }}>
                    {vehicle.image_count} photos
                  </div>
                )}
              </div>

              {/* Info */}
              <div style={{ padding: '12px' }}>
                <div style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '4px' }}>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </div>
                {vehicle.trim && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    {vehicle.trim}
                  </div>
                )}

                {/* Price */}
                <div style={{
                  fontSize: '13pt',
                  fontWeight: 700,
                  color: 'var(--accent)',
                  marginBottom: '8px'
                }}>
                  {formatPrice(vehicle)}
                </div>

                {/* Sale info */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-light)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7pt', color: 'var(--text-muted)' }}>
                    <span>Sold on:</span>
                    <span style={{ fontWeight: 600 }}>{formatPlatform(vehicle)}</span>
                  </div>
                  {vehicle.sale_date && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7pt', color: 'var(--text-muted)' }}>
                      <span>Date:</span>
                      <span style={{ fontWeight: 600 }}>{new Date(vehicle.sale_date).toLocaleDateString()}</span>
                    </div>
                  )}
                  {(vehicle.proof_url || vehicle.listing_url || vehicle.bat_auction_url || vehicle.timeline_bat_url) && (
                    <a
                      href={vehicle.proof_url || vehicle.listing_url || vehicle.bat_auction_url || vehicle.timeline_bat_url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontSize: '7pt',
                        color: 'var(--accent)',
                        textDecoration: 'none',
                        marginTop: '4px'
                      }}
                      className="hover:underline"
                    >
                      View original listing →
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* GRID VIEW */}
      {viewMode === 'grid' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '12px'
        }}>
          {filteredVehicles.map(vehicle => (
            <div
              key={vehicle.id}
              onClick={() => navigate(`/vehicle/${vehicle.vehicle_id}`)}
              style={{
                border: '1px solid var(--border)',
                borderRadius: '4px',
                overflow: 'hidden',
                background: 'var(--white)',
                cursor: 'pointer'
              }}
              className="hover-lift"
            >
              <div style={{
                aspectRatio: '1/1',
                background: vehicle.primary_image
                  ? `url(${vehicle.primary_image}) center/cover`
                  : 'var(--grey-200)',
                position: 'relative'
              }}>
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedProof(vehicle);
                  }}
                  style={{
                    position: 'absolute',
                    top: '6px',
                    left: '6px',
                    background: 'rgba(220, 38, 38, 0.95)',
                    color: 'white',
                    padding: '3px 8px',
                    borderRadius: '2px',
                    fontSize: '6pt',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                    zIndex: 10
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(220, 38, 38, 1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(220, 38, 38, 0.95)'}
                  title="Click to view sale proof"
                >
                  SOLD
                </div>
              </div>
              <div style={{ padding: '8px' }}>
                <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '2px' }}>
                  {vehicle.year} {vehicle.make}
                </div>
                <div style={{ fontSize: '7pt', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  {vehicle.model}
                </div>
                <div style={{ fontSize: '9pt', fontWeight: 700, color: 'var(--accent)' }}>
                  {formatPrice(vehicle)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TECHNICAL VIEW */}
      {viewMode === 'technical' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '8pt',
            background: 'var(--white)',
            border: '1px solid var(--border)'
          }}>
            <thead>
              <tr style={{ background: 'var(--grey-100)', borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Vehicle</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Engine</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Trans</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Drive</th>
                <th style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>Miles</th>
                <th style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>Sale Price</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Platform</th>
                <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Sale Date</th>
                <th style={{ padding: '8px', textAlign: 'center', fontWeight: 700 }}>Photos</th>
              </tr>
            </thead>
            <tbody>
              {filteredVehicles.map(vehicle => (
                <tr
                  key={vehicle.id}
                  onClick={() => navigate(`/vehicle/${vehicle.vehicle_id}`)}
                  style={{
                    borderBottom: '1px solid var(--border-light)',
                    cursor: 'pointer',
                    transition: 'background 0.12s'
                  }}
                  className="hover:bg-gray-50"
                >
                  <td style={{ padding: '10px' }}>
                    <div style={{ fontWeight: 700 }}>
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </div>
                    {vehicle.trim && (
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                        {vehicle.trim}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px' }}>
                    {vehicle.engine_size || 'N/A'}
                    {vehicle.displacement && (
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                        ({vehicle.displacement}ci)
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px' }}>{vehicle.transmission || 'N/A'}</td>
                  <td style={{ padding: '10px' }}>{vehicle.drivetrain || 'N/A'}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    {vehicle.mileage ? vehicle.mileage.toLocaleString() : 'N/A'}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>
                    {formatPrice(vehicle)}
                  </td>
                  <td style={{ padding: '10px' }}>
                    {(vehicle.proof_url || vehicle.listing_url || vehicle.bat_auction_url || vehicle.timeline_bat_url) ? (
                      <a
                        href={vehicle.proof_url || vehicle.listing_url || vehicle.bat_auction_url || vehicle.timeline_bat_url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: 'var(--accent)', textDecoration: 'none' }}
                        className="hover:underline"
                      >
                        {formatPlatform(vehicle)}
                      </a>
                    ) : (
                      formatPlatform(vehicle)
                    )}
                  </td>
                  <td style={{ padding: '10px' }}>
                    {vehicle.sale_date ? new Date(vehicle.sale_date).toLocaleDateString() : 'N/A'}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'center' }}>
                    {vehicle.image_count || 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Proof Modal */}
      {selectedProof && (
        <div
          onClick={() => setSelectedProof(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '500px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '14pt', fontWeight: 700 }}>
                Sale Proof: {selectedProof.year} {selectedProof.make} {selectedProof.model}
              </h3>
              <button
                onClick={() => setSelectedProof(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '18pt',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '0',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '9pt' }}>
              {/* Proof Type */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-muted)' }}>Proof Type:</div>
                <div style={{ 
                  padding: '6px 10px', 
                  background: selectedProof.proof_confidence && selectedProof.proof_confidence >= 80 ? 'var(--success-dim)' : 'var(--warning-dim)',
                  borderRadius: '4px',
                  display: 'inline-block',
                  fontWeight: 600
                }}>
                  {selectedProof.proof_type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Manual Mark'}
                  {selectedProof.proof_confidence && (
                    <span style={{ marginLeft: '8px', fontSize: '8pt', color: 'var(--text-muted)' }}>
                      ({selectedProof.proof_confidence}% confidence)
                    </span>
                  )}
                </div>
              </div>

              {/* Platform */}
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-muted)' }}>Platform:</div>
                <div style={{ fontWeight: 600 }}>{formatPlatform(selectedProof)}</div>
              </div>

              {/* Proof URL */}
              {(selectedProof.proof_url || selectedProof.bat_auction_url || selectedProof.timeline_bat_url) && (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-muted)' }}>Listing URL:</div>
                  <a
                    href={selectedProof.proof_url || selectedProof.bat_auction_url || selectedProof.timeline_bat_url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--accent)',
                      textDecoration: 'none',
                      wordBreak: 'break-all',
                      display: 'block',
                      padding: '6px',
                      background: 'var(--surface)',
                      borderRadius: '4px',
                      border: '1px solid var(--border)'
                    }}
                    className="hover:underline"
                  >
                    {selectedProof.proof_url || selectedProof.bat_auction_url || selectedProof.timeline_bat_url}
                  </a>
                </div>
              )}

              {/* Sale Details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {selectedProof.sale_date && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-muted)' }}>Sale Date:</div>
                    <div>{new Date(selectedProof.sale_date).toLocaleDateString()}</div>
                  </div>
                )}
                {selectedProof.sale_price && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-muted)' }}>Sale Price:</div>
                    <div style={{ fontWeight: 600, color: 'var(--accent)' }}>
                      ${selectedProof.sale_price.toLocaleString()}
                    </div>
                  </div>
                )}
              </div>

              {/* Proof Source Details */}
              {selectedProof.external_listing_id && (
                <div style={{ 
                  padding: '8px', 
                  background: 'var(--success-dim)', 
                  borderRadius: '4px',
                  fontSize: '8pt'
                }}>
                  <strong>External Listing Record:</strong> Verified sale through external_listings table (ID: {selectedProof.external_listing_id})
                </div>
              )}

              {selectedProof.timeline_event_id && (
                <div style={{ 
                  padding: '8px', 
                  background: 'var(--info-dim)', 
                  borderRadius: '4px',
                  fontSize: '8pt'
                }}>
                  <strong>Timeline Event:</strong> Sale recorded in timeline_events (ID: {selectedProof.timeline_event_id})
                </div>
              )}

              {!selectedProof.proof_url && !selectedProof.bat_auction_url && !selectedProof.timeline_bat_url && (
                <div style={{ 
                  padding: '8px', 
                  background: 'var(--warning-dim)', 
                  borderRadius: '4px',
                  fontSize: '8pt',
                  color: 'var(--warning)'
                }}>
                  <strong>No external proof available.</strong> This vehicle was marked as sold manually or imported from a source without listing URLs.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

