/**
 * FieldProvenanceDrawer.tsx
 *
 * Inline expandable provenance drawer for a single vehicle field.
 * Shows retained source claims, qualified scores and separately named clocks.
 *
 * Design system: Nuke utilitarian — Arial, 2px solid borders,
 * ALL CAPS labels, 9-10px body, greyscale/flat, no gradients/shadows/glows,
 * no emojis, no rounded corners.
 */
import React from 'react';
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
  user_input_unverified: 'USER',
  image_vision: 'VISION',
  title_document: 'TITLE',
  receipt: 'RECEIPT',
  enrichment: 'ENRICH',
  appraiser: 'APPRAISER',
  technician: 'TECH',
  forum: 'FORUM',
  historian: 'HISTORIAN',
  ai_extraction: 'AI',
  ai_vision: 'AI',
  manual: 'USER',
};

function getSourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] || sourceType.toUpperCase().replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ */
/*  Score labels — a stored number is not calibrated accuracy.         */
/* ------------------------------------------------------------------ */

function scoreLabel(row: FieldEvidenceRow): string {
  if (row.evidence_origin === 'vehicle_wiki') {
    return Number.isFinite(row.confidence) ? `Derived score ${Math.round(row.confidence * 100)}/100` : 'Derived score unknown';
  }
  return typeof row.source_confidence === 'number' && Number.isFinite(row.source_confidence)
    ? `Stored score ${row.source_confidence}/100` : 'Stored score unknown';
}


/* ------------------------------------------------------------------ */
/*  Styles (inline, Nuke design system)                                */
/* ------------------------------------------------------------------ */

const S = {
  drawer: {
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
    background: 'var(--bg)',
  } as React.CSSProperties,

  label: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-secondary)',
  } as React.CSSProperties,

  badge: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    padding: '1px 4px',
    border: '1px solid var(--text-disabled)',
    background: 'var(--bg)',
    color: 'var(--text)',
    maxWidth: '100px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  conflictBadge: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    padding: '1px 4px',
    border: '1px solid var(--error)',
    background: 'var(--error-dim)',
    color: 'var(--error)',
  } as React.CSSProperties,

  body: {
    padding: '6px 8px 8px',
    borderTop: '1px dashed var(--border)',
    borderBottom: '1px dashed var(--border)',
    background: 'var(--surface)',
  } as React.CSSProperties,

  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(60px, 100px) minmax(0, 1fr)',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 0',
    borderBottom: '1px solid var(--border)',
  } as React.CSSProperties,

  value: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    color: 'var(--text)',
    minWidth: 0,
    overflowWrap: 'anywhere' as const,
  } as React.CSSProperties,

  confLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
  } as React.CSSProperties,

  timestamp: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '10px',
    color: 'var(--text-secondary)',
    overflowWrap: 'anywhere' as const,
  } as React.CSSProperties,

  chevron: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    color: 'var(--text-disabled)',
    flexShrink: 0,
    transition: 'transform 0.15s ease-out',
  } as React.CSSProperties,

};

/* ------------------------------------------------------------------ */
/*  Date formatting                                                    */
/* ------------------------------------------------------------------ */

function ClaimClock({ label, value }: { label: string; value: string | null | undefined }) {
  // Native timestamptz responses include an offset. Do not invent a local zone or day precision.
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? new Date(value) : null;
  const valid = date && Number.isFinite(date.getTime());
  return <span style={S.timestamp}>{label}: {valid
    ? <time dateTime={value!}>{date.toISOString().replace('T', ' ').replace('Z', ' UTC')}</time>
    : 'unknown'}</span>;
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
  const { sources, agreementCount, totalSources, hasConflict, conflictType, primary } = group;

  return (
    <div
      style={{
        ...S.drawer,
        display: isOpen ? 'block' : 'none',
      }}
      id={`provenance-drawer-${fieldName}`}
      aria-label={`${fieldLabel} retained source claims`}
      data-testid={`provenance-drawer-${fieldName}`}
    >
      {/* Drawer body — shows all sources */}
      <div style={S.body}>
        {/* Summary line */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '4px',
          paddingBottom: '4px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={S.label}>CLAIM RECORDS</span>
          <span style={{ ...S.label, color: 'var(--text-disabled)' }}>
            {totalSources} RECORD{totalSources !== 1 ? 'S' : ''}
          </span>
          {agreementCount > 1 && (
            <span style={{ ...S.label, color: 'var(--text)' }}>
              {agreementCount}/{totalSources} MATCHING TEXT
            </span>
          )}
          {hasConflict && (
            <span style={{
              ...S.conflictBadge,
              ...(conflictType === 'genuine' ? {} :
                conflictType === 'refinement' ? { borderColor: 'var(--warning)', background: 'var(--warning-dim)', color: 'var(--warning)' } :
                conflictType === 'synonym' ? { borderColor: 'var(--text-secondary)', background: 'var(--bg)', color: 'var(--text-secondary)' } :
                conflictType === 'variance' ? { borderColor: 'var(--text-secondary)', background: 'var(--bg)', color: 'var(--text-secondary)' } : {}),
            }}>
              {conflictType === 'genuine' ? 'CONFLICT' :
               conflictType === 'refinement' ? 'REFINEMENT' :
               conflictType === 'synonym' ? 'SYNONYM' :
               conflictType === 'variance' ? 'VARIANCE' : 'CONFLICT'}
            </span>
          )}
        </div>
        <p style={{ ...S.timestamp, margin: '4px 0 6px' }}>
          Score calibration and source independence are unknown. Stored clocks do not establish original source event time.
        </p>

        {/* Source rows */}
        {sources.map((row, idx) => {
          const isPrimary = row.id === primary.id;
          const primaryValue = (primary.field_value || '').toLowerCase().trim();
          const thisValue = (row.field_value || '').toLowerCase().trim();
          const isConflict = !isPrimary && primaryValue && thisValue && thisValue !== primaryValue;

          return (
            <div key={row.id} className="dossier-evidence-row" style={{
              ...S.row,
              borderBottom: idx === sources.length - 1 ? 'none' : '1px solid var(--border)',
              borderLeft: isPrimary ? '2px solid var(--text)' : '2px solid transparent',
              paddingLeft: isPrimary ? '4px' : '0',
              ...(isConflict ? { border: '1px solid var(--error)', background: 'var(--error-dim)' } : {}),
            }}>
              {/* Source badge */}
              <span title={`Source label: ${row.source_type}`} style={{
                ...S.badge,
                borderColor: isPrimary ? 'var(--text)' : 'var(--text-disabled)',
                background: isPrimary ? 'var(--surface-hover)' : 'var(--bg)',
              }}>
                {getSourceLabel(row.source_type)}
              </span>

              {/* Value */}
              <span style={{
                ...S.value,
                fontWeight: isPrimary ? 700 : 400,
              }}>
                {row.field_value || '\u2014'}
              </span>

              <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '6px 16px', minWidth: 0 }}>
                <span style={S.confLabel} data-testid={`claim-score-${row.id}`}>{scoreLabel(row)}</span>
                <ClaimClock label="Stored extraction" value={row.extracted_at} />
                <ClaimClock label="Claim row created" value={row.evidence_origin === 'vehicle_wiki' ? null : row.created_at} />
              </div>

              {/* Extraction context */}
              <span
                className="dossier-evidence-context"
                style={{
                  fontFamily: 'Arial, sans-serif',
                  gridColumn: '1 / -1',
                  fontSize: '10px',
                  color: 'var(--text-secondary)',
                  overflowWrap: 'anywhere' as const,
                }}
                title={row.extraction_context || ''}
              >
                {row.extraction_context || ''}
              </span>

            </div>
          );
        })}

        {/* Notes from primary if present */}
        {primary.notes && (
          <div style={{
            marginTop: '4px',
            paddingTop: '4px',
            borderTop: '1px solid var(--border)',
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
  const { primary, totalSources, hasConflict, conflictType } = group;
  const isGenuine = hasConflict && conflictType === 'genuine';

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
      title={`${totalSources} claim record${totalSources !== 1 ? 's' : ''} | ${getSourceLabel(primary.source_type)} | ${scoreLabel(primary)}; calibration unknown`}
    >
      <span style={{
        ...S.badge,
        fontSize: '8px',
        padding: '0px 3px',
        borderColor: isGenuine ? 'var(--error)' : 'var(--text-disabled)',
        background: isGenuine ? 'var(--error-dim)' : 'var(--bg)',
        color: isGenuine ? 'var(--error)' : 'var(--text)',
      }}>
        {getSourceLabel(primary.source_type)}
      </span>
      {totalSources > 1 && (
        <span style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '8px',
          color: 'var(--text-disabled)',
        }}>
          +{totalSources - 1}
        </span>
      )}
    </span>
  );
};

export default FieldProvenanceDrawer;
