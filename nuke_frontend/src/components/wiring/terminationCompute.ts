// terminationCompute.ts — Pure termination calculator
// Input: WireSpec[] + ManifestDevice[] → TerminationRecord[] with BOM per endpoint.
// Deterministic. No network. No React. No side effects.

import type { WireSpec, ManifestDevice } from './overlayCompute';
import {
  type EndpointTermination,
  getTerminationForEndpoint,
  getHeatShrinkSpec,
  getLabelText,
  CONNECTOR_TERMINATION_MAP,
} from './terminationRules';

// ── Types ───────────────────────────────────────────────────────────

export interface WireEndpointBOM {
  deviceId: string;
  deviceName: string;
  connectorFamily: string;
  pinCount: number;
  termination: EndpointTermination;
  missingParts: string[];
}

export interface TerminationRecord {
  wireNumber: number;
  label: string;
  gauge: number;
  color: string;
  sourceEndpoint: WireEndpointBOM;
  deviceEndpoint: WireEndpointBOM;
  heatShrink: { size: string; pn: string };
  readyToTerminate: boolean;
  missingParts: string[];
}

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_CONNECTOR_FAMILY = 'deutsch_dtm';
const DEFAULT_PIN_COUNT = 2;

// ── Helpers ─────────────────────────────────────────────────────────

function resolveDevice(
  deviceId: string,
  deviceMap: Map<string, ManifestDevice>,
): { name: string; connectorFamily: string; pinCount: number } {
  const dev = deviceMap.get(deviceId);
  if (!dev) {
    return { name: deviceId, connectorFamily: DEFAULT_CONNECTOR_FAMILY, pinCount: DEFAULT_PIN_COUNT };
  }
  return {
    name: dev.device_name,
    connectorFamily: dev.connector_type ?? DEFAULT_CONNECTOR_FAMILY,
    pinCount: dev.pin_count ?? DEFAULT_PIN_COUNT,
  };
}

function buildEndpointBOM(
  deviceId: string,
  deviceName: string,
  connectorFamily: string,
  pinCount: number,
  gaugeAWG: number,
  wireNumber: number,
  color: string,
): WireEndpointBOM {
  const termination = getTerminationForEndpoint(connectorFamily, pinCount, gaugeAWG);
  termination.label = getLabelText(wireNumber, deviceName, gaugeAWG, color);

  const missingParts: string[] = [];
  if (termination.housing === 'UNKNOWN') missingParts.push('housing');
  if (termination.contactMale === 'UNKNOWN') missingParts.push('contact_male');
  if (termination.contactFemale === 'UNKNOWN') missingParts.push('contact_female');
  if (termination.crimpTool === 'UNKNOWN') missingParts.push('crimp_tool');

  // Check gauge compatibility
  const specs = CONNECTOR_TERMINATION_MAP[connectorFamily];
  if (specs && specs.length > 0) {
    const inRange = specs.some(
      (s) => gaugeAWG >= s.contactGaugeRange[0] && gaugeAWG <= s.contactGaugeRange[1],
    );
    if (!inRange) missingParts.push('gauge_out_of_range');
  }

  return { deviceId, deviceName, connectorFamily, pinCount, termination, missingParts };
}

// ── Main Computation ────────────────────────────────────────────────

/**
 * Compute termination BOM for every wire in the harness.
 * Each wire has two endpoints (source and device). For each endpoint,
 * resolves connector family from the device manifest, looks up catalog
 * part numbers, and flags missing parts.
 *
 * @param wires - All wires from overlayCompute
 * @param devices - All devices from the manifest
 * @returns TerminationRecord per wire, with readyToTerminate flag
 */
export function computeTerminations(
  wires: WireSpec[],
  devices: ManifestDevice[],
): TerminationRecord[] {
  const deviceMap = new Map(devices.map((d) => [d.id, d]));

  return wires.map((wire) => {
    const source = resolveDevice(wire.from, deviceMap);
    const target = resolveDevice(wire.to, deviceMap);

    const sourceEndpoint = buildEndpointBOM(
      wire.from, source.name, source.connectorFamily, source.pinCount,
      wire.gauge, wire.wireNumber, wire.color,
    );
    const deviceEndpoint = buildEndpointBOM(
      wire.to, target.name, target.connectorFamily, target.pinCount,
      wire.gauge, wire.wireNumber, wire.color,
    );

    const heatShrink = getHeatShrinkSpec(wire.gauge);
    const allMissing = [...sourceEndpoint.missingParts, ...deviceEndpoint.missingParts];

    return {
      wireNumber: wire.wireNumber,
      label: wire.label,
      gauge: wire.gauge,
      color: wire.color,
      sourceEndpoint,
      deviceEndpoint,
      heatShrink,
      readyToTerminate: allMissing.length === 0,
      missingParts: allMissing,
    };
  });
}

/**
 * Summarize termination readiness across the entire harness.
 */
export function summarizeTerminationReadiness(records: TerminationRecord[]): {
  total: number;
  ready: number;
  notReady: number;
  readyPct: number;
  missingPartFrequency: Record<string, number>;
} {
  const ready = records.filter((r) => r.readyToTerminate).length;
  const freq: Record<string, number> = {};
  for (const r of records) {
    for (const p of r.missingParts) {
      freq[p] = (freq[p] ?? 0) + 1;
    }
  }
  return {
    total: records.length,
    ready,
    notReady: records.length - ready,
    readyPct: records.length > 0 ? Math.round((ready / records.length) * 100) : 0,
    missingPartFrequency: freq,
  };
}
