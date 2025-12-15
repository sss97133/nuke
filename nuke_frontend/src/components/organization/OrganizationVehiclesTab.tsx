import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getRelationshipBadge, canLinkVehicle } from '../../services/organizationPermissions';

interface Vehicle {
  id: string;
  vehicle_id: string;
  relationship_type: string;
  linked_by_user_id: string;
  auto_tagged: boolean;
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
  };
  vehicle_image_url?: string;
}

interface Props {
  organizationId: string;
  userId: string | null;
  canEdit: boolean;
  isOwner: boolean;
}

type ViewMode = 'grid' | 'list';
type FilterType = 'all' | 'in_stock' | 'sold' | 'consignment' | 'service';

const OrganizationVehiclesTab: React.FC<Props> = ({ organizationId, userId, canEdit, isOwner }) => {
  const navigate = useNavigate();
  
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterType>('all');
  const [unlinking, setUnlinking] = useState<string | null>(null);

  useEffect(() => {
    loadVehicles();
  }, [organizationId]);

  const loadVehicles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select(`
          id,
          vehicle_id,
          relationship_type,
          linked_by_user_id,
          auto_tagged,
          created_at,
          vehicles!inner(
            id,
            year,
            make,
            model,
            trim,
            vin,
            current_value,
            mileage
          )
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch primary images
      const enriched = await Promise.all(
        (data || []).map(async (v) => {
          const { data: img } = await supabase
            .from('vehicle_images')
            .select('thumbnail_url, medium_url, image_url')
            .eq('vehicle_id', v.vehicle_id)
            .order('is_primary', { ascending: false })
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

          return {
            ...v,
            vehicle_image_url: img?.thumbnail_url || img?.medium_url || img?.image_url || null
          };
        })
      );

      setVehicles(enriched as Vehicle[]);
    } catch (error) {
      console.error('Failed to load vehicles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async (linkId: string, vehicleId: string) => {
    const canUnlink = await canLinkVehicle(organizationId, vehicleId, userId);
    if (!canUnlink) {
      alert('You do not have permission to unlink this vehicle');
      return;
    }

    if (!confirm('Unlink this vehicle from the organization?')) return;

    setUnlinking(linkId);
    try {
      const { error } = await supabase
        .from('organization_vehicles')
        .delete()
        .eq('id', linkId);

      if (error) throw error;

      setVehicles(vehicles.filter(v => v.id !== linkId));
    } catch (error: any) {
      alert('Failed to unlink: ' + error.message);
    } finally {
      setUnlinking(null);
    }
  };

  const filteredVehicles = vehicles.filter(v => {
    if (filter === 'all') return true;
    return v.relationship_type === filter;
  });

  const vehicleCounts = {
    all: vehicles.length,
    in_stock: vehicles.filter(v => v.relationship_type === 'in_stock').length,
    sold: vehicles.filter(v => v.relationship_type === 'sold').length,
    consignment: vehicles.filter(v => v.relationship_type === 'consignment').length,
    service: vehicles.filter(v => v.relationship_type === 'service').length
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
        Loading vehicles...
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      {/* Header Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        {/* Filter Tabs */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {(['all', 'in_stock', 'sold', 'consignment', 'service'] as FilterType[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 12px',
                fontSize: '8pt',
                fontWeight: 600,
                border: filter === f ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: filter === f ? 'rgba(var(--accent-rgb), 0.1)' : 'white',
                color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                borderRadius: '4px',
                transition: 'all 0.12s ease'
              }}
            >
              {f === 'all' ? 'All' : f.replace('_', ' ').toUpperCase()} ({vehicleCounts[f]})
            </button>
          ))}
        </div>

        {/* View Mode Toggle */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setViewMode('grid')}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: viewMode === 'grid' ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: viewMode === 'grid' ? 'var(--accent)' : 'white',
              color: viewMode === 'grid' ? 'white' : 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: '4px 0 0 4px'
            }}
          >
            GRID
          </button>
          <button
            onClick={() => setViewMode('list')}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: viewMode === 'list' ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: viewMode === 'list' ? 'var(--accent)' : 'white',
              color: viewMode === 'list' ? 'white' : 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: '0 4px 4px 0'
            }}
          >
            LIST
          </button>
        </div>
      </div>

      {/* Empty State */}
      {filteredVehicles.length === 0 && (
        <div className="card">
          <div className="card-body" style={{
            textAlign: 'center',
            padding: '40px',
            color: 'var(--text-muted)',
            fontSize: '9pt'
          }}>
            <div style={{ marginBottom: '12px', fontSize: '11pt', fontWeight: 600 }}>
              No vehicles found
            </div>
            <div>
              {filter === 'all' 
                ? 'No vehicles linked to this organization yet'
                : `No vehicles with status "${filter.replace('_', ' ')}"`
              }
            </div>
          </div>
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && filteredVehicles.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px'
        }}>
          {filteredVehicles.map(v => {
            const badge = getRelationshipBadge(v.relationship_type);
            return (
              <div
                key={v.id}
                className="card"
                style={{
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'all 0.12s ease'
                }}
                onClick={() => navigate(`/vehicle/${v.vehicle_id}`)}
              >
                {/* Image */}
                <div style={{
                  width: '100%',
                  height: '180px',
                  backgroundImage: v.vehicle_image_url ? `url(${v.vehicle_image_url})` : 'url(/n-zero.png)',
                  backgroundSize: v.vehicle_image_url ? 'cover' : 'contain',
                  backgroundPosition: 'center',
                  backgroundColor: '#f5f5f5',
                  position: 'relative',
                  opacity: v.vehicle_image_url ? 1 : 0.3
                }}>
                  {/* Relationship Badge */}
                  <div style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    padding: '4px 8px',
                    background: badge.color,
                    color: 'white',
                    fontSize: '7pt',
                    fontWeight: 700,
                    borderRadius: '3px'
                  }}>
                    {badge.text}
                  </div>

                  {/* Price (if available) */}
                  {v.vehicles.current_value && (
                    <div style={{
                      position: 'absolute',
                      bottom: '8px',
                      left: '8px',
                      padding: '4px 8px',
                      background: 'rgba(0, 0, 0, 0.75)',
                      backdropFilter: 'blur(5px)',
                      color: 'white',
                      fontSize: '8pt',
                      fontWeight: 700,
                      borderRadius: '3px'
                    }}>
                      ${v.vehicles.current_value.toLocaleString()}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="card-body">
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px', lineHeight: 1.2 }}>
                    {v.vehicles.year} {v.vehicles.make} {v.vehicles.model || v.vehicles.series}
                  </div>
                  
                  {(v.vehicles.trim || (v.vehicles.series && v.vehicles.model)) && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      {[
                        v.vehicles.model && v.vehicles.series && v.vehicles.series !== v.vehicles.model ? v.vehicles.series : null,
                        v.vehicles.trim,
                        v.vehicles.body_style
                      ].filter(Boolean).join(' ')}
                    </div>
                  )}
                  
                  {(v.vehicles.engine_size || v.vehicles.transmission) && (
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '6px', fontFamily: 'monospace' }}>
                      {[v.vehicles.engine_size, v.vehicles.transmission].filter(Boolean).join(' • ')}
                    </div>
                  )}
                  
                  <div style={{
                    fontSize: '8pt',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    gap: '8px',
                    marginTop: '8px'
                  }}>
                    {v.vehicles.mileage && (
                      <span>{v.vehicles.mileage.toLocaleString()} mi</span>
                    )}
                    {v.vehicles.vin && (
                      <span style={{ fontFamily: 'monospace' }}>
                        {v.vehicles.vin.slice(-8)}
                      </span>
                    )}
                  </div>

                  {/* Unlink Button (if has permission) */}
                  {canEdit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUnlink(v.id, v.vehicle_id);
                      }}
                      disabled={unlinking === v.id}
                      style={{
                        marginTop: '12px',
                        width: '100%',
                        padding: '6px',
                        fontSize: '8pt',
                        border: '1px solid var(--danger)',
                        background: 'var(--surface)',
                        color: 'var(--danger)',
                        cursor: unlinking === v.id ? 'wait' : 'pointer',
                        borderRadius: '4px',
                        opacity: unlinking === v.id ? 0.5 : 1
                      }}
                    >
                      {unlinking === v.id ? 'Unlinking...' : 'UNLINK'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && filteredVehicles.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredVehicles.map(v => {
            const badge = getRelationshipBadge(v.relationship_type);
            return (
              <div
                key={v.id}
                className="card"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/vehicle/${v.vehicle_id}`)}
              >
                <div className="card-body">
                  <div style={{
                    display: 'flex',
                    gap: '16px',
                    alignItems: 'center'
                  }}>
                    {/* Thumbnail */}
                    <div style={{
                      width: '100px',
                      height: '75px',
                      backgroundImage: v.vehicle_image_url ? `url(${v.vehicle_image_url})` : 'url(/n-zero.png)',
                      backgroundSize: v.vehicle_image_url ? 'cover' : 'contain',
                      backgroundPosition: 'center',
                      backgroundColor: '#f5f5f5',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      flexShrink: 0,
                      opacity: v.vehicle_image_url ? 1 : 0.3
                    }} />

                    {/* Info */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
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
                          <span>{v.vehicles.mileage.toLocaleString()} miles</span>
                        )}
                        {v.vehicles.current_value && (
                          <span style={{ fontWeight: 600 }}>${v.vehicles.current_value.toLocaleString()}</span>
                        )}
                      </div>
                    </div>

                    {/* Badge + Actions */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      alignItems: 'flex-end'
                    }}>
                      <div style={{
                        padding: '4px 8px',
                        background: badge.color,
                        color: 'white',
                        fontSize: '7pt',
                        fontWeight: 700,
                        borderRadius: '3px'
                      }}>
                        {badge.text}
                      </div>

                      {canEdit && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnlink(v.id, v.vehicle_id);
                          }}
                          disabled={unlinking === v.id}
                          style={{
                            padding: '4px 12px',
                            fontSize: '7pt',
                            border: '1px solid var(--danger)',
                            background: 'var(--surface)',
                            color: 'var(--danger)',
                            cursor: unlinking === v.id ? 'wait' : 'pointer',
                            borderRadius: '4px',
                            opacity: unlinking === v.id ? 0.5 : 1
                          }}
                        >
                          {unlinking === v.id ? 'Unlinking...' : 'UNLINK'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrganizationVehiclesTab;

