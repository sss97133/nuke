import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import OrganizationTimelineHeatmap from './OrganizationTimelineHeatmap';

interface TimelineEvent {
  id: string;
  business_id: string;
  event_type: string;
  title: string;
  event_date: string;
  labor_hours?: number;
  created_by?: string;
  created_at: string;
  vehicle_id?: string;
}

interface Props {
  organizationId: string;
  userId: string | null;
}

type FilterType = 'all' | 'service' | 'image_upload' | 'work_order' | 'vehicle_status';

const OrganizationTimelineTab: React.FC<Props> = ({ organizationId, userId }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    loadEvents();
  }, [organizationId]);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('business_timeline_events')
        .select(`
          id,
          business_id,
          event_type,
          title,
          event_date,
          labor_hours,
          created_by,
          created_at,
          vehicle_id
        `)
        .eq('business_id', organizationId)
        .order('event_date', { ascending: false })
        .limit(200);

      if (error) throw error;
      setEvents(data || []);
    } catch (error) {
      console.error('Failed to load timeline events:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = events.filter(e => {
    if (filter === 'all') return true;
    return e.event_type === filter;
  });

  const eventCounts = {
    all: events.length,
    service: events.filter(e => e.event_type === 'service').length,
    image_upload: events.filter(e => e.event_type === 'image_upload').length,
    work_order: events.filter(e => e.event_type === 'work_order').length,
    vehicle_status: events.filter(e => e.event_type === 'vehicle_status').length
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontSize: '9pt', color: 'var(--text-muted)' }}>
        Loading timeline...
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      {/* Heatmap Calendar */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
          Activity Calendar
        </div>
        <div className="card-body">
          <OrganizationTimelineHeatmap
            organizationId={organizationId}
            onDateClick={(date) => setSelectedDate(date)}
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '16px',
        flexWrap: 'wrap'
      }}>
        {(['all', 'service', 'image_upload', 'work_order', 'vehicle_status'] as FilterType[]).map(f => (
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
              borderRadius: '4px'
            }}
          >
            {f === 'all' ? 'All' : f.replace('_', ' ').toUpperCase()} ({eventCounts[f]})
          </button>
        ))}
      </div>

      {/* Events List */}
      {filteredEvents.length === 0 ? (
        <div className="card">
          <div className="card-body" style={{
            textAlign: 'center',
            padding: '40px',
            color: 'var(--text-muted)',
            fontSize: '9pt'
          }}>
            No events found
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredEvents.map(event => (
            <div key={event.id} className="card">
              <div className="card-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
                  {/* Event Details */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                      {event.title}
                    </div>
                    
                    <div style={{
                      fontSize: '7pt',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}>
                      <span>{new Date(event.event_date).toLocaleDateString()}</span>
                      
                      {event.labor_hours && event.labor_hours > 0 && (
                        <span>{event.labor_hours} hrs</span>
                      )}
                    </div>
                  </div>

                  {/* Event Type Badge */}
                  <div style={{
                    padding: '4px 8px',
                    background: 'var(--grey-100)',
                    fontSize: '7pt',
                    fontWeight: 700,
                    borderRadius: '3px',
                    height: 'fit-content',
                    textTransform: 'uppercase'
                  }}>
                    {event.event_type.replace('_', ' ')}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OrganizationTimelineTab;

