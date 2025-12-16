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
  title?: string; // Optional custom title (e.g., "Service Archive" for service orgs)
}

type ViewMode = 'gallery' | 'grid' | 'technical';
type SortBy = 'date' | 'price' | 'year' | 'make' | 'model';
type SortDirection = 'asc' | 'desc';

export default function SoldInventoryBrowser({ organizationId, title = 'Sold Inventory Archive' }: Props) {
  const navigate = useNavigate();
  
  const [soldVehicles, setSoldVehicles] = useState<SoldVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('technical'); // Default to technical
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedProof, setSelectedProof] = useState<SoldVehicle | null>(null);
  const [isExpanded, setIsExpanded] = useState(true); // Collapsible state
  const [hoveredVehicle, setHoveredVehicle] = useState<SoldVehicle | null>(null); // For hover preview

  useEffect(() => {
    loadSoldVehicles();
  }, [organizationId]);

  const loadSoldVehicles = async () => {
    setLoading(true);
    try {
      const isServiceArchive = String(title || '').toLowerCase().includes('service');

      // Fetch organization_vehicles first (we'll filter "sold" using multiple indicators after enrichment).
      // IMPORTANT: many orgs do NOT consistently set `listing_status = 'sold'` on organization_vehicles,
      // but do set sale fields on the vehicle record or via external listings/proof.
      const { data: orgVehicles, error: orgError } = await supabase
        .from('organization_vehicles')
        .select('id, vehicle_id, relationship_type, status, start_date, end_date, sale_price, sale_date, listing_status')
        .eq('organization_id', organizationId)
        .or('status.eq.active,status.eq.sold,status.eq.archived')
        .order('created_at', { ascending: false });

      if (orgError) throw orgError;

      if (!orgVehicles || orgVehicles.length === 0) {
        setSoldVehicles([]);
        setLoading(false);
        return;
      }

      const vehicleIds = orgVehicles.map((ov: any) => ov.vehicle_id).filter(Boolean);
      if (vehicleIds.length === 0) {
        setSoldVehicles([]);
        setLoading(false);
        return;
      }

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
          mileage,
          sale_status,
          sale_price,
          sale_date
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

      // Fetch external listing data (BaT, etc) in one shot
      const { data: externalListings } = await supabase
        .from('external_listings')
        .select('vehicle_id, platform, listing_url, final_price, sold_at, listing_status')
        .in('vehicle_id', vehicleIds);
      const externalMap = new Map((externalListings || []).map((l: any) => [l.vehicle_id, l]));

      // Fetch images in one shot and build:
      // - primary image per vehicle (primary first, newest first)
      // - image count per vehicle
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('vehicle_id, image_url, thumbnail_url, medium_url, is_primary, created_at, taken_at')
        .in('vehicle_id', vehicleIds)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false });

      const imageCountByVehicle = new Map<string, number>();
      const primaryImageByVehicle = new Map<string, string>();
      (images || []).forEach((img: any) => {
        const vid = img?.vehicle_id;
        if (!vid) return;
        imageCountByVehicle.set(vid, (imageCountByVehicle.get(vid) || 0) + 1);
        if (!primaryImageByVehicle.has(vid)) {
          const url = img.thumbnail_url || img.medium_url || img.image_url;
          if (url) primaryImageByVehicle.set(vid, url);
        }
      });

      // Enrich and filter
      const enriched = (data || [])
        .map((v: any) => {
          const orgVehicle = orgVehicleMap.get(v.id);
          if (!orgVehicle) return null;

          const proof = proofMap.get(v.id);
          const externalListing = externalMap.get(v.id);

          const saleStatus = String(v.sale_status || '').toLowerCase();
          const listingStatus = String(orgVehicle.listing_status || externalListing?.listing_status || '').toLowerCase();

          const ovSalePriceNum = orgVehicle.sale_price ? Number(orgVehicle.sale_price) : 0;
          const vSalePriceNum = v.sale_price ? Number(v.sale_price) : 0;
          const extFinalPriceNum = externalListing?.final_price ? Number(externalListing.final_price) : 0;

          const isSold =
            listingStatus === 'sold' ||
            saleStatus === 'sold' ||
            Boolean(orgVehicle.sale_date) ||
            Boolean(v.sale_date) ||
            ovSalePriceNum > 0 ||
            vSalePriceNum > 0 ||
            Boolean(externalListing?.sold_at) ||
            extFinalPriceNum > 0;

          const isCompletedService =
            ['service_provider', 'work_location'].includes(String(orgVehicle.relationship_type || '').toLowerCase()) &&
            (Boolean(orgVehicle.end_date) || String(orgVehicle.status || '').toLowerCase() === 'archived' || String(orgVehicle.status || '').toLowerCase() === 'sold');

          // For service orgs, this component acts as a service archive.
          // For inventory orgs, it is a sold inventory archive.
          if (isServiceArchive) {
            if (!isCompletedService) return null;
          } else {
            if (!isSold) return null;
          }

          const saleDate = orgVehicle.sale_date || v.sale_date || externalListing?.sold_at || null;
          const salePrice =
            (orgVehicle.sale_price ? Number(orgVehicle.sale_price) : null) ||
            (v.sale_price ? Number(v.sale_price) : null) ||
            null;

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
            sale_price: salePrice,
            sale_date: saleDate,
            platform: proof?.proof_platform || externalListing?.platform,
            listing_url: proof?.proof_url || externalListing?.listing_url,
            final_price: externalListing?.final_price,
            sold_at: externalListing?.sold_at,
            primary_image: primaryImageByVehicle.get(v.id) || null,
            image_count: imageCountByVehicle.get(v.id) || 0,
            // Proof data
            proof_url: proof?.proof_url,
            proof_platform: proof?.proof_platform,
            proof_type: proof?.proof_type,
            proof_confidence: proof?.proof_confidence,
            bat_auction_url: proof?.bat_auction_url,
            external_listing_id: proof?.external_listing_id,
            timeline_event_id: proof?.timeline_event_id,
            timeline_bat_url: proof?.timeline_bat_url
          } as SoldVehicle;
        })
        .filter(Boolean) as SoldVehicle[];

      // Filter out nulls and sort by sale_date
      enriched.sort((a, b) => {
        const dateA = a.sale_date ? new Date(a.sale_date).getTime() : 0;
        const dateB = b.sale_date ? new Date(b.sale_date).getTime() : 0;
        return dateB - dateA; // Descending
      });

      setSoldVehicles(enriched);
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
      let comparison = 0;
      
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.sale_date || 0).getTime() - new Date(b.sale_date || 0).getTime();
          break;
        case 'price':
          comparison = (a.sale_price || a.final_price || 0) - (b.sale_price || b.final_price || 0);
          break;
        case 'year':
          comparison = a.year - b.year;
          break;
        case 'make':
          comparison = (a.make || '').localeCompare(b.make || '');
          break;
        case 'model':
          comparison = (a.model || '').localeCompare(b.model || '');
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });

  const handleSort = (column: SortBy) => {
    if (sortBy === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDirection('desc'); // Default to descending
    }
  };

  const getSortIcon = (column: SortBy) => {
    if (sortBy !== column) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const formatPrice = (vehicle: SoldVehicle) => {
    const price = vehicle.sale_price || vehicle.final_price;
    if (!price || price === 0) return 'Price not disclosed';
    return `$${price.toLocaleString()}`;
  };

  const formatProofType = (proofType: string | null | undefined): string => {
    if (!proofType) return 'Manual Mark';
    return proofType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l: string) => l.toUpperCase());
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
      <div className="card">
        <div 
          className="card-header" 
          style={{ fontSize: '11pt', fontWeight: 700, cursor: 'pointer' }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {title}
          <span style={{ float: 'right', fontSize: '9pt' }}>{isExpanded ? '▼' : '▶'}</span>
        </div>
        {isExpanded && (
          <div className="card-body" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '9pt' }}>
            {title.includes('Service') ? 'No completed service work yet' : 'No sold vehicles yet'}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      {/* Collapsible Header */}
      <div 
        className="card-header" 
        style={{ fontSize: '11pt', fontWeight: 700, cursor: 'pointer' }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {title}
        <span style={{ float: 'right', fontSize: '9pt' }}>{isExpanded ? '▼' : '▶'}</span>
      </div>

      {isExpanded && (
        <div className="card-body">
          {/* All controls on one line */}
          <div style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '16px',
            flexWrap: 'wrap',
            alignItems: 'center'
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

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
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
              <option value="make">Sort by Make</option>
              <option value="model">Sort by Model</option>
            </select>

            {/* Sort Direction Toggle */}
            <button
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              style={{
                padding: '6px 8px',
                border: '1px solid var(--border)',
                borderRadius: '3px',
                fontSize: '8pt',
                cursor: 'pointer',
                background: 'var(--white)',
                minWidth: '40px'
              }}
              title={`Sort ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
            >
              {sortDirection === 'asc' ? '↑' : '↓'}
            </button>

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

          {/* Results count */}
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Showing {filteredVehicles.length} of {soldVehicles.length} sold vehicles
          </div>

          {/* GALLERY VIEW - More compact */}
          {viewMode === 'gallery' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
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

              {/* Compact Info */}
              <div style={{ padding: '10px' }}>
                <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </div>
                {vehicle.trim && (
                  <div style={{ fontSize: '7pt', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    {vehicle.trim}
                  </div>
                )}
                <div style={{
                  fontSize: '12pt',
                  fontWeight: 700,
                  color: 'var(--accent)',
                  marginBottom: '6px'
                }}>
                  {formatPrice(vehicle)}
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '7pt',
                  color: 'var(--text-muted)',
                  paddingTop: '6px',
                  borderTop: '1px solid var(--border-light)'
                }}>
                  <span>{formatPlatform(vehicle)}</span>
                  {vehicle.sale_date && (
                    <span>{new Date(vehicle.sale_date).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

          {/* GRID VIEW - More compact */}
          {viewMode === 'grid' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '10px'
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
              <div style={{ padding: '6px' }}>
                <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '2px' }}>
                  {vehicle.year} {vehicle.make}
                </div>
                <div style={{ fontSize: '6pt', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  {vehicle.model}
                </div>
                <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--accent)' }}>
                  {formatPrice(vehicle)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

          {/* TECHNICAL VIEW - Default, with hover preview and sortable columns */}
          {viewMode === 'technical' && (
            <div style={{ position: 'relative' }}>
              {/* Hover Preview Card */}
              {hoveredVehicle && (
                <div
                  style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'var(--surface)',
                    border: '2px solid var(--border)',
                    borderRadius: '8px',
                    padding: '16px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                    zIndex: 1000,
                    maxWidth: '400px',
                    pointerEvents: 'none'
                  }}
                >
                  {hoveredVehicle.primary_image && (
                    <img 
                      src={hoveredVehicle.primary_image}
                      alt={`${hoveredVehicle.year} ${hoveredVehicle.make} ${hoveredVehicle.model}`}
                      style={{
                        width: '100%',
                        aspectRatio: '4/3',
                        objectFit: 'cover',
                        borderRadius: '4px',
                        marginBottom: '12px'
                      }}
                    />
                  )}
                  <div style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '4px' }}>
                    {hoveredVehicle.year} {hoveredVehicle.make} {hoveredVehicle.model}
                  </div>
                  {hoveredVehicle.trim && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      {hoveredVehicle.trim}
                    </div>
                  )}
                  <div style={{ fontSize: '14pt', fontWeight: 700, color: 'var(--accent)', marginBottom: '8px' }}>
                    {formatPrice(hoveredVehicle)}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    Sold on {formatPlatform(hoveredVehicle)}
                    {hoveredVehicle.sale_date && ` • ${new Date(hoveredVehicle.sale_date).toLocaleDateString()}`}
                  </div>
                </div>
              )}

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
                      <th 
                        style={{ padding: '8px', textAlign: 'left', fontWeight: 700, cursor: 'pointer' }}
                        onClick={() => handleSort('year')}
                      >
                        Year {getSortIcon('year')}
                      </th>
                      <th 
                        style={{ padding: '8px', textAlign: 'left', fontWeight: 700, cursor: 'pointer' }}
                        onClick={() => handleSort('make')}
                      >
                        Make {getSortIcon('make')}
                      </th>
                      <th 
                        style={{ padding: '8px', textAlign: 'left', fontWeight: 700, cursor: 'pointer' }}
                        onClick={() => handleSort('model')}
                      >
                        Model {getSortIcon('model')}
                      </th>
                      <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Trim</th>
                      <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Engine</th>
                      <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Drive</th>
                      <th style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>Miles</th>
                      <th 
                        style={{ padding: '8px', textAlign: 'right', fontWeight: 700, cursor: 'pointer' }}
                        onClick={() => handleSort('price')}
                      >
                        Sale Price {getSortIcon('price')}
                      </th>
                      <th style={{ padding: '8px', textAlign: 'left', fontWeight: 700 }}>Platform</th>
                      <th 
                        style={{ padding: '8px', textAlign: 'left', fontWeight: 700, cursor: 'pointer' }}
                        onClick={() => handleSort('date')}
                      >
                        Sale Date {getSortIcon('date')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVehicles.map(vehicle => (
                      <tr
                        key={vehicle.id}
                        onClick={() => navigate(`/vehicle/${vehicle.vehicle_id}`)}
                        onMouseEnter={() => setHoveredVehicle(vehicle)}
                        onMouseLeave={() => setHoveredVehicle(null)}
                        style={{
                          borderBottom: '1px solid var(--border-light)',
                          cursor: 'pointer',
                          transition: 'background 0.12s'
                        }}
                        className="hover:bg-gray-50"
                      >
                        <td style={{ padding: '10px', fontWeight: 600 }}>{vehicle.year}</td>
                        <td style={{ padding: '10px' }}>{vehicle.make}</td>
                        <td style={{ padding: '10px' }}>{vehicle.model}</td>
                        <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                          {vehicle.trim || '—'}
                        </td>
                        <td style={{ padding: '10px' }}>
                          {vehicle.engine_size || '—'}
                          {vehicle.displacement && (
                            <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                              ({vehicle.displacement}ci)
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px' }}>{vehicle.drivetrain || '—'}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          {vehicle.mileage ? vehicle.mileage.toLocaleString() : '—'}
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
                          {vehicle.sale_date ? new Date(vehicle.sale_date).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
              background: 'var(--surface)',
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
                  {formatProofType(selectedProof.proof_type)}
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

