import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';

/**
 * Robinhood × Cursor Dashboard
 * Portfolio manager for vehicles - actionable, data-dense, financial
 */

interface PortfolioStats {
  totalVehicles: number;
  totalValue: number;
  monthChange: number;
  monthChangePercent: number;
  totalPhotos: number;
  totalEvents: number;
  contributionPoints: number;
  currentLevel: number;
}

interface PendingAction {
  id: string;
  type: 'merge_proposal' | 'data_gap' | 'verification_pending' | 'url_processing';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  reward?: number;
  entityId?: string;
  entityType?: string;
  createdAt: string;
}

interface RecentActivity {
  id: string;
  type: 'photo_upload' | 'event_created' | 'value_change' | 'contribution' | 'merge_completed';
  title: string;
  description: string;
  timestamp: string;
  value?: number;
  vehicleId?: string;
}

export default function DashboardNew() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PortfolioStats | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

  useEffect(() => {
    if (session?.user) {
      loadDashboard();
    }
  }, [session]);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadPortfolioStats(),
        loadPendingActions(),
        loadRecentActivity(),
        loadVehicles()
      ]);
    } catch (error) {
      console.error('Dashboard load error:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPortfolioStats = async () => {
    // Get user's vehicles
    const { data: userVehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id')
      .eq('uploaded_by', session!.user.id);

    if (vehiclesError) throw vehiclesError;

    const vehicleIds = userVehicles?.map(v => v.id) || [];

    // Get photo count
    const { count: photoCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .in('vehicle_id', vehicleIds);

    // Get event count
    const { count: eventCount } = await supabase
      .from('timeline_events')
      .select('*', { count: 'exact', head: true })
      .in('vehicle_id', vehicleIds);

    // Get contribution points
    const { data: points } = await supabase
      .from('user_contribution_points')
      .select('*')
      .eq('user_id', session!.user.id)
      .single();

    // TODO: Calculate actual portfolio value from valuations
    const totalValue = userVehicles.length * 75000; // Placeholder
    const monthChange = 3200; // Placeholder
    const monthChangePercent = (monthChange / totalValue) * 100;

    setStats({
      totalVehicles: userVehicles.length,
      totalValue,
      monthChange,
      monthChangePercent,
      totalPhotos: photoCount || 0,
      totalEvents: eventCount || 0,
      contributionPoints: points?.total_points || 0,
      currentLevel: points?.current_level || 1
    });
  };

  const loadPendingActions = async () => {
    const actions: PendingAction[] = [];

    // Merge proposals
    const { data: proposals } = await supabase
      .from('vehicle_merge_proposals')
      .select(`
        id,
        primary_vehicle_id,
        duplicate_vehicle_id,
        confidence_score,
        created_at,
        primary_vehicle:vehicles!vehicle_merge_proposals_primary_vehicle_id_fkey(year, make, model)
      `)
      .eq('status', 'proposed')
      .or(`primary_vehicle_id.in.(${await getUserVehicleIds()}),duplicate_vehicle_id.in.(${await getUserVehicleIds()})`)
      .limit(5);

    proposals?.forEach(p => {
      actions.push({
        id: p.id,
        type: 'merge_proposal',
        priority: p.confidence_score >= 90 ? 'critical' : 'high',
        title: 'Duplicate Vehicle Detected',
        description: `${(p.primary_vehicle as any)?.year} ${(p.primary_vehicle as any)?.make} ${(p.primary_vehicle as any)?.model}`,
        entityId: p.primary_vehicle_id,
        entityType: 'vehicle',
        createdAt: p.created_at
      });
    });

    // Data gaps
    const { data: gaps } = await supabase
      .from('data_gaps')
      .select(`
        id,
        field_name,
        field_priority,
        points_reward,
        entity_id,
        entity_type,
        detected_at,
        vehicles!data_gaps_entity_id_fkey(year, make, model)
      `)
      .eq('is_filled', false)
      .in('entity_id', await getUserVehicleIds())
      .order('points_reward', { ascending: false })
      .limit(5);

    gaps?.forEach(g => {
      actions.push({
        id: g.id,
        type: 'data_gap',
        priority: g.field_priority as any,
        title: `Missing ${g.field_name}`,
        description: `${(g.vehicles as any)?.year} ${(g.vehicles as any)?.make} ${(g.vehicles as any)?.model}`,
        reward: g.points_reward,
        entityId: g.entity_id,
        entityType: g.entity_type,
        createdAt: g.detected_at
      });
    });

    // Sort by priority and date
    actions.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    setPendingActions(actions.slice(0, 10));
  };

  const loadRecentActivity = async () => {
    // TODO: Implement activity feed from timeline_events + contributions
    setRecentActivity([]);
  };

  const loadVehicles = async () => {
    const { data, error } = await supabase
      .from('vehicles')
      .select(`
        id,
        year,
        make,
        model,
        vin,
        created_at,
        vehicle_images(id, image_url, is_primary)
      `)
      .eq('uploaded_by', session!.user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    setVehicles(data || []);
  };

  const getUserVehicleIds = async (): Promise<string> => {
    const { data } = await supabase
      .from('vehicles')
      .select('id')
      .eq('uploaded_by', session!.user.id);
    
    return data?.map(v => v.id).join(',') || '';
  };

  if (loading) {
    return (
      <div className="rh-feed" style={{ padding: '24px', textAlign: 'center' }}>
        <div style={{ color: 'var(--rh-text-secondary)' }}>Loading portfolio...</div>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="rh-feed" style={{ padding: '24px', textAlign: 'center' }}>
        <div style={{ color: 'var(--rh-text-secondary)' }}>Please sign in to view dashboard</div>
      </div>
    );
  }

  return (
    <div className="rh-feed">
      {/* Portfolio Value Hero (Robinhood-style) */}
      <div className="rh-value-hero">
        <div className="rh-value-label">Portfolio Value</div>
        <div className="rh-value-price">
          ${stats?.totalValue.toLocaleString()}
        </div>
        <div className={`rh-value-change ${stats && stats.monthChange >= 0 ? 'positive' : 'negative'}`}>
          {stats && stats.monthChange >= 0 ? '↑' : '↓'} ${Math.abs(stats?.monthChange || 0).toLocaleString()} 
          ({stats?.monthChangePercent.toFixed(1)}%) This Month
        </div>
      </div>

      {/* Stats Grid */}
      <div className="rh-stat-grid">
        <div className="rh-stat-card" onClick={() => navigate('/vehicles')}>
          <div className="rh-stat-label">Vehicles</div>
          <div className="rh-stat-value">{stats?.totalVehicles || 0}</div>
        </div>
        <div className="rh-stat-card">
          <div className="rh-stat-label">Photos</div>
          <div className="rh-stat-value">{stats?.totalPhotos || 0}</div>
        </div>
        <div className="rh-stat-card">
          <div className="rh-stat-label">Events</div>
          <div className="rh-stat-value">{stats?.totalEvents || 0}</div>
        </div>
        <div className="rh-stat-card">
          <div className="rh-stat-label">Points</div>
          <div className="rh-stat-value">{stats?.contributionPoints || 0}</div>
          <div className="rh-stat-change positive">
            Level {stats?.currentLevel || 1}
          </div>
        </div>
      </div>

      {/* Pending Actions (Critical) */}
      {pendingActions.length > 0 && (
        <div style={{ margin: '16px' }}>
          <div style={{ 
            fontSize: '15px', 
            fontWeight: 600, 
            color: 'var(--rh-text-primary)',
            marginBottom: '12px'
          }}>
            Action Required
          </div>
          
          {pendingActions.map(action => {
            const priorityColor = {
              critical: 'var(--rh-red)',
              high: 'var(--rh-orange)',
              medium: 'var(--rh-blue)',
              low: 'var(--rh-text-tertiary)'
            }[action.priority];

            return (
              <div
                key={action.id}
                className="rh-timeline-item"
                onClick={() => {
                  if (action.type === 'merge_proposal') {
                    navigate(`/vehicle/${action.entityId}`);
                  } else if (action.type === 'data_gap') {
                    navigate(`/vehicle/${action.entityId}`);
                  }
                }}
              >
                <div className="rh-timeline-icon" style={{ background: `${priorityColor}20`, color: priorityColor }}>
                  {action.type === 'merge_proposal' ? '⚠️' : '📝'}
                </div>
                <div className="rh-timeline-content">
                  <div className="rh-timeline-header">
                    <div className="rh-timeline-title">{action.title}</div>
                    {action.reward && (
                      <div style={{ 
                        fontFamily: 'var(--rh-font-mono)',
                        fontSize: '14px',
                        color: 'var(--rh-green)',
                        fontWeight: 600
                      }}>
                        +{action.reward}
                      </div>
                    )}
                  </div>
                  <div className="rh-timeline-desc">{action.description}</div>
                  <div className="rh-timeline-meta">
                    <span style={{ color: priorityColor, textTransform: 'uppercase', fontSize: '11px', fontWeight: 600 }}>
                      {action.priority}
                    </span>
                    <span>{new Date(action.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Actions */}
      <div style={{ margin: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <button
          onClick={() => navigate('/vehicles/new')}
          className="rh-btn-primary"
          style={{ width: '100%', padding: '12px' }}
        >
          Add Vehicle
        </button>
        <button
          onClick={() => navigate('/admin/merge-proposals')}
          className="rh-btn"
          style={{ width: '100%', padding: '12px' }}
        >
          Review Duplicates
        </button>
      </div>

      {/* Recent Vehicles */}
      <div style={{ margin: '16px' }}>
        <div style={{ 
          fontSize: '15px', 
          fontWeight: 600, 
          color: 'var(--rh-text-primary)',
          marginBottom: '12px'
        }}>
          Your Vehicles
        </div>
        
        {vehicles.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '32px', 
            color: 'var(--rh-text-secondary)' 
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🚗</div>
            <div style={{ marginBottom: '16px' }}>No vehicles yet</div>
            <button
              onClick={() => navigate('/vehicles/new')}
              className="rh-btn-primary"
            >
              Add Your First Vehicle
            </button>
          </div>
        ) : (
          vehicles.map(vehicle => {
            const primaryImage = (vehicle.vehicle_images as any[])?.find(img => img.is_primary);
            
            return (
              <div
                key={vehicle.id}
                className="rh-timeline-item"
                onClick={() => navigate(`/vehicle/${vehicle.id}`)}
              >
                {primaryImage ? (
                  <img
                    src={primaryImage.image_url}
                    alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '8px',
                      objectFit: 'cover',
                      flexShrink: 0
                    }}
                  />
                ) : (
                  <div className="rh-timeline-icon">🚗</div>
                )}
                <div className="rh-timeline-content">
                  <div className="rh-timeline-title">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </div>
                  <div className="rh-timeline-desc" style={{ fontFamily: 'var(--rh-font-mono)', fontSize: '12px' }}>
                    {vehicle.vin || 'No VIN'}
                  </div>
                  <div className="rh-timeline-meta">
                    <span>{(vehicle.vehicle_images as any[])?.length || 0} photos</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

