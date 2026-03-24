// useOverlayCompute.ts — React hook for real-time harness computation
// Recomputes on every manifest change. No API calls. Instant.

import { useMemo, useCallback, useRef, useState } from 'react';
import { computeOverlay, computeDelta, type ManifestDevice, type OverlayResult, type OverlayDelta } from './overlayCompute';
import { computeTerminations, summarizeTerminationReadiness } from './terminationCompute';

export function useOverlayCompute(initialDevices: ManifestDevice[] = []) {
  const [devices, setDevices] = useState<ManifestDevice[]>(initialDevices);
  const previousResult = useRef<OverlayResult | null>(null);

  // Compute overlay — memoized, only recalculates when devices change
  const result = useMemo(() => computeOverlay(devices), [devices]);

  // Compute termination BOM per wire endpoint
  const terminations = useMemo(() => computeTerminations(result.wires, devices), [result, devices]);
  const terminationSummary = useMemo(() => summarizeTerminationReadiness(terminations), [terminations]);

  // Compute delta from last result
  const delta = useMemo((): OverlayDelta | null => {
    if (!previousResult.current) return null;
    return computeDelta(previousResult.current, result);
  }, [result]);

  // ── Device Mutations ──

  const addDevice = useCallback((device: Partial<ManifestDevice> & { device_name: string; device_category: string }) => {
    const newDevice: ManifestDevice = {
      id: crypto.randomUUID(),
      device_name: device.device_name,
      device_category: device.device_category,
      pin_count: device.pin_count || 2,
      power_draw_amps: device.power_draw_amps || 1,
      signal_type: device.signal_type || 'switch',
      pdm_controlled: device.pdm_controlled ?? true,
      location_zone: device.location_zone || 'dash',
      layer: device.layer || 'interior',
      price: device.price || 0,
      purchased: false,
      pct_complete: 30,
      ...device,
    };
    previousResult.current = result;
    setDevices(prev => [...prev, newDevice]);
    return newDevice.id;
  }, [result]);

  const removeDevice = useCallback((deviceId: string) => {
    previousResult.current = result;
    setDevices(prev => prev.filter(d => d.id !== deviceId));
  }, [result]);

  const updateDevice = useCallback((deviceId: string, updates: Partial<ManifestDevice>) => {
    previousResult.current = result;
    setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, ...updates } : d));
  }, [result]);

  const replaceAllDevices = useCallback((newDevices: ManifestDevice[]) => {
    previousResult.current = result;
    setDevices(newDevices);
  }, [result]);

  // ── Quick Add Helpers ──

  const addSensor = useCallback((name: string, signalType = 'analog_5v', pins = 3) => {
    return addDevice({
      device_name: name,
      device_category: 'sensors',
      signal_type: signalType,
      pin_count: pins,
      power_draw_amps: 0,
      pdm_controlled: false,
      location_zone: 'engine_bay',
      layer: 'engine',
    });
  }, [addDevice]);

  const addLight = useCallback((name: string, amps = 2, zone = 'exterior') => {
    return addDevice({
      device_name: name,
      device_category: 'lighting',
      signal_type: 'led_lighting',
      pin_count: 2,
      power_draw_amps: amps,
      pdm_controlled: true,
      location_zone: zone === 'exterior' ? 'engine_bay' : zone,
      layer: zone,
    });
  }, [addDevice]);

  const addMotor = useCallback((name: string, amps: number, zone = 'doors') => {
    return addDevice({
      device_name: name,
      device_category: 'body',
      signal_type: 'motor',
      pin_count: 2,
      power_draw_amps: amps,
      pdm_controlled: true,
      location_zone: zone,
      layer: zone === 'doors' ? 'interior' : 'frame',
    });
  }, [addDevice]);

  return {
    // State
    devices,
    result,
    delta,
    terminations,
    terminationSummary,

    // Mutations
    addDevice,
    removeDevice,
    updateDevice,
    replaceAllDevices,

    // Quick adds
    addSensor,
    addLight,
    addMotor,

    // Counts for quick reference
    deviceCount: devices.length,
    wireCount: result.wireCount,
    ecuModel: result.recommendedConfig.ecu.model,
    pdmChannels: result.pdmChannels.length,
    pdmConfig: result.recommendedConfig.pdm.config,
    warningCount: result.warnings.length,
    totalCost: result.partsCost + result.recommendedConfig.totalCost,
    terminationReadyCount: terminationSummary.ready,
    terminationMissingCount: terminationSummary.notReady,
    allTerminationsReady: terminationSummary.total > 0 && terminationSummary.notReady === 0,
  };
}
