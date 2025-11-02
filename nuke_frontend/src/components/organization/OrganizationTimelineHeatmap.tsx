/**
 * Organization Timeline Heatmap
 * GitHub-style activity heatmap showing company work activity
 * Adapted from ContributionTimeline but for organizations
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import WorkOrderViewer from './WorkOrderViewer';

interface TimelineEvent {
  id: string;
  business_id: string;
  event_type: string;
  event_date: string;
  cost_amount?: number;
  labor_hours?: number;
  image_urls?: string[];
  metadata?: any;
}

interface OrganizationTimelineHeatmapProps {
  organizationId: string;
}

export const OrganizationTimelineHeatmap: React.FC<OrganizationTimelineHeatmapProps> = ({ organizationId }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<any>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const year = new Date().getFullYear();

  useEffect(() => {
    loadEvents();
    loadOrganization();
  }, [organizationId]);

  const loadOrganization = async () => {
    const { data } = await supabase
      .from('businesses')
      .select('id, business_name, labor_rate')
      .eq('id', organizationId)
      .single();
    
    if (data) setOrganization(data);
  };

  const loadEvents = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('business_timeline_events')
        .select('id, business_id, event_type, event_date, cost_amount, labor_hours, image_urls, metadata, title, description, event_category')
        .eq('business_id', organizationId)
        .gte('event_date', `${year - 1}-01-01`) // Load last 2 years
        .order('event_date', { ascending: false });

      if (error) throw error;
      setEvents(data || []);
    } catch (error) {
      console.error('Error loading org timeline:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper: normalize date to YYYY-MM-DD
  const toDateOnly = (raw: any): string => {
    if (!raw) return new Date().toISOString().split('T')[0];
    try {
      const s = String(raw);
      if (s.includes('T')) return s.split('T')[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    } catch {}
    return new Date().toISOString().split('T')[0];
  };

  // Group events by date with activity metrics
  const daily = new Map<string, { events: TimelineEvent[]; count: number; hours: number; value: number; types: Set<string> }>();
  
  for (const event of events) {
    const date = toDateOnly(event.event_date);
    const entry = daily.get(date) || { events: [], count: 0, hours: 0, value: 0, types: new Set() };
    
    entry.events.push(event);
    entry.count++;
    entry.hours += event.labor_hours || 0;
    entry.value += event.cost_amount || 0;
    entry.types.add(event.event_type);
    
    daily.set(date, entry);
  }

  // Calculate stats
  const totalEvents = events.length;
  const totalHours = events.reduce((sum, e) => sum + (e.labor_hours || 0), 0);
  const totalValue = events.reduce((sum, e) => sum + (e.cost_amount || 0), 0);
  const activeDays = daily.size;
  const contributionTypes = [...new Set(events.map(e => e.event_type))];

  // Calculate streaks
  const calculateMaxStreak = (): number => {
    let maxStreak = 0;
    let currentStreak = 0;
    const today = new Date().toISOString().split('T')[0];
    const start = new Date(today);
    start.setDate(start.getDate() - 364);

    for (let d = new Date(start); d <= new Date(today); d.setDate(d.getDate() + 1)) {
      const date = d.toISOString().split('T')[0];
      const count = daily.get(date)?.count || 0;
      if (count > 0) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    return maxStreak;
  };

  const calculateCurrentStreak = (): number => {
    let streak = 0;
    const today = new Date().toISOString().split('T')[0];
    const start = new Date(today);
    start.setDate(start.getDate() - 364);

    const dates: string[] = [];
    for (let d = new Date(start); d <= new Date(today); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }

    for (let i = dates.length - 1; i >= 0; i--) {
      const date = dates[i];
      const count = daily.get(date)?.count || 0;
      if (date <= today && count > 0) {
        streak++;
      } else if (date <= today) {
        break;
      }
    }
    return streak;
  };

  const maxStreak = calculateMaxStreak();
  const currentStreak = calculateCurrentStreak();

  // Color intensity - Green shades for organization activity
  const colorForActivity = (hours: number, eventCount: number) => {
    // If no events at all, return grey
    if (eventCount === 0) return '#ebedf0';
    
    // If we have events but no hours (e.g. inventory photos), show light green
    if (hours <= 0 && eventCount > 0) return '#d9f99d'; // Lime-200 - light green for documentation
    
    // For actual work hours, use intensity-based colors
    if (hours < 1) return '#bef264';   // Lime-300
    if (hours < 3) return '#a3e635';   // Lime-400
    if (hours < 6) return '#84cc16';   // Lime-500
    if (hours < 12) return '#65a30d';  // Lime-600
    if (hours < 24) return '#4d7c0f';  // Lime-700
    return '#3f6212';                  // Lime-800 (very high activity)
  };

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
      Loading activity...
    </div>;
  }

  const handleDayClick = (date: Date) => {
    const dayYmd = date.toISOString().slice(0, 10);
    const entry = daily.get(dayYmd);
    
    if (entry && entry.count > 0) {
      // Aggregate all images from same-day events for same vehicle
      const eventsByVehicle = new Map();
      
      for (const evt of entry.events) {
        const vId = evt.metadata?.vehicle_id || 'no-vehicle';
        if (!eventsByVehicle.has(vId)) {
          eventsByVehicle.set(vId, { ...evt, aggregated_images: [] });
        }
        
        // Collect images from all events
        const existing = eventsByVehicle.get(vId);
        if (evt.image_urls && Array.isArray(evt.image_urls)) {
          existing.aggregated_images.push(...evt.image_urls);
        }
      }
      
      // Show the first vehicle's consolidated work order
      const firstWorkOrder = Array.from(eventsByVehicle.values())[0];
      setSelectedWorkOrder(firstWorkOrder);
    }
  };

  return (
    <div className="card">
      <div className="card-body" style={{ padding: 'var(--space-2)' }}>
        {/* Compact stats row */}
        <div className="text-small" style={{ 
          display: 'flex', 
          gap: 'var(--space-4)', 
          marginBottom: 'var(--space-2)'
        }}>
          <span>Events: <strong>{totalEvents}</strong></span>
          <span>Hours: <strong>{totalHours.toFixed(1)}</strong></span>
          <span>Value: <strong>${totalValue.toLocaleString()}</strong></span>
          <span>Active days: <strong>{activeDays}</strong></span>
          {maxStreak > 0 && <span>Streak: <strong>{maxStreak}d</strong></span>}
        </div>

        {/* Mobile scroll hint */}
        <div style={{ 
          fontSize: '8pt', 
          color: 'var(--text-secondary)', 
          textAlign: 'center',
          marginBottom: '8px',
          display: 'block'
        }}>
          ← Swipe to view full year →
        </div>

        {/* Timeline Grid - Mobile-friendly horizontal scroll */}
        <div 
          className="timeline-container" 
          style={{ 
            position: 'relative',
            overflowX: 'auto',
            overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch', // Smooth scrolling on iOS
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,0,0,0.2) transparent',
            paddingBottom: '8px'
          }}
        >
          <div style={{ minWidth: '700px' }}> {/* Ensure full width on mobile */}
            <div key={year} id={`year-${year}`} className="bg-white rounded-lg p-2">
              {/* Months header */}
              <div style={{ marginLeft: '30px', marginBottom: '2px' }}>
                <div 
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(53, 12px)',
                    gap: '2px',
                    justifyContent: 'start'
                  }}
                >
                  {Array.from({ length: 12 }, (_, monthIndex) => {
                    const startWeek = Math.floor((monthIndex * 53) / 12);
                    const endWeek = Math.floor(((monthIndex + 1) * 53) / 12);
                    const monthWidth = endWeek - startWeek;
                    
                    return (
                      <div 
                        key={monthIndex}
                        style={{
                          gridColumn: `${startWeek + 1} / span ${monthWidth}`,
                          textAlign: 'center',
                          fontSize: '8pt',
                          color: '#888888',
                          lineHeight: '8px'
                        }}
                      >
                        {monthIndex + 1}
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Timeline Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-3)' }}>
                <div>
                  {(() => {
                    const jan1 = new Date(year, 0, 1);
                    const gridStart = new Date(jan1);
                    gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // Sunday on/before Jan 1
                    const totalWeeks = 53;

                    return (
                      <div>
                        <div 
                          className="timeline-grid"
                          style={{ 
                            display: 'grid',
                            gridTemplateRows: 'repeat(7, 12px)',
                            gridTemplateColumns: `repeat(${Math.min(53, totalWeeks)}, 12px)`,
                            gap: '2px',
                            justifyContent: 'start'
                          }}
                        >
                          {/* Day boxes: column-first (vertically down, then next column) */}
                          {Array.from({ length: totalWeeks * 7 }, (_, idx) => {
                            // Calculate column-first position
                            const weekIdx = Math.floor(idx / 7);
                            const dayIdx = idx % 7;
                            
                            const date = new Date(gridStart);
                            date.setDate(date.getDate() + weekIdx * 7 + dayIdx);
                            const inYear = date.getFullYear() === year;
                            const dayYmd = date.toISOString().slice(0,10);
                            const entry = inYear ? daily.get(dayYmd) : undefined;
                            const hours = entry?.hours || 0;
                            const count = entry?.count || 0;
                            const clickable = count > 0;

                            return (
                              <div
                                key={idx}
                                title={`${date.toLocaleDateString()}: ${clickable ? `${count} events • ~${hours.toFixed(1)} hrs${entry?.types ? ` • ${Array.from(entry.types).join(', ')}` : ''}` : 'No activity'}`}
                                className={clickable ? 'hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer' : ''}
                                onClick={() => {
                                  if (clickable) {
                                    handleDayClick(date);
                                  }
                                }}
                                style={{
                                  gridRow: dayIdx + 1,
                                  gridColumn: weekIdx + 1,
                                  width: '12px',
                                  height: '12px',
                                  backgroundColor: inYear ? colorForActivity(hours, count) : '#f5f5f5',
                                  borderRadius: '2px',
                                  border: clickable ? '1px solid rgba(0,0,0,0.1)' : 'none',
                                  opacity: inYear ? 1 : 0.3
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                
                {/* Year button on the right */}
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'auto', 
                  gap: 'var(--space-2)',
                  paddingLeft: 'var(--space-2)'
                }}>
                  <button
                    className="text-small font-bold"
                    style={{ 
                      padding: 'var(--space-1) var(--space-2)', 
                      fontSize: '8pt', 
                      background: 'var(--grey-200)',
                      border: '1px inset var(--border-medium)',
                      borderRadius: '2px',
                      minWidth: '45px',
                      textAlign: 'center'
                    }}
                  >
                    {year}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 4,
          marginTop: 'var(--space-2)',
          fontSize: 'var(--font-size-small)',
          color: 'var(--text-muted)'
        }}>
          <span className="text-small">Less activity</span>
          {[0, 0.5, 2.5, 7, 14].map(level => (
            <div
              key={level}
              style={{
                width: 11,
                height: 11,
                backgroundColor: colorForActivity(level, level > 0 ? 1 : 0),
                border: '1px solid rgba(0,0,0,0.15)',
                borderRadius: 2
              }}
            />
          ))}
          <span className="text-small">More activity</span>
        </div>
      </div>

      {/* Work Order Viewer - The Research Terminal */}
      {selectedWorkOrder && organization && (
        <WorkOrderViewer
          event={selectedWorkOrder}
          organizationName={organization.business_name}
          laborRate={organization.labor_rate}
          onClose={() => setSelectedWorkOrder(null)}
        />
      )}
    </div>
  );
};

export default OrganizationTimelineHeatmap;
