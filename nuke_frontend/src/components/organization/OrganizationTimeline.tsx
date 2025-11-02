import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface TimelineEvent {
  id: string;
  business_id: string;
  event_type: string;
  event_category?: string;
  title: string;
  description?: string;
  event_date: string;
  cost_amount?: number;
  labor_hours?: number;
  image_urls?: string[];
  created_by: string;
  metadata?: any;
  profiles?: {
    full_name?: string;
    username?: string;
    avatar_url?: string;
  };
}

interface OrganizationTimelineProps {
  organizationId: string;
  isOwner: boolean;
}

export const OrganizationTimeline: React.FC<OrganizationTimelineProps> = ({ organizationId, isOwner }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupedEvents, setGroupedEvents] = useState<{ [key: string]: TimelineEvent[] }>({});

  useEffect(() => {
    loadEvents();
  }, [organizationId]);

  const loadEvents = async () => {
    try {
      setLoading(true);

      const { data: eventsData, error } = await supabase
        .from('business_timeline_events')
        .select('*')
        .eq('business_id', organizationId)
        .order('event_date', { ascending: false });

      if (error) throw error;

      // Enrich with user profiles
      const enriched = await Promise.all(
        (eventsData || []).map(async (e: any) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, username, avatar_url')
            .eq('id', e.created_by)
            .maybeSingle();

          return { ...e, profiles: profile };
        })
      );

      setEvents(enriched);

      // Group by date for vertical timeline
      const grouped: { [key: string]: TimelineEvent[] } = {};
      enriched.forEach(event => {
        const date = event.event_date;
        if (!grouped[date]) {
          grouped[date] = [];
        }
        grouped[date].push(event);
      });
      setGroupedEvents(grouped);

    } catch (error: any) {
      console.error('Error loading organization timeline:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading timeline...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '9pt' }}>
        No work orders or events yet. Upload images or add data to create timeline entries.
      </div>
    );
  }

  const sortedDates = Object.keys(groupedEvents).sort((a, b) => 
    new Date(b).getTime() - new Date(a).getTime()
  );

  return (
    <div style={{ position: 'relative' }}>
      {/* Vertical timeline line */}
      <div style={{
        position: 'absolute',
        left: '20px',
        top: '0',
        bottom: '0',
        width: '2px',
        background: 'var(--border)',
        zIndex: 0
      }} />

      {/* Timeline events */}
      {sortedDates.map((date, dateIdx) => (
        <div key={date} style={{ marginBottom: '24px', position: 'relative' }}>
          {/* Date marker */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '12px'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'var(--accent)',
              border: '3px solid var(--white)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '8pt',
              fontWeight: 700,
              color: '#fff',
              position: 'relative',
              zIndex: 1,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}>
              {new Date(date).getDate()}
            </div>
            <div style={{ fontSize: '10pt', fontWeight: 600, color: 'var(--text)' }}>
              {new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </div>
            {groupedEvents[date].length > 1 && (
              <div style={{
                fontSize: '7pt',
                padding: '2px 6px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '2px',
                color: 'var(--text-muted)'
              }}>
                {groupedEvents[date].length} events
              </div>
            )}
          </div>

          {/* Events for this date */}
          {groupedEvents[date].map((event, eventIdx) => (
            <div
              key={event.id}
              style={{
                marginLeft: '60px',
                marginBottom: '16px',
                padding: '12px',
                background: 'var(--white)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                transition: '0.12s'
              }}
              className="hover-lift"
            >
              {/* Event header */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                  {event.title}
                </div>
                {event.description && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {event.description}
                  </div>
                )}
              </div>

              {/* Event metadata badges */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: event.image_urls?.length ? '10px' : '0' }}>
                <div style={{
                  fontSize: '7pt',
                  padding: '2px 6px',
                  borderRadius: '2px',
                  background: 'var(--accent-dim)',
                  color: 'var(--accent)',
                  fontWeight: 600,
                  textTransform: 'uppercase'
                }}>
                  {event.event_type?.replace(/_/g, ' ')}
                </div>

                {event.profiles && (
                  <div style={{
                    fontSize: '7pt',
                    padding: '2px 6px',
                    borderRadius: '2px',
                    background: 'var(--surface)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)'
                  }}>
                    by {event.profiles.full_name || event.profiles.username || 'User'}
                  </div>
                )}

                {event.cost_amount && (
                  <div style={{
                    fontSize: '7pt',
                    padding: '2px 6px',
                    borderRadius: '2px',
                    background: '#d4edda',
                    color: '#155724',
                    fontWeight: 600
                  }}>
                    ${event.cost_amount.toLocaleString()}
                  </div>
                )}

                {event.labor_hours && (
                  <div style={{
                    fontSize: '7pt',
                    padding: '2px 6px',
                    borderRadius: '2px',
                    background: '#d1ecf1',
                    color: '#0c5460'
                  }}>
                    {event.labor_hours}h
                  </div>
                )}
              </div>

              {/* Event images */}
              {event.image_urls && event.image_urls.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {event.image_urls.slice(0, 5).map((url, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: '80px',
                        height: '80px',
                        backgroundImage: `url(${url})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        borderRadius: '2px',
                        border: '1px solid var(--border)',
                        cursor: 'pointer'
                      }}
                      onClick={() => window.open(url, '_blank')}
                    />
                  ))}
                  {event.image_urls.length > 5 && (
                    <div style={{
                      width: '80px',
                      height: '80px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: '2px',
                      fontSize: '9pt',
                      color: 'var(--text-muted)',
                      fontWeight: 600
                    }}>
                      +{event.image_urls.length - 5}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default OrganizationTimeline;

