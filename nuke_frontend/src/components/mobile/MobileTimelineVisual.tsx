/**
 * Mobile Timeline Visual - Redesigned for vertical viewing
 * Instagram-story-style vertical timeline with large touchable cards
 * Photo previews and smooth swipe gestures
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import { UserInteractionService } from '../../services/userInteractionService';

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
  cost_amount?: number;
}

interface MonthData {
  month: string; // YYYY-MM
  monthName: string; // "January 2024"
  events: TimelineEvent[];
  imageCount: number;
  duration_hours: number;
  firstImage?: string;
}

interface MobileTimelineVisualProps {
  vehicleId: string;
}

export const MobileTimelineVisual: React.FC<MobileTimelineVisualProps> = ({ vehicleId }) => {
  const [months, setMonths] = useState<MonthData[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<MonthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
    });
  }, []);

  useEffect(() => {
    if (vehicleId) {
      loadTimelineData();
    }
  }, [vehicleId]);

  const loadTimelineData = async () => {
    try {
      setLoading(true);

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
          cost_amount
        `)
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });

      if (error) throw error;

      // Transform to images array format
      const eventsWithImages = events?.map(event => ({
        ...event,
        images: (event.image_urls || []).map((url, idx) => ({
          image_url: url,
          id: `${event.id}-img-${idx}`
        }))
      })) || [];

      // Group by month
      const monthMap = new Map<string, MonthData>();

      eventsWithImages.forEach(event => {
        const date = new Date(event.event_date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        if (!monthMap.has(monthKey)) {
          monthMap.set(monthKey, {
            month: monthKey,
            monthName,
            events: [],
            imageCount: 0,
            duration_hours: 0,
            firstImage: undefined
          });
        }

        const monthData = monthMap.get(monthKey)!;
        monthData.events.push(event as TimelineEvent);
        monthData.imageCount += event.images?.length || 0;
        monthData.duration_hours += event.duration_hours || 0;
        
        if (!monthData.firstImage && event.images && event.images.length > 0) {
          monthData.firstImage = event.images[0].image_url;
        }
      });

      setMonths(Array.from(monthMap.values()));
    } catch (error) {
      console.error('Error loading timeline data:', error);
      setMonths([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.loading}>
        <div>Loading timeline...</div>
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', marginBottom: '8px' }}>
          No Timeline Events
        </div>
        <div style={{ fontSize: '9pt', color: '#666' }}>
          Start adding photos and events to build your vehicle's story!
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={scrollContainerRef} style={styles.container}>
        {months.map((month, idx) => (
          <div
            key={month.month}
            style={styles.monthCard}
            onClick={() => {
              setSelectedMonth(month);
              // Track timeline interaction
              if (session?.user) {
                UserInteractionService.logInteraction(
                  session.user.id,
                  'view',
                  'event',
                  month.month,
                  {
                    vehicle_id: vehicleId,
                    source_page: '/vehicle/timeline',
                    device_type: 'mobile',
                    gesture_type: 'tap',
                    event_count: month.events.length,
                    image_count: month.imageCount
                  }
                );
              }
            }}
          >
            {/* Month Image Preview */}
            {month.firstImage ? (
              <div
                style={{
                  ...styles.monthImage,
                  backgroundImage: `linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.6)), url(${month.firstImage})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              />
            ) : (
              <div style={{
                ...styles.monthImage,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '14pt',
                fontWeight: 'bold'
              }}>
                {month.monthName.split(' ')[0].substring(0, 3).toUpperCase()}
              </div>
            )}

            {/* Month Info Overlay */}
            <div style={styles.monthInfo}>
              <div style={styles.monthTitle}>{month.monthName}</div>
              <div style={styles.monthStats}>
                <span>{month.events.length} events</span>
                {month.imageCount > 0 && <span> · {month.imageCount} photos</span>}
                {month.duration_hours > 0 && <span> · {month.duration_hours.toFixed(1)}h</span>}
              </div>
            </div>

            {/* Event Count Badge */}
            <div style={styles.eventBadge}>
              {month.events.length}
            </div>
          </div>
        ))}
      </div>

      {/* Month Detail Modal */}
      {selectedMonth && ReactDOM.createPortal(
        <div style={styles.modalOverlay} onClick={() => setSelectedMonth(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{selectedMonth.monthName}</h3>
              <button style={styles.closeButton} onClick={() => setSelectedMonth(null)}>×</button>
            </div>

            {/* Modal Content - Scrollable Events */}
            <div style={styles.modalContent}>
              {selectedMonth.events.map(event => (
                <div key={event.id} style={styles.eventCard}>
                  {/* Event Header */}
                  <div style={styles.eventHeader}>
                    <div style={styles.eventTitle}>{event.title}</div>
                    <div style={styles.eventDate}>
                      {new Date(event.event_date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </div>
                  </div>

                  {/* Event Images - Horizontal Scroll */}
                  {event.images && event.images.length > 0 && (
                    <div style={styles.imageScroll}>
                      {event.images.map(img => (
                        <img
                          key={img.id}
                          src={img.image_url}
                          alt=""
                          style={styles.eventImage}
                          loading="lazy"
                        />
                      ))}
                    </div>
                  )}

                  {/* Event Description */}
                  {event.description && (
                    <div style={styles.eventDescription}>{event.description}</div>
                  )}

                  {/* Event Meta */}
                  <div style={styles.eventMeta}>
                    <span style={styles.typeBadge}>{event.event_type}</span>
                    {event.duration_hours && event.duration_hours > 0 && (
                      <span style={styles.metaBadge}>{event.duration_hours}h</span>
                    )}
                    {event.cost_amount && event.cost_amount > 0 && (
                      <span style={styles.costBadge}>${event.cost_amount.toLocaleString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
    padding: '12px',
    background: '#f8f9fa',
    overflowY: 'auto' as const,
    maxHeight: '80vh'
  },
  loading: {
    textAlign: 'center' as const,
    padding: '48px 24px',
    color: '#888',
    fontSize: '10pt'
  },
  empty: {
    textAlign: 'center' as const,
    padding: '48px 24px',
    background: '#fff',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    margin: '12px'
  },
  monthCard: {
    position: 'relative' as const,
    height: '200px',
    borderRadius: '12px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    touchAction: 'manipulation'
  },
  monthImage: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
  },
  monthInfo: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    padding: '16px',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
    color: '#fff'
  },
  monthTitle: {
    fontSize: '16pt',
    fontWeight: 'bold',
    marginBottom: '4px',
    textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
  },
  monthStats: {
    fontSize: '9pt',
    opacity: 0.9,
    textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
  },
  eventBadge: {
    position: 'absolute' as const,
    top: '12px',
    right: '12px',
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(8px)',
    color: '#fff',
    width: '36px',
    height: '36px',
    borderRadius: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12pt',
    fontWeight: 'bold',
    border: '2px solid rgba(255, 255, 255, 0.3)'
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 999999,
    animation: 'fadeIn 0.2s'
  },
  modal: {
    background: '#ffffff',
    borderRadius: '16px 16px 0 0',
    width: '100%',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column' as const,
    animation: 'slideUp 0.3s'
  },
  modalHeader: {
    padding: '16px',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#fff',
    borderRadius: '16px 16px 0 0'
  },
  modalTitle: {
    margin: 0,
    fontSize: '14pt',
    fontWeight: 'bold',
    color: '#111'
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: '#666',
    width: '32px',
    height: '32px',
    cursor: 'pointer',
    fontSize: '24pt',
    lineHeight: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalContent: {
    padding: '16px',
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px'
  },
  eventCard: {
    background: '#f8f9fa',
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid #e5e7eb'
  },
  eventHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px'
  },
  eventTitle: {
    fontSize: '11pt',
    fontWeight: 'bold',
    color: '#111',
    flex: 1
  },
  eventDate: {
    fontSize: '9pt',
    color: '#666',
    fontWeight: '500'
  },
  imageScroll: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto' as const,
    marginBottom: '12px',
    scrollSnapType: 'x mandatory',
    WebkitOverflowScrolling: 'touch' as any,
    paddingBottom: '4px'
  },
  eventImage: {
    width: '120px',
    height: '120px',
    objectFit: 'cover' as const,
    borderRadius: '8px',
    flexShrink: 0,
    scrollSnapAlign: 'start',
    cursor: 'pointer',
    border: '1px solid #e5e7eb'
  },
  eventDescription: {
    fontSize: '9pt',
    color: '#444',
    marginBottom: '12px',
    lineHeight: '1.4'
  },
  eventMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
    fontSize: '9pt'
  },
  typeBadge: {
    background: '#3b82f6',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: '4px',
    fontWeight: '500'
  },
  metaBadge: {
    background: '#8b5cf6',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: '4px',
    fontWeight: '500'
  },
  costBadge: {
    background: '#10b981',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: '4px',
    fontWeight: 'bold',
    fontFamily: 'monospace'
  }
};

