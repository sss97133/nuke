/**
 * Timeline Photos View
 * Images organized chronologically by work order/timeline event
 */

import React, { useState } from 'react';

interface TimelinePhotosViewProps {
  images: any[];
  onImageClick: (image: any) => void;
  session: any;
}

export const TimelinePhotosView: React.FC<TimelinePhotosViewProps> = ({ images, onImageClick, session }) => {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  // Group images by timeline event
  const groupedImages = images.reduce((acc, img) => {
    const eventId = img.timeline_event_id || 'standalone';
    if (!acc[eventId]) {
      acc[eventId] = {
        eventId,
        eventData: img.timeline_events,
        images: []
      };
    }
    acc[eventId].images.push(img);
    return acc;
  }, {} as Record<string, any>);

  const groups = Object.values(groupedImages).sort((a, b) => {
    // Timeline events first (sorted by date desc), then standalone
    if (a.eventId === 'standalone') return 1;
    if (b.eventId === 'standalone') return -1;
    const dateA = a.eventData?.event_date || '';
    const dateB = b.eventData?.event_date || '';
    return dateB.localeCompare(dateA);
  });

  const toggleEvent = (eventId: string) => {
    const newExpanded = new Set(expandedEvents);
    if (newExpanded.has(eventId)) {
      newExpanded.delete(eventId);
    } else {
      newExpanded.add(eventId);
    }
    setExpandedEvents(newExpanded);
  };

  return (
    <div style={styles.container}>
      {groups.map(group => {
        const isExpanded = expandedEvents.has(group.eventId);
        const event = group.eventData;
        const imageCount = group.images.length;

        if (group.eventId === 'standalone') {
          // Standalone photos section
          return (
            <div key="standalone" style={styles.standaloneSection}>
              <div style={styles.standaloneHeader}>
                📷 Standalone Photos ({imageCount})
              </div>
              <div style={styles.imageGrid}>
                {group.images.map((img: any) => (
                  <div
                    key={img.id}
                    style={styles.imageCard}
                    onClick={() => onImageClick(img)}
                  >
                    <img
                      src={img.thumbnail_url || img.medium_url || img.image_url}
                      alt=""
                      style={styles.thumbnail}
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        }

        // Work order section
        return (
          <div key={group.eventId} style={styles.eventSection}>
            {/* Event Header */}
            <div
              onClick={() => toggleEvent(group.eventId)}
              style={styles.eventHeader}
            >
              <div style={styles.eventTitle}>
                <span style={styles.eventDate}>
                  📅 {event ? new Date(event.event_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  }) : 'Unknown Date'}
                </span>
                <span style={styles.eventName}>
                  {event?.title || 'Work Session'}
                </span>
              </div>
              
              <div style={styles.eventMeta}>
                {event?.cost_amount && (
                  <span style={styles.metaBadge}>💰 ${event.cost_amount}</span>
                )}
                {event?.duration_hours && (
                  <span style={styles.metaBadge}>⏱️ {event.duration_hours}h</span>
                )}
                <span style={styles.metaBadge}>📷 {imageCount} photos</span>
              </div>

              <span style={styles.expandIcon}>{isExpanded ? '−' : '+'}</span>
            </div>

            {/* Event Images - Collapsible */}
            {isExpanded && (
              <div style={styles.eventContent}>
                {event?.description && (
                  <div style={styles.eventDescription}>{event.description}</div>
                )}
                <div style={styles.imageGrid}>
                  {group.images.map((img: any, idx: number) => (
                    <div
                      key={img.id}
                      style={styles.imageCard}
                      onClick={() => onImageClick(img)}
                    >
                      <img
                        src={img.thumbnail_url || img.medium_url || img.image_url}
                        alt=""
                        style={styles.thumbnail}
                        loading="lazy"
                      />
                      {/* Image number badge */}
                      <div style={styles.imageNumber}>{idx + 1}</div>
                      
                      {/* Uploader badge if current user */}
                      {img.user_id === session?.user?.id && (
                        <div style={styles.uploaderBadge}>YOU</div>
                      )}
                    </div>
                  ))}
                </div>
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
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px'
  },
  eventSection: {
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    marginBottom: '8px'
  },
  eventHeader: {
    background: '#000080',
    color: '#ffffff',
    padding: '12px',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  eventTitle: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    marginBottom: '8px'
  },
  eventDate: {
    fontSize: '11px',
    opacity: 0.9
  },
  eventName: {
    fontSize: '14px',
    fontWeight: 'bold' as const
  },
  eventMeta: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
    marginBottom: '4px'
  },
  metaBadge: {
    background: 'rgba(255, 255, 255, 0.2)',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '11px'
  },
  expandIcon: {
    float: 'right' as const,
    fontSize: '20px',
    lineHeight: '1'
  },
  eventContent: {
    padding: '12px',
    background: '#ffffff',
    border: '2px inset #808080'
  },
  eventDescription: {
    fontSize: '12px',
    color: '#000',
    marginBottom: '12px',
    padding: '8px',
    background: '#f0f0f0',
    border: '1px solid #d0d0d0',
    borderRadius: '4px'
  },
  imageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px'
  },
  imageCard: {
    position: 'relative' as const,
    aspectRatio: '1',
    cursor: 'pointer',
    border: '1px solid #808080',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const
  },
  imageNumber: {
    position: 'absolute' as const,
    top: '4px',
    left: '4px',
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#fff',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: 'bold' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  uploaderBadge: {
    position: 'absolute' as const,
    top: '4px',
    right: '4px',
    background: '#008000',
    color: '#fff',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '9px',
    fontWeight: 'bold' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  standaloneSection: {
    background: '#c0c0c0',
    border: '2px inset #808080',
    padding: '12px',
    marginBottom: '8px'
  },
  standaloneHeader: {
    fontSize: '13px',
    fontWeight: 'bold' as const,
    color: '#000',
    marginBottom: '12px',
    fontFamily: '"MS Sans Serif", sans-serif'
  }
};

