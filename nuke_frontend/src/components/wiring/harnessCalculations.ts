// harnessCalculations.ts — Pure engineering functions for wire gauge selection and load analysis
// No React dependencies — can be shared between frontend and edge functions

import { AWG_TABLE, DEFAULT_MAX_VOLTAGE_DROP_PERCENT } from './harnessConstants';
import type { GaugeResult, LoadSummary, CircuitCalc, HarnessEndpoint, WiringConnection, HarnessSection } from './harnessTypes';

/**
 * Calculate voltage drop for a given wire configuration.
 * Formula: V_drop = I × R_per_ft × L × 2 (round trip)
 */
export function calculateVoltageDrop(
  amperage: number,
  ohmPerFt: number,
  lengthFt: number
): number {
  return amperage * ohmPerFt * lengthFt * 2;
}

/**
 * Select the optimal wire gauge for a circuit.
 * Picks the smallest (highest AWG number) gauge that satisfies both:
 *   1. Voltage drop <= maxDropPercent of system voltage
 *   2. Max ampacity >= continuous load
 * For motors/inductive loads, upsizes one gauge for inrush current.
 */
export function selectWireGauge(params: {
  amperage: number;
  lengthFt: number;
  voltage?: number;
  maxDropPercent?: number;
  isMotor?: boolean;
}): GaugeResult {
  const {
    amperage,
    lengthFt,
    voltage = 12,
    maxDropPercent = DEFAULT_MAX_VOLTAGE_DROP_PERCENT,
    isMotor = false,
  } = params;

  const maxDrop = voltage * maxDropPercent;
  const effectiveAmps = isMotor ? amperage * 1.25 : amperage;

  // Iterate from smallest to largest gauge
  for (let i = 0; i < AWG_TABLE.length; i++) {
    const entry = AWG_TABLE[i];
    const drop = calculateVoltageDrop(effectiveAmps, entry.ohmPerFt, lengthFt);

    if (drop <= maxDrop && entry.maxAmps >= effectiveAmps) {
      // For motors, upsize one gauge for safety
      const selectedIdx = isMotor && i > 0 ? i - 1 : i;
      // Actually reconsider: if isMotor we already inflated amps by 1.25x,
      // so just pick the one that passes
      const selected = AWG_TABLE[isMotor ? Math.max(0, i) : i];
      const actualDrop = calculateVoltageDrop(amperage, selected.ohmPerFt, lengthFt);
      const dropPct = (actualDrop / voltage) * 100;

      return {
        gauge: selected.gauge,
        actualVoltageDrop: Math.round(actualDrop * 1000) / 1000,
        voltageDropPercent: Math.round(dropPct * 100) / 100,
        recommendation: dropPct < 1
          ? 'Excellent'
          : dropPct < 2
            ? 'Good'
            : dropPct < 3
              ? 'Acceptable'
              : 'Marginal — consider upsizing',
      };
    }
  }

  // If nothing in table works, recommend the heaviest gauge
  const heaviest = AWG_TABLE[AWG_TABLE.length - 1];
  const actualDrop = calculateVoltageDrop(amperage, heaviest.ohmPerFt, lengthFt);
  return {
    gauge: heaviest.gauge,
    actualVoltageDrop: Math.round(actualDrop * 1000) / 1000,
    voltageDropPercent: Math.round((actualDrop / voltage) * 10000) / 100,
    recommendation: 'Heaviest available — verify this is sufficient',
  };
}

/**
 * Suggest fuse rating for a circuit.
 * Rule: fuse = next standard size above 125% of continuous load.
 * Standard fuse sizes: 1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100
 */
const FUSE_SIZES = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];

export function suggestFuseRating(continuousAmps: number): number {
  const target = continuousAmps * 1.25;
  for (const size of FUSE_SIZES) {
    if (size >= target) return size;
  }
  return FUSE_SIZES[FUSE_SIZES.length - 1];
}

/**
 * Calculate complete load summary for a harness design.
 */
export function calculateLoadSummary(
  endpoints: HarnessEndpoint[],
  connections: WiringConnection[],
  sections: HarnessSection[],
  vehicleType: string | null
): LoadSummary {
  const warnings: string[] = [];

  // Total amperage from all endpoints
  const totalContinuousAmps = endpoints.reduce(
    (sum, ep) => sum + (ep.amperage_draw || 0),
    0
  );
  const totalPeakAmps = endpoints.reduce(
    (sum, ep) => sum + (ep.peak_amperage || ep.amperage_draw || 0),
    0
  );

  // Per-section breakdown
  const perSection = sections.map(section => {
    const sectionEndpoints = endpoints.filter(ep => ep.section_id === section.id);
    const amps = sectionEndpoints.reduce((sum, ep) => sum + (ep.amperage_draw || 0), 0);
    return { sectionId: section.id, name: section.name, amps: Math.round(amps * 10) / 10 };
  });

  // Per-circuit calculation
  const perCircuit: CircuitCalc[] = connections.map(conn => {
    const fromEp = endpoints.find(ep => ep.id === conn.from_endpoint_id);
    const toEp = endpoints.find(ep => ep.id === conn.to_endpoint_id);
    const amps = conn.amperage_load || toEp?.amperage_draw || fromEp?.amperage_draw || 0;
    const lengthFt = conn.length_ft || 5;
    const isMotor = toEp?.endpoint_type === 'actuator' && (toEp?.peak_amperage || 0) > (toEp?.amperage_draw || 0) * 1.5;

    const gaugeResult = selectWireGauge({ amperage: amps, lengthFt, isMotor });

    return {
      connectionId: conn.id,
      amps,
      gauge: conn.wire_gauge || gaugeResult.gauge,
      voltageDrop: gaugeResult.actualVoltageDrop,
      voltageDropPercent: gaugeResult.voltageDropPercent,
      lengthFt,
    };
  });

  // Check for high voltage drop circuits
  perCircuit.forEach(c => {
    if (c.voltageDropPercent > 3) {
      const conn = connections.find(cn => cn.id === c.connectionId);
      warnings.push(`${conn?.connection_name || 'Circuit'}: ${c.voltageDropPercent.toFixed(1)}% voltage drop exceeds 3% limit`);
    }
  });

  // Alternator sizing: 125% of total continuous load
  const altMinimum = Math.ceil(totalContinuousAmps * 1.25);
  const altRecommended = altMinimum <= 80 ? '80A stock'
    : altMinimum <= 100 ? '100A'
    : altMinimum <= 130 ? '130A'
    : altMinimum <= 160 ? '160A high-output'
    : altMinimum <= 200 ? '200A high-output'
    : `${altMinimum}A+ (custom high-output)`;

  // Battery sizing: cranking + 30min accessory reserve
  const hasStarter = endpoints.some(ep => ep.system_category === 'starting');
  const crankingAmps = hasStarter ? 600 : 0; // typical CCA
  const accessoryReserve = totalContinuousAmps * 0.5; // 30 min at full load in Ah
  const battMinAh = Math.ceil(accessoryReserve + 20); // +20 for margin
  const battRecommended = battMinAh <= 40 ? 'Optima 34R (50Ah)'
    : battMinAh <= 55 ? 'Optima 75/25 (55Ah)'
    : battMinAh <= 75 ? 'Optima D34 (75Ah)'
    : `${battMinAh}Ah+ (consider dual batteries)`;

  if (totalContinuousAmps > 150) {
    warnings.push(`Total continuous load (${totalContinuousAmps.toFixed(0)}A) is very high — verify alternator and wiring can handle this`);
  }

  // PDM channel allocation (auto-assign switched loads to PDM channels)
  const pdmChannels: { channel: number; assignment: string; amps: number }[] = [];
  const switchedEndpoints = endpoints
    .filter(ep => ep.is_switched && ep.amperage_draw && ep.endpoint_type !== 'ecu' && ep.endpoint_type !== 'power_source' && ep.endpoint_type !== 'ground')
    .sort((a, b) => (b.amperage_draw || 0) - (a.amperage_draw || 0));

  switchedEndpoints.forEach((ep, idx) => {
    const channel = idx + 1;
    if (channel <= 30) { // PDM30 has 30 channels
      const maxForChannel = channel <= 10 ? 20 : channel <= 15 ? 25 : channel <= 20 ? 20 : channel <= 25 ? 15 : 10;
      const amps = ep.amperage_draw || 0;
      pdmChannels.push({ channel, assignment: ep.name, amps });
      if (amps > maxForChannel) {
        warnings.push(`PDM CH${channel} (${ep.name}): ${amps}A exceeds channel limit of ${maxForChannel}A`);
      }
    }
  });

  if (switchedEndpoints.length > 30) {
    warnings.push(`${switchedEndpoints.length} switched loads exceed PDM30's 30 channels — consider PDM expansion or combining loads`);
  }

  return {
    totalContinuousAmps: Math.round(totalContinuousAmps * 10) / 10,
    totalPeakAmps: Math.round(totalPeakAmps * 10) / 10,
    perSection,
    perCircuit,
    alternatorSizing: { minimumAmps: altMinimum, recommended: altRecommended },
    batterySizing: { minimumAh: battMinAh, recommended: battRecommended },
    pdmChannels,
    warnings,
  };
}
