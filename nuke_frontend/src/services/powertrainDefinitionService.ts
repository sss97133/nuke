export type PowertrainSpecKind = 'transmission' | 'engine';

export type PowertrainSpecDefinition = {
  kind: PowertrainSpecKind;
  /** The normalized key used for lookup (e.g., "TH350", "LS3"). */
  key: string;
  /** Short token label shown on cards. */
  label: string;
  /** Human title for the popover header. */
  title: string;
  /** One-sentence definition. */
  summary: string;
  /** Optional bullets for deeper details. */
  details?: string[];
  /** Whether the definition is from the built-in canonical map. */
  known: boolean;
};

const normalizeKey = (raw: unknown): string => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // Keep alphanumerics + a few separators, then collapse.
  const upper = s.toUpperCase();
  return upper.replace(/[^A-Z0-9]/g, '');
};

const transmissionMap: Record<string, Omit<PowertrainSpecDefinition, 'kind' | 'key' | 'known'>> = {
  // Generic types (reduces "unmapped" spam for common scraped values)
  AUTOMATIC: {
    label: 'Auto',
    title: 'Automatic Transmission',
    summary: 'Automatic transmission (exact model unspecified).',
    details: ['Model-specific behavior varies (gearing, overdrive, control type).'],
  },
  MANUAL: {
    label: 'Manual',
    title: 'Manual Transmission',
    summary: 'Manual transmission (exact model unspecified).',
    details: ['Model-specific behavior varies (gear count, ratios, synchros).'],
  },
  CVT: {
    label: 'CVT',
    title: 'Continuously Variable Transmission (CVT)',
    summary: 'Automatic transmission with a continuously variable ratio (not fixed gears).',
    details: ['Common in many modern applications; behavior varies by design.'],
  },
  DCT: {
    label: 'DCT',
    title: 'Dual-Clutch Transmission (DCT)',
    summary: 'Automated transmission using two clutches for rapid gear changes.',
    details: ['Often described as "DCT", "DSG", or similar depending on brand.'],
  },
  DSG: {
    label: 'DSG',
    title: 'Direct-Shift Gearbox (DSG)',
    summary: 'A type of dual-clutch transmission (brand-specific naming).',
    details: ['Common term in VAG applications; still a DCT conceptually.'],
  },
  PDK: {
    label: 'PDK',
    title: 'Porsche Doppelkupplung (PDK)',
    summary: 'Porsche dual-clutch transmission.',
    details: ['A DCT; exact model varies by platform/year.'],
  },

  TH350: {
    label: 'TH350',
    title: 'Turbo-Hydramatic 350 (TH350)',
    summary: '3-speed automatic transmission without overdrive.',
    details: [
      'Common GM automatic used in many 1969–1986 vehicles.',
      'Hydraulic control (non-electronic).',
      'Overdrive: No.',
    ],
  },
  TH400: {
    label: 'TH400',
    title: 'Turbo-Hydramatic 400 (TH400)',
    summary: 'Heavy-duty 3-speed automatic transmission without overdrive.',
    details: [
      'Common GM automatic used in many performance and truck applications.',
      'Hydraulic control (non-electronic).',
      'Overdrive: No.',
    ],
  },
  SM465: {
    label: 'SM465',
    title: 'SM465',
    summary: '4-speed manual transmission with a very low first gear ("granny low").',
    details: [
      'Common GM truck manual used in many 1968–1991 applications.',
      'Overdrive: No.',
      'Often paired with 4x4 trucks and towing setups.',
    ],
  },
  NV4500: {
    label: 'NV4500',
    title: 'NV4500',
    summary: '5-speed manual transmission with overdrive.',
    details: [
      'Common in 1990s–2000s trucks (varies by make/application).',
      'Overdrive: Yes.',
    ],
  },
  T56: {
    label: 'T56',
    title: 'T56',
    summary: '6-speed manual transmission (performance-oriented).',
    details: [
      'Common in modern performance applications.',
      'Overdrive: Yes (typically).',
    ],
  },
  '4L60E': {
    label: '4L60E',
    title: '4L60E',
    summary: '4-speed automatic transmission with overdrive (electronically controlled).',
    details: [
      'Common GM automatic in 1990s–2000s applications.',
      'Overdrive: Yes.',
    ],
  },
  '4L65E': {
    label: '4L65E',
    title: '4L65E',
    summary: '4-speed automatic transmission with overdrive (electronically controlled).',
    details: [
      'Variant of GM 4L60E family; application-specific internals.',
      'Overdrive: Yes.',
    ],
  },
  '4L70E': {
    label: '4L70E',
    title: '4L70E',
    summary: '4-speed automatic transmission with overdrive (electronically controlled).',
    details: [
      'Variant of GM 4L60E family used in some performance/late applications.',
      'Overdrive: Yes.',
    ],
  },
  '4L80E': {
    label: '4L80E',
    title: '4L80E',
    summary: 'Heavy-duty 4-speed automatic transmission with overdrive (electronically controlled).',
    details: [
      'Common GM heavy-duty automatic in truck/HD applications.',
      'Overdrive: Yes.',
    ],
  },
  '6L80': {
    label: '6L80',
    title: '6L80',
    summary: '6-speed automatic transmission with overdrive (electronically controlled).',
    details: ['Common GM 6-speed automatic family.', 'Overdrive: Yes.'],
  },
  '6L80E': {
    label: '6L80E',
    title: '6L80E',
    summary: '6-speed automatic transmission with overdrive (electronically controlled).',
    details: ['Common GM 6-speed automatic family.', 'Overdrive: Yes.'],
  },
  '6L90': {
    label: '6L90',
    title: '6L90',
    summary: 'Heavy-duty 6-speed automatic transmission with overdrive.',
    details: ['Common GM heavy-duty 6-speed automatic family.', 'Overdrive: Yes.'],
  },
  '6L90E': {
    label: '6L90E',
    title: '6L90E',
    summary: 'Heavy-duty 6-speed automatic transmission with overdrive.',
    details: ['Common GM heavy-duty 6-speed automatic family.', 'Overdrive: Yes.'],
  },
  '10L80': {
    label: '10L80',
    title: '10L80',
    summary: '10-speed automatic transmission with overdrive.',
    details: ['Common modern 10-speed automatic family.', 'Overdrive: Yes.'],
  },
  '10L90': {
    label: '10L90',
    title: '10L90',
    summary: '10-speed automatic transmission with overdrive.',
    details: ['Common modern 10-speed automatic family.', 'Overdrive: Yes.'],
  },
  '700R4': {
    label: '700R4',
    title: '700R4',
    summary: '4-speed automatic transmission with overdrive.',
    details: [
      'Common GM overdrive automatic in many 1980s applications.',
      'Overdrive: Yes.',
    ],
  },
  AOD: {
    label: 'AOD',
    title: 'AOD',
    summary: '4-speed automatic transmission with overdrive.',
    details: [
      'Common Ford overdrive automatic in many 1980s–1990s applications.',
      'Overdrive: Yes.',
    ],
  },
  '6R80': {
    label: '6R80',
    title: '6R80',
    summary: '6-speed automatic transmission with overdrive.',
    details: ['Common Ford 6-speed automatic family.', 'Overdrive: Yes.'],
  },
  '10R80': {
    label: '10R80',
    title: '10R80',
    summary: '10-speed automatic transmission with overdrive.',
    details: ['Common Ford 10-speed automatic family.', 'Overdrive: Yes.'],
  },
  C6: {
    label: 'C6',
    title: 'C6',
    summary: 'Heavy-duty 3-speed automatic transmission without overdrive.',
    details: [
      'Common Ford automatic used in many truck and performance applications.',
      'Overdrive: No.',
    ],
  },
  TR6060: {
    label: 'TR6060',
    title: 'Tremec TR-6060',
    summary: '6-speed manual transmission (performance-oriented).',
    details: ['Common in modern performance applications.', 'Overdrive: Yes (typically).'],
  },
  ZF6: {
    label: 'ZF6',
    title: 'ZF 6-speed (ZF6)',
    summary: '6-speed manual transmission (truck-oriented).',
    details: [
      'Common in various truck applications depending on make/year.',
      'Overdrive: Yes (typically).',
    ],
  },
};

const engineMap: Record<string, Omit<PowertrainSpecDefinition, 'kind' | 'key' | 'known'>> = {
  // Generic families (reduces "unmapped" noise for scraped engines like "V8")
  V8: {
    label: 'V8',
    title: 'V8 Engine',
    summary: 'V8 engine (exact displacement/model unspecified).',
    details: ['Specific family, displacement, and era determine exact specs.'],
  },
  V6: {
    label: 'V6',
    title: 'V6 Engine',
    summary: 'V6 engine (exact displacement/model unspecified).',
    details: ['Specific family, displacement, and era determine exact specs.'],
  },
  I4: {
    label: 'I4',
    title: 'Inline-4 Engine',
    summary: 'Inline-4 engine (exact displacement/model unspecified).',
    details: ['Specific family, displacement, and era determine exact specs.'],
  },
  I6: {
    label: 'I6',
    title: 'Inline-6 Engine',
    summary: 'Inline-6 engine (exact displacement/model unspecified).',
    details: ['Specific family, displacement, and era determine exact specs.'],
  },
  LS1: {
    label: 'LS1',
    title: 'GM LS1',
    summary: '5.7L V8 in the GM LS-family.',
    details: [
      'Aluminum V8 (common in late-1990s/2000s performance applications).',
      'Architecture: pushrod (OHV).',
    ],
  },
  LS2: {
    label: 'LS2',
    title: 'GM LS2',
    summary: '6.0L V8 in the GM LS-family.',
    details: [
      'Common in mid-2000s performance applications.',
      'Architecture: pushrod (OHV).',
    ],
  },
  LS3: {
    label: 'LS3',
    title: 'GM LS3',
    summary: '6.2L V8 in the GM LS-family.',
    details: [
      'Common in modern performance applications.',
      'Architecture: pushrod (OHV).',
    ],
  },
  LT1: {
    label: 'LT1',
    title: 'LT1',
    summary: 'V8 engine designation used by GM in multiple eras (context matters).',
    details: [
      'This label is ambiguous across decades; verify year/application for exact spec.',
    ],
  },
  '2JZ': {
    label: '2JZ',
    title: 'Toyota 2JZ',
    summary: 'Inline-6 engine family (commonly 3.0L).',
    details: [
      'Often referenced as 2JZ-GE (NA) or 2JZ-GTE (turbo).',
    ],
  },
  CUMMINS59: {
    label: '5.9 Cummins',
    title: 'Cummins 5.9L',
    summary: 'Turbo-diesel inline-6 engine family (5.9L).',
    details: [
      'Common in truck applications; exact generation varies by year.',
    ],
  },
};

const tryParseEngineKey = (raw: unknown): string => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const upper = s.toUpperCase();

  // Direct family codes
  if (upper.includes('LS2')) return 'LS2';
  if (upper.includes('LS3')) return 'LS3';
  if (upper.includes('LS1')) return 'LS1';
  if (upper.match(/\bLT1\b/)) return 'LT1';
  if (upper.match(/\bV8\b/)) return 'V8';
  if (upper.match(/\bV6\b/)) return 'V6';
  if (upper.match(/\bI4\b/) || upper.includes('INLINE 4') || upper.includes('INLINE-4') || upper.includes('4 CYL')) return 'I4';
  if (upper.match(/\bI6\b/) || upper.includes('INLINE 6') || upper.includes('INLINE-6') || upper.includes('6 CYL')) return 'I6';
  if (upper.includes('2JZ')) return '2JZ';

  // Cummins 5.9 variations
  if (upper.includes('CUMMINS') && (upper.includes('5.9') || upper.includes('59'))) return 'CUMMINS59';

  return '';
};

export function getTransmissionDefinition(raw: unknown): PowertrainSpecDefinition | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  const hit = transmissionMap[key];
  if (hit) {
    return {
      kind: 'transmission',
      key,
      known: true,
      ...hit,
    };
  }

  // Unknown: provide a safe placeholder so the UI can still show "depth" without hallucinating.
  const label = String(raw ?? '').trim();
  if (!label) return null;
  return {
    kind: 'transmission',
    key,
    label: label.length > 24 ? `${label.slice(0, 24)}…` : label,
    title: label,
    summary: 'Definition not mapped yet. Click-through exists so we can expand this canon over time.',
    details: [
      'Provenance (factory vs installed vs rebuilt) will be shown here once field sources are wired.',
    ],
    known: false,
  };
}

export function getEngineDefinition(raw: unknown): PowertrainSpecDefinition | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const parsedKey = tryParseEngineKey(s);
  const key = parsedKey || normalizeKey(s);

  const hit = parsedKey ? engineMap[parsedKey] : engineMap[key];
  if (hit) {
    return {
      kind: 'engine',
      key: parsedKey || key,
      known: true,
      ...hit,
    };
  }

  return {
    kind: 'engine',
    key,
    label: s.length > 24 ? `${s.slice(0, 24)}…` : s,
    title: s,
    summary: 'Definition not mapped yet. Click-through exists so we can expand this canon over time.',
    details: [
      'Provenance (factory vs installed vs rebuilt) will be shown here once field sources are wired.',
    ],
    known: false,
  };
}

