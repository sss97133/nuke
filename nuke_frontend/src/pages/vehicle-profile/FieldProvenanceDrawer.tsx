/**
 * FieldProvenanceDrawer.tsx
 *
 * Inline expandable provenance drawer for a single vehicle field.
 * Shows all evidence sources with confidence bars, source badges,
 * and verification status.
 *
 * Design system: Nuke utilitarian — Arial, 2px solid borders,
 * ALL CAPS labels, 9-10px body, greyscale/flat, no gradients/shadows/glows,
 * no emojis, no rounded corners.
 */
import React, { useState, useRef, useEffect } from 'react';
import type { FieldEvidenceGroup, FieldEvidenceRow } from './hooks/useFieldEvidence';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface FieldProvenanceDrawerProps {
  fieldName: string;
  fieldLabel: string;
  group: FieldEvidenceGroup;
  isOpen: boolean;
  onToggle: () => void;
}

/* ------------------------------------------------------------------ */
/*  Source display names                                                */
/* ------------------------------------------------------------------ */

const SOURCE_LABELS: Record<string, string> = {
  bat_listing: 'BAT',
  nhtsa_vin_decode: 'NHTSA',
  vin_decode: 'VIN',
  user_input: 'USER',
  image_vision: 'VISION',
  title_document: 'TITLE',
  receipt: 'RECEIPT',
  enrichment: 'ENRICH',
  appraiser: 'APPRAISER',
  technician: 'TECH',
  forum: 'FORUM',
  historian: 'HISTORIAN',
};

function getSourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] || sourceType.toUpperCase().replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ */
/*  Confidence bar color (greyscale + subtle accent for high conf)     */
/* ------------------------------------------------------------------ */

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9) return '#222';
  if (confidence >= 0.7) return '#555';
  if (confidence >= 0.5) return '#888';
  return '#bbb';
}

function getVerificationLabel(row: FieldEvidenceRow): string | null {
  if (row.verified) return 'VERIFIED';
  if (row.verification_type) return row.verification_type.toUpperCase();
  return null;
}

/* ------------------------------------------------------------------ */
/*  Styles (inline, Nuke design system)                                */
/* ------------------------------------------------------------------ */

const S = {
  drawer: {
    border: '2px solid #ccc',
    background: '#f5f5f5',
    marginTop: '2px',
    overflow: 'hidden',
    transition: 'max-height 0.2s ease-out',
  } as React.CSSProperties,

  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    cursor: 'pointer',
    userSelect: 'none' as const,
    background: '#f5f5f5',
  } as React.CSSProperties,

  label: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#666',
  } as React.CSSProperties,

  badge: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    padding: '1px 4px',
    border: '1px solid #999',
    background: '#eee',
    color: '#333',
  } as React.CSSProperties,

  conflictBadge: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    padding: '1px 4px',
    border: '1px solid #c00',
    background: '#fee',
    color: '#900',
  } as React.CSSProperties,

  body: {
    padding: '6px 8px 8px',
    borderTop: '1px solid #ddd',
  } as React.CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '3px 0',
    borderBottom: '1px solid #eee',
  } as React.CSSProperties,

  value: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '10px',
    color: '#222',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  confidenceBar: {
    width: '40px',
    height: '4px',
    background: '#e0e0e0',
    position: 'relative' as const,
    flexShrink: 0,
  } as React.CSSProperties,

  confidenceFill: (confidence: number) => ({
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    width: `${Math.round(confidence * 100)}%`,
    background: getConfidenceColor(confidence),
    transition: 'width 0.15s ease-out',
  }) as React.CSSProperties,

  confLabel: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    color: '#888',
    width: '28px',
    textAlign: 'right' as const,
    flexShrink: 0,
  } as React.CSSProperties,

  timestamp: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '8px',
    color: '#aaa',
    flexShrink: 0,
  } as React.CSSProperties,

  verifiedTag: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    padding: '0px 3px',
    border: '1px solid #090',
    color: '#060',
    background: '#efe',
  } as React.CSSProperties,

  chevron: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '9px',
    color: '#999',
    flexShrink: 0,
    transition: 'transform 0.15s ease-out',
  } as React.CSSProperties,

  sourceLink: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '8px',
    color: '#666',
    textDecoration: 'underline',
    cursor: 'pointer',
  } as React.CSSProperties,

  primaryIndicator: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    padding: '0px 3px',
    border: '1px solid #333',
    color: '#111',
    background: '#ddd',
  } as React.CSSProperties,
};

/* ------------------------------------------------------------------ */
/*  Date formatting                                                    */
/* ------------------------------------------------------------------ */

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = Date.now();
    const ms = now - d.getTime();
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
    if (ms < 2592000000) return `${Math.floor(ms / 86400000)}d`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const FieldProvenanceDrawer: React.FC<FieldProvenanceDrawerProps> = ({
  fieldName,
  fieldLabel,
  group,
  isOpen,
  onToggle,
}) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState(0);

  useEffect(() => {
    if (bodyRef.current) {
      setBodyHeight(bodyRef.current.scrollHeight);
    }
  }, [isOpen, group.sources.length]);

  const { sources, agreementCount, totalSources, hasConflict, primary } = group;

  return (
    <div
      style={{
        ...S.drawer,
        maxHeight: isOpen ? `${bodyHeight + 40}px` : '0px',
        borderColor: isOpen ? '#ccc' : 'transparent',
        marginTop: isOpen ? '2px' : '0px',
      }}
      data-testid={`provenance-drawer-${fieldName}`}
    >
      {/* Drawer body — shows all sources */}
      <div ref={bodyRef} style={S.body}>
        {/* Summary line */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '4px',
          paddingBottom: '4px',
          borderBottom: '1px solid #ddd',
        }}>
          <span style={S.label}>SOURCES</span>
          <span style={{ ...S.label, color: '#999' }}>
            {totalSources} INPUT{totalSources !== 1 ? 'S' : ''}
          </span>
          {agreementCount > 1 && (
            <span style={{ ...S.label, color: '#444' }}>
              {agreementCount}/{totalSources} AGREE
            </span>
          )}
          {hasConflict && (
            <span style={S.conflictBadge}>CONFLICT</span>
          )}
        </div>

        {/* Source rows */}
        {sources.map((row, idx) => {
          const isPrimary = row.id === primary.id;
          const vLabel = getVerificationLabel(row);

          return (
            <div key={row.id} style={{
              ...S.row,
              borderBottom: idx === sources.length - 1 ? 'none' : '1px solid #eee',
            }}>
              {/* Source badge */}
              <span style={{
                ...S.badge,
                borderColor: isPrimary ? '#333' : '#999',
                background: isPrimary ? '#ddd' : '#eee',
              }}>
                {getSourceLabel(row.source_type)}
              </span>

              {/* Primary indicator */}
              {isPrimary && <span style={S.primaryIndicator}>PRIMARY</span>}

              {/* Value */}
              <span style={{
                ...S.value,
                fontWeight: isPrimary ? 700 : 400,
              }}>
                {row.field_value || '\u2014'}
              </span>

              {/* Confidence bar */}
              <div style={S.confidenceBar}>
                <div style={S.confidenceFill(row.confidence)} />
              </div>
              <span style={S.confLabel}>
                {Math.round(row.confidence * 100)}%
              </span>

              {/* Verified tag */}
              {vLabel && <span style={S.verifiedTag}>{vLabel}</span>}

              {/* Source link */}
              {row.source_url && (
                <a
                  href={row.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={S.sourceLink}
                  title={row.source_url}
                >
                  SRC
                </a>
              )}

              {/* Timestamp */}
              <span style={S.timestamp}>
                {formatDate(row.updated_at || row.created_at)}
              </span>
            </div>
          );
        })}

        {/* Notes from primary if present */}
        {primary.notes && (
          <div style={{
            marginTop: '4px',
            paddingTop: '4px',
            borderTop: '1px solid #ddd',
          }}>
            <span style={{ ...S.label, marginRight: '4px' }}>NOTE</span>
            <span style={{ ...S.value, whiteSpace: 'normal' as const }}>{primary.notes}</span>
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Inline source badge — shown next to field value in the data row    */
/* ------------------------------------------------------------------ */

export interface SourceBadgeProps {
  group: FieldEvidenceGroup;
  onClick: () => void;
}

export const SourceBadge: React.FC<SourceBadgeProps> = ({ group, onClick }) => {
  const { primary, totalSources, hasConflict } = group;

  return (
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        cursor: 'pointer',
        marginLeft: '4px',
        verticalAlign: 'middle',
      }}
      title={`${totalSources} source${totalSources !== 1 ? 's' : ''} | ${getSourceLabel(primary.source_type)} | ${Math.round(primary.confidence * 100)}% confidence`}
    >
      <span style={{
        ...S.badge,
        fontSize: '8px',
        padding: '0px 3px',
        borderColor: hasConflict ? '#c00' : '#999',
        background: hasConflict ? '#fee' : '#eee',
        color: hasConflict ? '#900' : '#333',
      }}>
        {getSourceLabel(primary.source_type)}
      </span>
      {totalSources > 1 && (
        <span style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '8px',
          color: '#999',
        }}>
          +{totalSources - 1}
        </span>
      )}
    </span>
  );
};

export default FieldProvenanceDrawer;
