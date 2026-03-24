// terminationRules.ts — Static connector termination lookup tables
// Maps connector families to catalog part numbers for wire termination BOM.
// Pure TypeScript. No React. No Supabase. No side effects.

// ── Interfaces ──────────────────────────────────────────────────────

export interface ConnectorTerminationSpec {
  connectorFamily: string;
  housingPN: string;
  contactPN_male: string;
  contactPN_female: string;
  pinSealPN?: string;
  wedgeLockPN?: string;
  bootPN?: string;
  crimpToolPN: string;
  contactGaugeRange: [number, number]; // AWG [min, max] — lower number = thicker
}

export interface EndpointTermination {
  housing: string;
  contactMale: string;
  contactFemale: string;
  pinSeal: string | null;
  wedgeLock: string | null;
  boot: string | null;
  crimpTool: string;
  heatShrink: { size: string; pn: string };
  label: string;
}

// ── Connector Termination Map ───────────────────────────────────────
// Housing PNs use 'x' as placeholder for pin count (resolved at lookup time)

function spec(
  f: string, h: string, m: string, fe: string, cr: string, g: [number, number],
  opts?: { seal?: string; wedge?: string },
): ConnectorTerminationSpec {
  return {
    connectorFamily: f, housingPN: h, contactPN_male: m, contactPN_female: fe,
    crimpToolPN: cr, contactGaugeRange: g,
    ...(opts?.seal ? { pinSealPN: opts.seal } : {}),
    ...(opts?.wedge ? { wedgeLockPN: opts.wedge } : {}),
  };
}

export const CONNECTOR_TERMINATION_MAP: Record<string, ConnectorTerminationSpec[]> = {
  deutsch_dtm: [
    spec('deutsch_dtm', 'DTM04-xP', '0460-202-20141', '0462-201-20141', 'HDT-48-00', [16, 22],
      { seal: '1010-009-0205', wedge: 'WM-xS' }),
  ],
  deutsch_dt: [
    spec('deutsch_dt', 'DT04-xP', '0460-202-16141', '0462-201-16141', 'HDT-48-00', [14, 20],
      { seal: '1010-009-0205', wedge: 'W-xP' }),
  ],
  deutsch_dtp: [
    spec('deutsch_dtp', 'DTP04-xP', '0460-204-12141', '0462-203-12141', 'HDT-48-00', [8, 14],
      { seal: '1010-009-0406' }),
  ],
  deutsch_369: [
    spec('deutsch_369', '369-xx-xxx', '0460-215-16141', '0462-215-16141', 'HDT-48-00', [14, 20]),
  ],
  superseal_1_0: [
    spec('superseal_1_0', 'SS-1.0-xP', '1-968855-1', '1-968857-1', 'PRO-CRIMPER-III', [16, 22],
      { seal: '1-967658-1' }),
  ],
  weatherpack: [
    spec('weatherpack', '12010996', '12077411', '12089188', '12014254', [14, 20],
      { seal: '15324980' }),
  ],
  packard_56: [
    spec('packard_56', '12020827', '12077568', '12077411', '12014254', [14, 20]),
  ],
  mil_spec: [
    spec('mil_spec', 'D38999/26WA98SN', 'M39029/58-360', 'M39029/57-354', 'M22520/2-01', [12, 22]),
  ],
  uscar_ev6: [
    spec('uscar_ev6', 'EV6-F', 'EV6-M-TERM', 'EV6-F-TERM', 'PRO-CRIMPER-III', [16, 20]),
  ],
  amp_junior: [
    spec('amp_junior', '282080-1', '63523-1', '66358-4', 'PRO-CRIMPER-III', [16, 22]),
  ],
  ring_terminal: [
    spec('ring_terminal', 'N/A', 'RT-16-1/4', 'RT-16-1/4', 'HDT-48-00', [14, 22]),
    spec('ring_terminal', 'N/A', 'RT-10-3/8', 'RT-10-3/8', 'HDT-48-00', [8, 12]),
  ],
  butt_splice: [
    spec('butt_splice', 'N/A', 'BSV-18', 'BSV-18', 'HDT-48-00', [14, 22]),
    spec('butt_splice', 'N/A', 'BSV-10', 'BSV-10', 'HDT-48-00', [8, 12]),
  ],
} as const satisfies Record<string, ConnectorTerminationSpec[]>;

// ── Heat Shrink Map ─────────────────────────────────────────────────

export const HEAT_SHRINK_MAP = [
  { gaugeMin: 20, gaugeMax: 22, size: '3/16"', pn: 'DR-25-3/16' },
  { gaugeMin: 16, gaugeMax: 18, size: '1/4"',  pn: 'DR-25-1/4' },
  { gaugeMin: 12, gaugeMax: 14, size: '3/8"',  pn: 'DR-25-3/8' },
  { gaugeMin: 8,  gaugeMax: 10, size: '1/2"',  pn: 'DR-25-1/2' },
] as const;

// ── Boot Map ────────────────────────────────────────────────────────

export const BOOT_MAP: Record<string, Record<number, string>> = {
  deutsch_dtm: {
    2: 'RBT-DTM2', 3: 'RBT-DTM3', 4: 'RBT-DTM4',
    6: 'RBT-DTM6', 8: 'RBT-DTM8', 12: 'RBT-DTM12',
  },
  deutsch_dt: {
    2: 'RBT-DT2', 3: 'RBT-DT3', 4: 'RBT-DT4',
    6: 'RBT-DT6', 8: 'RBT-DT8', 12: 'RBT-DT12',
  },
  deutsch_dtp: { 2: 'RBT-DTP2', 4: 'RBT-DTP4' },
} as const;

// ── Crimp Tool Map ──────────────────────────────────────────────────

export const CRIMP_TOOL_MAP: Record<string, string> = {
  deutsch_dtm: 'HDT-48-00',
  deutsch_dt: 'HDT-48-00',
  deutsch_dtp: 'HDT-48-00',
  deutsch_369: 'HDT-48-00',
  superseal_1_0: 'PRO-CRIMPER-III',
  weatherpack: '12014254',
  packard_56: '12014254',
  mil_spec: 'M22520/2-01',
  uscar_ev6: 'PRO-CRIMPER-III',
  amp_junior: 'PRO-CRIMPER-III',
  ring_terminal: 'HDT-48-00',
  butt_splice: 'HDT-48-00',
} as const;

// ── Helper Functions ────────────────────────────────────────────────

/**
 * Look up heat shrink spec for a given wire gauge.
 * Returns the DR-25 size and part number that covers the AWG range.
 */
export function getHeatShrinkSpec(gaugeAWG: number): { size: string; pn: string } {
  for (const entry of HEAT_SHRINK_MAP) {
    if (gaugeAWG >= entry.gaugeMin && gaugeAWG <= entry.gaugeMax) {
      return { size: entry.size, pn: entry.pn };
    }
  }
  // Fallback for gauges outside mapped range
  if (gaugeAWG < 8) return { size: '1/2"', pn: 'DR-25-1/2' };
  return { size: '3/16"', pn: 'DR-25-3/16' };
}

/**
 * Format wire label text.
 * Format: W{num} {shortName} {gauge}ga {color}
 * shortName is truncated to 12 chars.
 */
export function getLabelText(
  wireNumber: number,
  deviceName: string,
  gaugeAWG: number,
  color: string,
): string {
  const shortName = deviceName.length > 12 ? deviceName.slice(0, 12) : deviceName;
  return `W${wireNumber} ${shortName} ${gaugeAWG}ga ${color}`;
}

/**
 * Resolve full termination BOM for a single wire endpoint.
 * Finds the matching connector spec by family and gauge, then assembles
 * housing, contacts, seals, boot, heat shrink, crimp tool, and label.
 *
 * @param connectorFamily - Key from CONNECTOR_TERMINATION_MAP (e.g. 'deutsch_dtm')
 * @param pinCount - Number of pins on the connector (used for boot/wedgelock lookup)
 * @param gaugeAWG - Wire gauge in AWG
 * @returns Full endpoint termination spec, or null values for unknown families
 */
export function getTerminationForEndpoint(
  connectorFamily: string,
  pinCount: number,
  gaugeAWG: number,
): EndpointTermination {
  const specs = CONNECTOR_TERMINATION_MAP[connectorFamily];
  const heatShrink = getHeatShrinkSpec(gaugeAWG);

  if (!specs || specs.length === 0) {
    return {
      housing: 'UNKNOWN',
      contactMale: 'UNKNOWN',
      contactFemale: 'UNKNOWN',
      pinSeal: null,
      wedgeLock: null,
      boot: null,
      crimpTool: 'UNKNOWN',
      heatShrink,
      label: '',
    };
  }

  // Find spec matching gauge range (lower AWG number = thicker wire)
  const spec = specs.find(
    (s) => gaugeAWG >= s.contactGaugeRange[0] && gaugeAWG <= s.contactGaugeRange[1],
  ) ?? specs[0];

  // Resolve parametric housing PN — replace 'x' with pin count
  const housing = spec.housingPN.replace(/x/g, String(pinCount));

  // Resolve wedge lock PN
  const wedgeLock = spec.wedgeLockPN
    ? spec.wedgeLockPN.replace(/x/g, String(pinCount))
    : null;

  // Look up boot from BOOT_MAP
  const bootFamily = BOOT_MAP[connectorFamily];
  const boot = bootFamily ? (bootFamily[pinCount] ?? null) : null;

  return {
    housing,
    contactMale: spec.contactPN_male,
    contactFemale: spec.contactPN_female,
    pinSeal: spec.pinSealPN ?? null,
    wedgeLock,
    boot,
    crimpTool: spec.crimpToolPN,
    heatShrink,
    label: '',
  };
}
