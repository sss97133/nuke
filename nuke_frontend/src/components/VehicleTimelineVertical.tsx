import React from 'react';

interface TimelineEvent {
  id: string;
  title: string;
  event_type: 'purchase' | 'repair' | 'modification' | 'inspection' | 'sale' | 'maintenance' | string;
  event_date: string;
  description?: string;
  cost_amount?: number;
  mileage_at_event?: number;
  created_by?: string;
  image_urls?: string[];
}

const eventTypeStyles: Record<string, { icon: string; color: string; label: string }> = {
  purchase: { icon: '💰', color: '#2da44e', label: 'Purchase' },
  repair: { icon: '🔧', color: '#6e40aa', label: 'Repair' },
  modification: { icon: '⚙️', color: '#0969da', label: 'Modification' },
  inspection: { icon: '🔍', color: '#fb8500', label: 'Inspection' },
  sale: { icon: '📤', color: '#d1242f', label: 'Sale' },
  maintenance: { icon: '✅', color: '#1f883d', label: 'Maintenance' },
  general: { icon: '📝', color: '#666666', label: 'Event' },
};

interface VehicleTimelineVerticalProps {
  events: TimelineEvent[];
  onEventClick?: (event: TimelineEvent) => void;
}

const VehicleTimelineVertical: React.FC<VehicleTimelineVerticalProps> = ({ events, onEventClick }) => {
  // Group events by year
  const eventsByYear = events.reduce((acc, event) => {
    const year = new Date(event.event_date).getFullYear().toString();
    if (!acc[year]) acc[year] = [];
    acc[year].push(event);
    return acc;
  }, {} as Record<string, TimelineEvent[]>);

  const sortedYears = Object.keys(eventsByYear).sort().reverse();

  if (!events.length) {
    return (
      <div style={{ 
        textAlign: 'center', 
        padding: '24px 12px', 
        color: 'var(--text-secondary)',
        fontSize: '11px'
      }}>
        No timeline events yet
      </div>
    );
  }

  return (
    <div style={{ fontSize: '11px', lineHeight: '1.5' }}>
      {sortedYears.map((year) => (
        <div key={year}>
          {/* Year Header */}
          <h4 style={{ 
            fontSize: '12px', 
            fontWeight: 600, 
            margin: '16px 0 8px 0',
            color: 'var(--text)'
          }}>
            {year}
          </h4>

          {/* Timeline Column */}
          <div style={{ 
            position: 'relative', 
            paddingLeft: '24px',
            borderLeft: '2px solid var(--border)',
            marginBottom: '24px'
          }}>
            {eventsByYear[year].map((event) => {
              const style = eventTypeStyles[event.event_type as keyof typeof eventTypeStyles] 
                || { icon: '📝', color: '#666', label: 'Event' };
              
              return (
                <div 
                  key={event.id} 
                  style={{ 
                    marginBottom: '16px', 
                    position: 'relative',
                    cursor: 'pointer'
                  }}
                  onClick={() => onEventClick?.(event)}
                >
                  {/* Timeline Dot */}
                  <div style={{
                    position: 'absolute',
                    left: '-15px',
                    top: '2px',
                    width: '24px',
                    height: '24px',
                    background: 'var(--surface)',
                    border: `2px solid ${style.color}`,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    zIndex: 2,
                    transition: 'all 0.15s ease'
                  }}>
                    {style.icon}
                  </div>

                  {/* Event Card */}
                  <div style={{
                    padding: '8px 12px',
                    background: 'var(--surface)',
                    border: `1px solid var(--border)`,
                    borderRadius: '4px',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLDivElement;
                    el.style.borderColor = style.color;
                    el.style.boxShadow = `0 0 0 2px ${style.color}22`;
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLDivElement;
                    el.style.borderColor = 'var(--border)';
                    el.style.boxShadow = 'none';
                  }}>
                    
                    {/* Header: Type + Title + Date */}
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'baseline', 
                      gap: '8px', 
                      marginBottom: '4px' 
                    }}>
                      <span style={{ 
                        fontSize: '9px', 
                        fontWeight: 600, 
                        color: style.color, 
                        textTransform: 'uppercase' 
                      }}>
                        {style.label}
                      </span>
                      <span style={{ 
                        fontSize: '10px', 
                        color: 'var(--text)',
                        flex: 1
                      }}>
                        {event.title}
                      </span>
                      <span style={{ 
                        fontSize: '9px', 
                        color: 'var(--text-secondary)', 
                        whiteSpace: 'nowrap' 
                      }}>
                        {new Date(event.event_date).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric'
                        })}
                      </span>
                    </div>

                    {/* Details Row */}
                    <div style={{ 
                      display: 'flex', 
                      gap: '12px', 
                      fontSize: '10px', 
                      color: 'var(--text-secondary)',
                      flexWrap: 'wrap'
                    }}>
                      {event.mileage_at_event && (
                        <span>📊 {event.mileage_at_event.toLocaleString()} mi</span>
                      )}
                      {event.cost_amount && (
                        <span>💵 ${event.cost_amount.toLocaleString()}</span>
                      )}
                      {event.created_by && (
                        <span>✏️ {event.created_by.substring(0, 12)}</span>
                      )}
                    </div>

                    {/* Description (if exists) */}
                    {event.description && (
                      <p style={{ 
                        fontSize: '10px', 
                        margin: '4px 0 0 0', 
                        color: 'var(--text-secondary)', 
                        lineHeight: '1.4' 
                      }}>
                        {event.description}
                      </p>
                    )}

                    {/* Image Thumbnails */}
                    {event.image_urls && event.image_urls.length > 0 && (
                      <div style={{ 
                        display: 'flex', 
                        gap: '4px', 
                        marginTop: '6px', 
                        flexWrap: 'wrap' 
                      }}>
                        {event.image_urls?.slice(0, 4).map((url) => (
                          <img 
                            key={url}
                            src={url}
                            style={{
                              width: '32px',
                              height: '32px',
                              objectFit: 'cover',
                              borderRadius: '2px',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                            onError={(e) => e.currentTarget.style.display = 'none'}
                            onMouseEnter={(e) => (e.currentTarget as HTMLImageElement).style.transform = 'scale(1.1)'}
                            onMouseLeave={(e) => (e.currentTarget as HTMLImageElement).style.transform = 'scale(1)'}
                          />
                        ))}
                        {event.image_urls.length > 4 && (
                          <div style={{
                            width: '32px',
                            height: '32px',
                            background: 'var(--bg)',
                            borderRadius: '2px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '9px',
                            fontWeight: 600,
                            color: 'var(--text-secondary)'
                          }}>
                            +{event.image_urls.length - 4}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default VehicleTimelineVertical;
