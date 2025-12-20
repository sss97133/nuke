export type VehicleIdentitySource = {
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  normalized_model?: string | null;
  series?: string | null;
  trim?: string | null;
  transmission?: string | null;
  transmission_model?: string | null;
  mileage?: number | null;
};

export type VehicleIdentityOptions = {
  /**
   * Max differentiators to show inline after Y/M/M.
   * Keep this low to prevent "title creep" as data becomes richer.
   */
  maxDifferentiators?: number;
  /**
   * Transmission is not universally useful. Default is contextual:
   * - include when it’s high-signal for the niche (e.g., Porsche) AND it’s a strong signal (manual/PDK).
   */
  transmissionStrategy?: 'never' | 'contextual' | 'manual_only' | 'always';
};

export type VehicleIdentityTokenKind = 'year' | 'make' | 'model' | 'series' | 'trim' | 'transmission';

export type VehicleIdentityToken = {
  kind: VehicleIdentityTokenKind;
  value: string;
};

const escapeRegExp = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * DISPLAY-ONLY cleanup: strips common listing boilerplate from a field when the DB is contaminated.
 * This does NOT assert truth—it's a rendering hygiene layer until data is backfilled.
 */
export function sanitizeIdentityToken(raw: unknown, ctx?: { year?: number | null; make?: string | null }): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';

  // Drop trailing site name / SEO tails.
  s = s.split('|')[0].trim();

  // Remove common BaT boilerplate and auction-result tails.
  s = s.replace(/\bfor sale on BaT Auctions?\b/gi, '').trim();
  s = s.replace(/\bon\s+BaT\s+Auctions\b/gi, '').trim();
  s = s.replace(/\bBaT\s+Auctions\b/gi, '').trim();
  s = s.replace(/\bBring\s+a\s+Trailer\b/gi, '').trim();
  s = s.replace(/\bAuction\s+Result\b/gi, '').trim();
  s = s.replace(/\bsold for \$[\d,]+ on [A-Z][a-z]+ \d{1,2}, \d{4}\b/gi, '').trim();
  s = s.replace(/\bending\b[\s\S]*$/i, '').trim();

  // Remove lot number parenthetical.
  s = s.replace(/\(\s*Lot\s*#.*?\)\s*/gi, ' ').trim();
  
  // Remove "| Bring a Trailer" pattern
  s = s.replace(/\s*\|\s*Bring a Trailer\s*/gi, ' ').trim();

  // Remove leading mileage words like "42k-mile".
  s = s.replace(/^\s*\d{1,3}(?:,\d{3})?\s*[kK]\s*[-\s]*mile\s+/i, '').trim();
  s = s.replace(/^\s*\d{1,3}(?:,\d{3})+\s*[-\s]*mile\s+/i, '').trim();

  // Remove leading year/make if present (avoid "2001 Porsche Porsche ...").
  const year = ctx?.year ?? null;
  const make = (ctx?.make ?? '').trim();
  if (typeof year === 'number') {
    const yr = escapeRegExp(String(year));
    s = s.replace(new RegExp(`^\\s*${yr}\\s+`, 'i'), '').trim();
  } else {
    s = s.replace(/^\s*(19|20)\d{2}\s+/, '').trim();
  }
  if (make) {
    s = s.replace(new RegExp(`^\\s*${escapeRegExp(make)}\\s+`, 'i'), '').trim();
  }

  // Remove common listing contamination patterns:
  // "Model - COLOR - $Price (Location)" -> "Model"
  // "Model - $Price" -> "Model"
  if (s.includes(' - $') || (s.includes(' - ') && s.match(/\$[\d,]+/))) {
    // Split on " - $" or " - " followed by price pattern
    const parts = s.split(/\s*-\s*(?=\$|\([A-Z])/);
    if (parts.length > 0) {
      s = parts[0].trim();
    }
  }
  
  // Remove color patterns that might still be present
  s = s.replace(/\s*-\s*(BLACK|WHITE|RED|BLUE|GREEN|SILVER|GRAY|GREY|YELLOW|ORANGE|PURPLE|BROWN|BEIGE|TAN)\s*$/i, '').trim();
  
  // Remove location patterns like "(Torrance)", "(Los Angeles)"
  s = s.replace(/\s*\([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\)\s*$/g, '').trim();
  
  // Collapse whitespace + trim dangling separators.
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[-–—]\s*$/g, '').trim();

  // Guardrails: if it's still a paragraph or contains listing keywords, treat as unusable.
  if (s.length > 80) return '';
  // If it still contains listing contamination keywords, return empty
  if (s.toLowerCase().includes('for sale') && s.toLowerCase().includes('sold for')) return '';
  if (s.toLowerCase().includes('for sale') && s.match(/\$\d+/)) return ''; // "for sale" + price = contaminated
  if (s.toLowerCase().includes('auction') && (s.includes('$') || s.match(/Lot\s*#/i))) return '';
  // Remove "Euro" prefix that's often part of BaT contamination
  s = s.replace(/^\s*Euro\s+/i, '').trim();
  return s;
}

function isManualTransmission(transmissionRaw: string): boolean {
  const t = String(transmissionRaw || '').trim().toLowerCase();
  if (!t) return false;
  return /\b(manual|m\/t|mt|stick|three[-\s]?pedal|3[-\s]?pedal)\b/i.test(t);
}

export function getTransmissionDisplay(v: VehicleIdentitySource): string {
  const raw = String(v.transmission_model || v.transmission || '').trim();
  if (!raw) return '';

  const lower = raw.toLowerCase();
  const speed = (() => {
    const m = raw.match(/\b(\d{1,2})\s*[-\s]*speed\b/i);
    const n = m?.[1] ? Number(m[1]) : NaN;
    return Number.isFinite(n) ? String(n) : '';
  })();

  if (isManualTransmission(raw)) {
    return speed ? `${speed}-speed manual` : 'Manual';
  }

  // Collector-relevant non-manual signals (DB field only; no title inference)
  if (lower.includes('pdk')) return 'PDK';
  return '';
}

function shouldIncludeTransmissionByNiche(v: VehicleIdentitySource): boolean {
  const make = String(v.make || '').trim().toLowerCase();
  const model = String(v.normalized_model || v.model || '').trim().toLowerCase();

  // Start tight: only include transmission as a differentiator for niches where it’s consistently high-signal.
  if (make === 'porsche') return true;
  if (make === 'bmw' && /\bm\b|\b(m2|m3|m4|m5|m6)\b/.test(model)) return true;
  return false;
}

export function getVehicleIdentityParts(
  v: VehicleIdentitySource,
  opts: VehicleIdentityOptions = {}
): {
  primary: string[];        // year/make/model (always first)
  differentiators: string[]; // series/trim/transmission signals
} {
  const tokens = getVehicleIdentityTokens(v, opts);
  return {
    primary: tokens.primary.map(t => t.value),
    differentiators: tokens.differentiators.map(t => t.value),
  };
}

export function getVehicleIdentityTokens(
  v: VehicleIdentitySource,
  opts: VehicleIdentityOptions = {}
): {
  primary: VehicleIdentityToken[];
  differentiators: VehicleIdentityToken[];
  meta: Required<Pick<VehicleIdentityOptions, 'maxDifferentiators' | 'transmissionStrategy'>>;
} {
  const {
    maxDifferentiators = 3,
    transmissionStrategy = 'contextual',
  } = opts;

  const yearNum =
    typeof v.year === 'number'
      ? v.year
      : (typeof v.year === 'string' ? Number.parseInt(v.year, 10) : null);
  const year = Number.isFinite(yearNum as number) ? String(yearNum) : '';
  const make = String(v.make || '').trim();
  const ctx = { year: yearNum && Number.isFinite(yearNum) ? yearNum : null, make: make || null };

  const modelRaw = v.normalized_model || v.model || '';
  const model = sanitizeIdentityToken(modelRaw, ctx);
  const series = sanitizeIdentityToken(v.series, ctx);
  const trim = sanitizeIdentityToken(v.trim, ctx);
  const transmissionDisplay = getTransmissionDisplay(v);
  const rawTransmission = String(v.transmission_model || v.transmission || '').trim();
  const isManual = rawTransmission ? isManualTransmission(rawTransmission) : false;

  const includeTransmission = (() => {
    if (!transmissionDisplay) return false;
    if (transmissionStrategy === 'never') return false;
    if (transmissionStrategy === 'always') return true;
    if (transmissionStrategy === 'manual_only') return isManual;
    // contextual (default)
    // Only include if this niche cares AND the signal is strong (manual/PDK).
    return shouldIncludeTransmissionByNiche(v) && (isManual || transmissionDisplay === 'PDK');
  })();

  const primary: VehicleIdentityToken[] = [
    year ? { kind: 'year', value: year } : null,
    make ? { kind: 'make', value: make } : null,
    model ? { kind: 'model', value: model } : null,
  ].filter(Boolean) as VehicleIdentityToken[];

  const differentiatorsAll: VehicleIdentityToken[] = [
    series ? { kind: 'series', value: series } : null,
    trim ? { kind: 'trim', value: trim } : null,
    includeTransmission && transmissionDisplay ? { kind: 'transmission', value: transmissionDisplay } : null,
  ].filter(Boolean) as VehicleIdentityToken[];

  return {
    primary,
    differentiators: differentiatorsAll.slice(0, Math.max(0, maxDifferentiators)),
    meta: { maxDifferentiators, transmissionStrategy },
  };
}


