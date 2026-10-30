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
import { Link, useNavigate } from 'react-router-dom';
import { useVehicleProfile } from './VehicleProfileContext';
import { usePopup } from '../../components/popups/usePopup';
import { supabase } from '../../lib/supabase';
import { useFieldEvidence, type FieldEvidenceMap, type FieldEvidenceGroup } from './hooks/useFieldEvidence';
import { useVehiclePriceFacts, priceKindLabel } from './hooks/useVehiclePriceFacts';
import { useFieldProvenance, formatProvenanceValue, provenanceCoverageUnavailable } from './hooks/useFieldProvenance';
import FieldProvenanceDrawer, { SourceBadge } from './FieldProvenanceDrawer';

const FieldEvidencePopup = React.lazy(() => import('./FieldEvidencePopup'));

type StructuredClaim = {
  property_key: string; property_id: string; observation_id: string;
  value: string | number; unit: string | null; source_url: string | null;
  observed_at: string | null; ingested_at: string | null;
  qualifiers?: { claim_role?: string; current_configuration_status?: string; factory_configuration_status?: string;
    observed_at_basis?: string; limitation?: string };
};
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Read admitted claims from the existing canonical owner, without promoting
 * a source assertion into a verified factory/current specification. */
const StructuredProfileClaims: React.FC<{ vehicleId: string }> = ({ vehicleId }) => {
  const [read, setRead] = useState<{ id: string; status: 'loading' | 'ready' | 'failed'; claims: StructuredClaim[] }>(
    { id: vehicleId, status: 'loading', claims: [] });
  React.useEffect(() => {
    if (!UUID.test(vehicleId)) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setRead({ id: vehicleId, status: 'loading', claims: [] });
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_vehicle_specs', {
          p_vehicle_ids: [vehicleId], p_include_typed_claims: true,
        }).abortSignal(controller.signal);
        const model = Array.isArray(data) && data.length === 1 ? data[0] : null;
        if (error || model?.vehicle_id !== vehicleId || model.schema_version !== 'vehicle_data_model_v1'
          || model.typed_claims_status !== 'current_core_scope_read' || !Array.isArray(model.typed_claims)) throw Error('Unavailable structured claims');
        const claims: StructuredClaim[] = model.typed_claims;
        if (!claims.every(c => c && /^[a-z][a-z0-9_]*$/.test(c.property_key)
          && UUID.test(c.property_id) && UUID.test(c.observation_id)
          && (c.unit === null || typeof c.unit === 'string')
          && (c.observed_at === null || typeof c.observed_at === 'string')
          && (c.ingested_at === null || typeof c.ingested_at === 'string')
          && (!c.qualifiers || (typeof c.qualifiers === 'object' &&
            ['claim_role', 'current_configuration_status', 'factory_configuration_status', 'observed_at_basis', 'limitation']
              .every(key => c.qualifiers?.[key as keyof NonNullable<StructuredClaim['qualifiers']>] == null
                || typeof c.qualifiers?.[key as keyof NonNullable<StructuredClaim['qualifiers']>] === 'string')))
          && (typeof c.value === 'string' || (typeof c.value === 'number' && Number.isFinite(c.value))))) throw Error('Invalid structured claims');
        if (active) setRead({ id: vehicleId, status: 'ready', claims });
      } catch {
        if (active) setRead({ id: vehicleId, status: 'failed', claims: [] });
      } finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [vehicleId]);
  if (!UUID.test(vehicleId)) return null;
  const current = read.id === vehicleId ? read : { status: 'loading', claims: [] };
  return <section aria-label="Structured source claims" className="vp-structured-claims">
    <h3>Structured source claims</h3>
    {current.status === 'loading' ? <p role="status">Reading structured evidence…</p>
      : current.status === 'failed' ? <p role="status">Structured evidence could not be read. Missing information has not been established.</p>
      : current.claims.length === 0 ? <p>No admitted core claims returned. Retained descriptions and records may still contain unprocessed evidence.</p>
      : <dl>{current.claims.map(claim => {
        let external: string | null = null;
        try { const url = new URL(claim.source_url || ''); if (url.protocol === 'https:' || url.protocol === 'http:') external = url.href; } catch { /* Retain the internal evidence link. */ }
        return <div key={`${claim.property_id}:${claim.observation_id}`} className="vp-structured-claims__row">
          <dt>{claim.property_key.replaceAll('_', ' ')}</dt>
          <dd>
            {String(claim.value)}{claim.unit ? ` ${claim.unit}` : ''}
            <div className="vp-structured-claims__source">
              <Link to={`/vehicle/${vehicleId}/observation/${claim.observation_id}`}>Evidence</Link>
              {external && <> · <a href={external} target="_blank" rel="noopener noreferrer">Original source</a></>}
              {' · '}{claim.qualifiers?.claim_role?.replaceAll('_', ' ') || 'Attributed claim'}
              <div>Recorded: {claim.ingested_at || 'Unknown'} · Observation clock: {claim.observed_at || 'Unknown'}</div>
              <div>Clock basis: {claim.qualifiers?.observed_at_basis?.replaceAll('_', ' ') || 'Unknown'}</div>
              <div>Factory configuration: {claim.qualifiers?.factory_configuration_status || 'unknown'} · Current configuration: {claim.qualifiers?.current_configuration_status || 'unknown'}</div>
              {claim.qualifiers?.limitation && <div>{claim.qualifiers.limitation}</div>}
            </div>
          </dd>
        </div>;
      })}</dl>}
  </section>;
};

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
  { label: 'POWERPLANT', fields: ['engine_configuration', 'engine_displacement_l', 'engine_type', 'engine_size', 'fuel_type', 'fuel_system_type'] },
  { label: 'DRIVETRAIN', fields: ['transmission', 'drivetrain'] },
  { label: 'APPEARANCE', fields: ['color', 'interior_color', 'body_style'] },
  { label: 'METRICS', fields: ['mileage', 'sale_price'] },
];

const FIELD_LABELS: Record<string, string> = {
  vin: 'VIN', year: 'YEAR', make: 'MAKE', model: 'MODEL',
  engine_type: 'ENGINE TYPE', engine_size: 'ENGINE SIZE',
  engine_configuration: 'ENGINE CONFIGURATION', engine_displacement_l: 'DISPLACEMENT',
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
/*  Retained claims: source categories do not establish verification    */
/* ------------------------------------------------------------------ */

function buildClaimTooltip(group: FieldEvidenceGroup | undefined): string {
  const count = group?.sources.length ?? 0;
  if (count === 0) return 'No retained claims loaded for this field. Verification unknown.';
  return `${count} retained claim record${count === 1 ? '' : 's'}. Independent support and verification unknown.${group?.hasConflict ? ' Reported values differ; no resolution is established.' : ''}`;
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
    <span className="vp-source-badge" style={{
      border: `1px solid ${colors.border}`,
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
  retainedClaimTooltip?: string;
}> = ({ field, label, displayValue, group, isMod, isOpen, onToggle, onValueClick, retainedClaimTooltip }) => {
  const [hovered, setHovered] = useState(false);

  const claimTooltip = useMemo(() => buildClaimTooltip(group), [group]);

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
      }}
      data-field={field}
      title={retainedClaimTooltip || claimTooltip}
    >
      <div
        onClick={group && group.sources.length > 0 ? onToggle : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="dossier-field-grid"
        style={{
          cursor: group && group.sources.length > 0 ? 'pointer' : 'default',
          background: isOpen ? 'var(--surface-hover)' : (hovered && !isOpen ? 'var(--bg)' : 'transparent'),
          transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Label */}
        <span className="dossier-field-label">
          {label}
        </span>

        {/* Value */}
        <span
          role={onValueClick ? 'button' : undefined}
          tabIndex={onValueClick ? 0 : undefined}
          aria-label={onValueClick ? `${label}: ${displayValue}. Inspect evidence` : undefined}
          className={`dossier-field-value${field === 'vin' ? ' dossier-field-value--vin' : ''}`}
          onClick={onValueClick ? (e) => { e.stopPropagation(); onValueClick(); } : undefined}
          onKeyDown={onValueClick ? e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onValueClick(); }
          } : undefined}
        >
          {displayValue || '\u2014'}
        </span>

        {/* Retain a readable source count even before a pointer hovers the row. */}
        <span className="dossier-field-sources">
          {sourceBadges.length > 0 && !hovered && !isOpen ? (
            <span className="dossier-source-count" title={`${sourceBadges.length} source types`}>
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
        <button type="button" aria-label={`${isOpen ? 'Hide' : 'Show'} ${label} source claims`}
          aria-expanded={isOpen} aria-controls={`provenance-drawer-${field}`}
          disabled={!group || group.sources.length === 0}
          className="dossier-field-expand"
          onClick={e => { e.stopPropagation(); onToggle(); }}>
          {group && group.sources.length > 0 ? '\u25B6' : ''}
        </button>
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
  const { vehicle, vehicleId, canEdit, isVerifiedOwner, isMobile, setGalleryFilter } = useVehicleProfile();
  const navigate = useNavigate();
  const { openPopup } = usePopup();
  const { evidence, loading, error: evidenceError } = useFieldEvidence(vehicle?.id);
  const configuration = useFieldProvenance(vehicle?.id || '', 'engine_configuration');
  const displacement = useFieldProvenance(vehicle?.id || '', 'engine_displacement_l');
  const vinRead = useFieldProvenance(vehicle?.id || '', 'vin');
  const vinConsensus = (vinRead.data as any)?.identifier_consensus as { status?: string; canonical_value?: string; citation_summary?: string } | undefined;
  const engineReads: Record<string, typeof configuration> = { engine_configuration: configuration, engine_displacement_l: displacement };
  const engineValue = (field: string) => {
    const read = engineReads[field];
    if (!read || read.isLoading || read.error || !read.data || read.data.canonical?.status === 'unavailable') return '';
    if (read.data.canonical?.status === 'resolved') return formatProvenanceValue(field, read.data.canonical.value!);
    return read.data.observations.length > 0 ? 'Unknown' : '';
  };
  const engineReadFailed = [configuration, displacement].some(read => !!read.error || provenanceCoverageUnavailable(read.data) || read.data?.canonical?.status === 'unavailable');
  // the SALE PRICE row is the typed price said as what it is (sold / bid / ask), never a raw sale_price
  const { priceFacts, priceSettled, priceFailed } = useVehiclePriceFacts(vehicle?.id);
  const priceKind = priceSettled && !priceFailed ? priceKindLabel(priceFacts) : null;

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
  const differingValuesCount = useMemo(() => {
    return FIELD_ORDER.filter(f => evidence[f]?.sources.length > 0 && evidence[f].hasConflict).length;
  }, [evidence]);

  // Identity badges
  const badges = useMemo(() => {
    if (!vehicle) return [];
    const v = vehicle as any;
    const b: Array<{ text: string; cls: string }> = [];
    if (priceKind === 'Sold') {
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
  }, [vehicle, evidence, hasModification, priceKind]);

  if (!vehicle) return null;

  const v = vehicle as any;

  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ').toUpperCase().trim();

  return (
    <div>
      {/* Identity stripped — YMM, VIN, owner, badges are in the sticky badge bar.
           Go straight to the spec table. */}
      <div style={{ display: 'none' }}>
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
                fontFamily: 'Arial, sans-serif',
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
      <div className="vp-dossier-panel">
        <div className="vp-dossier-panel__title">Vehicle information</div>

        <StructuredProfileClaims vehicleId={vehicle?.id || ''} />

        {FIELD_GROUPS.map((fg, gi) => {
          // Collect visible fields for this group
          const visibleFields = fg.fields.filter(field => {
            if (engineReads[field]) return !!engineValue(field);
            if (field === 'vin') return true; // Unknown canonical identity still has a useful source drill.
            if (field === 'sale_price') return !!priceKind;
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
            // Distinct resolved fields own the summary; preserve combined source text in the existing expansion.
            if (configuration.data?.canonical?.status === 'resolved' && displacement.data?.canonical?.status === 'resolved') {
              for (const field of ['engine_type', 'engine_size']) if (visibleFields.includes(field)) hiddenFields.add(field);
            }
          }
          const shownFields = visibleFields.filter(f => !hiddenFields.has(f));
          const collapsedCount = hiddenFields.size;

          return (
            <React.Fragment key={fg.label}>
              {gi > 0 && (
                <div className="vp-dossier-panel__group">
                  {fg.label}
                </div>
              )}
              {shownFields.map(field => {
                const normalized = field.replace(/[\s-]/g, '_').toLowerCase();
                const group = evidence[field] || (normalized !== field ? evidence[normalized] : undefined);
                let pv = v[field];
                if (field !== 'vin' && (pv == null || pv === '') && group && group.sources.length > 0) {
                  pv = group.primary.field_value;
                }
                let displayValue = fmtVal(field, pv);
                if (engineReads[field]) displayValue = engineValue(field);
                if (field === 'vin' && !displayValue && vinConsensus?.status === 'resolved' && vinConsensus.canonical_value) {
                  // Column empty: resolve from cited claims; format rules only flag.
                  displayValue = `${vinConsensus.canonical_value}${vinConsensus.citation_summary ? ` · ${vinConsensus.citation_summary}` : ''}`;
                }
                if (field === 'vin' && !displayValue) displayValue = 'Unknown';
                let fieldLabel = FIELD_LABELS[field] || field.toUpperCase().replace(/_/g, ' ');
                if (field === 'sale_price') {
                  const on = priceFacts?.price_as_of
                    ? new Date(priceFacts.price_as_of).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
                    : null;
                  displayValue = priceKind ? fmtVal(field, priceFacts?.price_amount) + (on ? ` · ${on}` : '') : '';
                  fieldLabel = priceKind === 'Sold' ? 'SALE PRICE' : (priceKind || '').toUpperCase();
                }
                // the listing's own qualifier on the reading, e.g. BaT "10k Miles Shown, TMU" -> "10,000 mi · shown, TMU"
                const mileageClaim = field === 'mileage' ? evidence['mileage_claim']?.primary?.field_value : null;
                if (mileageClaim && displayValue) displayValue = `${displayValue} · ${mileageClaim}`;
                if (!displayValue) return null;
                // Every field value opens its evidence popup — click-through chain
                const handleValueClick = () => {
                  // Color fields also set gallery filter
                  if (field === 'color') setGalleryFilter({ category: 'exterior' });
                  if (field === 'interior_color') setGalleryFilter({ category: 'interior' });
                  // Open evidence popup for all fields
                  const vinDecode = field === 'vin' ? (v.origin_metadata?.vin_decode || v.vin_decode || null) : null;
                  openPopup(
                    <React.Suspense fallback={<div style={{ padding: '12px', fontSize: 'var(--text-callout)' }}>Loading evidence...</div>}>
                      <FieldEvidencePopup
                        field={field}
                        label={fieldLabel}
                        value={displayValue}
                        vehicleId={vehicle.id}
                        evidence={engineReads[field] ? undefined : group}
                        vinDecode={vinDecode}
                      />
                    </React.Suspense>,
                    `${fieldLabel} — ${displayValue}`,
                    Math.min(480, window.innerWidth - 24),
                    false,
                  );
                };
                return (
                  <FieldRow
                    key={field}
                    field={field}
                    label={fieldLabel}
                    displayValue={displayValue}
                    group={group}
                    isMod={modFields.has(field)}
                    isOpen={openDrawers.has(field)}
                    onToggle={() => toggleDrawer(field)}
                    onValueClick={handleValueClick}
                    retainedClaimTooltip={engineReads[field] ? 'Retained source claims. Vehicle identity, factory/current configuration and independent support are not established by these reports.' : undefined}
                  />
                );
              })}
              {/* P12: Collapsed fields indicator for POWERPLANT */}
              {fg.label === 'POWERPLANT' && collapsedCount > 0 && (
                <button type="button"
                  onClick={() => setPowerplantExpanded(true)}
                  className="vp-dossier-expand-fields"
                >
                  {collapsedCount} original or overlapping field{collapsedCount > 1 ? 's' : ''} · expand
                </button>
              )}
            </React.Fragment>
          );
        })}
        {engineReadFailed && <p role="status">Engine source claims could not be read completely. Their absence has not been established.</p>}

        {/* Extended Specifications */}
        {(() => {
          const extFields = EXTENDED_FIELDS.filter(({ key }) => {
            const val = v[key];
            return val != null && val !== '';
          });
          if (extFields.length === 0) return null;
          return (
            <>
              <div className="vp-dossier-panel__title">Extended specifications</div>
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
                    onValueClick={() => openPopup(
                      <React.Suspense fallback={<div style={{ padding: '12px', fontSize: 'var(--text-callout)' }}>Loading evidence...</div>}>
                        <FieldEvidencePopup
                          field={key}
                          label={label}
                          value={displayValue}
                          vehicleId={vehicle.id}
                          evidence={group}
                        />
                      </React.Suspense>,
                      `${label} — ${displayValue}`,
                      Math.min(480, window.innerWidth - 24),
                      false,
                    )}
                  />
                );
              })}
            </>
          );
        })()}
      </div>

      {/* Claim presence uses a fixed core-field denominator, not a verification tier. */}
      <div data-testid="source-claim-coverage" className="vp-source-coverage">
        <h4>Source claim coverage</h4>
        {evidenceError ? <p role="status">Source claim coverage unavailable.</p>
          : loading ? <p role="status">Loading source claim coverage…</p>
          : <>
            <div role="img" aria-label={`${withEvidence} of ${FIELD_ORDER.length} core fields have claim records`}
              style={{ height: '6px', background: 'var(--border)', margin: '4px 0' }}>
              <div style={{ height: '100%', width: `${withEvidence / FIELD_ORDER.length * 100}%`, background: 'var(--text-secondary)' }} />
            </div>
            <div>{withEvidence} of {FIELD_ORDER.length} core fields have claim records · {differingValuesCount} have differing reported values</div>
          </>}
        <p style={{ margin: '4px 0 0' }}>Claim record counts do not establish independent support or verification.</p>
      </div>


      {/* Condition Score (if available) */}
      <ConditionScoreSection vehicleId={vehicle.id} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Stored condition assessment — source/calibration not exposed        */
/* ------------------------------------------------------------------ */

export const ConditionScoreSection: React.FC<{ vehicleId: string }> = ({ vehicleId }) => {
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

  const reportedScore = score.condition_score != null && Number.isFinite(Number(score.condition_score))
    && Number(score.condition_score) >= 0 && Number(score.condition_score) <= 100
    ? Number(score.condition_score) : null;
  const domains = [
    { label: 'EXTERIOR', value: score.exterior_score },
    { label: 'INTERIOR', value: score.interior_score },
    { label: 'MECHANICAL', value: score.mechanical_score },
    { label: 'PROVENANCE', value: score.provenance_score },
    { label: 'PRESENTATION', value: score.presentation_score },
  ].filter(d => d.value != null && Number.isFinite(Number(d.value)) && Number(d.value) >= 0 && Number(d.value) <= 100);

  if (reportedScore == null && domains.length === 0) return null;

  return (
    <div style={{
      background: 'var(--surface-elevated)',
      border: '2px solid var(--border)',
      padding: '8px 10px',
      marginBottom: '8px',
    }}>
      <div style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: '9px',
        fontWeight: 700,
        letterSpacing: '1px',
        textTransform: 'uppercase',
        marginBottom: '6px',
      }}>
        STORED CONDITION ASSESSMENT
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
        <span style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '20px',
          fontWeight: 700,
        }}>
          {reportedScore != null ? Math.round(reportedScore) : 'Unknown'}
        </span>
        <span style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '9px',
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {reportedScore != null && <>/ 100 &middot; reported score</>}
          {score.condition_tier && <> &middot; reported tier: {score.condition_tier}</>}
        </span>
      </div>
      {domains.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 30px', gap: '2px 8px', fontSize: '8px' }}>
          {domains.map(d => (
            <React.Fragment key={d.label}>
              <span style={{
                fontFamily: 'Arial, sans-serif',
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
                  background: 'var(--text-secondary)',
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
      <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '6px' }}>
        Inputs, method and assessment time unavailable. Condition matching unverified.
        {score.percentile_within_ymm != null && (
          <div>Reported percentile: {score.percentile_within_ymm} &middot; comparison group, size and eligibility unavailable.</div>
        )}
      </div>
    </div>
  );
};

export default VehicleDossierPanel;
