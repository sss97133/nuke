import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleRelationshipVerification from './VehicleRelationshipVerification';

interface DealerVehicle {
  id: string;
  vehicle_id: string;
  relationship_type: string;
  status: string;
  listing_status?: string | null;
  asking_price: number | null;
  cost_basis: number | null;
  days_on_lot: number;
  featured: boolean;
  sale_date: string | null;
  sale_price: number | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  vehicles: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim?: string;
    vin?: string;
    current_value?: number;
    mileage?: number;
    sale_status?: string | null;
  };
  thumbnail_url?: string;
}

interface Props {
  organizationId: string;
  userId: string | null;
  canEdit: boolean;
  isOwner: boolean;
}

type ViewMode = 'grid' | 'list' | 'compact';
type CategoryType = 'all' | 'for_sale' | 'sold' | 'new_arrival' | 'in_build' | 'auction_soon' | 'pending' | 'service' | 'historical';
type SortBy = 'newest' | 'oldest' | 'price_high' | 'price_low' | 'days_lot';

const EnhancedDealerInventory: React.FC<Props> = ({ organizationId, userId, canEdit, isOwner }) => {
  const navigate = useNavigate();
  
  const [vehicles, setVehicles] = useState<DealerVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [category, setCategory] = useState<CategoryType>('all');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadVehicles();
  }, [organizationId]);

  const loadVehicles = async () => {
    setLoading(true);
    try {
      // Load ALL vehicles (active, sold, archived) - smart display will categorize them
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select(`
          id,
          vehicle_id,
          relationship_type,
          status,
          listing_status,
          asking_price,
          cost_basis,
          days_on_lot,
          featured,
          sale_date,
          sale_price,
          start_date,
          end_date,
          created_at,
          vehicles!inner(
            id,
            year,
            make,
            model,
            trim,
            vin,
            current_value,
            mileage,
            sale_status
          )
        `)
        .eq('organization_id', organizationId)
        .in('status', ['active', 'sold', 'archived'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch thumbnails
      const enriched = await Promise.all(
        (data || []).map(async (v) => {
          const { data: img } = await supabase
            .from('vehicle_images')
            .select('thumbnail_url, medium_url, image_url')
            .eq('vehicle_id', v.vehicle_id)
            .order('is_primary', { ascending: false })
            .limit(1)
            .maybeSingle();

          return {
            ...v,
            thumbnail_url: img?.thumbnail_url || img?.medium_url || img?.image_url || null
          };
        })
      );

      setVehicles(enriched as DealerVehicle[]);
    } catch (error) {
      console.error('Failed to load vehicles:', error);
    } finally {
      setLoading(false);
    }
  };

  // Smart categorization: Map relationship_type + status to display categories
  // IMPORTANT: Only mark as "sold" if there's proof (BAT URL, sale_date, approved verification, etc.)
  const getDisplayCategory = (v: DealerVehicle): string => {
    // Sold vehicles - ONLY if there's proof
    // Check for: sale_date, BAT listing (external_listings), or approved sale verification
    const hasSaleProof = v.sale_date || 
                        (v.vehicles.sale_status === 'sold' && v.sale_price) ||
                        (v.status === 'sold' && (v.sale_date || v.sale_price)); // Only if status is explicitly set with proof
    
    if (hasSaleProof && v.status === 'sold') {
      return 'sold';
    }
    
    // If status says "sold" but no proof, treat as inventory (needs verification)
    if (v.status === 'sold' && !hasSaleProof) {
      return 'all'; // Show in "all" until verified
    }
    
    // Service/work vehicles
    if (v.relationship_type === 'work_location' || v.relationship_type === 'service_provider') {
      return 'service';
    }
    
    // Historical vehicles (past tenure)
    if (v.end_date && new Date(v.end_date) < new Date()) {
      return 'historical';
    }
    
    // Active inventory
    if (v.relationship_type === 'in_stock' || v.relationship_type === 'consigner' || v.relationship_type === 'owner') {
      return v.listing_status || 'for_sale';
    }
    
    // Default to listing_status if available
    return v.listing_status || 'all';
  };

  // Filter and sort
  const filteredAndSorted = vehicles
    .filter(v => {
      // Category filter - use smart categorization
      if (category !== 'all') {
        const displayCategory = getDisplayCategory(v);
        if (displayCategory !== category) return false;
      }
      
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const vehicleStr = `${v.vehicles.year} ${v.vehicles.make} ${v.vehicles.model} ${v.vehicles.vin || ''}`.toLowerCase();
        if (!vehicleStr.includes(search)) return false;
      }
      
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'oldest': return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'price_high': return (b.asking_price || 0) - (a.asking_price || 0);
        case 'price_low': return (a.asking_price || 0) - (b.asking_price || 0);
        case 'days_lot': return b.days_on_lot - a.days_on_lot;
        default: return 0;
      }
    });

  // Calculate category counts using smart categorization
  const counts = {
    all: vehicles.length,
    for_sale: vehicles.filter(v => getDisplayCategory(v) === 'for_sale').length,
    new_arrival: vehicles.filter(v => getDisplayCategory(v) === 'new_arrival').length,
    in_build: vehicles.filter(v => getDisplayCategory(v) === 'in_build').length,
    auction_soon: vehicles.filter(v => getDisplayCategory(v) === 'auction_soon').length,
    pending: vehicles.filter(v => getDisplayCategory(v) === 'pending').length,
    sold: vehicles.filter(v => getDisplayCategory(v) === 'sold').length,
    service: vehicles.filter(v => getDisplayCategory(v) === 'service').length,
    historical: vehicles.filter(v => getDisplayCategory(v) === 'historical').length
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedVehicles.size === 0) return;
    
    const confirmed = confirm(`Change status of ${selectedVehicles.size} vehicles to "${newStatus}"?`);
    if (!confirmed) return;

    try {
      const updates = Array.from(selectedVehicles).map(vehicleId =>
        supabase
          .from('organization_vehicles')
          .update({ listing_status: newStatus })
          .eq('id', vehicleId)
      );

      await Promise.all(updates);
      await loadVehicles();
      setSelectedVehicles(new Set());
      alert('Status updated successfully!');
    } catch (error: any) {
      alert('Failed to update: ' + error.message);
    }
  };

  const toggleSelectVehicle = (vehicleId: string) => {
    const newSet = new Set(selectedVehicles);
    if (newSet.has(vehicleId)) {
      newSet.delete(vehicleId);
    } else {
      newSet.add(vehicleId);
    }
    setSelectedVehicles(newSet);
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; text: string }> = {
      'for_sale': { color: '#10b981', text: 'FOR SALE' },
      'sold': { color: '#6b7280', text: 'SOLD' },
      'new_arrival': { color: '#3b82f6', text: 'NEW ARRIVAL' },
      'in_build': { color: '#f59e0b', text: 'IN BUILD' },
      'auction_soon': { color: '#8b5cf6', text: 'AUCTION SOON' },
      'pending': { color: '#eab308', text: 'PENDING' },
      'consignment': { color: '#06b6d4', text: 'CONSIGNMENT' }
    };
    return badges[status] || { color: '#9ca3af', text: status.toUpperCase() };
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
        Loading inventory...
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '14pt', fontWeight: 700, margin: 0 }}>Inventory</h2>
          <span style={{ fontSize: '10pt', color: 'var(--text-muted)' }}>
            {filteredAndSorted.length} vehicles
          </span>
        </div>

        {canEdit && (
          <button
            onClick={() => setBulkEditMode(!bulkEditMode)}
            style={{
              padding: '8px 16px',
              fontSize: '8pt',
              fontWeight: 700,
              border: bulkEditMode ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: bulkEditMode ? 'var(--accent)' : 'white',
              color: bulkEditMode ? 'white' : 'var(--text)',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            {bulkEditMode ? 'EXIT BULK EDIT' : 'BULK EDIT'}
          </button>
        )}
      </div>

      {/* Bulk Actions */}
      {bulkEditMode && selectedVehicles.size > 0 && (
        <div style={{
          padding: '12px',
          background: 'var(--accent)',
          color: 'white',
          borderRadius: '4px',
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontSize: '9pt', fontWeight: 700 }}>
            {selectedVehicles.size} selected
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <select
              onChange={(e) => handleBulkStatusChange(e.target.value)}
              style={{
                padding: '4px 8px',
                fontSize: '8pt',
                borderRadius: '3px',
                border: 'none'
              }}
              defaultValue=""
            >
              <option value="" disabled>Change Status...</option>
              <option value="for_sale">For Sale</option>
              <option value="sold">Sold</option>
              <option value="new_arrival">New Arrival</option>
              <option value="in_build">In Build</option>
              <option value="auction_soon">Auction Soon</option>
              <option value="pending">Pending</option>
            </select>
            <button
              onClick={() => setSelectedVehicles(new Set())}
              style={{
                padding: '4px 12px',
                fontSize: '8pt',
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                borderRadius: '3px'
              }}
            >
              CLEAR
            </button>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '16px',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search year, make, model, VIN..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1,
            minWidth: '200px',
            padding: '8px 12px',
            fontSize: '9pt',
            border: '1px solid var(--border)',
            borderRadius: '4px'
          }}
        />

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          style={{
            padding: '8px 12px',
            fontSize: '8pt',
            border: '1px solid var(--border)',
            borderRadius: '4px'
          }}
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="price_high">Price: High to Low</option>
          <option value="price_low">Price: Low to High</option>
          <option value="days_lot">Days on Lot</option>
        </select>

        {/* View Mode */}
        <div style={{ display: 'flex', gap: '0', border: '1px solid var(--border)', borderRadius: '4px' }}>
          {(['grid', 'list', 'compact'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '6px 12px',
                fontSize: '7pt',
                fontWeight: 700,
                border: 'none',
                background: viewMode === mode ? 'var(--accent)' : 'transparent',
                color: viewMode === mode ? 'white' : 'var(--text-muted)',
                cursor: 'pointer'
              }}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Category Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '16px',
        flexWrap: 'wrap',
        overflowX: 'auto',
        paddingBottom: '8px'
      }}>
        {(['all', 'for_sale', 'sold', 'new_arrival', 'in_build', 'auction_soon', 'pending', 'service', 'historical'] as CategoryType[]).filter(cat => counts[cat] > 0 || cat === 'all').map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            style={{
              padding: '8px 16px',
              fontSize: '8pt',
              fontWeight: 700,
              border: category === cat ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: category === cat ? 'rgba(var(--accent-rgb), 0.1)' : 'white',
              color: category === cat ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: '20px',
              whiteSpace: 'nowrap',
              transition: 'all 0.12s ease'
            }}
          >
            {cat === 'all' ? 'ALL' : cat.replace('_', ' ').toUpperCase()} ({counts[cat]})
          </button>
        ))}
      </div>

      {/* Vehicles Display */}
      {filteredAndSorted.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: 'var(--text-muted)'
          }}>
            <div style={{ fontSize: '12pt', fontWeight: 600, marginBottom: '8px' }}>
              No vehicles found
            </div>
            <div style={{ fontSize: '9pt' }}>
              {searchTerm ? 'Try adjusting your search' : 'No vehicles in this category'}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Grid View */}
          {viewMode === 'grid' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '16px'
            }}>
              {filteredAndSorted.map(v => {
                const displayCategory = getDisplayCategory(v);
                const badge = getStatusBadge(displayCategory);
                const profit = v.sale_price && v.cost_basis ? v.sale_price - v.cost_basis : null;
                const isSelected = selectedVehicles.has(v.id);

                return (
                  <div
                    key={v.id}
                    className="card"
                    style={{
                      overflow: 'hidden',
                      cursor: 'pointer',
                      border: isSelected ? '3px solid var(--accent)' : undefined,
                      position: 'relative'
                    }}
                    onClick={() => bulkEditMode ? toggleSelectVehicle(v.id) : navigate(`/vehicle/${v.vehicle_id}`)}
                  >
                    {/* Checkbox for bulk edit */}
                    {bulkEditMode && (
                      <div style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        zIndex: 10
                      }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectVehicle(v.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            width: '20px',
                            height: '20px',
                            cursor: 'pointer'
                          }}
                        />
                      </div>
                    )}

                    {/* Image */}
                    <div style={{
                      width: '100%',
                      height: '200px',
                      backgroundImage: v.thumbnail_url ? `url(${v.thumbnail_url})` : 'url(/n-zero.png)',
                      backgroundSize: v.thumbnail_url ? 'cover' : 'contain',
                      backgroundPosition: 'center',
                      backgroundColor: '#f5f5f5',
                      position: 'relative',
                      opacity: v.thumbnail_url ? 1 : 0.3
                    }}>
                      {/* Status Badge */}
                      <div style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        padding: '4px 10px',
                        background: badge.color,
                        color: 'white',
                        fontSize: '7pt',
                        fontWeight: 700,
                        borderRadius: '3px'
                      }}>
                        {badge.text}
                      </div>

                      {/* Featured Star */}
                      {v.featured && (
                        <div style={{
                          position: 'absolute',
                          top: '8px',
                          left: bulkEditMode ? '36px' : '8px',
                          fontSize: '18pt'
                        }}>
                          ⭐
                        </div>
                      )}

                      {/* Days on Lot */}
                      {displayCategory !== 'sold' && v.days_on_lot > 0 && (
                        <div style={{
                          position: 'absolute',
                          bottom: '8px',
                          left: '8px',
                          padding: '4px 8px',
                          background: 'rgba(0,0,0,0.7)',
                          backdropFilter: 'blur(5px)',
                          color: 'white',
                          fontSize: '7pt',
                          fontWeight: 600,
                          borderRadius: '3px'
                        }}>
                          {v.days_on_lot} days on lot
                        </div>
                      )}

                      {/* Price */}
                      {v.asking_price && (
                        <div style={{
                          position: 'absolute',
                          bottom: '8px',
                          right: '8px',
                          padding: '4px 10px',
                          background: 'rgba(0,0,0,0.8)',
                          backdropFilter: 'blur(5px)',
                          color: 'white',
                          fontSize: '9pt',
                          fontWeight: 700,
                          borderRadius: '3px'
                        }}>
                          ${v.asking_price.toLocaleString()}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="card-body">
                      <div style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '6px' }}>
                        {v.vehicles.year} {v.vehicles.make} {v.vehicles.model}
                      </div>
                      
                      {v.vehicles.trim && (
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                          {v.vehicles.trim}
                        </div>
                      )}

                      {/* Metrics */}
                      <div style={{
                        display: 'flex',
                        gap: '12px',
                        fontSize: '8pt',
                        color: 'var(--text-muted)',
                        marginTop: '8px'
                      }}>
                        {v.vehicles.mileage && (
                          <span>{v.vehicles.mileage.toLocaleString()} mi</span>
                        )}
                        {v.vehicles.vin && (
                          <span style={{ fontFamily: 'monospace' }}>
                            {v.vehicles.vin.slice(-6)}
                          </span>
                        )}
                      </div>

                      {/* Profit (for sold vehicles, owner only) */}
                      {isOwner && displayCategory === 'sold' && profit !== null && (
                        <div style={{
                          marginTop: '8px',
                          padding: '6px',
                          background: profit > 0 ? '#ecfdf5' : '#fef2f2',
                          borderRadius: '4px',
                          fontSize: '8pt',
                          fontWeight: 600,
                          color: profit > 0 ? '#059669' : '#dc2626'
                        }}>
                          {profit > 0 ? '+' : ''}{profit.toLocaleString()} profit
                        </div>
                      )}

                      {/* Verification Request Button */}
                      {canEdit && (
                        <div style={{ marginTop: '8px' }}>
                          <VehicleRelationshipVerification
                            organizationVehicleId={v.id}
                            currentRelationshipType={v.relationship_type}
                            currentStatus={v.status}
                            vehicleId={v.vehicle_id}
                            onVerificationSubmitted={() => {
                              loadVehicles();
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* List View */}
          {viewMode === 'list' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filteredAndSorted.map(v => {
                const displayCategory = getDisplayCategory(v);
                const badge = getStatusBadge(displayCategory);
                const isSelected = selectedVehicles.has(v.id);

                return (
                  <div
                    key={v.id}
                    className="card"
                    style={{
                      cursor: 'pointer',
                      border: isSelected ? '3px solid var(--accent)' : undefined
                    }}
                    onClick={() => bulkEditMode ? toggleSelectVehicle(v.id) : navigate(`/vehicle/${v.vehicle_id}`)}
                  >
                    <div className="card-body">
                      <div style={{
                        display: 'flex',
                        gap: '16px',
                        alignItems: 'center'
                      }}>
                        {/* Checkbox */}
                        {bulkEditMode && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectVehicle(v.id)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: '18px', height: '18px' }}
                          />
                        )}

                        {/* Thumbnail */}
                        <div style={{
                          width: '120px',
                          height: '80px',
                          backgroundImage: v.thumbnail_url ? `url(${v.thumbnail_url})` : 'url(/n-zero.png)',
                          backgroundSize: v.thumbnail_url ? 'cover' : 'contain',
                          backgroundPosition: 'center',
                          backgroundColor: '#f5f5f5',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          flexShrink: 0,
                          opacity: v.thumbnail_url ? 1 : 0.3
                        }} />

                        {/* Info */}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '4px' }}>
                            {v.featured && '⭐ '}
                            {v.vehicles.year} {v.vehicles.make} {v.vehicles.model}
                            {v.vehicles.trim && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> {v.vehicles.trim}</span>}
                          </div>
                          
                          <div style={{
                            fontSize: '8pt',
                            color: 'var(--text-muted)',
                            display: 'flex',
                            gap: '12px',
                            flexWrap: 'wrap'
                          }}>
                            {v.vehicles.vin && (
                              <span style={{ fontFamily: 'monospace' }}>VIN: {v.vehicles.vin}</span>
                            )}
                            {v.vehicles.mileage && (
                              <span>{v.vehicles.mileage.toLocaleString()} mi</span>
                            )}
                            {v.days_on_lot > 0 && displayCategory !== 'sold' && (
                              <span>{v.days_on_lot} days on lot</span>
                            )}
                          </div>
                        </div>

                        {/* Price and Badge */}
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          alignItems: 'flex-end'
                        }}>
                          <div style={{
                            padding: '4px 10px',
                            background: badge.color,
                            color: 'white',
                            fontSize: '7pt',
                            fontWeight: 700,
                            borderRadius: '3px'
                          }}>
                            {badge.text}
                          </div>

                          {v.asking_price && (
                            <div style={{ fontSize: '11pt', fontWeight: 700 }}>
                              ${v.asking_price.toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Compact View */}
          {viewMode === 'compact' && (
            <div className="card">
              <div className="card-body" style={{ padding: 0 }}>
                <table style={{ width: '100%', fontSize: '8pt', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
                      {bulkEditMode && <th style={{ padding: '8px', width: '40px' }}></th>}
                      <th style={{ padding: '8px', textAlign: 'left' }}>Vehicle</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Price</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Days</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>VIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSorted.map(v => {
                      const displayCategory = getDisplayCategory(v);
                      const badge = getStatusBadge(displayCategory);
                      const isSelected = selectedVehicles.has(v.id);

                      return (
                        <tr
                          key={v.id}
                          onClick={() => bulkEditMode ? toggleSelectVehicle(v.id) : navigate(`/vehicle/${v.vehicle_id}`)}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(var(--accent-rgb), 0.1)' : undefined
                          }}
                          className="hover:bg-gray-50"
                        >
                          {bulkEditMode && (
                            <td style={{ padding: '8px' }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectVehicle(v.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                          )}
                          <td style={{ padding: '8px', fontWeight: 600 }}>
                            {v.featured && '⭐ '}
                            {v.vehicles.year} {v.vehicles.make} {v.vehicles.model}
                          </td>
                          <td style={{ padding: '8px' }}>
                            <span style={{
                              padding: '2px 8px',
                              background: badge.color,
                              color: 'white',
                              borderRadius: '3px',
                              fontSize: '7pt',
                              fontWeight: 700
                            }}>
                              {badge.text}
                            </span>
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>
                            {v.asking_price ? `$${v.asking_price.toLocaleString()}` : '—'}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            {displayCategory !== 'sold' && v.days_on_lot > 0 ? v.days_on_lot : '—'}
                          </td>
                          <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '7pt' }}>
                            {v.vehicles.vin || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default EnhancedDealerInventory;

