import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleRelationshipVerification from './VehicleRelationshipVerification';
import QuickRelationshipEditor from './QuickRelationshipEditor';
import MarkAsDuplicateButton from '../vehicle/MarkAsDuplicateButton';
import QuickStatusBadge from './QuickStatusBadge';
import FlagProblemButton from './FlagProblemButton';
import ResilientImage from '../images/ResilientImage';

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
  // PostgREST relationship typing can sometimes surface this as an array depending on schema metadata.
  // We normalize this at runtime to a single object.
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
  thumbnail_sources?: string[] | null;
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
  const [showAddVehiclesModal, setShowAddVehiclesModal] = useState(false);
  const reloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    loadVehicles({ silent: false });
  }, [organizationId]);

  const loadVehicles = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
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
          vehicles(
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

      if (error) {
        console.error('Supabase query error:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        throw error;
      }

      console.log('Loaded vehicles count:', data?.length || 0);
      console.log('Sample vehicle data:', data?.[0]);

      // Filter out vehicles where the join failed (vehicles is null)
      const validVehicles = (data || []).filter((v: any) => v && v.vehicles !== null);
      console.log('Valid vehicles after filtering null joins:', validVehicles.length);

      // Fetch thumbnails in chunks (avoid hundreds of parallel requests that can trigger rate-limits / CORS failures).
      const uniqueVehicleIds = Array.from(
        new Set(
          validVehicles
            .map((v: any) => v?.vehicle_id)
            .filter((x: any) => typeof x === 'string' && x.length > 0)
        )
      );

      const thumbByVehicleId = new Map<string, string | null>();
      const thumbSourcesByVehicleId = new Map<string, string[]>();
      const chunkSize = 75; // keep URL size + concurrency low
      for (let i = 0; i < uniqueVehicleIds.length; i += chunkSize) {
        const chunk = uniqueVehicleIds.slice(i, i + chunkSize);
        const { data: imgs, error: imgErr } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, thumbnail_url, medium_url, image_url, variants')
          .in('vehicle_id', chunk)
          .eq('is_primary', true);
        if (imgErr) {
          // Non-fatal: we can still render without thumbnails.
          console.warn('Failed to fetch thumbnail chunk:', imgErr);
          continue;
        }
        for (const r of (imgs || []) as any[]) {
          const vid = r?.vehicle_id;
          if (typeof vid !== 'string' || !vid) continue;
          const variants = r?.variants && typeof r.variants === 'object' ? r.variants : {};
          const sources = [
            variants?.thumbnail,
            variants?.medium,
            variants?.large,
            variants?.full,
            r?.thumbnail_url,
            r?.medium_url,
            r?.image_url,
          ]
            .filter((x: any) => typeof x === 'string' && x.trim().length > 0)
            .map((x: any) => String(x));
          const best = sources[0] || null;
          if (!thumbByVehicleId.has(vid)) thumbByVehicleId.set(vid, best);
          if (!thumbSourcesByVehicleId.has(vid)) thumbSourcesByVehicleId.set(vid, sources);
        }

        // Fallback: if a vehicle has no primary image flagged, grab the newest non-document image and use it.
        const missing = chunk.filter((vid) => !thumbByVehicleId.has(vid));
        if (missing.length > 0) {
          const { data: fallbackImgs, error: fallbackErr } = await supabase
            .from('vehicle_images')
            .select('vehicle_id, thumbnail_url, medium_url, image_url, variants, is_primary, created_at')
            .in('vehicle_id', missing)
            .not('is_document', 'is', true)
            .not('is_duplicate', 'is', true)
            .order('is_primary', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(Math.min(500, missing.length * 4));
          if (fallbackErr) {
            console.warn('Failed to fetch fallback thumbnails:', fallbackErr);
          } else {
            for (const r of (fallbackImgs || []) as any[]) {
              const vid = r?.vehicle_id;
              if (typeof vid !== 'string' || !vid) continue;
              if (thumbByVehicleId.has(vid)) continue;
              const variants = r?.variants && typeof r.variants === 'object' ? r.variants : {};
              const sources = [
                variants?.thumbnail,
                variants?.medium,
                variants?.large,
                variants?.full,
                r?.thumbnail_url,
                r?.medium_url,
                r?.image_url,
              ]
                .filter((x: any) => typeof x === 'string' && x.trim().length > 0)
                .map((x: any) => String(x));
              const best = sources[0] || null;
              thumbByVehicleId.set(vid, best);
              thumbSourcesByVehicleId.set(vid, sources);
            }
          }
        }
      }

      const enriched = validVehicles.map((v: any) => {
        // Normalize embedded vehicles relationship to a single object.
        // In some generated Supabase types, `vehicles` is typed as an array even though it's a many-to-one.
        const vehicleObj = Array.isArray(v.vehicles) ? (v.vehicles[0] ?? null) : v.vehicles;
        if (!vehicleObj) return null;

        return {
          ...v,
          vehicles: vehicleObj,
          thumbnail_url: thumbByVehicleId.get(v.vehicle_id) || null,
          thumbnail_sources: thumbSourcesByVehicleId.get(v.vehicle_id) || null,
        };
      });

      const finalList = enriched.filter(Boolean) as DealerVehicle[];
      console.log('Enriched vehicles count:', finalList.length);
      setVehicles(finalList);
    } catch (error) {
      console.error('Failed to load vehicles:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Live updates:
  // - Subscribe to organization_vehicles changes for this org (new imports land here)
  // - Also do a low-cost polling fallback every ~3s while the page is open.
  useEffect(() => {
    if (!organizationId) return;

    const scheduleReload = () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = window.setTimeout(() => {
        loadVehicles({ silent: true });
      }, 500);
    };

    const channel = supabase
      .channel(`org-inventory-live:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'organization_vehicles',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          scheduleReload();
        }
      )
      .subscribe();

    const poll = window.setInterval(() => {
      // Poll is a safety net if realtime is unavailable / RLS blocks broadcasts.
      loadVehicles({ silent: true });
    }, 3000);

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
      window.clearInterval(poll);
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    };
  }, [organizationId]);

  // Smart categorization: Map relationship_type + status to display categories
  // IMPORTANT: Only mark as "sold" if there's proof (BAT URL, sale_date, approved verification, etc.)
  const getDisplayCategory = (v: DealerVehicle): string => {
    // Sold vehicles - ONLY if there's proof AND status is 'sold'
    // Check for: sale_date, BAT listing (external_listings), or approved sale verification
    const hasSaleProof = v.sale_date || 
                        (v.vehicles.sale_status === 'sold' && v.sale_price) ||
                        (v.status === 'sold' && (v.sale_date || v.sale_price)); // Only if status is explicitly set with proof
    
    // Only mark as sold if status is actually 'sold' (not just listing_status)
    if (v.status === 'sold') {
      if (hasSaleProof) {
        return 'sold';
      }
      // If status says "sold" but no proof, still show as sold but flag it
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
    
    // Active inventory - prioritize status over listing_status
    // If status is 'active', ignore listing_status='sold' (likely data inconsistency)
    if (v.relationship_type === 'in_stock' || v.relationship_type === 'consigner' || v.relationship_type === 'owner') {
      // Only use listing_status if it's not 'sold' or if status is also 'sold'
      if (v.status === 'active' && v.listing_status === 'sold') {
        // Data inconsistency: status is active but listing_status says sold
        // Treat as active inventory, default to 'for_sale'
        return 'for_sale';
      }
      return v.listing_status || 'for_sale';
    }
    
    // Default to listing_status if available, but not if it conflicts with active status
    if (v.status === 'active' && v.listing_status === 'sold') {
      return 'for_sale';
    }
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
        {canEdit && (
          <button
            onClick={() => setShowAddVehiclesModal(true)}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px',
              fontSize: '8pt',
              fontWeight: 700,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              cursor: 'pointer',
              borderRadius: '4px',
            }}
          >
            Add Vehicles
          </button>
        )}
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
      {loading ? (
        <div className="card">
          <div className="card-body" style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: 'var(--text-muted)'
          }}>
            <div style={{ fontSize: '12pt', fontWeight: 600, marginBottom: '8px' }}>
              Loading vehicles...
            </div>
          </div>
        </div>
      ) : filteredAndSorted.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: 'var(--text-muted)'
          }}>
            <div style={{ fontSize: '12pt', fontWeight: 600, marginBottom: '8px' }}>
              No vehicles found
            </div>
            <div style={{ fontSize: '9pt', marginBottom: '8px' }}>
              {searchTerm ? 'Try adjusting your search' : 'No vehicles in this category'}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '16px', fontFamily: 'monospace' }}>
              Debug: Total loaded: {vehicles.length} | Filtered: {filteredAndSorted.length} | Category: {category} | Search: {searchTerm || 'none'}
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
                      backgroundColor: 'var(--bg)',
                      position: 'relative',
                    }}>
                      <ResilientImage
                        sources={(v.thumbnail_sources && v.thumbnail_sources.length > 0) ? v.thumbnail_sources : [v.thumbnail_url]}
                        alt={`${v.vehicles.year} ${v.vehicles.make} ${v.vehicles.model}`}
                        fill={true}
                        objectFit="cover"
                        placeholderSrc="/n-zero.png"
                        placeholderOpacity={0.3}
                      />

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

                      {/* Featured */}
                      {v.featured && (
                        <div style={{
                          position: 'absolute',
                          top: '8px',
                          left: '8px',
                          padding: '4px 10px',
                          background: 'rgba(0,0,0,0.75)',
                          backdropFilter: 'blur(5px)',
                          color: 'white',
                          fontSize: '7pt',
                          fontWeight: 800,
                          borderRadius: '3px',
                          letterSpacing: '0.5px'
                        }}>
                          FEATURED
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
                        <div
                          style={{
                            width: '120px',
                            height: '80px',
                            backgroundColor: 'var(--bg)',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            flexShrink: 0,
                            overflow: 'hidden',
                            position: 'relative',
                          }}
                        >
                          <ResilientImage
                            sources={(v.thumbnail_sources && v.thumbnail_sources.length > 0) ? v.thumbnail_sources : [v.thumbnail_url]}
                            alt={`${v.vehicles.year} ${v.vehicles.make} ${v.vehicles.model}`}
                            fill={true}
                            objectFit="cover"
                            placeholderSrc="/n-zero.png"
                            placeholderOpacity={0.3}
                          />
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '4px' }}>
                            {v.featured && <span style={{ fontWeight: 800 }}>FEATURED </span>}
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

      {/* Add Vehicles Modal - link existing builds into this organization */}
      {showAddVehiclesModal && userId && (
        <AddVehiclesModal
          organizationId={organizationId}
          userId={userId}
          onClose={() => setShowAddVehiclesModal(false)}
          onLinked={() => {
            setShowAddVehiclesModal(false);
            loadVehicles();
          }}
        />
      )}
    </div>
  );
};

export default EnhancedDealerInventory;

interface AddVehiclesModalProps {
  organizationId: string;
  userId: string;
  onClose: () => void;
  onLinked: () => void;
}

const AddVehiclesModal: React.FC<AddVehiclesModalProps> = ({
  organizationId,
  userId,
  onClose,
  onLinked,
}) => {
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);

        // Vehicles already linked to this organization
        const { data: existingLinks } = await supabase
          .from('organization_vehicles')
          .select('vehicle_id')
          .eq('organization_id', organizationId);

        const existingIds = new Set(
          (existingLinks || []).map((r: any) => r.vehicle_id)
        );

        // Candidate vehicles: ones this user uploaded or discovered
        const { data: myVehicles, error } = await supabase
          .from('vehicles')
          .select('id, year, make, model, vin, current_value, asking_price')
          .or(`user_id.eq.${userId},uploaded_by.eq.${userId}`)
          .order('updated_at', { ascending: false })
          .limit(200);

        if (error) {
          console.error('Error loading candidate vehicles:', error);
          setCandidates([]);
          return;
        }

        const filtered = (myVehicles || []).filter(
          (v: any) => !existingIds.has(v.id)
        );
        setCandidates(filtered);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [organizationId, userId]);

  const toggleSelect = (vehicleId: string) => {
    const next = new Set(selectedIds);
    if (next.has(vehicleId)) {
      next.delete(vehicleId);
    } else {
      next.add(vehicleId);
    }
    setSelectedIds(next);
  };

  const handleLink = async () => {
    if (selectedIds.size === 0) {
      onClose();
      return;
    }

    if (
      !confirm(
        `Add ${selectedIds.size} vehicle${
          selectedIds.size === 1 ? '' : 's'
        } to this organization?`
      )
    ) {
      return;
    }

    try {
      setLinking(true);

      const inserts = Array.from(selectedIds).map((vehicleId) =>
        supabase.from('organization_vehicles').insert({
          organization_id: organizationId,
          vehicle_id: vehicleId,
          relationship_type: 'in_stock',
          status: 'active',
          listing_status: 'for_sale',
        })
      );

      await Promise.all(inserts);
      onLinked();
    } catch (error: any) {
      console.error('Error linking vehicles:', error);
      alert(`Failed to add vehicles: ${error.message}`);
      setLinking(false);
    }
  };

  const visibleCandidates = candidates.filter((v) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const str = `${v.year || ''} ${v.make || ''} ${v.model || ''} ${
      v.vin || ''
    }`.toLowerCase();
    return str.includes(s);
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 10002,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--white)',
          maxWidth: '720px',
          width: '100%',
          maxHeight: '90vh',
          border: '2px solid var(--border)',
          boxShadow: 'var(--shadow)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '2px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '10pt', fontWeight: 700 }}>
              Add Vehicles to Organization
            </div>
            <div
              style={{
                fontSize: '8pt',
                color: 'var(--text-muted)',
                marginTop: '2px',
              }}
            >
              Link your existing builds into this shop&apos;s inventory.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              padding: '2px 8px',
              fontSize: '8pt',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)' }}>
          <input
            type="text"
            placeholder="Search by year, make, model, VIN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: '8pt',
              border: '1px solid var(--border)',
            }}
          />
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 14px',
          }}
        >
          {loading ? (
            <div
              style={{
                padding: '40px 0',
                textAlign: 'center',
                fontSize: '9pt',
                color: 'var(--text-muted)',
              }}
            >
              Loading your vehicles...
            </div>
          ) : visibleCandidates.length === 0 ? (
            <div
              style={{
                padding: '40px 0',
                textAlign: 'center',
                fontSize: '9pt',
                color: 'var(--text-muted)',
              }}
            >
              No eligible vehicles found to link.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '8px',
              }}
            >
              {visibleCandidates.map((v) => {
                const isSelected = selectedIds.has(v.id);
                return (
                  <div
                    key={v.id}
                    onClick={() => toggleSelect(v.id)}
                    style={{
                      border: isSelected
                        ? '2px solid var(--accent)'
                        : '1px solid var(--border)',
                      background: isSelected ? 'var(--accent-dim)' : 'var(--white)',
                      padding: '8px',
                      cursor: 'pointer',
                      fontSize: '8pt',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '4px',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {v.year} {v.make} {v.model}
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                      />
                    </div>
                    {v.vin && (
                      <div
                        style={{
                          fontFamily: 'monospace',
                          color: 'var(--text-muted)',
                          marginBottom: '4px',
                        }}
                      >
                        VIN: {v.vin}
                      </div>
                    )}
                    {(v.current_value || v.asking_price) && (
                      <div
                        style={{
                          fontSize: '8pt',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Value:{' '}
                        <strong>
                          $
                          {(v.asking_price || v.current_value || 0).toLocaleString()}
                        </strong>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--border-light)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '8pt',
          }}
        >
          <div style={{ color: 'var(--text-muted)' }}>
            {selectedIds.size} selected
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '4px 10px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                fontSize: '8pt',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleLink}
              disabled={linking || selectedIds.size === 0}
              style={{
                padding: '4px 12px',
                border: '1px solid var(--accent)',
                background: linking
                  ? 'var(--accent-dim)'
                  : 'var(--accent)',
                color: 'white',
                fontSize: '8pt',
                fontWeight: 700,
                cursor: linking || selectedIds.size === 0 ? 'default' : 'pointer',
              }}
            >
              {linking ? 'Linking…' : 'Add to Organization'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

