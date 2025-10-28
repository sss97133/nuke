/**
 * Mobile Timeline Heatmap - Windows 95 Style
 * GitHub-style year heatmap showing vehicle work activity
 * Expandable years with clickable day cells showing event images
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface TimelineEvent {
  id: string;
  vehicle_id: string;
  title: string;
  description?: string;
  event_type: string;
  event_date: string;
  image_urls?: string[];
  images?: { image_url: string; id: string }[];
  metadata?: any;
  duration_hours?: number;
  participant_count?: number;
  verification_count?: number;
  service_info?: any;
}

interface DayData {
  date: string;
  events: TimelineEvent[];
  eventCount: number;
  imageCount: number;
  durationHours: number;
}

interface YearData {
  year: number;
  eventCount: number;
  totalImages: number;
  totalDurationHours: number;
  days: Map<string, DayData>;
}

interface MobileTimelineHeatmapProps {
  vehicleId: string;
}

export const MobileTimelineHeatmap: React.FC<MobileTimelineHeatmapProps> = ({ vehicleId }) => {
  const [yearData, setYearData] = useState<Map<number, YearData>>(new Map());
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([new Date().getFullYear()]));
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (vehicleId) {
      loadTimelineData();
    }
  }, [vehicleId]);

  const loadTimelineData = async () => {
    try {
      setLoading(true);
      console.log('[MobileTimelineHeatmap] ===== LOADING TIMELINE DATA =====');
      console.log('[MobileTimelineHeatmap] Vehicle ID:', vehicleId);
      console.log('[MobileTimelineHeatmap] Vehicle ID type:', typeof vehicleId);

      // Load all timeline events with image_urls array from enriched view
      // vehicle_timeline_events is a VIEW that includes participant_count, verification_count, and service_info
      const { data: events, error } = await supabase
        .from('vehicle_timeline_events')
        .select(`
          id,
          vehicle_id,
          title,
          description,
          event_type,
          event_date,
          image_urls,
          metadata,
          duration_hours,
          participant_count,
          verification_count,
          service_info
        `)
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });

      if (error) {
        console.error('[MobileTimelineHeatmap] ❌ QUERY ERROR:', error);
        console.error('[MobileTimelineHeatmap] Error details:', JSON.stringify(error, null, 2));
        throw error;
      }

      console.log('[MobileTimelineHeatmap] ✅ Query successful');
      console.log('[MobileTimelineHeatmap] Events loaded:', events?.length || 0);
      console.log('[MobileTimelineHeatmap] First event sample:', events?.[0]);

      // Transform image_urls array into images array format
      const eventsWithImages = events?.map(event => ({
        ...event,
        images: (event.image_urls || []).map((url, idx) => ({
          image_url: url,
          id: `${event.id}-img-${idx}` // Generate temp ID for rendering
        }))
      })) || [];

      // Group events by year and day
      const grouped = new Map<number, YearData>();

      eventsWithImages.forEach((event) => {
        const date = new Date(event.event_date);
        const year = date.getFullYear();
        const dateStr = date.toISOString().split('T')[0];

        if (!grouped.has(year)) {
          grouped.set(year, {
            year,
            eventCount: 0,
            totalImages: 0,
            totalDurationHours: 0,
            days: new Map()
          });
        }

        const yearData = grouped.get(year)!;
        yearData.eventCount++;
        yearData.totalImages += event.images?.length || 0;
        yearData.totalDurationHours += event.duration_hours || 0;

        if (!yearData.days.has(dateStr)) {
          yearData.days.set(dateStr, {
            date: dateStr,
            events: [],
            eventCount: 0,
            imageCount: 0,
            durationHours: 0
          });
        }

        const dayData = yearData.days.get(dateStr)!;
        dayData.events.push(event as TimelineEvent);
        dayData.eventCount++;
        dayData.imageCount += event.images?.length || 0;
        dayData.durationHours += event.duration_hours || 0;
      });

      console.log('[MobileTimelineHeatmap] Grouped into years:', Array.from(grouped.keys()));
      setYearData(grouped);
    } catch (error) {
      console.error('[MobileTimelineHeatmap] Error loading timeline data:', error);
      // Set empty data on error so UI doesn't stay in loading state
      setYearData(new Map());
    } finally {
      setLoading(false);
    }
  };

  const toggleYear = (year: number) => {
    const newExpanded = new Set(expandedYears);
    if (newExpanded.has(year)) {
      newExpanded.delete(year);
    } else {
      newExpanded.add(year);
    }
    setExpandedYears(newExpanded);
  };

  const getDayColor = (dayData?: DayData): string => {
    if (!dayData || dayData.events.length === 0) {
      return '#ebedf0'; // No work - light gray
    }

    // Use duration_hours if available for more accurate work intensity
    const hours = dayData.durationHours;
    if (hours > 0) {
      if (hours < 2) return '#d9f99d'; // < 2 hours - light green
      if (hours < 4) return '#a7f3d0'; // 2-4 hours - light mint
      if (hours <= 8) return '#34d399'; // 4-8 hours - green
      if (hours <= 12) return '#10b981'; // 8-12 hours - emerald
      return '#059669'; // 12+ hours - dark green
    }

    // Fallback to event count if no duration data
    const count = dayData.eventCount;
    if (count === 1) return '#d9f99d'; // 1 event - light green
    if (count === 2) return '#a7f3d0'; // 2 events - light mint
    if (count <= 5) return '#34d399'; // 3-5 events - green
    if (count <= 10) return '#10b981'; // 6-10 events - emerald
    return '#059669'; // 10+ events - dark green
  };

  const generateYearCalendar = (year: number) => {
    const yearInfo = yearData.get(year);
    if (!yearInfo) return null;

    // Generate all weeks of the year (52-53 weeks, 7 days each)
    const firstDay = new Date(year, 0, 1);
    const lastDay = new Date(year, 11, 31);
    
    // Adjust to start on Monday
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - ((startDate.getDay() + 6) % 7));

    const weeks: DayData[][] = [];
    let currentWeek: DayData[] = [];
    let currentDate = new Date(startDate);

    // Safety limit to prevent infinite loops
    let maxIterations = 400; // 53 weeks * 7 days = 371 max
    while ((currentDate <= lastDay || currentWeek.length < 7) && maxIterations > 0) {
      maxIterations--;
      
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayData = yearInfo.days.get(dateStr);
      const isCurrentYear = currentDate.getFullYear() === year;

      currentWeek.push(dayData || {
        date: dateStr,
        events: [],
        eventCount: 0,
        imageCount: 0,
        durationHours: 0
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }

      currentDate.setDate(currentDate.getDate() + 1);
      
      // Break if we've gone way past the year
      if (currentDate.getFullYear() > year + 1) {
        console.warn('[MobileTimelineHeatmap] Breaking calendar generation - went past year boundary');
        break;
      }
    }
    
    if (maxIterations === 0) {
      console.error('[MobileTimelineHeatmap] ⚠️  Calendar generation hit safety limit!');
    }

    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return weeks;
  };

  const formatTitle = (dayData: DayData): string => {
    const date = new Date(dayData.date);
    const formatted = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
    
    if (dayData.events.length === 0) return `${formatted}: No events`;
    
    let title = `${formatted}: ${dayData.events.length} events`;
    if (dayData.durationHours > 0) {
      title += ` • ${dayData.durationHours.toFixed(1)}h`;
    }
    if (dayData.imageCount > 0) {
      title += ` • ${dayData.imageCount} images`;
    }
    return title;
  };

  const years = Array.from(yearData.keys()).sort((a, b) => b - a);

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={{ marginBottom: '8px' }}>Loading timeline...</div>
        <div style={{ fontSize: '10px', color: '#666' }}>Vehicle ID: {vehicleId}</div>
      </div>
    );
  }

  if (years.length === 0) {
    return (
      <div style={styles.loading}>
        <div style={{ marginBottom: '12px', fontWeight: 'bold' }}>No Timeline Events Found</div>
        <div style={{ fontSize: '11px', marginBottom: '8px' }}>
          This vehicle doesn't have any timeline events yet.
        </div>
        <div style={{ fontSize: '10px', color: '#666' }}>
          Add photos or events to start building your vehicle's history!
        </div>
        <div style={{ fontSize: '9px', color: '#999', marginTop: '12px' }}>
          Debug: Vehicle ID = {vehicleId}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {years.map(year => {
        const yearInfo = yearData.get(year)!;
        const isExpanded = expandedYears.has(year);
        const weeks = isExpanded ? generateYearCalendar(year) : null;

        return (
          <div key={year} style={styles.yearSection}>
            {/* Year Header - Clickable to expand/collapse */}
            <div
              onClick={() => toggleYear(year)}
              style={styles.yearHeader}
            >
              <span>
                {year} ({yearInfo.eventCount} events
                {yearInfo.totalDurationHours > 0 ? `, ${yearInfo.totalDurationHours.toFixed(1)}h` : ''}
                {yearInfo.totalImages > 0 ? `, ${yearInfo.totalImages} images` : ''})
              </span>
              <span style={styles.expandIcon}>{isExpanded ? '−' : '+'}</span>
            </div>

            {/* Year Heatmap - GitHub style */}
            {isExpanded && weeks && (
              <div style={styles.heatmapContainer}>
                {/* Month labels */}
                <div style={styles.monthLabels}>
                  <div style={{ gridColumn: '1 / 2' }}></div>
                  {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, idx) => (
                    <div
                      key={month}
                      style={{
                        gridColumn: `${2 + idx * 4} / span 4`,
                        textAlign: 'center',
                        fontSize: '8pt',
                        color: '#888',
                        lineHeight: '8px'
                      }}
                    >
                      {month}
                    </div>
                  ))}
                </div>

                <div style={styles.calendarGrid}>
                  {/* Day labels */}
                  <div style={styles.dayLabels}>
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, idx) => (
                      <div key={idx} style={styles.dayLabel}>{day}</div>
                    ))}
                  </div>

                  {/* Week columns */}
                  <div style={styles.weeksGrid}>
                    {weeks.map((week, weekIdx) => (
                      <div key={weekIdx} style={styles.weekColumn}>
                        {week.map((dayData, dayIdx) => {
                          const hasEvents = dayData.events.length > 0;
                          const color = getDayColor(hasEvents ? dayData : undefined);
                          const date = new Date(dayData.date);
                          const isCurrentYear = date.getFullYear() === year;

                          return (
                            <div
                              key={dayIdx}
                              title={formatTitle(dayData)}
                              onClick={() => hasEvents ? setSelectedDay(dayData) : null}
                              style={{
                                ...styles.dayCell,
                                backgroundColor: color,
                                cursor: hasEvents ? 'pointer' : 'default',
                                opacity: isCurrentYear ? 1 : 0.3,
                                border: hasEvents ? '1px solid rgba(0,0,0,0.1)' : 'none'
                              }}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Day Detail Modal - USING PORTAL TO ESCAPE PARENT CONTAINER */}
      {selectedDay && ReactDOM.createPortal(
        <div style={styles.modalOverlay} onClick={() => setSelectedDay(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                {new Date(selectedDay.date).toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </h3>
              <button style={styles.closeButton} onClick={() => setSelectedDay(null)}>×</button>
            </div>

            <div style={styles.modalContent}>
              {selectedDay.events.map(event => (
                <div key={event.id} style={styles.eventCard}>
                  <div style={styles.eventTitle}>{event.title}</div>
                  {event.description && (
                    <div style={styles.eventDescription}>{event.description}</div>
                  )}
                  
                  {/* Event Images - Clickable thumbnails */}
                  {event.images && event.images.length > 0 && (
                    <div style={styles.imageGrid}>
                      {event.images.map(img => (
                        <img
                          key={img.id}
                          src={img.image_url}
                          alt=""
                          style={styles.thumbnail}
                          loading="lazy"
                          onClick={() => window.open(img.image_url, '_blank')}
                        />
                      ))}
                    </div>
                  )}

                  <div style={styles.eventMeta}>
                    <span style={styles.eventType}>{event.event_type}</span>
                    {event.duration_hours && event.duration_hours > 0 && (
                      <span style={styles.durationBadge}>{event.duration_hours.toFixed(1)}h</span>
                    )}
                    {event.images && event.images.length > 0 && (
                      <span style={styles.imageCount}>{event.images.length} 📷</span>
                    )}
                    {event.participant_count && event.participant_count > 0 && (
                      <span style={styles.participantBadge}>{event.participant_count} 👤</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    padding: '8px',
    background: '#ffffff'
  },
  loading: {
    textAlign: 'center' as const,
    padding: '24px',
    color: '#888',
    fontSize: '12px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  yearSection: {
    marginBottom: '4px'
  },
  yearHeader: {
    background: '#000080',
    color: '#ffffff',
    padding: '12px',
    border: '2px outset #ffffff',
    marginBottom: '4px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  expandIcon: {
    fontSize: '18px',
    lineHeight: '1'
  },
  heatmapContainer: {
    background: '#c0c0c0',
    border: '2px inset #808080',
    padding: '8px',
    marginBottom: '8px'
  },
  monthLabels: {
    display: 'grid',
    gridTemplateColumns: '20px repeat(53, 8px)',
    gap: '1px',
    justifyContent: 'start',
    marginBottom: '2px'
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: '20px auto',
    gap: '1px'
  },
  dayLabels: {
    display: 'grid',
    gridTemplateRows: 'repeat(7, 8px)',
    gap: '1px'
  },
  dayLabel: {
    textAlign: 'center' as const,
    fontSize: '7pt',
    color: '#888',
    lineHeight: '8px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  weeksGrid: {
    display: 'grid',
    gridTemplateRows: 'repeat(7, 8px)',
    gridTemplateColumns: 'repeat(53, 8px)',
    gap: '1px',
    justifyContent: 'start',
    overflowX: 'auto' as const // Allow horizontal scroll if still needed
  },
  weekColumn: {
    display: 'contents'
  },
  dayCell: {
    width: '8px',
    height: '8px',
    borderRadius: '1px',
    transition: 'all 0.2s'
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999999,
    padding: '16px'
  },
  modal: {
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  modalHeader: {
    background: '#000080',
    color: '#ffffff',
    padding: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '2px solid #ffffff'
  },
  modalTitle: {
    margin: 0,
    fontSize: '12px',
    fontWeight: 'bold' as const
  },
  closeButton: {
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    color: '#000',
    width: '24px',
    height: '24px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold' as const,
    lineHeight: '1',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  modalContent: {
    padding: '12px',
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px'
  },
  eventCard: {
    background: '#ffffff',
    border: '2px inset #808080',
    padding: '8px'
  },
  eventTitle: {
    fontSize: '13px',
    fontWeight: 'bold' as const,
    marginBottom: '4px',
    color: '#000'
  },
  eventDescription: {
    fontSize: '11px',
    color: '#000',
    marginBottom: '8px'
  },
  imageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
    gap: '4px',
    marginBottom: '8px'
  },
  thumbnail: {
    width: '100%',
    height: '60px',
    objectFit: 'cover' as const,
    border: '1px solid #808080',
    cursor: 'pointer'
  },
  eventMeta: {
    display: 'flex',
    gap: '8px',
    fontSize: '10px',
    color: '#000'
  },
  eventType: {
    background: '#000080',
    color: '#ffffff',
    padding: '2px 6px',
    borderRadius: '2px'
  },
  imageCount: {
    background: '#008000',
    color: '#ffffff',
    padding: '2px 6px',
    borderRadius: '2px'
  },
  durationBadge: {
    background: '#800080',
    color: '#ffffff',
    padding: '2px 6px',
    borderRadius: '2px'
  },
  participantBadge: {
    background: '#808000',
    color: '#ffffff',
    padding: '2px 6px',
    borderRadius: '2px'
  }
};

