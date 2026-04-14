// useDRC.ts — Design Rule Check hook
// Runs 8 design rule checks against device manifest + pin maps + overlay result.
// Returns per-device severity map and summary counts.

import { useMemo } from 'react';
import type { ManifestDevice, OverlayResult } from './overlayCompute';
import { AWG_TABLE } from './harnessConstants';

// ── Types ─────────────────────────────────────────────────────────────

export interface DRCRule {
  ruleId: string;
  label: string;
  message: string;
  severity: 'pass' | 'warn' | 'fail';
}

export interface DRCDeviceResult {
  severity: 'pass' | 'warn' | 'fail';
  rules: DRCRule[];
}

export interface DRCSummary {
  pass: number;
  warn: number;
  fail: number;
}

export interface DRCResult {
  drcMap: Map<string, DRCDeviceResult>;
  summary: DRCSummary;
}

// ── AWG lookup ────────────────────────────────────────────────────────
// Build a map from gauge number to max amps
const AWG_MAX_AMPS = new Map<number, number>();
for (const entry of AWG_TABLE) {
  const gaugeNum = parseInt(entry.gauge);
  if (!isNaN(gaugeNum)) AWG_MAX_AMPS.set(gaugeNum, entry.maxAmps);
}

// Special handling for 0 AWG
if (!AWG_MAX_AMPS.has(0)) {
  const zeroEntry = AWG_TABLE.find(e => e.gauge === '0 AWG');
  if (zeroEntry) AWG_MAX_AMPS.set(0, zeroEntry.maxAmps);
}

// Critical device categories
const CRITICAL_CATEGORIES = new Set([
  'engine_mgmt', 'engine_management', 'sensors', 'safety',
]);

// ── Hook ──────────────────────────────────────────────────────────────

export function useDRC(
  devices: ManifestDevice[],
  result: OverlayResult,
  pinMaps?: Record<string, unknown[]>,
): DRCResult {
  return useMemo(() => {
    const drcMap = new Map<string, DRCDeviceResult>();

    // Build wire lookup by device name
    const wiresByDevice = new Map<string, typeof result.wires>();
    for (const w of result.wires) {
      // "to" field is the device name
      if (!wiresByDevice.has(w.to)) wiresByDevice.set(w.to, []);
      wiresByDevice.get(w.to)!.push(w);
      // "from" can be "PDM30:OUT5" — extract device name
      const fromDevice = w.from.split(':')[0];
      if (!wiresByDevice.has(fromDevice)) wiresByDevice.set(fromDevice, []);
      wiresByDevice.get(fromDevice)!.push(w);
    }

    // PDM channel map for overload check
    const pdmChannelAmps = new Map<number, number>();
    const pdmChannelMaxAmps = new Map<number, number>();
    for (const ch of result.pdmChannels) {
      pdmChannelAmps.set(ch.channel, ch.totalAmps);
      pdmChannelMaxAmps.set(ch.channel, ch.maxAmps);
    }

    for (const device of devices) {
      const rules: DRCRule[] = [];
      const modelPins = pinMaps?.[device.model_number || ''] as Array<{
        pin_number?: string;
        connected_to_device?: string;
        connected_to_pin?: string;
      }> | undefined;

      // ── Rule 1: Pin conflict ──
      if (modelPins && modelPins.length > 0) {
        const pinAssignments = new Map<string, string[]>();
        for (const pin of modelPins) {
          const pn = pin.pin_number || '';
          const target = `${pin.connected_to_device || ''}:${pin.connected_to_pin || ''}`;
          if (!pinAssignments.has(pn)) pinAssignments.set(pn, []);
          pinAssignments.get(pn)!.push(target);
        }
        const duplicates = Array.from(pinAssignments.entries())
          .filter(([, targets]) => {
            const unique = new Set(targets.filter(t => t !== ':'));
            return unique.size > 1;
          });
        if (duplicates.length > 0) {
          rules.push({
            ruleId: 'pin-conflict',
            label: 'Pin Conflict',
            message: `Duplicate pin assignments: ${duplicates.map(([p]) => p).join(', ')}`,
            severity: 'fail',
          });
        } else {
          rules.push({
            ruleId: 'pin-conflict',
            label: 'Pin Conflict',
            message: 'No pin conflicts',
            severity: 'pass',
          });
        }
      }

      // ── Rule 2: Gauge vs ampacity ──
      if (device.power_draw_amps && device.wire_gauge_recommended) {
        const maxAmps = AWG_MAX_AMPS.get(device.wire_gauge_recommended);
        if (maxAmps != null) {
          if (device.power_draw_amps > maxAmps) {
            rules.push({
              ruleId: 'gauge-ampacity',
              label: 'Gauge vs Ampacity',
              message: `${device.wire_gauge_recommended} AWG max ${maxAmps}A < draw ${device.power_draw_amps}A`,
              severity: 'fail',
            });
          } else if (device.power_draw_amps > maxAmps * 0.8) {
            rules.push({
              ruleId: 'gauge-ampacity',
              label: 'Gauge vs Ampacity',
              message: `${device.wire_gauge_recommended} AWG at ${Math.round((device.power_draw_amps / maxAmps) * 100)}% capacity`,
              severity: 'warn',
            });
          } else {
            rules.push({
              ruleId: 'gauge-ampacity',
              label: 'Gauge vs Ampacity',
              message: `${device.wire_gauge_recommended} AWG OK for ${device.power_draw_amps}A`,
              severity: 'pass',
            });
          }
        }
      }

      // ── Rule 3: Voltage drop ──
      const deviceWires = wiresByDevice.get(device.device_name) || [];
      const highDropWires = deviceWires.filter(w => w.voltageDropPct > 3);
      if (highDropWires.length > 0) {
        const worst = highDropWires.reduce((a, b) => a.voltageDropPct > b.voltageDropPct ? a : b);
        rules.push({
          ruleId: 'voltage-drop',
          label: 'Voltage Drop',
          message: `${worst.voltageDropPct.toFixed(1)}% drop on ${worst.label} (>3% limit)`,
          severity: worst.voltageDropPct > 5 ? 'fail' : 'warn',
        });
      } else if (deviceWires.length > 0) {
        rules.push({
          ruleId: 'voltage-drop',
          label: 'Voltage Drop',
          message: 'All wires within 3% drop limit',
          severity: 'pass',
        });
      }

      // ── Rule 4: Missing pin map ──
      if (!modelPins || modelPins.length === 0) {
        rules.push({
          ruleId: 'missing-pin-map',
          label: 'Missing Pin Map',
          message: `No pin map entries for ${device.model_number || device.device_name}`,
          severity: 'warn',
        });
      } else {
        rules.push({
          ruleId: 'missing-pin-map',
          label: 'Missing Pin Map',
          message: `${modelPins.length} pin mappings found`,
          severity: 'pass',
        });
      }

      // ── Rule 5: Missing connector type ──
      if (!device.connector_type) {
        rules.push({
          ruleId: 'missing-connector',
          label: 'Missing Connector Type',
          message: 'Connector type not specified',
          severity: 'warn',
        });
      } else {
        rules.push({
          ruleId: 'missing-connector',
          label: 'Missing Connector Type',
          message: device.connector_type,
          severity: 'pass',
        });
      }

      // ── Rule 6: Missing location zone ──
      if (!device.location_zone) {
        rules.push({
          ruleId: 'missing-zone',
          label: 'Missing Location Zone',
          message: 'Location zone not specified',
          severity: 'warn',
        });
      } else {
        rules.push({
          ruleId: 'missing-zone',
          label: 'Missing Location Zone',
          message: device.location_zone.replace(/_/g, ' '),
          severity: 'pass',
        });
      }

      // ── Rule 7: PDM overload ──
      if (device.pdm_controlled) {
        // Find PDM channel for this device
        const deviceCh = result.pdmChannels.find(ch =>
          ch.devices.includes(device.device_name)
        );
        if (deviceCh && deviceCh.totalAmps > deviceCh.maxAmps) {
          rules.push({
            ruleId: 'pdm-overload',
            label: 'PDM Overload',
            message: `Channel ${deviceCh.channel}: ${deviceCh.totalAmps.toFixed(1)}A > ${deviceCh.maxAmps}A max`,
            severity: 'fail',
          });
        } else if (deviceCh && deviceCh.totalAmps > deviceCh.maxAmps * 0.8) {
          rules.push({
            ruleId: 'pdm-overload',
            label: 'PDM Overload',
            message: `Channel ${deviceCh.channel}: ${Math.round((deviceCh.totalAmps / deviceCh.maxAmps) * 100)}% capacity`,
            severity: 'warn',
          });
        } else if (deviceCh) {
          rules.push({
            ruleId: 'pdm-overload',
            label: 'PDM Overload',
            message: `Channel ${deviceCh.channel} OK`,
            severity: 'pass',
          });
        }
      }

      // ── Rule 8: Unpurchased critical ──
      const isCritical = CRITICAL_CATEGORIES.has(device.device_category || '');
      if (!device.purchased && isCritical) {
        rules.push({
          ruleId: 'unpurchased-critical',
          label: 'Unpurchased Critical',
          message: `Critical ${device.device_category?.replace(/_/g, ' ')} device not purchased`,
          severity: 'fail',
        });
      } else if (!device.purchased) {
        rules.push({
          ruleId: 'unpurchased-critical',
          label: 'Unpurchased Critical',
          message: 'Not purchased (non-critical)',
          severity: 'pass',
        });
      } else {
        rules.push({
          ruleId: 'unpurchased-critical',
          label: 'Unpurchased Critical',
          message: 'Purchased',
          severity: 'pass',
        });
      }

      // Compute worst severity
      let severity: 'pass' | 'warn' | 'fail' = 'pass';
      for (const r of rules) {
        if (r.severity === 'fail') { severity = 'fail'; break; }
        if (r.severity === 'warn') severity = 'warn';
      }

      drcMap.set(device.id, { severity, rules });
    }

    // Summary
    let pass = 0, warn = 0, fail = 0;
    for (const [, v] of drcMap) {
      if (v.severity === 'pass') pass++;
      else if (v.severity === 'warn') warn++;
      else fail++;
    }

    return { drcMap, summary: { pass, warn, fail } };
  }, [devices, result, pinMaps]);
}
