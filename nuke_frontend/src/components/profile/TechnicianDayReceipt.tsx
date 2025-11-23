import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface TechnicianDayReceiptProps {
  userId: string;
  date: string; // YYYY-MM-DD format
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
}

interface WorkEntry {
  id: string;
  type: 'contractor_work' | 'timeline_event';
  
  // Work details
  description: string;
  category?: string;
  
  // Time & Location
  timestamp: string;
  organization_id?: string;
  organization_name?: string;
  
  // Financial
  labor_hours?: number;
  hourly_rate?: number;
  labor_value?: number;
  materials_cost?: number;
  total_value?: number;
  
  // Vehicle context
  vehicle_id?: string;
  vehicle_name?: string;
  vehicle_image?: string;
  
  // Materials/Parts
  parts?: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  
  // Images
  images?: string[];
  source_image_url?: string;
  
  // Metadata
  metadata?: any;
}

interface DaySummary {
  total_labor_hours: number;
  total_labor_value: number;
  total_materials: number;
  total_earned: number;
  locations: Array<{ id: string; name: string; hours: number; value: number }>;
  vehicles: Array<{ id: string; name: string; image?: string }>;
  entries: WorkEntry[];
}

const TechnicianDayReceipt: React.FC<TechnicianDayReceiptProps> = ({ 
  userId, 
  date, 
  onClose,
  onNavigate 
}) => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  useEffect(() => {
    loadDayData();
  }, [userId, date]);

  const loadDayData = async () => {
    try {
      setLoading(true);
      
      // 1. Load contractor work contributions for this day
      const { data: contractorWork, error: cwError } = await supabase
        .from('contractor_work_contributions')
        .select(`
          *,
          organization:businesses!contractor_work_contributions_organization_id_fkey (
            id,
            name,
            shop_name
          ),
          vehicle:vehicles (
            id,
            year,
            make,
            model
          )
        `)
        .eq('contractor_user_id', userId)
        .eq('work_date', date)
        .order('created_at', { ascending: true });

      if (cwError) throw cwError;

      // 2. Load timeline events for this day (from vehicle_timeline_events)
      // These might have work_order_labor and work_order_parts linked
      const { data: timelineEvents, error: teError } = await supabase
        .from('vehicle_timeline_events')
        .select(`
          *,
          vehicle:vehicles (
            id,
            year,
            make,
            model
          )
        `)
        .eq('created_by', userId)
        .gte('event_date', `${date}T00:00:00`)
        .lte('event_date', `${date}T23:59:59`)
        .order('event_date', { ascending: true });

      if (teError) throw teError;

      // 3. For each timeline event, load associated labor and parts
      const eventIds = (timelineEvents || []).map(e => e.id);
      
      let laborData: any[] = [];
      let partsData: any[] = [];
      
      if (eventIds.length > 0) {
        const { data: labor } = await supabase
          .from('work_order_labor')
          .select('*')
          .in('timeline_event_id', eventIds);
        
        const { data: parts } = await supabase
          .from('work_order_parts')
          .select('*')
          .in('timeline_event_id', eventIds);
        
        laborData = labor || [];
        partsData = parts || [];
      }

      // 4. Load vehicle images for context
      const vehicleIds = [
        ...(contractorWork || [])
          .filter(w => w.vehicle_id)
          .map(w => w.vehicle_id),
        ...(timelineEvents || [])
          .filter(e => e.vehicle_id)
          .map(e => e.vehicle_id)
      ].filter((id): id is string => !!id);

      const uniqueVehicleIds = [...new Set(vehicleIds)];
      const vehicleImageMap = new Map<string, string>();

      if (uniqueVehicleIds.length > 0) {
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('vehicle_id, image_url')
          .in('vehicle_id', uniqueVehicleIds)
          .order('created_at', { ascending: true });

        if (images) {
          images.forEach(img => {
            if (!vehicleImageMap.has(img.vehicle_id)) {
              vehicleImageMap.set(img.vehicle_id, img.image_url);
            }
          });
        }
      }

      // 5. Transform data into unified WorkEntry format
      const entries: WorkEntry[] = [];

      // Add contractor work contributions
      (contractorWork || []).forEach(work => {
        const vehicleName = work.vehicle 
          ? `${work.vehicle.year} ${work.vehicle.make} ${work.vehicle.model}`
          : work.vehicle_name || undefined;

        entries.push({
          id: work.id,
          type: 'contractor_work',
          description: work.work_description,
          category: work.work_category,
          timestamp: work.created_at,
          organization_id: work.organization_id,
          organization_name: work.organization?.shop_name || work.organization?.name,
          labor_hours: work.labor_hours,
          hourly_rate: work.hourly_rate,
          labor_value: work.total_labor_value,
          materials_cost: work.materials_cost,
          total_value: work.total_value,
          vehicle_id: work.vehicle_id,
          vehicle_name: vehicleName,
          vehicle_image: work.vehicle_id ? vehicleImageMap.get(work.vehicle_id) : undefined,
          source_image_url: work.source_image_id ? undefined : undefined, // Would need to query organization_images
          metadata: work.metadata
        });
      });

      // Add timeline events with labor/parts
      (timelineEvents || []).forEach(event => {
        const eventLabor = laborData.filter(l => l.timeline_event_id === event.id);
        const eventParts = partsData.filter(p => p.timeline_event_id === event.id);
        
        const totalHours = eventLabor.reduce((sum, l) => sum + (l.hours || 0), 0);
        const totalLaborValue = eventLabor.reduce((sum, l) => sum + (l.total_cost || 0), 0);
        const totalMaterials = eventParts.reduce((sum, p) => sum + (p.total_price || 0), 0);

        const vehicleName = event.vehicle 
          ? `${event.vehicle.year} ${event.vehicle.make} ${event.vehicle.model}`
          : undefined;

        entries.push({
          id: event.id,
          type: 'timeline_event',
          description: event.description || event.title || event.event_type,
          category: event.event_type,
          timestamp: event.event_date,
          labor_hours: totalHours > 0 ? totalHours : undefined,
          labor_value: totalLaborValue > 0 ? totalLaborValue : undefined,
          materials_cost: totalMaterials > 0 ? totalMaterials : undefined,
          total_value: totalLaborValue + totalMaterials,
          vehicle_id: event.vehicle_id,
          vehicle_name: vehicleName,
          vehicle_image: event.vehicle_id ? vehicleImageMap.get(event.vehicle_id) : undefined,
          parts: eventParts.map(p => ({
            name: p.part_name,
            quantity: p.quantity,
            price: p.total_price
          })),
          images: event.image_urls || [],
          metadata: event.metadata
        });
      });

      // 6. Calculate summary statistics
      const totalLaborHours = entries.reduce((sum, e) => sum + (e.labor_hours || 0), 0);
      const totalLaborValue = entries.reduce((sum, e) => sum + (e.labor_value || 0), 0);
      const totalMaterials = entries.reduce((sum, e) => sum + (e.materials_cost || 0), 0);
      const totalEarned = entries.reduce((sum, e) => sum + (e.total_value || 0), 0);

      // Group by location
      const locationMap = new Map<string, { name: string; hours: number; value: number }>();
      entries.forEach(e => {
        if (e.organization_id && e.organization_name) {
          const existing = locationMap.get(e.organization_id) || {
            name: e.organization_name,
            hours: 0,
            value: 0
          };
          existing.hours += e.labor_hours || 0;
          existing.value += e.total_value || 0;
          locationMap.set(e.organization_id, existing);
        }
      });

      const locations = Array.from(locationMap.entries()).map(([id, data]) => ({
        id,
        ...data
      }));

      // Group by vehicle
      const vehicleMap = new Map<string, { name: string; image?: string }>();
      entries.forEach(e => {
        if (e.vehicle_id && e.vehicle_name) {
          if (!vehicleMap.has(e.vehicle_id)) {
            vehicleMap.set(e.vehicle_id, {
              name: e.vehicle_name,
              image: e.vehicle_image
            });
          }
        }
      });

      const vehicles = Array.from(vehicleMap.entries()).map(([id, data]) => ({
        id,
        ...data
      }));

      setSummary({
        total_labor_hours: totalLaborHours,
        total_labor_value: totalLaborValue,
        total_materials: totalMaterials,
        total_earned: totalEarned,
        locations,
        vehicles,
        entries: entries.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
      });

    } catch (error) {
      console.error('Error loading technician day data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001
        }}
      >
        <div className="card" style={{ maxWidth: '400px', padding: 'var(--space-4)' }}>
          <div className="text">Loading day report...</div>
        </div>
      </div>
    );
  }

  if (!summary || summary.entries.length === 0) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001
        }}
        onClick={onClose}
      >
        <div className="card" style={{ maxWidth: '400px', padding: 'var(--space-4)' }} onClick={(e) => e.stopPropagation()}>
          <div className="card-header">
            <h4 className="text">No Work Data</h4>
          </div>
          <div className="card-body">
            <p className="text text-muted">No work recorded for this day.</p>
          </div>
          <div className="card-footer">
            <button className="button button-secondary button-small" onClick={onClose}>
              CLOSE
            </button>
          </div>
        </div>
      </div>
    );
  }

  const formatCurrency = (value: number) => `$${value.toFixed(2)}`;
  const formatHours = (hours: number) => hours === 1 ? '1 hr' : `${hours.toFixed(1)} hrs`;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1001,
        overflow: 'auto'
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ 
          maxWidth: '900px', 
          width: '90%', 
          maxHeight: '85vh', 
          overflow: 'auto',
          margin: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="card-header" style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          borderBottom: '2px solid var(--border-dark)',
          padding: '12px 16px',
          gap: '16px'
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px',
            flex: 1
          }}>
            {onNavigate && (
              <button 
                className="button button-secondary button-small"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate('prev');
                }}
                style={{ 
                  fontSize: '9px', 
                  fontWeight: 700,
                  padding: '6px 12px',
                  minWidth: '70px',
                  whiteSpace: 'nowrap'
                }}
              >
                PREV DAY
              </button>
            )}
            <div style={{ 
              flex: 1,
              textAlign: 'center',
              minWidth: '200px'
            }}>
              <h3 className="text" style={{ 
                fontSize: '11px', 
                fontWeight: 700, 
                margin: 0,
                lineHeight: 1.4
              }}>
                WORK RECEIPT
              </h3>
              <div style={{ 
                fontSize: '10px',
                color: 'var(--text-muted)',
                marginTop: '2px'
              }}>
                {new Date(date).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </div>
            </div>
            {onNavigate && (
              <button 
                className="button button-secondary button-small"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate('next');
                }}
                style={{ 
                  fontSize: '9px', 
                  fontWeight: 700,
                  padding: '6px 12px',
                  minWidth: '70px',
                  whiteSpace: 'nowrap'
                }}
              >
                NEXT DAY
              </button>
            )}
          </div>
          <button 
            className="button button-secondary button-small" 
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            style={{ 
              fontSize: '9px', 
              fontWeight: 700,
              padding: '6px 12px',
              minWidth: '60px',
              whiteSpace: 'nowrap'
            }}
          >
            CLOSE
          </button>
        </div>

        {/* SUMMARY STATS */}
        <div className="card-body" style={{ 
          background: 'var(--grey-100)', 
          borderBottom: '1px solid var(--border-light)'
        }}>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 'var(--space-3)'
          }}>
            <div>
              <div className="text text-muted" style={{ fontSize: '9px', marginBottom: '4px' }}>
                TOTAL EARNED
              </div>
              <div className="text" style={{ fontSize: '18px', fontWeight: 700 }}>
                {formatCurrency(summary.total_earned)}
              </div>
              <div className="text text-muted" style={{ fontSize: '8px' }}>
                {formatCurrency(summary.total_labor_value)} labor + {formatCurrency(summary.total_materials)} materials
              </div>
            </div>

            <div>
              <div className="text text-muted" style={{ fontSize: '9px', marginBottom: '4px' }}>
                LABOR HOURS
              </div>
              <div className="text" style={{ fontSize: '18px', fontWeight: 700 }}>
                {formatHours(summary.total_labor_hours)}
              </div>
              {summary.total_labor_hours > 0 && summary.total_labor_value > 0 && (
                <div className="text text-muted" style={{ fontSize: '8px' }}>
                  Avg: {formatCurrency(summary.total_labor_value / summary.total_labor_hours)}/hr
                </div>
              )}
            </div>

            <div>
              <div className="text text-muted" style={{ fontSize: '9px', marginBottom: '4px' }}>
                LOCATIONS
              </div>
              <div className="text" style={{ fontSize: '18px', fontWeight: 700 }}>
                {summary.locations.length}
              </div>
              <div className="text text-muted" style={{ fontSize: '8px' }}>
                {summary.locations.map(l => l.name).join(', ') || 'None'}
              </div>
            </div>

            <div>
              <div className="text text-muted" style={{ fontSize: '9px', marginBottom: '4px' }}>
                VEHICLES
              </div>
              <div className="text" style={{ fontSize: '18px', fontWeight: 700 }}>
                {summary.vehicles.length}
              </div>
              <div className="text text-muted" style={{ fontSize: '8px' }}>
                {summary.entries.length} work entries
              </div>
            </div>
          </div>
        </div>

        {/* LOCATION BREAKDOWN */}
        {summary.locations.length > 0 && (
          <div className="card-body" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <h4 className="text" style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
              LOCATIONS WORKED
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {summary.locations.map(location => (
                <div 
                  key={location.id}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    padding: 'var(--space-2)',
                    background: 'var(--white)',
                    border: '1px solid var(--border-light)'
                  }}
                >
                  <a 
                    href={`/organization/${location.id}`}
                    className="text"
                    style={{ fontWeight: 600, fontSize: '11px' }}
                  >
                    {location.name}
                  </a>
                  <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <span className="text text-muted" style={{ fontSize: '10px' }}>
                      {formatHours(location.hours)}
                    </span>
                    <span className="text" style={{ fontSize: '10px', fontWeight: 600 }}>
                      {formatCurrency(location.value)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WORK ENTRIES */}
        <div className="card-body">
          <h4 className="text" style={{ fontSize: '10px', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            WORK PERFORMED ({summary.entries.length})
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {summary.entries.map((entry) => {
              const isExpanded = expandedEntry === entry.id;
              const hasDetails = entry.parts && entry.parts.length > 0;

              return (
                <div
                  key={entry.id}
                  style={{
                    border: '2px solid var(--border-light)',
                    background: 'var(--white)',
                    overflow: 'hidden'
                  }}
                >
                  {/* Entry Header */}
                  <div 
                    style={{ 
                      display: 'flex', 
                      gap: 'var(--space-2)',
                      padding: 'var(--space-2)',
                      cursor: hasDetails ? 'pointer' : 'default'
                    }}
                    onClick={() => hasDetails && setExpandedEntry(isExpanded ? null : entry.id)}
                  >
                    {/* Vehicle Image */}
                    {entry.vehicle_image && (
                      <img
                        src={`${entry.vehicle_image}${entry.vehicle_image.includes('supabase') ? '?width=120&height=120' : ''}`}
                        alt={entry.vehicle_name || 'Vehicle'}
                        style={{
                          width: '60px',
                          height: '60px',
                          objectFit: 'cover',
                          border: '1px solid var(--border-medium)'
                        }}
                      />
                    )}

                    {/* Entry Details */}
                    <div style={{ flex: 1 }}>
                      {/* Vehicle name & Time */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        {entry.vehicle_name ? (
                          <a 
                            href={`/vehicle/${entry.vehicle_id}`}
                            className="text"
                            style={{ fontSize: '11px', fontWeight: 700 }}
                          >
                            {entry.vehicle_name}
                          </a>
                        ) : (
                          <span className="text text-muted" style={{ fontSize: '11px' }}>
                            {entry.organization_name || 'General Work'}
                          </span>
                        )}
                        <span className="text text-muted" style={{ fontSize: '9px' }}>
                          {new Date(entry.timestamp).toLocaleTimeString([], { 
                            hour: 'numeric', 
                            minute: '2-digit' 
                          })}
                        </span>
                      </div>

                      {/* Description */}
                      <div className="text" style={{ fontSize: '10px', marginBottom: '6px' }}>
                        {entry.description}
                      </div>

                      {/* Stats Row */}
                      <div style={{ 
                        display: 'flex', 
                        gap: 'var(--space-3)',
                        alignItems: 'center' 
                      }}>
                        {entry.labor_hours && entry.labor_hours > 0 && (
                          <span className="text" style={{ fontSize: '9px' }}>
                            {formatHours(entry.labor_hours)}
                          </span>
                        )}
                        {entry.hourly_rate && (
                          <span className="text text-muted" style={{ fontSize: '9px' }}>
                            @ {formatCurrency(entry.hourly_rate)}/hr
                          </span>
                        )}
                        {entry.materials_cost && entry.materials_cost > 0 && (
                          <span className="text" style={{ fontSize: '9px' }}>
                            Materials: {formatCurrency(entry.materials_cost)}
                          </span>
                        )}
                        {entry.total_value && entry.total_value > 0 && (
                          <span 
                            className="text" 
                            style={{ 
                              fontSize: '10px', 
                              fontWeight: 700,
                              marginLeft: 'auto'
                            }}
                          >
                            {formatCurrency(entry.total_value)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && hasDetails && (
                    <div style={{ 
                      borderTop: '1px solid var(--border-light)',
                      padding: 'var(--space-2)',
                      background: 'var(--grey-50)'
                    }}>
                      <div className="text" style={{ fontSize: '9px', fontWeight: 700, marginBottom: '4px' }}>
                        PARTS & MATERIALS:
                      </div>
                      {entry.parts?.map((part, idx) => (
                        <div 
                          key={idx}
                          style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between',
                            fontSize: '9px',
                            marginBottom: '2px'
                          }}
                        >
                          <span className="text">
                            {part.name} (x{part.quantity})
                          </span>
                          <span className="text">
                            {formatCurrency(part.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* FOOTER */}
        <div className="card-footer" style={{ 
          textAlign: 'center',
          borderTop: '2px solid var(--border-dark)',
          background: 'var(--grey-100)'
        }}>
          <div className="text" style={{ fontSize: '10px', fontWeight: 700 }}>
            END OF DAY REPORT
          </div>
          <div className="text text-muted" style={{ fontSize: '9px' }}>
            Generated {new Date().toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TechnicianDayReceipt;

