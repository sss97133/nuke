/**
 * VehicleDossierPanel.tsx
 *
 * Provenance-rich vehicle profile panel. Replaces VehicleBasicInfo.
 * Each field row shows the primary value with source badges and an
 * expandable provenance drawer showing all evidence sources.
 *
 * Design system: Nuke utilitarian — Arial, 2px solid borders,
 * ALL CAPS labels, 9-10px body, zero radius/shadows/gradients.
 */
import React, { useState, useMemo } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import { supabase } from '../../lib/supabase';
import { useFieldEvidence, type FieldEvidenceMap, type FieldEvidenceGroup } from './hooks/useFieldEvidence';
import FieldProvenanceDrawer, { SourceBadge } from './FieldProvenanceDrawer';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FIELD_ORDER = [
  'vin', 'year', 'make', 'model', 'engine_type', 'engine_size',
  'transmission', 'drivetrain', 'fuel_type', 'fuel_system_type',
  'color', 'interior_color', 'mileage', 'body_style', 'sale_price', 'trim',
] as const;

const FIELD_LABELS: Record<string, string> = {
  vin: 'VIN', year: 'YEAR', make: 'MAKE', model: 'MODEL',
  engine_type: 'ENGINE TYPE', engine_size: 'ENGINE SIZE',
  transmission: 'TRANSMISSION', drivetrain: 'DRIVETRAIN',
  fuel_type: 'FUEL TYPE', fuel_system_type: 'FUEL SYSTEM',
  color: 'COLOR', interior_color: 'INTERIOR COLOR',
  mileage: 'MILEAGE', body_style: 'BODY STYLE',
  sale_price: 'SALE PRICE', trim: 'TRIM',
};

/* ------------------------------------------------------------------ */
/*  Source badge classification (matching reference HTML)               */
/* ------------------------------------------------------------------ */

interface SourceClass { key: string; cls: string }

function classifySource(sourceType: string | null): SourceClass {
  if (!sourceType) return { key: 'USER', cls: 'badge-user' };
  const s = sourceType.toLowerCase();
  if (s.includes('vin') || s.includes('nhtsa')) return { key: 'VIN', cls: 'badge-vin' };
  if (s.includes('bat')) return { key: 'BaT', cls: 'badge-bat' };
  if (s.includes('user')) return { key: 'USER', cls: 'badge-user' };
  if (s.includes('ai') || s.includes('vision')) return { key: 'AI', cls: 'badge-ai' };
  if (s.includes('enrich')) return { key: 'ENRICH', cls: 'badge-enrich' };
  return { key: 'SRC', cls: 'badge-user' };
}

const BADGE_COLORS: Record<string, { border: string; color: string; bg?: string }> = {
  'badge-vin': { border: '#1a5c1a', color: '#1a5c1a' },
  'badge-bat': { border: '#1a4a8a', color: '#1a4a8a' },
  'badge-user': { border: '#666', color: '#666' },
  'badge-ai': { border: '#8a6b1a', color: '#8a6b1a' },
  'badge-enrich': { border: '#8a1a1a', color: '#8a1a1a' },
  'badge-mod': { border: '#8a6b1a', color: '#8a6b1a', bg: '#fff8e6' },
};

/* ------------------------------------------------------------------ */
/*  Value formatting                                                   */
/* ------------------------------------------------------------------ */

function fmtVal(field: string, val: any): string {
  if (val == null || val === '') return '';
  const s = String(val);
  if (field === 'sale_price') {
    const n = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (!isNaN(n) && n > 0) return '$' + n.toLocaleString();
  }
  if (field === 'mileage') {
    const m = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (!isNaN(m) && m > 0) return m.toLocaleString() + ' mi';
  }
  return s;
}

/* ------------------------------------------------------------------ */
/*  Modification detection                                             */
/* ------------------------------------------------------------------ */

function detectModifications(evidence: FieldEvidenceMap): Set<string> {
  const mods = new Set<string>();
  for (const [field, group] of Object.entries(evidence)) {
    if (group.sources.length < 2) continue;
    const vinItems = group.sources.filter(s => {
      const st = s.source_type.toLowerCase();
      return st.includes('vin') || st.includes('nhtsa');
    });
    const others = group.sources.filter(s => {
      const st = s.source_type.toLowerCase();
      return !st.includes('vin') && !st.includes('nhtsa');
    });
    if (vinItems.length > 0 && others.length > 0) {
      const vinVal = (vinItems[0].field_value || '').toLowerCase().trim();
      if (others.some(o => {
        const ov = (o.field_value || '').toLowerCase().trim();
        return ov && vinVal && ov !== vinVal;
      })) {
        mods.add(field);
      }
    }
  }
  return mods;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const Badge: React.FC<{
  text: string;
  cls?: string;
  style?: React.CSSProperties;
}> = ({ text, cls = 'badge-user', style }) => {
  const colors = BADGE_COLORS[cls] || BADGE_COLORS['badge-user'];
  return (
    <span style={{
      display: 'inline-block',
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: '8px',
      fontWeight: 700,
      letterSpacing: '0.5px',
      textTransform: 'uppercase',
      padding: '1px 5px',
      border: `2px solid ${colors.border}`,
      background: colors.bg || '#fff',
      color: colors.color,
      lineHeight: 1.4,
      ...style,
    }}>
      {text}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/*  FieldRow                                                           */
/* ------------------------------------------------------------------ */

const FieldRow: React.FC<{
  field: string;
  label: string;
  displayValue: string;
  group: FieldEvidenceGroup | undefined;
  isMod: boolean;
  isOpen: boolean;
  onToggle: () => void;
}> = ({ field, label, displayValue, group, isMod, isOpen, onToggle }) => {
  // Deduplicated source badges
  const sourceBadges = useMemo(() => {
    if (!group) return [];
    const seen = new Map<string, SourceClass>();
    for (const s of group.sources) {
      const c = classifySource(s.source_type);
      if (!seen.has(c.key)) seen.set(c.key, c);
    }
    return Array.from(seen.values());
  }, [group]);

  return (
    <div style={{ borderBottom: '1px solid #e0e0e0' }}>
      <div
        onClick={group && group.sources.length > 0 ? onToggle : undefined}
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr auto 20px',
          alignItems: 'center',
          padding: '4px 10px',
          minHeight: '28px',
          cursor: group && group.sources.length > 0 ? 'pointer' : 'default',
          background: isOpen ? '#f5f5f0' : 'transparent',
          transition: 'background 0.1s',
        }}
      >
        {/* Label */}
        <span style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          color: '#666',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>

        {/* Value */}
        <span style={{
          fontFamily: field === 'vin' ? "'Courier New', Courier, monospace" : 'Arial, Helvetica, sans-serif',
          fontSize: '10px',
          color: '#111',
          padding: '0 8px',
          letterSpacing: field === 'vin' ? '1px' : 'normal',
        }}>
          {displayValue || '\u2014'}
        </span>

        {/* Source badges */}
        <span style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
          {sourceBadges.map(c => (
            <Badge key={c.key} text={c.key} cls={c.cls} />
          ))}
          {isMod && <Badge text="MOD" cls="badge-mod" />}
        </span>

        {/* Expand icon */}
        <span style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '8px',
          color: '#999',
          textAlign: 'center',
          userSelect: 'none',
          transition: 'transform 0.15s',
          transform: isOpen ? 'rotate(90deg)' : 'none',
        }}>
          {group && group.sources.length > 0 ? '\u25B6' : ''}
        </span>
      </div>

      {/* Provenance drawer */}
      {group && group.sources.length > 0 && (
        <FieldProvenanceDrawer
          fieldName={field}
          fieldLabel={label}
          group={group}
          isOpen={isOpen}
          onToggle={onToggle}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

const VehicleDossierPanel: React.FC = () => {
  const { vehicle } = useVehicleProfile();
  const { evidence, loading } = useFieldEvidence(vehicle?.id);
  const [openDrawer, setOpenDrawer] = useState<string | null>(null);

  const toggleDrawer = (field: string) => {
    setOpenDrawer(prev => prev === field ? null : field);
  };

  const modFields = useMemo(() => detectModifications(evidence), [evidence]);
  const hasModification = modFields.size > 0 || (vehicle as any)?.is_modified === true;

  // Coverage
  const withEvidence = useMemo(() => {
    return FIELD_ORDER.filter(f => evidence[f] && evidence[f].sources.length > 0).length;
  }, [evidence]);
  const coverage = withEvidence / FIELD_ORDER.length;
  const verificationLabel = coverage >= 0.75 ? 'MULTI-SOURCE VERIFIED' : 'PARTIAL VERIFICATION';
  const verificationClass = coverage >= 0.75 ? 'verified' : 'partial';

  // Identity badges
  const badges = useMemo(() => {
    if (!vehicle) return [];
    const v = vehicle as any;
    const b: Array<{ text: string; cls: string }> = [];
    if (v.sale_status === 'sold' || v.auction_outcome === 'sold' || (v.sale_price && Number(v.sale_price) > 0)) {
      b.push({ text: 'SOLD', cls: 'badge-sold' });
    }
    const hasBat = Object.values(evidence).some(g =>
      g.sources.some(s => s.source_type.toLowerCase().includes('bat'))
    );
    if (hasBat || v.bat_auction_url) b.push({ text: 'BaT', cls: 'badge-bat' });
    const titleStatus = (v.title_status || '').toLowerCase();
    if (titleStatus.includes('tmu')) b.push({ text: 'TMU', cls: 'badge-ai' });
    if (hasModification) b.push({ text: 'MODIFIED', cls: 'badge-mod' });
    const reserveStatus = (v.reserve_status || '').toLowerCase();
    if (reserveStatus === 'no_reserve') b.push({ text: 'NO RESERVE', cls: 'badge-user' });
    else if (reserveStatus === 'reserve_not_met') b.push({ text: 'RNM', cls: 'badge-ai' });
    return b;
  }, [vehicle, evidence, hasModification]);

  if (!vehicle) return null;

  const v = vehicle as any;
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ').toUpperCase().trim();

  return (
    <div>
      {/* Header Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#fff',
        border: '2px solid #000',
        padding: '8px 12px',
      }}>
        <span style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
        }}>
          VEHICLE DOSSIER
        </span>
        <span style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '8px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          padding: '2px 6px',
          border: `2px solid ${verificationClass === 'verified' ? '#1a5c1a' : '#8a6b1a'}`,
          color: verificationClass === 'verified' ? '#1a5c1a' : '#8a6b1a',
          background: '#fff',
        }}>
          {verificationLabel}
        </span>
      </div>

      {/* Identity Block */}
      <div style={{
        background: '#fff',
        border: '2px solid #000',
        borderTop: 'none',
        padding: '10px 12px 8px',
        marginBottom: '8px',
      }}>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '16px',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          lineHeight: 1.2,
        }}>
          {ymm || 'UNKNOWN VEHICLE'}
        </div>
        {v.vin && (
          <div style={{
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: '11px',
            color: '#333',
            marginTop: '4px',
            letterSpacing: '1px',
          }}>
            {v.vin}
          </div>
        )}
        {badges.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
            {badges.map((b, i) => {
              // Special handling for SOLD badge
              if (b.text === 'SOLD') {
                return (
                  <span key={i} style={{
                    display: 'inline-block',
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: '8px',
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    padding: '1px 5px',
                    border: '2px solid #000',
                    background: '#000',
                    color: '#fff',
                    lineHeight: 1.4,
                  }}>
                    SOLD
                  </span>
                );
              }
              return <Badge key={i} text={b.text} cls={b.cls} />;
            })}
          </div>
        )}
      </div>

      {/* Info Panel */}
      <div style={{
        background: '#fff',
        border: '2px solid #000',
        marginBottom: '8px',
      }}>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          padding: '6px 10px',
          background: '#f0f0f0',
          borderBottom: '1px solid #ccc',
        }}>
          VEHICLE INFORMATION
        </div>

        {FIELD_ORDER.map(field => {
          const group = evidence[field];
          // Primary value: prefer vehicle table, then highest-confidence evidence
          let pv = v[field];
          if ((pv == null || pv === '') && group && group.sources.length > 0) {
            pv = group.primary.field_value;
          }
          const displayValue = fmtVal(field, pv);

          return (
            <FieldRow
              key={field}
              field={field}
              label={FIELD_LABELS[field] || field.toUpperCase().replace(/_/g, ' ')}
              displayValue={displayValue}
              group={group}
              isMod={modFields.has(field)}
              isOpen={openDrawer === field}
              onToggle={() => toggleDrawer(field)}
            />
          );
        })}
      </div>

      {/* Verification Summary */}
      <div style={{
        background: '#fff',
        border: '2px solid #000',
        padding: '8px 10px',
        marginBottom: '8px',
      }}>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          marginBottom: '4px',
        }}>
          PROVENANCE COVERAGE
        </div>
        <div style={{
          width: '100%',
          height: '6px',
          background: '#e0e0e0',
          marginBottom: '4px',
        }}>
          <div style={{
            height: '100%',
            width: `${Math.round(coverage * 100)}%`,
            background: '#1a5c1a',
            transition: 'width 0.3s',
          }} />
        </div>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: '#666',
        }}>
          {withEvidence}/{FIELD_ORDER.length} FIELDS WITH PROVENANCE
        </div>
      </div>

      {/* Condition Score (if available) */}
      <ConditionScoreSection vehicleId={vehicle.id} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Condition Score (Phase 5A)                                         */
/* ------------------------------------------------------------------ */

const ConditionScoreSection: React.FC<{ vehicleId: string }> = ({ vehicleId }) => {
  const [score, setScore] = React.useState<any>(null);

  React.useEffect(() => {
    let cancelled = false;
    supabase
      .from('vehicle_condition_scores')
      .select('condition_score, condition_tier, percentile_within_ymm, exterior_score, interior_score, mechanical_score, provenance_score, presentation_score')
      .eq('vehicle_id', vehicleId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled && data && data.length > 0) setScore(data[0]);
      });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (!score) return null;

  const domains = [
    { label: 'EXTERIOR', value: score.exterior_score },
    { label: 'INTERIOR', value: score.interior_score },
    { label: 'MECHANICAL', value: score.mechanical_score },
    { label: 'PROVENANCE', value: score.provenance_score },
    { label: 'PRESENTATION', value: score.presentation_score },
  ].filter(d => d.value != null);

  return (
    <div style={{
      background: '#fff',
      border: '2px solid #000',
      padding: '8px 10px',
      marginBottom: '8px',
    }}>
      <div style={{
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '1px',
        textTransform: 'uppercase',
        marginBottom: '6px',
      }}>
        CONDITION SPECTROMETER
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
        <span style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '20px',
          fontWeight: 700,
        }}>
          {Math.round(score.condition_score)}
        </span>
        <span style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          / 100 &middot; {score.condition_tier}
          {score.percentile_within_ymm != null && (
            <> &middot; {Math.round(score.percentile_within_ymm)}th percentile</>
          )}
        </span>
      </div>
      {domains.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 30px', gap: '2px 8px', fontSize: '8px' }}>
          {domains.map(d => (
            <React.Fragment key={d.label}>
              <span style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontWeight: 700,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                color: '#666',
              }}>
                {d.label}
              </span>
              <div style={{ height: '4px', background: '#e0e0e0', alignSelf: 'center' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, Math.max(0, d.value))}%`,
                  background: d.value >= 70 ? '#1a5c1a' : d.value >= 40 ? '#8a6b1a' : '#8a1a1a',
                }} />
              </div>
              <span style={{
                fontFamily: "'Courier New', Courier, monospace",
                color: '#333',
                textAlign: 'right',
              }}>
                {Math.round(d.value)}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

export default VehicleDossierPanel;
