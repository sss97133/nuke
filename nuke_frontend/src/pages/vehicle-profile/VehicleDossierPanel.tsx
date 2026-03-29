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
import { useNavigate } from 'react-router-dom';
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

const FIELD_GROUPS: { label: string; fields: readonly string[] }[] = [
  { label: 'IDENTITY', fields: ['vin', 'year', 'make', 'model', 'trim'] },
  { label: 'POWERPLANT', fields: ['engine_type', 'engine_size', 'fuel_type', 'fuel_system_type'] },
  { label: 'DRIVETRAIN', fields: ['transmission', 'drivetrain'] },
  { label: 'APPEARANCE', fields: ['color', 'interior_color', 'body_style'] },
  { label: 'METRICS', fields: ['mileage', 'sale_price'] },
];

const FIELD_LABELS: Record<string, string> = {
  vin: 'VIN', year: 'YEAR', make: 'MAKE', model: 'MODEL',
  engine_type: 'ENGINE TYPE', engine_size: 'ENGINE SIZE',
  transmission: 'TRANSMISSION', drivetrain: 'DRIVETRAIN',
  fuel_type: 'FUEL TYPE', fuel_system_type: 'FUEL SYSTEM',
  color: 'COLOR', interior_color: 'INTERIOR COLOR',
  mileage: 'MILEAGE', body_style: 'BODY STYLE',
  sale_price: 'SALE PRICE', trim: 'TRIM',
};

const EXTENDED_FIELDS: Array<{ key: string; label: string; formatter?: (val: any) => string }> = [
  { key: 'doors', label: 'DOORS' },
  { key: 'seats', label: 'SEATS' },
  { key: 'horsepower', label: 'HORSEPOWER', formatter: (v) => `${Number(v).toLocaleString()} HP` },
  { key: 'torque', label: 'TORQUE', formatter: (v) => `${Number(v).toLocaleString()} LB-FT` },
  { key: 'weight_lbs', label: 'WEIGHT', formatter: (v) => `${Number(v).toLocaleString()} LBS` },
  { key: 'wheelbase_inches', label: 'WHEELBASE', formatter: (v) => `${v}"` },
  { key: 'length_inches', label: 'LENGTH', formatter: (v) => `${v}"` },
  { key: 'width_inches', label: 'WIDTH', formatter: (v) => `${v}"` },
  { key: 'height_inches', label: 'HEIGHT', formatter: (v) => `${v}"` },
  { key: 'mpg_city', label: 'MPG CITY' },
  { key: 'mpg_highway', label: 'MPG HIGHWAY' },
  { key: 'mpg_combined', label: 'MPG COMBINED' },
];

function sanitizeInlineValue(val: any): string {
  const s = (val ?? '').toString();
  if (!s) return '';
  if (s.length > 200) return s.substring(0, 197) + '...';
  if (s.includes('{') || s.includes('}') || s.includes(';') || s.includes('}.') || s.includes('/*') || s.includes('*/')) return '';
  if (/^[,;]\s+/.test(s) || /^,?\s*(and|or|but|with|the)\s+/i.test(s)) return '';
  const batPatterns = [
    /\s*for sale on BaT Auctions?\s*/gi,
    /\s*sold for \$[\d,]+ on [A-Z][a-z]+ \d{1,2}, \d{4}\s*/gi,
    /\s*\(Lot\s*#[\d,]+\s*\)\s*/gi,
    /\s*\|\s*Bring a Trailer\s*/gi,
    /\s*on bringatrailer\.com\s*/gi,
  ];
  let cleaned = s;
  let hasBat = false;
  for (const p of batPatterns) {
    if (p.test(cleaned)) { hasBat = true; cleaned = cleaned.replace(p, ' '); }
  }
  if (hasBat && (cleaned.includes(' for sale') || /sold for \$/i.test(cleaned) || /Lot\s*#/i.test(cleaned))) {
    if (cleaned.trim().length === 0 || cleaned.length > 100) return '';
  }
  cleaned = cleaned.trim().replace(/\s+/g, ' ');
  if (cleaned.includes(' - $') || (cleaned.includes(' - ') && /\$[\d,]+/.test(cleaned))) {
    const parts = cleaned.split(/\s*-\s*(?=\$|\()/);
    if (parts.length > 0) {
      let pc = parts[0].trim().replace(/\s*\(\d+of\d+\)\s*$/i, '').replace(/[-\u2013\u2014]\s*$/, '').replace(/\s*-\s*(BLACK|WHITE|RED|BLUE|GREEN|SILVER|GRAY|GREY|YELLOW|ORANGE|PURPLE|BROWN|BEIGE|TAN)\s*$/i, '').replace(/\s*\([A-Z][a-z]+\)\s*$/, '').trim();
      if (pc.length > 0 && pc.length < cleaned.length && pc.length < 60) cleaned = pc;
    }
  }
  if (cleaned.length > 80 && (/for sale/i.test(cleaned) || /auction/i.test(cleaned) || /listing/i.test(cleaned))) return '';
  return cleaned;
}

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
  'badge-vin': { border: 'var(--success)', color: 'var(--success)' },
  'badge-bat': { border: 'var(--info)', color: 'var(--info)' },
  'badge-user': { border: 'var(--text-secondary)', color: 'var(--text-secondary)' },
  'badge-ai': { border: 'var(--warning)', color: 'var(--warning)' },
  'badge-enrich': { border: 'var(--error)', color: 'var(--error)' },
  'badge-mod': { border: 'var(--warning)', color: 'var(--warning)', bg: 'var(--warning-dim)' },
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
/*  Epistemological layer computation (P15)                             */
/* ------------------------------------------------------------------ */

type EpistemologicalLayer = 'claim' | 'consensus' | 'inspection' | 'bedrock';

const LAYER_COLORS: Record<EpistemologicalLayer, string> = {
  claim: 'transparent',
  consensus: 'var(--info, #3b82f6)',
  inspection: 'var(--success, #10b981)',
  bedrock: 'var(--vp-brg, #006747)',
};

function computeEpistemologicalLayer(group: FieldEvidenceGroup | undefined): EpistemologicalLayer {
  if (!group || group.sources.length === 0) return 'claim';

  const sourceTypes = group.sources.map(s => s.source_type.toLowerCase());

  // Scientific test: has physical measurement source
  if (sourceTypes.some(s => s.includes('dyno') || s.includes('measurement') || s.includes('inspection_report'))) {
    return 'bedrock';
  }

  // Inspection: has photo-verified evidence
  if (sourceTypes.some(s => s.includes('photo_verified') || s.includes('vin_plate_photo'))) {
    return 'inspection';
  }

  // Consensus: 2+ independent source TYPES agree on the value
  const distinctSourceTypes = new Set(sourceTypes.map(s => {
    if (s.includes('vin') || s.includes('nhtsa')) return 'vin';
    if (s.includes('bat')) return 'bat';
    if (s.includes('ai') || s.includes('vision')) return 'ai';
    if (s.includes('user')) return 'user';
    if (s.includes('enrich')) return 'enrich';
    return s;
  }));

  // Check that distinct source types agree on value
  if (distinctSourceTypes.size >= 2) {
    const values = group.sources.map(s => (s.field_value || '').toLowerCase().trim());
    const primaryVal = values[0];
    const agreeing = values.filter(v => v === primaryVal || v.includes(primaryVal) || primaryVal.includes(v));
    if (agreeing.length >= 2) return 'consensus';
  }

  return 'claim';
}

/** Build a human-readable tooltip explaining why a field has its epistemological layer */
function buildLayerTooltip(layer: EpistemologicalLayer, group: FieldEvidenceGroup | undefined): string {
  if (!group || group.sources.length === 0) return 'Claim: no evidence sources';
  const sourceTypes = group.sources.map(s => s.source_type.toLowerCase());

  if (layer === 'bedrock') {
    const measurement = sourceTypes.find(s => s.includes('dyno') || s.includes('measurement') || s.includes('inspection_report'));
    return `Scientific test: ${(measurement || 'measurement').replace(/_/g, ' ')} data`;
  }

  if (layer === 'inspection') {
    return 'Inspection: photo-verified evidence on file';
  }

  if (layer === 'consensus') {
    const typeLabels: Record<string, string> = {
      vin: 'VIN decode', bat: 'BaT listing', ai: 'AI extraction',
      user: 'user input', enrich: 'enrichment',
    };
    const mapped = new Set(sourceTypes.map(s => {
      if (s.includes('vin') || s.includes('nhtsa')) return 'vin';
      if (s.includes('bat')) return 'bat';
      if (s.includes('ai') || s.includes('vision')) return 'ai';
      if (s.includes('user')) return 'user';
      if (s.includes('enrich')) return 'enrich';
      return s;
    }));
    const labels = [...mapped].map(k => typeLabels[k] || k).slice(0, 3);
    return `Consensus: ${labels.join(' + ')} agree`;
  }

  // claim — single source
  const typeLabels: Record<string, string> = {
    vin: 'VIN decode', bat: 'BaT listing', ai: 'AI extraction',
    user: 'user input', enrich: 'enrichment',
  };
  const st = sourceTypes[0];
  const label = st.includes('vin') || st.includes('nhtsa') ? typeLabels.vin :
    st.includes('bat') ? typeLabels.bat :
    st.includes('ai') || st.includes('vision') ? typeLabels.ai :
    st.includes('user') ? typeLabels.user :
    st.includes('enrich') ? typeLabels.enrich :
    st.replace(/_/g, ' ');
  return `Claim: ${label} (single source)`;
}

/* ------------------------------------------------------------------ */
/*  Modification detection                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Powerplant field deduplication (P12)                               */
/*  Token-based overlap detection — cosmetic only, no data mutation.   */
/*  Only hides fields whose tokens are fully contained in a higher-    */
/*  priority field. Skips hiding when provenance quality differs.      */
/* ------------------------------------------------------------------ */

function deduplicatePowerplant(
  fields: { field: string; value: string }[],
  evidence: FieldEvidenceMap,
): Set<string> {
  const priority = ['engine_type', 'engine_size', 'fuel_system_type', 'fuel_type'];
  const seenTokens = new Set<string>();
  const hide = new Set<string>();

  /** Check if two fields have meaningfully different provenance quality.
   *  If the candidate-to-hide has a higher-trust source type than the
   *  field that would subsume it, we keep both visible — the provenance
   *  difference is meaningful even if surface values overlap. */
  function hasHigherProvenanceQuality(candidateField: string, subsumingField: string): boolean {
    const candidateGroup = evidence[candidateField];
    const subsumingGroup = evidence[subsumingField];
    if (!candidateGroup || !subsumingGroup) return false;
    // Compare primary source types
    const candidateSrc = candidateGroup.primary.source_type.toLowerCase();
    const subsumingSrc = subsumingGroup.primary.source_type.toLowerCase();
    // VIN/NHTSA is the gold standard — if the candidate comes from VIN and the
    // subsuming field doesn't, the provenance difference is meaningful
    const isVin = (s: string) => s.includes('vin') || s.includes('nhtsa');
    if (isVin(candidateSrc) && !isVin(subsumingSrc)) return true;
    return false;
  }

  // Special rule: fuel_type is hidden if fuel_system_type exists and is non-empty
  // ("Gasoline" is implied by "Carburetor")
  const fuelSystem = fields.find(f => f.field === 'fuel_system_type');
  const fuelType = fields.find(f => f.field === 'fuel_type');
  if (fuelSystem && fuelType && fuelSystem.value && fuelType.value) {
    if (!hasHigherProvenanceQuality('fuel_type', 'fuel_system_type')) {
      hide.add('fuel_type');
    }
  }

  for (const fieldName of priority) {
    const entry = fields.find(f => f.field === fieldName);
    if (!entry || hide.has(fieldName)) continue;
    const tokens = entry.value.toLowerCase().split(/[\s,/()-]+/).filter(t => t.length > 1);

    // If ALL tokens in this field already appeared in a higher-priority field, hide it
    const newTokens = tokens.filter(t => !seenTokens.has(t));
    if (newTokens.length === 0 && tokens.length > 0) {
      // Find which higher-priority field subsumed this one
      const subsumingField = priority.find(p => {
        if (p === fieldName) return false;
        const pEntry = fields.find(f => f.field === p);
        if (!pEntry || hide.has(p)) return false;
        const pTokens = pEntry.value.toLowerCase().split(/[\s,/()-]+/).filter(t => t.length > 1);
        return tokens.every(t => pTokens.includes(t));
      });
      // Only hide if provenance quality is not higher on the candidate
      if (!subsumingField || !hasHigherProvenanceQuality(fieldName, subsumingField)) {
        hide.add(fieldName);
      }
    }
    tokens.forEach(t => seenTokens.add(t));
  }

  return hide;
}

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
      background: colors.bg || 'var(--surface-elevated)',
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
  onValueClick?: () => void;
}> = ({ field, label, displayValue, group, isMod, isOpen, onToggle, onValueClick }) => {
  const [hovered, setHovered] = useState(false);

  // Compute epistemological layer (P15)
  const layer = useMemo(() => computeEpistemologicalLayer(group), [group]);
  const layerTooltip = useMemo(() => buildLayerTooltip(layer, group), [layer, group]);

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
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        borderLeft: layer !== 'claim' ? `3px solid ${LAYER_COLORS[layer]}` : 'none',
        paddingLeft: layer !== 'claim' ? '0px' : '0px',
      }}
      data-field={field}
      title={layer !== 'claim' ? layerTooltip : undefined}
    >
      <div
        onClick={group && group.sources.length > 0 ? onToggle : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="dossier-field-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr auto 20px',
          alignItems: 'center',
          padding: layer !== 'claim' ? '4px 10px 4px 7px' : '4px 10px',
          minHeight: '28px',
          cursor: group && group.sources.length > 0 ? 'pointer' : 'default',
          background: isOpen ? 'var(--surface-hover)' : (hovered && !isOpen ? 'var(--bg)' : 'transparent'),
          transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Label */}
        <span style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>

        {/* Value */}
        <span
          style={{
            fontFamily: field === 'vin' ? "'Courier New', Courier, monospace" : 'Arial, Helvetica, sans-serif',
            fontSize: '10px',
            color: 'var(--text)',
            padding: '0 8px',
            letterSpacing: field === 'vin' ? '1px' : 'normal',
            cursor: onValueClick ? 'pointer' : undefined,
            textDecoration: onValueClick ? 'underline dotted' : undefined,
          }}
          onClick={onValueClick ? (e) => { e.stopPropagation(); onValueClick(); } : undefined}
        >
          {displayValue || '\u2014'}
        </span>

        {/* Source badges — only visible on hover or when expanded to reduce clutter */}
        <span style={{
          display: 'flex',
          gap: '3px',
          alignItems: 'center',
          flexWrap: 'wrap',
          opacity: hovered || isOpen ? 1 : 0.3,
          transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {sourceBadges.length > 0 && !hovered && !isOpen ? (
            <span style={{
              fontFamily: "'Courier New', monospace",
              fontSize: '7px',
              color: 'var(--text-disabled)',
            }}>
              {sourceBadges.length}×
            </span>
          ) : (
            sourceBadges.map(c => (
              <Badge key={c.key} text={c.key} cls={c.cls} />
            ))
          )}
          {isMod && <Badge text="MOD" cls="badge-mod" />}
        </span>

        {/* Expand icon */}
        <span style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '8px',
          color: 'var(--text-disabled)',
          textAlign: 'center',
          userSelect: 'none',
          transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
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
  const { vehicle, canEdit, isVerifiedOwner, isMobile, setGalleryFilter } = useVehicleProfile();
  const navigate = useNavigate();
  const { evidence, loading } = useFieldEvidence(vehicle?.id);

  // Auto-expand fields with multi-source evidence
  const autoExpandFields = useMemo(() => {
    const candidates = ['drivetrain', 'engine_type', 'fuel_system_type'];
    const set = new Set<string>();
    for (const f of candidates) {
      const g = evidence[f];
      if (g && g.sources.length > 1) set.add(f);
    }
    return set;
  }, [evidence]);

  const [openDrawers, setOpenDrawers] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [powerplantExpanded, setPowerplantExpanded] = useState(false);

  // Initialize auto-expanded drawers once evidence loads
  React.useEffect(() => {
    if (!initialized && autoExpandFields.size > 0) {
      setOpenDrawers(new Set(autoExpandFields));
      setInitialized(true);
    }
  }, [autoExpandFields, initialized]);

  const toggleDrawer = (field: string) => {
    setOpenDrawers(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const modFields = useMemo(() => detectModifications(evidence), [evidence]);
  const hasModification = modFields.size > 0 || (vehicle as any)?.is_modified === true;

  // Coverage
  const withEvidence = useMemo(() => {
    return FIELD_ORDER.filter(f => evidence[f] && evidence[f].sources.length > 0).length;
  }, [evidence]);
  const coverage = withEvidence / FIELD_ORDER.length;
  // Count fields with 2+ distinct sources for "multi-source" label
  const multiSourceCount = useMemo(() => {
    return FIELD_ORDER.filter(f => evidence[f] && evidence[f].sources.length >= 2).length;
  }, [evidence]);
  const isMultiSource = multiSourceCount >= 5 && coverage >= 0.5;
  const verificationLabel = isMultiSource ? 'MULTI-SOURCE VERIFIED' : coverage >= 0.5 ? 'PARTIAL VERIFICATION' : 'UNVERIFIED';
  const verificationClass = isMultiSource ? 'verified' : 'partial';

  // Epistemological layer distribution (P15)
  const layerDistribution = useMemo(() => {
    let bedrock = 0, inspection = 0, consensus = 0, claims = 0, empty = 0;
    for (const f of FIELD_ORDER) {
      const group = evidence[f];
      if (!group || group.sources.length === 0) {
        empty++;
        continue;
      }
      const layer = computeEpistemologicalLayer(group);
      if (layer === 'bedrock') bedrock++;
      else if (layer === 'inspection') inspection++;
      else if (layer === 'consensus') consensus++;
      else claims++;
    }
    return { bedrock, inspection, consensus, claims, empty, total: FIELD_ORDER.length };
  }, [evidence]);

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
      {/* Identity stripped — YMM, VIN, owner, badges are in the sticky badge bar.
           Go straight to the spec table. */}
      <div style={{ display: 'none' }}>
        <span data-verification={verificationLabel} data-class={verificationClass} />
        {canEdit && <span data-can-edit="true" data-vehicle-id={vehicle?.id} />}
        <span>{ymm}</span>
        {v.vin && (
          <div style={{
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: '11px',
            color: 'var(--text)',
            marginTop: '4px',
            letterSpacing: '1px',
          }}>
            {v.vin}
          </div>
        )}
        {isVerifiedOwner && (() => {
          const ownerName = (v.sale_status === 'sold' || v.sale_price > 0)
            ? (v.bat_buyer?.trim() || null)
            : (v.bat_seller?.trim() || null);
          if (!ownerName) return null;
          return (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: '4px',
            }}>
              <span style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
              }}>
                OWNER
              </span>
              <span style={{
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: '10px',
                color: 'var(--success)',
              }}>
                @{ownerName}
              </span>
              <span style={{
                display: 'inline-block',
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: '8px',
                fontWeight: 700,
                letterSpacing: '0.5px',
                padding: '1px 5px',
                border: '2px solid var(--success)',
                background: 'var(--success)',
                color: 'var(--surface-elevated)',
                lineHeight: 1.4,
              }}>
                VERIFIED
              </span>
            </div>
          );
        })()}
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
                    border: '2px solid var(--accent)',
                    background: 'var(--accent)',
                    color: 'var(--surface-elevated)',
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
        background: 'var(--surface-elevated)',
        border: '2px solid var(--accent)',
        marginBottom: '8px',
      }}>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          padding: '6px 10px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
        }}>
          VEHICLE INFORMATION
        </div>

        {FIELD_GROUPS.map((fg, gi) => {
          // Collect visible fields for this group
          const visibleFields = fg.fields.filter(field => {
            let pv = v[field];
            if ((pv == null || pv === '') && evidence[field]?.sources?.length > 0) {
              pv = evidence[field].primary.field_value;
            }
            return !!fmtVal(field, pv);
          });
          if (visibleFields.length === 0) return null;

          // P12: Powerplant deduplication — compute hidden fields
          let hiddenFields = new Set<string>();
          if (fg.label === 'POWERPLANT' && !powerplantExpanded) {
            const fieldEntries = visibleFields.map(field => {
              const group = evidence[field] || evidence[field.replace(/[\s-]/g, '_').toLowerCase()];
              let pv = v[field];
              if ((pv == null || pv === '') && group && group.sources.length > 0) {
                pv = group.primary.field_value;
              }
              return { field, value: fmtVal(field, pv) };
            });
            hiddenFields = deduplicatePowerplant(fieldEntries, evidence);
          }
          const shownFields = visibleFields.filter(f => !hiddenFields.has(f));
          const collapsedCount = hiddenFields.size;

          return (
            <React.Fragment key={fg.label}>
              {gi > 0 && (
                <div style={{
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  fontSize: '8px',
                  fontWeight: 700,
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  padding: '4px 10px',
                  color: 'var(--text-disabled)',
                  borderBottom: '1px solid var(--border)',
                }}>
                  {fg.label}
                </div>
              )}
              {shownFields.map(field => {
                const normalized = field.replace(/[\s-]/g, '_').toLowerCase();
                const group = evidence[field] || (normalized !== field ? evidence[normalized] : undefined);
                let pv = v[field];
                if ((pv == null || pv === '') && group && group.sources.length > 0) {
                  pv = group.primary.field_value;
                }
                const displayValue = fmtVal(field, pv);
                if (!displayValue) return null;
                // Color/interior_color fields emit gallery filter on value click
                const colorFilterClick = field === 'color'
                  ? () => setGalleryFilter({ category: 'exterior' })
                  : field === 'interior_color'
                    ? () => setGalleryFilter({ category: 'interior' })
                    : undefined;
                return (
                  <FieldRow
                    key={field}
                    field={field}
                    label={FIELD_LABELS[field] || field.toUpperCase().replace(/_/g, ' ')}
                    displayValue={displayValue}
                    group={group}
                    isMod={modFields.has(field)}
                    isOpen={openDrawers.has(field)}
                    onToggle={() => toggleDrawer(field)}
                    onValueClick={colorFilterClick}
                  />
                );
              })}
              {/* P12: Collapsed fields indicator for POWERPLANT */}
              {fg.label === 'POWERPLANT' && collapsedCount > 0 && (
                <div
                  onClick={() => setPowerplantExpanded(true)}
                  style={{
                    fontFamily: 'Arial, Helvetica, sans-serif',
                    fontSize: '7px',
                    color: 'var(--text-disabled)',
                    padding: '2px 10px 3px',
                    cursor: 'pointer',
                    letterSpacing: '0.3px',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {collapsedCount} related field{collapsedCount > 1 ? 's' : ''} collapsed
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* Extended Specifications */}
        {(() => {
          const extFields = EXTENDED_FIELDS.filter(({ key }) => {
            const val = v[key];
            return val != null && val !== '';
          });
          if (extFields.length === 0) return null;
          return (
            <>
              <div style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '9px',
                fontWeight: 700,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                padding: '6px 10px',
                background: 'var(--surface)',
                borderTop: '1px solid var(--border)',
                borderBottom: '1px solid var(--border)',
              }}>
                EXTENDED SPECIFICATIONS
              </div>
              {extFields.map(({ key, label, formatter }) => {
                const raw = formatter ? formatter(v[key]) : String(v[key]);
                const displayValue = sanitizeInlineValue(raw);
                if (!displayValue) return null;
                const normalized = key.replace(/[\s-]/g, '_').toLowerCase();
                const group = evidence[key] || (normalized !== key ? evidence[normalized] : undefined);
                return (
                  <FieldRow
                    key={key}
                    field={key}
                    label={label}
                    displayValue={displayValue}
                    group={group}
                    isMod={modFields.has(key)}
                    isOpen={openDrawers.has(key)}
                    onToggle={() => toggleDrawer(key)}
                  />
                );
              })}
            </>
          );
        })()}
      </div>

      {/* Provenance Coverage with epistemological layer distribution (P15) */}
      <div style={{
        background: 'var(--surface-elevated)',
        border: '2px solid var(--accent)',
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
        {/* Segmented layer distribution bar */}
        <div style={{
          width: '100%',
          height: '6px',
          background: 'var(--border)',
          marginBottom: '4px',
          display: 'flex',
        }}>
          {layerDistribution.bedrock > 0 && (
            <div
              title={`${layerDistribution.bedrock} scientifically tested`}
              style={{
                height: '100%',
                width: `${Math.round((layerDistribution.bedrock / layerDistribution.total) * 100)}%`,
                background: 'var(--vp-brg, #006747)',
                transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          )}
          {layerDistribution.inspection > 0 && (
            <div
              title={`${layerDistribution.inspection} physically inspected`}
              style={{
                height: '100%',
                width: `${Math.round((layerDistribution.inspection / layerDistribution.total) * 100)}%`,
                background: 'var(--success, #10b981)',
                transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          )}
          {layerDistribution.consensus > 0 && (
            <div
              title={`${layerDistribution.consensus} multi-source consensus`}
              style={{
                height: '100%',
                width: `${Math.round((layerDistribution.consensus / layerDistribution.total) * 100)}%`,
                background: 'var(--info, #3b82f6)',
                transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          )}
          {layerDistribution.claims > 0 && (
            <div
              title={`${layerDistribution.claims} single-source claims`}
              style={{
                height: '100%',
                width: `${Math.round((layerDistribution.claims / layerDistribution.total) * 100)}%`,
                background: 'var(--text-disabled)',
                transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          )}
        </div>
        {/* Layer distribution summary text */}
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text-secondary)',
        }}>
          {[
            layerDistribution.bedrock > 0 ? `${layerDistribution.bedrock} BEDROCK` : null,
            layerDistribution.inspection > 0 ? `${layerDistribution.inspection} INSPECTED` : null,
            layerDistribution.consensus > 0 ? `${layerDistribution.consensus} CONSENSUS` : null,
            `${layerDistribution.claims} CLAIMS`,
            `${layerDistribution.empty} EMPTY`,
          ].filter(Boolean).join(' \u00B7 ')}
        </div>
      </div>

      {/* Data Quality Score */}
      {typeof (v as any).data_quality_score === 'number' && (
        <div style={{
          background: 'var(--surface-elevated)',
          border: '2px solid var(--accent)',
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
            DATA QUALITY
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: '12px',
              fontWeight: 700,
              color: (v as any).data_quality_score >= 70 ? 'var(--success)' : (v as any).data_quality_score >= 40 ? 'var(--warning)' : 'var(--error)',
            }}>
              {Math.round((v as any).data_quality_score)}/100
            </span>
            <div style={{
              flex: 1,
              height: '4px',
              background: 'var(--border)',
            }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, Math.max(0, (v as any).data_quality_score))}%`,
                background: (v as any).data_quality_score >= 70 ? 'var(--success)' : (v as any).data_quality_score >= 40 ? 'var(--warning)' : 'var(--error)',
                transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }} />
            </div>
          </div>
        </div>
      )}

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
      background: 'var(--surface-elevated)',
      border: '2px solid var(--accent)',
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
          color: 'var(--text-secondary)',
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
                color: 'var(--text-secondary)',
              }}>
                {d.label}
              </span>
              <div style={{ height: '4px', background: 'var(--border)', alignSelf: 'center' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, Math.max(0, d.value))}%`,
                  background: d.value >= 70 ? 'var(--success)' : d.value >= 40 ? 'var(--warning)' : 'var(--error)',
                }} />
              </div>
              <span style={{
                fontFamily: "'Courier New', Courier, monospace",
                color: 'var(--text)',
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
