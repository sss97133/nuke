// useDRC.ts — Design Rule Check hook
// Runs 8 design checks against manifest + pin maps + overlay.
// Returns severity map per device and summary counts.

import { useMemo, useEffect, useState } from 'react';
import type { ManifestDevice, WireSpec, PDMChannel, OverlayResult } from './overlayCompute';
import { AWG_TABLE } from './harnessConstants';
import { supabase } from '../../lib/supabase';

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
  total: number;
}

// AWG ampacity lookup from the constants table
function getMaxAmps(gauge: number): number {
  const entry = AWG_TABLE.find(e => parseInt(e.gauge) === gauge);
  return entry?.maxAmps ?? 999;
}

const CRITICAL_CATEGORIES = ['engine_management', 'engine_mgmt', 'sensors', 'safety', 'starting'];

export function useDRC(
  devices: ManifestDevice[],
  result: OverlayResult,
): { drcMap: Map<string, DRCDeviceResult>; summary: DRCSummary } {
  // Fetch pin maps for all device models
  const [pinMaps, setPinMaps] = useState<Map<string, { pin_number: string; connected_to_device: string | null }[]>>(new Map());

  useEffect(() => {
    async function loadPinMaps() {
      const models = [...new Set(devices.map(d => d.model_number).filter(Boolean))] as string[];
      if (models.length === 0) return;
      const { data } = await supabase
        .from('device_pin_maps')
        .select('device_model, pin_number, connected_to_device')
        .in('device_model', models);
      if (!data) return;
      const map = new Map<string, { pin_number: string; connected_to_device: string | null }[]>();
      for (const row of data) {
        const list = map.get(row.device_model) || [];
        list.push({ pin_number: row.pin_number, connected_to_device: row.connected_to_device });
        map.set(row.device_model, list);
      }
      setPinMaps(map);
    }
    loadPinMaps();
  }, [devices]);

  const drcMap = useMemo(() => {
    const map = new Map<string, DRCDeviceResult>();

    // Build wire lookup by device name
    const wiresByDevice = new Map<string, WireSpec[]>();
    for (const w of result.wires) {
      const list = wiresByDevice.get(w.to) || [];
      list.push(w);
      wiresByDevice.set(w.to, list);
    }

    // Build PDM channel lookup
    const pdmByDevice = new Map<string, PDMChannel>();
    for (const ch of result.pdmChannels) {
      for (const dName of ch.devices) {
        pdmByDevice.set(dName, ch);
      }
    }

    for (const device of devices) {
      const rules: DRCRule[] = [];

      // Rule 1: Pin conflict — same pin assigned to two different wires
      if (device.model_number && pinMaps.has(device.model_number)) {
        const pins = pinMaps.get(device.model_number)!;
        const pinAssignments = new Map<string, string[]>();
        for (const p of pins) {
          if (p.connected_to_device) {
            const list = pinAssignments.get(p.pin_number) || [];
            list.push(p.connected_to_device);
            pinAssignments.set(p.pin_number, list);
          }
        }
        const conflicts = [...pinAssignments.entries()].filter(([, devs]) => devs.length > 1);
        if (conflicts.length > 0) {
          rules.push({
            ruleId: 'pin_conflict',
            label: 'PIN CONFLICT',
            message: `Pin${conflicts.length > 1 ? 's' : ''} ${conflicts.map(([p]) => p).join(', ')} assigned to multiple wires`,
            severity: 'fail',
          });
        } else {
          rules.push({ ruleId: 'pin_conflict', label: 'PIN CONFLICT', message: 'No conflicts', severity: 'pass' });
        }
      } else {
        rules.push({ ruleId: 'pin_conflict', label: 'PIN CONFLICT', message: 'No pin data', severity: 'pass' });
      }

      // Rule 2: Gauge vs ampacity
      const wires = wiresByDevice.get(device.device_name) || [];
      if (wires.length > 0 && device.power_draw_amps) {
        const wire = wires[0];
        const maxAmps = getMaxAmps(wire.gauge);
        if (device.power_draw_amps > maxAmps) {
          rules.push({
            ruleId: 'gauge_ampacity',
            label: 'GAUGE AMPACITY',
            message: `${device.power_draw_amps}A exceeds ${wire.gauge}AWG rating of ${maxAmps}A`,
            severity: 'fail',
          });
        } else if (device.power_draw_amps > maxAmps * 0.8) {
          rules.push({
            ruleId: 'gauge_ampacity',
            label: 'GAUGE AMPACITY',
            message: `${device.power_draw_amps}A is >${Math.round(maxAmps * 0.8)}A (80% of ${maxAmps}A limit)`,
            severity: 'warn',
          });
        } else {
          rules.push({ ruleId: 'gauge_ampacity', label: 'GAUGE AMPACITY', message: `${wire.gauge}AWG OK for ${device.power_draw_amps}A`, severity: 'pass' });
        }
      } else {
        rules.push({ ruleId: 'gauge_ampacity', label: 'GAUGE AMPACITY', message: 'No wire data', severity: 'pass' });
      }

      // Rule 3: Voltage drop > 3%
      if (wires.length > 0) {
        const maxDrop = Math.max(...wires.map(w => w.voltageDropPct));
        if (maxDrop > 3) {
          rules.push({
            ruleId: 'voltage_drop',
            label: 'VOLTAGE DROP',
            message: `${maxDrop.toFixed(1)}% exceeds 3% limit`,
            severity: 'fail',
          });
        } else if (maxDrop > 2) {
          rules.push({
            ruleId: 'voltage_drop',
            label: 'VOLTAGE DROP',
            message: `${maxDrop.toFixed(1)}% approaching 3% limit`,
            severity: 'warn',
          });
        } else {
          rules.push({ ruleId: 'voltage_drop', label: 'VOLTAGE DROP', message: `${maxDrop.toFixed(1)}% OK`, severity: 'pass' });
        }
      } else {
        rules.push({ ruleId: 'voltage_drop', label: 'VOLTAGE DROP', message: 'No wire data', severity: 'pass' });
      }

      // Rule 4: Missing pin map
      if (device.model_number && !pinMaps.has(device.model_number) && (device.pin_count || 0) > 0) {
        rules.push({
          ruleId: 'missing_pin_map',
          label: 'PIN MAP',
          message: `No pin map found for ${device.model_number}`,
          severity: 'warn',
        });
      } else {
        rules.push({ ruleId: 'missing_pin_map', label: 'PIN MAP', message: 'Pin map available', severity: 'pass' });
      }

      // Rule 5: Missing connector type
      if (!device.connector_type) {
        rules.push({
          ruleId: 'missing_connector',
          label: 'CONNECTOR TYPE',
          message: 'No connector type specified',
          severity: 'warn',
        });
      } else {
        rules.push({ ruleId: 'missing_connector', label: 'CONNECTOR TYPE', message: device.connector_type, severity: 'pass' });
      }

      // Rule 6: Missing location zone
      if (!device.location_zone) {
        rules.push({
          ruleId: 'missing_zone',
          label: 'LOCATION ZONE',
          message: 'No location zone specified',
          severity: 'warn',
        });
      } else {
        rules.push({ ruleId: 'missing_zone', label: 'LOCATION ZONE', message: device.location_zone.replace(/_/g, ' '), severity: 'pass' });
      }

      // Rule 7: PDM overload
      const pdmCh = pdmByDevice.get(device.device_name);
      if (pdmCh && pdmCh.totalAmps > pdmCh.maxAmps) {
        rules.push({
          ruleId: 'pdm_overload',
          label: 'PDM OVERLOAD',
          message: `OUT${pdmCh.channel}: ${pdmCh.totalAmps.toFixed(1)}A exceeds ${pdmCh.maxAmps}A`,
          severity: 'fail',
        });
      } else {
        rules.push({ ruleId: 'pdm_overload', label: 'PDM OVERLOAD', message: pdmCh ? `OUT${pdmCh.channel}: ${pdmCh.totalAmps.toFixed(1)}A / ${pdmCh.maxAmps}A` : 'N/A', severity: 'pass' });
      }

      // Rule 8: Unpurchased critical
      if (!device.purchased && CRITICAL_CATEGORIES.includes(device.device_category || '')) {
        rules.push({
          ruleId: 'unpurchased_critical',
          label: 'PROCUREMENT',
          message: `Critical ${device.device_category} device not purchased`,
          severity: 'warn',
        });
      } else {
        rules.push({ ruleId: 'unpurchased_critical', label: 'PROCUREMENT', message: device.purchased ? 'Purchased' : 'Non-critical', severity: 'pass' });
      }

      // Compute worst severity
      const hasFail = rules.some(r => r.severity === 'fail');
      const hasWarn = rules.some(r => r.severity === 'warn');
      const severity: 'pass' | 'warn' | 'fail' = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

      map.set(device.id, { severity, rules });
    }

    return map;
  }, [devices, result, pinMaps]);

  const summary = useMemo((): DRCSummary => {
    let pass = 0, warn = 0, fail = 0;
    drcMap.forEach(v => {
      if (v.severity === 'pass') pass++;
      else if (v.severity === 'warn') warn++;
      else fail++;
    });
    return { pass, warn, fail, total: pass + warn + fail };
  }, [drcMap]);

  return { drcMap, summary };
}
