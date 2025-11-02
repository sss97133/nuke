import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface TimelineEvent {
  id: string;
  event_type: string;
  event_date: string;
  title: string;
  description?: string;
  cost_amount?: number;
  metadata?: any;
  photo_count?: number;
}

interface DocumentTimelineViewProps {
  vehicleId: string;
}

/**
 * Document-First Timeline View
 * 
 * Shows timeline events prioritizing DOCUMENTATION over photo counts:
 * - Invoices/Receipts (with amounts)
 * - Work Sessions
 * - Service Records
 * - Photo documentation (grouped, not individual)
 * 
 * Aligned with the architecture: Documents define value, photos are supporting evidence.
 */
export const DocumentTimelineView: React.FC<DocumentTimelineViewProps> = ({ vehicleId }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTimeline();
  }, [vehicleId]);

  const loadTimeline = async () => {
    try {
      setLoading(true);

      // Load timeline events (this is a VIEW that aggregates data)
      const { data: timelineData, error } = await supabase
        .from('timeline_events')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });

      if (error) {
        console.error('Timeline load error:', error);
        setEvents([]);
        return;
      }

      setEvents(timelineData || []);
    } catch (err) {
      console.error('Timeline error:', err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'document_upload':
      case 'invoice':
      case 'receipt':
        return '📄';
      case 'work_session':
        return '🔧';
      case 'service_record':
        return '⚙️';
      case 'photo_documentation':
        return '📸';
      case 'purchase':
        return '💰';
      default:
        return '📝';
    }
  };

  const getPriorityScore = (event: TimelineEvent): number => {
    // Higher score = higher priority
    if (event.event_type === 'invoice' || event.event_type === 'receipt') return 100;
    if (event.event_type === 'document_upload' && event.cost_amount) return 90;
    if (event.event_type === 'work_session') return 80;
    if (event.event_type === 'service_record') return 70;
    if (event.event_type === 'purchase') return 95;
    if (event.event_type === 'photo_documentation') return 30; // Photos are lowest priority
    return 50;
  };

  if (loading) {
    return (
      <div style={styles.loading}>
        Loading timeline...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div style={styles.empty}>
        <h3>No Timeline Events</h3>
        <p style={{ color: '#666', fontSize: '9pt', marginTop: '8px' }}>
          Upload documents and invoices to build your vehicle's history.
        </p>
      </div>
    );
  }

  // Sort by priority (documents first), then by date
  const sortedEvents = [...events].sort((a, b) => {
    const priorityDiff = getPriorityScore(b) - getPriorityScore(a);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.event_date).getTime() - new Date(a.event_date).getTime();
  });

  return (
    <div style={styles.container}>
      {sortedEvents.map((event) => {
        const hasValue = event.cost_amount && event.cost_amount > 0;
        const isHighPriority = getPriorityScore(event) >= 70;

        return (
          <div 
            key={event.id} 
            style={{
              ...styles.eventCard,
              ...(isHighPriority ? styles.highPriorityCard : {})
            }}
          >
            {/* Event Header */}
            <div style={styles.eventHeader}>
              <div style={styles.eventIcon}>{getEventIcon(event.event_type)}</div>
              <div style={styles.eventMeta}>
                <div style={styles.eventTitle}>{event.title}</div>
                <div style={styles.eventDate}>{formatDate(event.event_date)}</div>
              </div>
              {hasValue && (
                <div style={styles.eventValue}>
                  {formatCurrency(event.cost_amount)}
                </div>
              )}
            </div>

            {/* Event Description */}
            {event.description && (
              <div style={styles.eventDescription}>
                {event.description}
              </div>
            )}

            {/* Photo Count (if any) */}
            {event.photo_count && event.photo_count > 0 && (
              <div style={styles.photoCount}>
                {event.photo_count} photo{event.photo_count > 1 ? 's' : ''} attached
              </div>
            )}

            {/* Priority Badge */}
            {isHighPriority && (
              <div style={styles.priorityBadge}>
                {event.event_type === 'invoice' || event.event_type === 'receipt' ? 'Value Documentation' : 'Work Documented'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const styles = {
  container: {
    padding: '12px',
    background: '#f8f9fa',
    minHeight: '100vh'
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
  eventCard: {
    background: '#fff',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '12px',
    transition: 'all 0.2s ease'
  },
  highPriorityCard: {
    border: '2px solid #0066cc',
    boxShadow: '0 2px 8px rgba(0, 102, 204, 0.1)'
  },
  eventHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '8px'
  },
  eventIcon: {
    fontSize: '20pt',
    lineHeight: 1,
    flexShrink: 0
  },
  eventMeta: {
    flex: 1,
    minWidth: 0
  },
  eventTitle: {
    fontSize: '11pt',
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: '4px',
    lineHeight: 1.3
  },
  eventDate: {
    fontSize: '8pt',
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px'
  },
  eventValue: {
    fontSize: '13pt',
    fontWeight: 'bold',
    color: '#10b981',
    flexShrink: 0
  },
  eventDescription: {
    fontSize: '9pt',
    color: '#555',
    lineHeight: 1.5,
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid #e5e7eb'
  },
  photoCount: {
    fontSize: '8pt',
    color: '#888',
    marginTop: '8px',
    fontStyle: 'italic' as const
  },
  priorityBadge: {
    display: 'inline-block',
    marginTop: '8px',
    padding: '4px 8px',
    background: '#0066cc',
    color: '#fff',
    fontSize: '7pt',
    fontWeight: 'bold',
    textTransform: 'uppercase' as const,
    borderRadius: '4px',
    letterSpacing: '0.5px'
  }
};

