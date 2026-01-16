import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

interface VehicleHealthData {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  color: string | null;
  purchase_price: number | null;
  current_value: number | null;
  imageCount: number;
  eventCount: number;
  hasRecentActivity: boolean;
  healthScore: number;
}

interface FleetHealthOverviewProps {
  vehicles: any[];
  userId: string;
  onQuickFix: (fixType: 'price' | 'vin' | 'mileage' | 'color' | 'images', vehicleIds: string[]) => void;
  onFilterByHealth: (healthLevel: 'healthy' | 'needs_work' | 'critical' | null) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const FleetHealthOverview: React.FC<FleetHealthOverviewProps> = ({
  vehicles,
  userId,
  onQuickFix,
  onFilterByHealth,
  collapsed = false,
  onToggleCollapse
}) => {
  const [vehicleHealthData, setVehicleHealthData] = useState<VehicleHealthData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<'healthy' | 'needs_work' | 'critical' | null>(null);

  useEffect(() => {
    if (vehicles.length > 0) {
      loadHealthData();
    } else {
      setVehicleHealthData([]);
      setLoading(false);
    }
  }, [vehicles]);

  const loadHealthData = async () => {
    setLoading(true);
    try {
      const vehicleIds = vehicles.map(v => v.vehicle?.id || v.id).filter(Boolean);
      if (vehicleIds.length === 0) {
        setVehicleHealthData([]);
        return;
      }

      // Batch fetch image counts
      const { data: imageCounts } = await supabase
        .from('vehicle_images')
        .select('vehicle_id')
        .in('vehicle_id', vehicleIds);

      // Batch fetch event counts and recent activity
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: events } = await supabase
        .from('timeline_events')
        .select('vehicle_id, event_date')
        .in('vehicle_id', vehicleIds);

      // Count images per vehicle
      const imageCountMap = new Map<string, number>();
      (imageCounts || []).forEach((img: any) => {
        const count = imageCountMap.get(img.vehicle_id) || 0;
        imageCountMap.set(img.vehicle_id, count + 1);
      });

      // Count events and check recent activity per vehicle
      const eventCountMap = new Map<string, number>();
      const recentActivityMap = new Map<string, boolean>();
      (events || []).forEach((event: any) => {
        const count = eventCountMap.get(event.vehicle_id) || 0;
        eventCountMap.set(event.vehicle_id, count + 1);
        
        if (new Date(event.event_date) > thirtyDaysAgo) {
          recentActivityMap.set(event.vehicle_id, true);
        }
      });

      // Calculate health data for each vehicle
      const healthData: VehicleHealthData[] = vehicles.map(rel => {
        const v = rel.vehicle || rel;
        const id = v.id;
        const imageCount = imageCountMap.get(id) || 0;
        const eventCount = eventCountMap.get(id) || 0;
        const hasRecentActivity = recentActivityMap.get(id) || false;

        // Calculate health score (same logic as GarageVehicleCard)
        let healthScore = 0;
        if (v.current_value || v.purchase_price) healthScore += 25;
        if (imageCount > 0) healthScore += 25;
        if (eventCount > 0) healthScore += 25;
        if (hasRecentActivity) healthScore += 25;

        return {
          id,
          year: v.year,
          make: v.make,
          model: v.model,
          vin: v.vin,
          mileage: v.mileage,
          color: v.color,
          purchase_price: v.purchase_price,
          current_value: v.current_value,
          imageCount,
          eventCount,
          hasRecentActivity,
          healthScore
        };
      });

      setVehicleHealthData(healthData);
    } catch (error) {
      console.error('Error loading fleet health data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate health distribution
  const healthDistribution = useMemo(() => {
    const healthy = vehicleHealthData.filter(v => v.healthScore >= 75);
    const needsWork = vehicleHealthData.filter(v => v.healthScore >= 50 && v.healthScore < 75);
    const critical = vehicleHealthData.filter(v => v.healthScore < 50);
    
    return { healthy, needsWork, critical };
  }, [vehicleHealthData]);

  // Calculate missing fields
  const missingFields = useMemo(() => {
    const missing = {
      price: vehicleHealthData.filter(v => !v.purchase_price && !v.current_value),
      vin: vehicleHealthData.filter(v => !v.vin),
      mileage: vehicleHealthData.filter(v => !v.mileage),
      color: vehicleHealthData.filter(v => !v.color),
      images: vehicleHealthData.filter(v => v.imageCount === 0)
    };

    // Sort by count descending
    return Object.entries(missing)
      .map(([field, vehicles]) => ({ field, vehicles, count: vehicles.length }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [vehicleHealthData]);

  // Calculate migration progress
  const migrationProgress = useMemo(() => {
    const total = vehicleHealthData.length;
    if (total === 0) return { percentage: 0, complete: 0, inProgress: 0, notStarted: 0 };

    const complete = healthDistribution.healthy.length;
    const inProgress = healthDistribution.needsWork.length;
    const notStarted = healthDistribution.critical.length;
    const percentage = Math.round((complete / total) * 100);

    return { percentage, complete, inProgress, notStarted, total };
  }, [vehicleHealthData, healthDistribution]);

  const handleFilterClick = (level: 'healthy' | 'needs_work' | 'critical') => {
    const newFilter = activeFilter === level ? null : level;
    setActiveFilter(newFilter);
    onFilterByHealth(newFilter);
  };

  if (loading) {
    return (
      <div style={{
        padding: '16px',
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        marginBottom: '16px'
      }}>
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Analyzing fleet health...
        </div>
      </div>
    );
  }

  if (vehicleHealthData.length === 0) {
    return null;
  }

  if (collapsed) {
    return (
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer'
        }}
        onClick={onToggleCollapse}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '9pt', fontWeight: 700 }}>Fleet Health</span>
          <div style={{ display: 'flex', gap: '12px', fontSize: '8pt' }}>
            <span style={{ color: '#15803d' }}>
              {healthDistribution.healthy.length} healthy
            </span>
            <span style={{ color: '#d97706' }}>
              {healthDistribution.needsWork.length} need work
            </span>
            <span style={{ color: '#dc2626' }}>
              {healthDistribution.critical.length} critical
            </span>
          </div>
        </div>
        <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>EXPAND</span>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      marginBottom: '16px'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-light)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span style={{ fontSize: '9pt', fontWeight: 700 }}>Fleet Health Overview</span>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '7pt',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px 8px'
            }}
          >
            COLLAPSE
          </button>
        )}
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Health Distribution */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {/* Healthy */}
          <button
            type="button"
            onClick={() => handleFilterClick('healthy')}
            style={{
              flex: '1 1 120px',
              padding: '12px',
              background: activeFilter === 'healthy' ? '#dcfce7' : '#f0fdf4',
              border: `2px solid ${activeFilter === 'healthy' ? '#15803d' : '#86efac'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <div style={{ fontSize: '20pt', fontWeight: 700, color: '#15803d' }}>
              {healthDistribution.healthy.length}
            </div>
            <div style={{ fontSize: '8pt', fontWeight: 600, color: '#166534' }}>
              Healthy (75%+)
            </div>
          </button>

          {/* Needs Work */}
          <button
            type="button"
            onClick={() => handleFilterClick('needs_work')}
            style={{
              flex: '1 1 120px',
              padding: '12px',
              background: activeFilter === 'needs_work' ? '#fef3c7' : '#fffbeb',
              border: `2px solid ${activeFilter === 'needs_work' ? '#d97706' : '#fcd34d'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <div style={{ fontSize: '20pt', fontWeight: 700, color: '#d97706' }}>
              {healthDistribution.needsWork.length}
            </div>
            <div style={{ fontSize: '8pt', fontWeight: 600, color: '#92400e' }}>
              Needs Work (50-74%)
            </div>
          </button>

          {/* Critical */}
          <button
            type="button"
            onClick={() => handleFilterClick('critical')}
            style={{
              flex: '1 1 120px',
              padding: '12px',
              background: activeFilter === 'critical' ? '#fee2e2' : '#fef2f2',
              border: `2px solid ${activeFilter === 'critical' ? '#dc2626' : '#fca5a5'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              textAlign: 'left'
            }}
          >
            <div style={{ fontSize: '20pt', fontWeight: 700, color: '#dc2626' }}>
              {healthDistribution.critical.length}
            </div>
            <div style={{ fontSize: '8pt', fontWeight: 600, color: '#991b1b' }}>
              Critical (&lt;50%)
            </div>
          </button>
        </div>

        {/* Migration Progress Bar */}
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px'
          }}>
            <span style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text-muted)' }}>
              Migration Progress
            </span>
            <span style={{ fontSize: '8pt', fontWeight: 700 }}>
              {migrationProgress.percentage}% Complete
            </span>
          </div>
          <div style={{
            height: '8px',
            background: '#e5e7eb',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              width: `${migrationProgress.percentage}%`,
              background: 'linear-gradient(90deg, #22c55e, #16a34a)',
              borderRadius: '4px',
              transition: 'width 0.3s ease'
            }} />
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '6px',
            fontSize: '7pt',
            color: 'var(--text-muted)'
          }}>
            <span>{migrationProgress.complete} complete</span>
            <span>{migrationProgress.inProgress} in progress</span>
            <span>{migrationProgress.notStarted} not started</span>
          </div>
        </div>

        {/* Top Issues with Quick Fix Buttons */}
        {missingFields.length > 0 && (
          <div>
            <div style={{
              fontSize: '8pt',
              fontWeight: 600,
              color: 'var(--text-muted)',
              marginBottom: '10px'
            }}>
              Top Issues
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {missingFields.slice(0, 5).map(({ field, vehicles, count }) => {
                const fieldLabels: Record<string, string> = {
                  price: 'Purchase Price',
                  vin: 'VIN',
                  mileage: 'Mileage',
                  color: 'Color',
                  images: 'Images'
                };
                const fieldIcons: Record<string, string> = {
                  price: '$',
                  vin: '#',
                  mileage: 'MI',
                  color: '🎨',
                  images: '📷'
                };

                return (
                  <div
                    key={field}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '8pt',
                        background: '#e5e7eb',
                        padding: '2px 6px',
                        borderRadius: '2px'
                      }}>
                        {fieldIcons[field]}
                      </span>
                      <span style={{ fontSize: '8pt' }}>
                        <strong>{count}</strong> vehicles missing {fieldLabels[field]}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onQuickFix(field as any, vehicles.map(v => v.id))}
                      style={{
                        padding: '4px 10px',
                        fontSize: '7pt',
                        fontWeight: 600,
                        background: '#1e40af',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        textTransform: 'uppercase'
                      }}
                    >
                      Fix All
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default FleetHealthOverview;
