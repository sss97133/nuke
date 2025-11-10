import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getRelationshipBadge } from '../../services/organizationPermissions';

interface InventoryVehicle {
  id: string;
  vehicle_id: string;
  relationship_type: string;
  created_at: string;
  vehicles: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim?: string;
    vin?: string;
    asking_price?: number;
    purchase_price?: number;
    cost_basis?: number;
    mileage?: number;
  };
  vehicle_image_url?: string;
}

interface Props {
  organizationId: string;
  isOwner: boolean;
}

const OrganizationInventoryTab: React.FC<Props> = ({ organizationId, isOwner }) => {
  const navigate = useNavigate();
  
  const [inventory, setInventory] = useState<InventoryVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  useEffect(() => {
    loadInventory();
  }, [organizationId]);

  const loadInventory = async () => {
    setLoading(true);
    try {
      // Load only in_stock and consignment vehicles (active inventory)
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select(`
          id,
          vehicle_id,
          relationship_type,
          created_at,
          vehicles!inner(
            id,
            year,
            make,
            model,
            trim,
            vin,
            asking_price,
            purchase_price,
            cost_basis,
            mileage
          )
        `)
        .eq('organization_id', organizationId)
        .in('relationship_type', ['in_stock', 'consignment'])
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
            .limit(1)
            .maybeSingle();

          return {
            ...v,
            vehicle_image_url: img?.thumbnail_url || img?.medium_url || img?.image_url || null
          };
        })
      );

      setInventory(enriched as InventoryVehicle[]);
    } catch (error) {
      console.error('Failed to load inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (linkId: string, newType: string) => {
    if (!isOwner) {
      alert('Only owners can change vehicle status');
      return;
    }

    setUpdatingStatus(linkId);
    try {
      const { error } = await supabase
        .from('organization_vehicles')
        .update({ relationship_type: newType })
        .eq('id', linkId);

      if (error) throw error;

      // Reload to reflect changes
      await loadInventory();
    } catch (error: any) {
      alert('Failed to update status: ' + error.message);
    } finally {
      setUpdatingStatus(null);
    }
  };

  const calculateProfit = (v: InventoryVehicle): number | null => {
    if (!v.vehicles.asking_price || !v.vehicles.cost_basis) return null;
    return v.vehicles.asking_price - v.vehicles.cost_basis;
  };

  const calculateMargin = (v: InventoryVehicle): number | null => {
    if (!v.vehicles.asking_price || !v.vehicles.cost_basis || v.vehicles.asking_price === 0) return null;
    return ((v.vehicles.asking_price - v.vehicles.cost_basis) / v.vehicles.asking_price) * 100;
  };

  const totalValue = inventory.reduce((sum, v) => sum + (v.vehicles.asking_price || 0), 0);
  const totalCost = inventory.reduce((sum, v) => sum + (v.vehicles.cost_basis || v.vehicles.purchase_price || 0), 0);
  const potentialProfit = totalValue - totalCost;

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
        Loading inventory...
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      {/* Dealer Tools (Owner Only) */}
      {isOwner && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
            Dealer Tools
          </div>
          <div className="card-body">
            <div style={{ fontSize: '9pt', marginBottom: '12px', color: 'var(--text-secondary)' }}>
              Manage your dealership inventory with powerful tools
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => navigate(`/dealer/${organizationId}/ai-assistant`)}
                className="button button-primary"
                style={{ fontSize: '9pt' }}
              >
                AI Assistant
              </button>
              <button
                onClick={() => navigate(`/dealer/${organizationId}/bulk-editor`)}
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
              >
                Bulk Editor
              </button>
              <button
                onClick={() => navigate(`/dealer/${organizationId}/dropbox-import`)}
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
              >
                Dropbox Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inventory Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '12px',
        marginBottom: '16px'
      }}>
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--accent)' }}>
              {inventory.length}
            </div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Active Inventory
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--success)' }}>
              ${totalValue.toLocaleString()}
            </div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Total Value
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--warning)' }}>
              ${totalCost.toLocaleString()}
            </div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Total Cost
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: '16pt',
              fontWeight: 700,
              color: potentialProfit >= 0 ? 'var(--success)' : 'var(--danger)'
            }}>
              ${potentialProfit.toLocaleString()}
            </div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Potential Profit
            </div>
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      {inventory.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{
            textAlign: 'center',
            padding: '40px',
            color: 'var(--text-muted)',
            fontSize: '9pt'
          }}>
            <div style={{ marginBottom: '12px', fontSize: '11pt', fontWeight: 600 }}>
              No active inventory
            </div>
            <div style={{ marginBottom: '16px' }}>
              Use the dealer tools above to import your inventory
            </div>
            {isOwner && (
              <button
                onClick={() => navigate(`/dealer/${organizationId}/ai-assistant`)}
                className="button button-primary"
                style={{ fontSize: '9pt' }}
              >
                Get Started with AI Assistant
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '8pt',
            background: 'white',
            border: '1px solid var(--border)'
          }}>
            <thead>
              <tr style={{ background: 'var(--grey-50)' }}>
                <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Image</th>
                <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Vehicle</th>
                <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid var(--border)' }}>VIN</th>
                <th style={{ padding: '10px', textAlign: 'right', borderBottom: '2px solid var(--border)' }}>Asking</th>
                <th style={{ padding: '10px', textAlign: 'right', borderBottom: '2px solid var(--border)' }}>Cost</th>
                <th style={{ padding: '10px', textAlign: 'right', borderBottom: '2px solid var(--border)' }}>Profit</th>
                <th style={{ padding: '10px', textAlign: 'right', borderBottom: '2px solid var(--border)' }}>Margin</th>
                <th style={{ padding: '10px', textAlign: 'center', borderBottom: '2px solid var(--border)' }}>Status</th>
                {isOwner && (
                  <th style={{ padding: '10px', textAlign: 'center', borderBottom: '2px solid var(--border)' }}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {inventory.map(v => {
                const badge = getRelationshipBadge(v.relationship_type);
                const profit = calculateProfit(v);
                const margin = calculateMargin(v);
                
                return (
                  <tr
                    key={v.id}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border)'
                    }}
                    onClick={() => navigate(`/vehicle/${v.vehicle_id}`)}
                  >
                    <td style={{ padding: '10px' }}>
                      <div style={{
                        width: '60px',
                        height: '45px',
                        backgroundImage: v.vehicle_image_url ? `url(${v.vehicle_image_url})` : 'none',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        backgroundColor: v.vehicle_image_url ? '#f5f5f5' : '#333',
                        border: '2px solid var(--border)',
                        borderRadius: '3px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: '7pt',
                        fontWeight: 'bold'
                      }}>
                        {!v.vehicle_image_url && 'NO PHOTO'}
                      </div>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ fontWeight: 600 }}>
                        {v.vehicles.year} {v.vehicles.make} {v.vehicles.model}
                      </div>
                      {v.vehicles.trim && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '7pt' }}>
                          {v.vehicles.trim}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: '7pt' }}>
                      {v.vehicles.vin || '—'}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>
                      {v.vehicles.asking_price ? `$${v.vehicles.asking_price.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      {v.vehicles.cost_basis || v.vehicles.purchase_price 
                        ? `$${(v.vehicles.cost_basis || v.vehicles.purchase_price || 0).toLocaleString()}` 
                        : '—'}
                    </td>
                    <td style={{
                      padding: '10px',
                      textAlign: 'right',
                      fontWeight: 600,
                      color: profit && profit >= 0 ? 'var(--success)' : 'var(--danger)'
                    }}>
                      {profit !== null ? `$${profit.toLocaleString()}` : '—'}
                    </td>
                    <td style={{
                      padding: '10px',
                      textAlign: 'right',
                      fontWeight: 600,
                      color: margin && margin >= 20 ? 'var(--success)' : margin && margin >= 10 ? 'var(--warning)' : 'var(--danger)'
                    }}>
                      {margin !== null ? `${margin.toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'center' }}>
                      <div style={{
                        padding: '3px 8px',
                        background: badge.color,
                        color: 'white',
                        fontSize: '7pt',
                        fontWeight: 700,
                        borderRadius: '3px',
                        display: 'inline-block'
                      }}>
                        {badge.text}
                      </div>
                    </td>
                    {isOwner && (
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <select
                          value={v.relationship_type}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateStatus(v.id, e.target.value);
                          }}
                          disabled={updatingStatus === v.id}
                          style={{
                            padding: '4px 8px',
                            fontSize: '7pt',
                            border: '1px solid var(--border)',
                            borderRadius: '3px',
                            cursor: updatingStatus === v.id ? 'wait' : 'pointer'
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="in_stock">In Stock</option>
                          <option value="consignment">Consignment</option>
                          <option value="sold">Mark as Sold</option>
                          <option value="service">Move to Service</option>
                        </select>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default OrganizationInventoryTab;

