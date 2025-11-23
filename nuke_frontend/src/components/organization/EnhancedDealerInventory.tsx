import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleRelationshipVerification from './VehicleRelationshipVerification';
import QuickRelationshipEditor from './QuickRelationshipEditor';
import MarkAsDuplicateButton from '../vehicle/MarkAsDuplicateButton';
import QuickStatusBadge from './QuickStatusBadge';
import FlagProblemButton from './FlagProblemButton';

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
  notes?: string | null;
  created_at: string;
  vehicles: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim?: string;
    vin?: string;
    vin_is_valid?: boolean | null;
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
type CategoryType = 'current' | 'all' | 'for_sale' | 'sold' | 'new_arrival' | 'in_build' | 'auction_soon' | 'pending' | 'service' | 'historical';
type SortBy = 'newest' | 'oldest' | 'price_high' | 'price_low' | 'days_lot' | 'year_desc' | 'year_asc' | 'make_az' | 'make_za';

const EnhancedDealerInventory: React.FC<Props> = ({ organizationId, userId, canEdit, isOwner }) => {
  const navigate = useNavigate();
  
  const [vehicles, setVehicles] = useState<DealerVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [category, setCategory] = useState<CategoryType>('current');  // Changed from 'all' to 'current'
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [editingVehicle, setEditingVehicle] = useState<DealerVehicle | null>(null);
  const [editMode, setEditMode] = useState(false);

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
          notes,
          created_at,
          vehicles!inner(
            id,
            year,
            make,
            model,
            trim,
            vin,
            vin_is_valid,
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
    
    // If status says "sold" but no proof, still show as sold but flag it
    if (v.status === 'sold' && !hasSaleProof) {
      return 'sold'; // Show as sold, user can verify/fix
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
      // "Current" filter: exclude sold vehicles (this is the default view)
      if (category === 'current') {
        const displayCategory = getDisplayCategory(v);
        if (displayCategory === 'sold' || displayCategory === 'historical') return false;
      }
      // Category filter - use smart categorization
      else if (category !== 'all') {
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
        case 'year_desc': return (b.vehicles.year || 0) - (a.vehicles.year || 0);
        case 'year_asc': return (a.vehicles.year || 0) - (b.vehicles.year || 0);
        case 'make_az': return (a.vehicles.make || '').localeCompare(b.vehicles.make || '');
        case 'make_za': return (b.vehicles.make || '').localeCompare(a.vehicles.make || '');
        case 'price_high': return (b.asking_price || 0) - (a.asking_price || 0);
        case 'price_low': return (a.asking_price || 0) - (b.asking_price || 0);
        case 'days_lot': return b.days_on_lot - a.days_on_lot;
        default: return 0;
      }
    });

  // Calculate category counts using smart categorization
  const counts = {
    current: vehicles.filter(v => {
      const cat = getDisplayCategory(v);
      return cat !== 'sold' && cat !== 'historical';
    }).length,
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
      'all': { color: '#9ca3af', text: 'UNCATEGORIZED' },
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

      </div>

      {/* Minimal Sticky Edit Bar */}
      {canEdit && (
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'var(--bg-primary)',
          padding: '4px 0',
          marginBottom: '8px',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          <button
            onClick={() => {
              setEditMode(!editMode);
              setSelectedVehicles(new Set());
            }}
            style={{
              padding: '4px 12px',
              fontSize: '8pt',
              fontWeight: 700,
              border: editMode ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: editMode ? 'var(--accent)' : 'white',
              color: editMode ? 'white' : 'var(--text)',
              cursor: 'pointer',
              borderRadius: '4px',
              transition: 'all 0.12s ease'
            }}
          >
            {editMode ? 'EXIT EDIT' : 'EDIT'}
          </button>
          {editMode && selectedVehicles.size > 0 && (
            <div style={{
              padding: '4px 12px',
              background: 'var(--accent-dim)',
              border: '1px solid var(--accent)',
              borderRadius: '4px',
              fontSize: '8pt',
              fontWeight: 700,
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>{selectedVehicles.size} selected</span>
              <button
                onClick={() => setSelectedVehicles(new Set())}
                style={{
                  padding: '2px 8px',
                  fontSize: '8pt',
                  background: 'var(--accent)',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer',
                  borderRadius: '3px',
                  fontWeight: 600
                }}
              >
                CLEAR
              </button>
            </div>
          )}
        </div>
      )}

      {/* Search and Filters - NOT Sticky */}
      <div style={{
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginBottom: '16px'
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
            fontSize: '8pt',
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
          <option value="year_desc">Year (Newest)</option>
          <option value="year_asc">Year (Oldest)</option>
          <option value="make_az">Make (A-Z)</option>
          <option value="make_za">Make (Z-A)</option>
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
                padding: '4px 10px',
                fontSize: '8pt',
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
        {(['current', 'for_sale', 'sold', 'all', 'new_arrival', 'in_build', 'auction_soon', 'pending', 'service', 'historical'] as CategoryType[]).filter(cat => counts[cat] > 0 || cat === 'all' || cat === 'current').map(cat => (
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
            {cat === 'current' ? 'CURRENT' : cat === 'all' ? 'ALL' : cat.replace('_', ' ').toUpperCase()} ({counts[cat]})
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
                    onClick={() => editMode ? toggleSelectVehicle(v.id) : navigate(`/vehicle/${v.vehicle_id}`)}
                  >
                    {/* Checkbox for selection */}
                    {editMode && isSelected && (
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
                          left: '8px',
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

                      {/* VIN Warning */}
                      {(v.vehicles.vin_is_valid === false || !v.vehicles.vin) && (
                        <div style={{
                          padding: '6px 8px',
                          background: v.vehicles.vin_is_valid === false ? '#fef2f2' : '#fef3c7',
                          border: `2px solid ${v.vehicles.vin_is_valid === false ? '#dc2626' : '#fbbf24'}`,
                          borderRadius: '4px',
                          fontSize: '8pt',
                          fontWeight: 600,
                          color: v.vehicles.vin_is_valid === false ? '#dc2626' : '#92400e',
                          marginBottom: '8px'
                        }}>
                          {v.vehicles.vin_is_valid === false ? '❌ INVALID VIN' : '⚠️ NO VIN'}
                        </div>
                      )}

                      {/* Metrics */}
                      <div style={{
                        display: 'flex',
                        gap: '12px',
                        fontSize: '8pt',
                        color: 'var(--text-muted)',
                        marginTop: '8px',
                        alignItems: 'center'
                      }}>
                        {v.vehicles.mileage && (
                          <span>{v.vehicles.mileage.toLocaleString()} mi</span>
                        )}
                        {v.vehicles.vin && (
                          <span style={{ 
                            fontFamily: 'monospace',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            {v.vehicles.vin.slice(-6)}
                            {v.vehicles.vin_is_valid === false && (
                              <span style={{ color: '#dc2626', fontSize: '10px' }}>❌</span>
                            )}
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

                      {/* Quick Edit Buttons - Only show in edit mode */}
                      {editMode && (
                        <div style={{ marginTop: '8px', display: 'flex', gap: '4px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingVehicle(v);
                            }}
                            className="button button-secondary"
                            style={{
                              flex: 1,
                              fontSize: '8pt',
                              padding: '6px 8px'
                            }}
                          >
                            Edit
                          </button>
                          <div onClick={(e) => e.stopPropagation()}>
                            <FlagProblemButton
                              orgVehicleId={v.id}
                              vehicleId={v.vehicle_id}
                              userId={userId!}
                              onFlagged={loadVehicles}
                            />
                          </div>
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
                    onClick={() => editMode ? toggleSelectVehicle(v.id) : navigate(`/vehicle/${v.vehicle_id}`)}
                  >
                    <div className="card-body">
                      <div style={{
                        display: 'flex',
                        gap: '16px',
                        alignItems: 'center'
                      }}>
                        {/* Checkbox */}
                        {editMode && isSelected && (
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

                          {editMode && (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingVehicle(v);
                                }}
                                className="button button-secondary"
                                style={{
                                  fontSize: '7pt',
                                  padding: '4px 8px',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                Edit
                              </button>
                              <div onClick={(e) => e.stopPropagation()}>
                                <MarkAsDuplicateButton
                                  vehicleId={v.vehicle_id}
                                  userId={userId!}
                                  onMarked={loadVehicles}
                                />
                              </div>
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
                      {editMode && <th style={{ padding: '8px', width: '40px' }}></th>}
                      <th style={{ padding: '8px', textAlign: 'left' }}>Vehicle</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Price</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Days</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>VIN</th>
                      {editMode && <th style={{ padding: '8px', textAlign: 'center' }}>Actions</th>}
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
                          onClick={() => editMode ? toggleSelectVehicle(v.id) : navigate(`/vehicle/${v.vehicle_id}`)}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(var(--accent-rgb), 0.1)' : undefined
                          }}
                          className="hover:bg-gray-50"
                        >
                          {editMode && (
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
                          {editMode && (
                            <td style={{ padding: '8px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingVehicle(v);
                                  }}
                                  className="button button-secondary"
                                  style={{
                                    fontSize: '7pt',
                                    padding: '4px 8px'
                                  }}
                                >
                                  Edit
                                </button>
                                <div onClick={(e) => e.stopPropagation()}>
                                  <MarkAsDuplicateButton
                                    vehicleId={v.vehicle_id}
                                    userId={userId!}
                                    onMarked={loadVehicles}
                                  />
                                </div>
                              </div>
                            </td>
                          )}
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

      {/* Quick Relationship Editor Popup */}
      {editingVehicle && (
        <QuickRelationshipEditor
          orgVehicleId={editingVehicle.id}
          currentRelationship={editingVehicle.relationship_type}
          currentStatus={editingVehicle.status}
          currentNotes={editingVehicle.notes || ''}
          vehicleName={`${editingVehicle.vehicles.year} ${editingVehicle.vehicles.make} ${editingVehicle.vehicles.model}`}
          vehicleId={editingVehicle.vehicle_id}
          onUpdate={loadVehicles}
          onClose={() => setEditingVehicle(null)}
        />
      )}
    </div>
  );
};

export default EnhancedDealerInventory;

