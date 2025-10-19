/**
 * Event Detail Modal - Mobile
 * Shows comprehensive who/what/where/when/why/results for timeline events
 */

import React from 'react';

interface EventDetailModalProps {
  event: any;
  onClose: () => void;
}

const EventDetailModal: React.FC<EventDetailModalProps> = ({ event, onClose }) => {
  // Parse metadata for additional details
  const metadata = event.metadata || {};
  const aiDetectedParts = metadata.ai_detected_parts || [];
  const suppliesUsed = metadata.supplies_used || [];
  
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h3 style={styles.headerTitle}>{event.title}</h3>
          <button onClick={onClose} style={styles.closeButton}>×</button>
        </div>

        {/* Scrollable Content */}
        <div style={styles.content}>
          {/* WHEN */}
          <Section title="WHEN">
            <InfoRow label="Date" value={new Date(event.event_date).toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })} />
            {event.duration_hours && (
              <InfoRow label="Duration" value={`${event.duration_hours}h`} />
            )}
            {metadata.exif_verified && (
              <InfoRow label="Source" value="📸 EXIF verified" />
            )}
          </Section>

          {/* WHO */}
          {(event.user_id || event.service_provider_name) && (
            <Section title="WHO">
              {event.user_id && <InfoRow label="Documented by" value="Vehicle owner" />}
              {event.service_provider_name && (
                <InfoRow label="Service by" value={event.service_provider_name} />
              )}
              {event.service_provider_type && (
                <InfoRow label="Type" value={event.service_provider_type.replace('_', ' ')} />
              )}
            </Section>
          )}

          {/* WHERE */}
          {(event.location_name || event.location_address) && (
            <Section title="WHERE">
              {event.location_name && <InfoRow label="Location" value={event.location_name} />}
              {event.location_address && <InfoRow label="Address" value={event.location_address} />}
            </Section>
          )}

          {/* WHAT */}
          <Section title="WHAT">
            <InfoRow label="Type" value={event.event_type.replace('_', ' ')} />
            {event.description && (
              <div style={styles.description}>{event.description}</div>
            )}
            {aiDetectedParts.length > 0 && (
              <>
                <div style={styles.sectionSubtitle}>AI Detected Parts:</div>
                {aiDetectedParts.map((part: string, idx: number) => (
                  <div key={idx} style={styles.listItem}>• {part}</div>
                ))}
              </>
            )}
            {event.parts_used && event.parts_used.length > 0 && (
              <>
                <div style={styles.sectionSubtitle}>Parts Used:</div>
                {event.parts_used.map((part: any, idx: number) => (
                  <div key={idx} style={styles.listItem}>
                    • {part.name || part} {part.cost && `- $${part.cost}`}
                  </div>
                ))}
              </>
            )}
          </Section>

          {/* COSTS & VALUE IMPACT */}
          {(event.cost_amount || event.value_impact_amount) && (
            <Section title="RESULTS">
              {event.cost_amount && (
                <InfoRow 
                  label="Total Cost" 
                  value={`$${event.cost_amount.toLocaleString()}`} 
                />
              )}
              {event.value_impact_amount && (
                <InfoRow 
                  label="Value Impact" 
                  value={`${event.value_impact_amount >= 0 ? '+' : ''}$${Math.abs(event.value_impact_amount).toLocaleString()}`}
                  valueStyle={{ 
                    color: event.value_impact_amount >= 0 ? '#008000' : '#ff0000',
                    fontWeight: 'bold'
                  }}
                />
              )}
              {event.mileage_at_event && (
                <InfoRow label="Mileage" value={`${event.mileage_at_event.toLocaleString()} mi`} />
              )}
            </Section>
          )}

          {/* EFFICIENCY */}
          {(event.duration_hours || event.efficiency_score) && (
            <Section title="EFFICIENCY">
              {event.duration_hours && event.typical_duration_hours && (
                <>
                  <InfoRow label="Time taken" value={`${event.duration_hours}h`} />
                  <InfoRow label="Typical time" value={`${event.typical_duration_hours}h`} />
                  <InfoRow 
                    label="Performance" 
                    value={event.duration_hours < event.typical_duration_hours ? '👍 Faster' : '👎 Slower'} 
                  />
                </>
              )}
              {event.efficiency_score && (
                <InfoRow label="Efficiency Score" value={`${event.efficiency_score}/100`} />
              )}
            </Section>
          )}

          {/* CONNECTIONS */}
          {event.connection_count > 0 && (
            <Section title="CONNECTIONS">
              <InfoRow label="Total connections" value={event.connection_count.toString()} />
              {suppliesUsed.length > 0 && (
                <>
                  <div style={styles.sectionSubtitle}>Supplies & Tools:</div>
                  {suppliesUsed.slice(0, 5).map((item: string, idx: number) => (
                    <div key={idx} style={styles.listItem}>• {item}</div>
                  ))}
                </>
              )}
            </Section>
          )}

          {/* WHY (if available in metadata) */}
          {metadata.work_reason && (
            <Section title="WHY">
              <div style={styles.description}>{metadata.work_reason}</div>
            </Section>
          )}

          {/* Images */}
          {event.image_urls && event.image_urls.length > 0 && (
            <Section title="PHOTOS">
              <div style={styles.imageGrid}>
                {event.image_urls.map((url: string, idx: number) => (
                  <img
                    key={idx}
                    src={url}
                    alt=""
                    style={styles.eventImage}
                  />
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* Footer with comments link */}
        <div style={styles.footer}>
          <button style={styles.footerButton}>
            💬 View Comments
          </button>
        </div>
      </div>
    </div>
  );
};

// Helper Components
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={styles.section}>
    <div style={styles.sectionTitle}>{title}</div>
    <div style={styles.sectionContent}>{children}</div>
  </div>
);

const InfoRow: React.FC<{ label: string; value: string; valueStyle?: React.CSSProperties }> = ({ label, value, valueStyle }) => (
  <div style={styles.infoRow}>
    <span style={styles.infoLabel}>{label}:</span>
    <span style={{ ...styles.infoValue, ...valueStyle }}>{value}</span>
  </div>
);

// Styles
const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'flex-end',
    animation: 'fadeIn 0.2s ease-in-out'
  },
  modal: {
    background: '#c0c0c0',
    width: '100%',
    maxHeight: '85vh',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    animation: 'slideUp 0.3s ease-out'
  },
  header: {
    background: '#000080',
    color: '#ffffff',
    padding: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopLeftRadius: '12px',
    borderTopRightRadius: '12px'
  },
  headerTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 'bold',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  closeButton: {
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    color: '#000000',
    fontSize: '24px',
    width: '32px',
    height: '32px',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif',
    lineHeight: '1',
    padding: 0
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px'
  },
  section: {
    marginBottom: '20px'
  },
  sectionTitle: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#000080',
    marginBottom: '8px',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  sectionSubtitle: {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#000000',
    marginTop: '8px',
    marginBottom: '4px'
  },
  sectionContent: {
    fontSize: '13px'
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: '1px solid #808080'
  },
  infoLabel: {
    fontWeight: 'bold',
    color: '#000000'
  },
  infoValue: {
    color: '#000000',
    textAlign: 'right' as const
  },
  description: {
    fontSize: '12px',
    color: '#000000',
    lineHeight: '1.4',
    padding: '8px',
    background: '#ffffff',
    border: '1px inset #808080'
  },
  listItem: {
    fontSize: '12px',
    padding: '4px 0 4px 8px',
    color: '#000000'
  },
  imageGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    marginTop: '8px'
  },
  eventImage: {
    width: '100%',
    aspectRatio: '1',
    objectFit: 'cover' as const,
    border: '1px solid #808080',
    borderRadius: '4px'
  },
  footer: {
    background: '#c0c0c0',
    padding: '12px 16px',
    borderTop: '2px solid #808080'
  },
  footerButton: {
    width: '100%',
    background: '#000080',
    color: '#ffffff',
    border: '2px outset #ffffff',
    padding: '12px',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  }
};

export default EventDetailModal;

