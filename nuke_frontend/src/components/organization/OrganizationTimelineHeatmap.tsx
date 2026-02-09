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
  title?: string;
  description?: string;
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
  const [selectedDayCommits, setSelectedDayCommits] = useState<{ date: string; events: TimelineEvent[] } | null>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // GitHub-style: last 53 weeks (rolling), not calendar year
  const today = new Date();
  const rangeEnd = today.toISOString().slice(0, 10);
  const rangeStartDate = new Date(today);
  rangeStartDate.setDate(rangeStartDate.getDate() - 364);
  const rangeStart = rangeStartDate.toISOString().slice(0, 10);

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
        .gte('event_date', rangeStart)
        .lte('event_date', rangeEnd)
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

  // Group events by date with activity metrics (query already filtered to rangeStart..rangeEnd)
  const daily = new Map<string, { events: TimelineEvent[]; count: number; hours: number; value: number; types: Set<string> }>();

  for (const event of events) {
    const date = toDateOnly(event.event_date);
    if (date < rangeStart || date > rangeEnd) continue;

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
    for (let d = new Date(rangeStart); d <= new Date(rangeEnd); d.setDate(d.getDate() + 1)) {
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
    const dates: string[] = [];
    for (let d = new Date(rangeStart); d <= new Date(rangeEnd); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    for (let i = dates.length - 1; i >= 0; i--) {
      const date = dates[i];
      const count = daily.get(date)?.count || 0;
      if (date <= rangeEnd && count > 0) {
        streak++;
      } else if (date <= rangeEnd) {
        break;
      }
    }
    return streak;
  };

  const maxStreak = calculateMaxStreak();
  const currentStreak = calculateCurrentStreak();

  // Color intensity - Green shades; GitHub-style levels for commit-only days (by count)
  const colorForActivity = (hours: number, eventCount: number) => {
    if (eventCount === 0) return 'var(--heat-0)';

    // Events with no hours (e.g. commits, docs): use count-based levels like GitHub
    if (hours <= 0 && eventCount > 0) {
      if (eventCount >= 10) return 'var(--heat-5)';
      if (eventCount >= 6) return 'var(--heat-4)';
      if (eventCount >= 4) return 'var(--heat-3)';
      if (eventCount >= 2) return 'var(--heat-2)';
      return 'var(--heat-1)';
    }

    // Work hours-based intensity
    if (hours < 1) return 'var(--heat-2)';
    if (hours < 3) return 'var(--heat-3)';
    if (hours < 6) return 'var(--heat-4)';
    if (hours < 12) return 'var(--heat-5)';
    return 'var(--heat-6)';
  };

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
      Loading activity...
    </div>;
  }

  const handleDayClick = (date: Date) => {
    const dayYmd = date.toISOString().slice(0, 10);
    const entry = daily.get(dayYmd);

    if (!entry || entry.count === 0) return;

    const allCommits = entry.events.every((e) => e.event_type === 'commit');
    if (allCommits) {
      setSelectedDayCommits({ date: dayYmd, events: entry.events });
      setSelectedWorkOrder(null);
      return;
    }

    setSelectedDayCommits(null);
    // Automotive-style: group by vehicle and show work order viewer
    const eventsByVehicle = new Map();
    for (const evt of entry.events) {
      const vId = evt.metadata?.vehicle_id || 'no-vehicle';
      if (!eventsByVehicle.has(vId)) {
        eventsByVehicle.set(vId, { ...evt, aggregated_images: [] });
      }
      const existing = eventsByVehicle.get(vId);
      if (evt.image_urls && Array.isArray(evt.image_urls)) {
        existing.aggregated_images.push(...evt.image_urls);
      }
    }
    const firstWorkOrder = Array.from(eventsByVehicle.values())[0];
    setSelectedWorkOrder(firstWorkOrder);
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
          ← Swipe to view last 53 weeks (GitHub-style) →
        </div>

        {/* Timeline Grid - Rolling 53 weeks like GitHub contribution graph */}
        <div
          className="timeline-container"
          style={{
            position: 'relative',
            overflowX: 'auto',
            overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,0,0,0.2) transparent',
            paddingBottom: '8px'
          }}
        >
          <div style={{ minWidth: '700px' }}>
            <div
              key={rangeStart}
              id="timeline-rolling"
              className="rounded-lg p-2"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }}
            >
              {/* Month labels for rolling 53 weeks */}
              <div style={{ marginLeft: '30px', marginBottom: '2px' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(53, 12px)',
                    gap: '2px',
                    justifyContent: 'start'
                  }}
                >
                  {(() => {
                    const gridStart = new Date(rangeStart);
                    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
                    const monthLabels: { weekIdx: number; label: string }[] = [];
                    let lastMonth = -1;
                    for (let w = 0; w < 53; w++) {
                      const weekStart = new Date(gridStart);
                      weekStart.setDate(weekStart.getDate() + w * 7);
                      const m = weekStart.getMonth();
                      if (m !== lastMonth) {
                        monthLabels.push({ weekIdx: w, label: weekStart.toLocaleString('en-US', { month: 'short' }) });
                        lastMonth = m;
                      }
                    }
                    return monthLabels.map(({ weekIdx, label }, i) => (
                      <div
                        key={i}
                        style={{
                          gridColumn: `${weekIdx + 1} / span ${(monthLabels[i + 1]?.weekIdx ?? 53) - weekIdx}`,
                          textAlign: 'left',
                          fontSize: '8pt',
                          color: 'var(--text-secondary)',
                          lineHeight: '8px'
                        }}
                      >
                        {label}
                      </div>
                    ));
                  })()}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-3)' }}>
                <div>
                  {(() => {
                    const gridStart = new Date(rangeStart);
                    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
                    const totalWeeks = 53;

                    return (
                      <div>
                        <div
                          className="timeline-grid"
                          style={{
                            display: 'grid',
                            gridTemplateRows: 'repeat(7, 12px)',
                            gridTemplateColumns: `repeat(${totalWeeks}, 12px)`,
                            gap: '2px',
                            justifyContent: 'start'
                          }}
                        >
                          {Array.from({ length: totalWeeks * 7 }, (_, idx) => {
                            const weekIdx = Math.floor(idx / 7);
                            const dayIdx = idx % 7;

                            const date = new Date(gridStart);
                            date.setDate(date.getDate() + weekIdx * 7 + dayIdx);
                            const dayYmd = date.toISOString().slice(0, 10);
                            const inRange = dayYmd >= rangeStart && dayYmd <= rangeEnd;
                            const entry = inRange ? daily.get(dayYmd) : undefined;
                            const hours = entry?.hours || 0;
                            const count = entry?.count || 0;
                            const clickable = inRange && count > 0;

                            return (
                              <div
                                key={idx}
                                title={`${date.toLocaleDateString()}: ${clickable ? `${count} events • ~${hours.toFixed(1)} hrs${entry?.types ? ` • ${Array.from(entry.types).join(', ')}` : ''}` : inRange ? 'No activity' : ''}`}
                                className={clickable ? 'hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer' : ''}
                                onClick={() => {
                                  if (clickable) handleDayClick(date);
                                }}
                                style={{
                                  gridRow: dayIdx + 1,
                                  gridColumn: weekIdx + 1,
                                  width: '12px',
                                  height: '12px',
                                  backgroundColor: inRange ? colorForActivity(hours, count) : 'var(--heat-0)',
                                  borderRadius: '2px',
                                  border: clickable ? '1px solid var(--heat-border)' : 'none',
                                  opacity: inRange ? 1 : 0.3
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto',
                  gap: 'var(--space-2)',
                  paddingLeft: 'var(--space-2)'
                }}>
                  <span
                    className="text-small font-bold"
                    style={{
                      padding: 'var(--space-1) var(--space-2)',
                      fontSize: '8pt',
                      background: 'var(--grey-200)',
                      border: '1px solid var(--border-medium)',
                      borderRadius: '2px',
                      minWidth: '45px',
                      textAlign: 'center'
                    }}
                  >
                    {rangeStart.slice(0, 4)}–{rangeEnd.slice(0, 4)}
                  </span>
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
                border: '1px solid var(--heat-border)',
                borderRadius: 2
              }}
            />
          ))}
          <span className="text-small">More activity</span>
        </div>
      </div>

      {/* Commit-only day: list of commits (no automotive receipt) */}
      {selectedDayCommits && (
        <div
          className="card"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            margin: 0,
            maxHeight: '100vh',
            overflow: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 className="text font-bold">
              Activity on {new Date(selectedDayCommits.date + 'Z').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
            </h3>
            <button
              type="button"
              onClick={() => setSelectedDayCommits(null)}
              style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
            >
              Close
            </button>
          </div>
          <div className="card-body" style={{ padding: 'var(--space-3)' }}>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {selectedDayCommits.events.map((evt) => {
                const sha = evt.metadata?.sha as string | undefined;
                const repo = evt.metadata?.repo as string | undefined;
                const commitUrl = repo && sha ? `https://github.com/sss97133/${repo}/commit/${sha}` : null;
                return (
                  <li
                    key={evt.id}
                    style={{
                      padding: 'var(--space-2) 0',
                      borderBottom: '1px solid var(--border)'
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {evt.title || 'Commit'}
                    </div>
                    {evt.description && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 4 }}>
                        {evt.description.slice(0, 200)}
                        {evt.description.length > 200 ? '…' : ''}
                      </div>
                    )}
                    {commitUrl && (
                      <a href={commitUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: 'var(--link)' }}>
                        {sha?.slice(0, 7)} →
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Work Order Viewer - automotive receipts (only when day has work-order/vehicle events) */}
      {selectedWorkOrder && organization && !selectedDayCommits && (
        <WorkOrderViewer
          event={selectedWorkOrder}
          organizationName={organization.business_name}
          laborRate={organization.labor_rate}
          onClose={() => setSelectedWorkOrder(null)}
          onNavigateEvent={(newEvent) => {
            setSelectedWorkOrder(newEvent);
          }}
        />
      )}
    </div>
  );
};

export default OrganizationTimelineHeatmap;
