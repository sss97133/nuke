// WiringPlan.tsx — Parent page for /vehicle/:vehicleId/wiring
// 5-tab system: FORMBOARD | SCHEMATICS | 3D | DATA | TOPOLOGY
// Shared state: selectedDeviceId, selectedDeviceIds, selectedWireId
// Hosts DeviceDetailPanel (right-side), CommandPalette (overlay)
// Keyboard shortcuts: 1-5 tabs, F fit, Esc deselect, Cmd+K search

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ManifestDevice, WireSpec } from '../components/wiring/overlayCompute';
import { useOverlayCompute } from '../components/wiring/useOverlayCompute';
import { DeviceDetailPanel } from '../components/wiring/DeviceDetailPanel';
import { FormboardView } from '../components/wiring/FormboardView';
import { SchematicView } from '../components/wiring/SchematicView';
import { HarnessView3D } from '../components/wiring/HarnessView3D';
import { DataView } from '../components/wiring/DataView';
import { CommandPalette } from '../components/wiring/CommandPalette';
import { TopologyView } from '../components/wiring/TopologyView';
import { useDRC } from '../components/wiring/useDRC';

// ── Design tokens ─────────────────────────────────────────────────────
const C = {
  bg: '#1a1a2e',
  surface: '#1f1f35',
  elevated: '#252540',
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  active: '#00ddff',
  pass: '#22c55e',
  warn: '#eab308',
  fail: '#ef4444',
} as const;

const ZONE_COLORS: Record<string, string> = {
  engine_bay: '#cc2222',
  firewall: '#cc6600',
  dash: '#2266cc',
  doors: '#8822cc',
  rear: '#22aa44',
  underbody: '#666666',
};

type ViewTab = 'formboard' | 'schematics' | '3d' | 'data' | 'topology';
const TABS: { id: ViewTab; label: string; key: string }[] = [
  { id: 'formboard', label: 'FORMBOARD', key: '1' },
  { id: 'schematics', label: 'SCHEMATICS', key: '2' },
  { id: '3d', label: '3D', key: '3' },
  { id: 'data', label: 'DATA', key: '4' },
  { id: 'topology', label: 'TOPOLOGY', key: '5' },
];

// ── Camera state per view ─────────────────────────────────────────────
interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

const defaultCamera = (): CameraState => ({ x: 0, y: 0, zoom: 1 });

export default function WiringPlan() {
  const { vehicleId } = useParams();

  // ── Data loading ──
  const [vehicleInfo, setVehicleInfo] = useState<{ year?: number; make?: string; model?: string } | null>(null);
  const [manifestDevices, setManifestDevices] = useState<ManifestDevice[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Overlay compute ──
  const overlay = useOverlayCompute(manifestDevices);

  // ── Shared selection state ──
  const [activeTab, setActiveTab] = useState<ViewTab>('formboard');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [selectedWireId, setSelectedWireId] = useState<number | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [fitRequested, setFitRequested] = useState(0);

  // ── Camera state per view (persists across tab switches) ──
  const cameraRefs = useRef<Record<ViewTab, CameraState>>({
    formboard: defaultCamera(),
    schematics: defaultCamera(),
    '3d': defaultCamera(),
    data: defaultCamera(),
    topology: defaultCamera(),
  });

  // ── Selected device lookup ──
  const selectedDevice = useMemo(
    () => selectedDeviceId ? overlay.devices.find(d => d.id === selectedDeviceId) ?? null : null,
    [selectedDeviceId, overlay.devices]
  );

  const selectedWire = useMemo(
    () => selectedWireId != null ? overlay.result.wires.find(w => w.wireNumber === selectedWireId) ?? null : null,
    [selectedWireId, overlay.result.wires]
  );

  // ── Supabase queries for detail panel ──
  const [pinMaps, setPinMaps] = useState<Record<string, unknown[]>>({});
  const [partsReception, setPartsReception] = useState<unknown[]>([]);
  const [workOrderParts, setWorkOrderParts] = useState<unknown[]>([]);

  // ── DRC ──
  const drc = useDRC(overlay.devices, overlay.result, pinMaps);

  // ── Load manifest ──
  useEffect(() => {
    async function init() {
      if (!vehicleId) return;
      setLoading(true);
      try {
        const [vehicleRes, manifestRes] = await Promise.all([
          supabase.from('vehicles').select('year, make, model').eq('id', vehicleId).maybeSingle(),
          supabase.from('vehicle_build_manifest')
            .select('*')
            .eq('vehicle_id', vehicleId)
            .order('device_category')
            .order('device_name'),
        ]);
        if (vehicleRes.data) setVehicleInfo(vehicleRes.data);
        if (manifestRes.data) setManifestDevices(manifestRes.data as ManifestDevice[]);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [vehicleId]);

  // ── Load pin maps once ──
  useEffect(() => {
    async function loadPinMaps() {
      const { data } = await supabase.from('device_pin_maps').select('*');
      if (data) {
        const grouped: Record<string, unknown[]> = {};
        for (const row of data) {
          const model = (row as { device_model: string }).device_model;
          if (!grouped[model]) grouped[model] = [];
          grouped[model].push(row);
        }
        setPinMaps(grouped);
      }
    }
    loadPinMaps();
  }, []);

  // ── Load procurement data once ──
  useEffect(() => {
    async function loadProcurement() {
      const [prRes, woRes] = await Promise.all([
        supabase.from('parts_reception').select('*'),
        supabase.from('work_order_parts').select('*'),
      ]);
      if (prRes.data) setPartsReception(prRes.data);
      if (woRes.data) setWorkOrderParts(woRes.data);
    }
    loadProcurement();
  }, []);

  // ── Click handlers ──
  const handleDeviceClick = useCallback((deviceId: string, shiftKey?: boolean) => {
    if (shiftKey) {
      setSelectedDeviceIds(prev => {
        const next = new Set(prev);
        if (next.has(deviceId)) next.delete(deviceId);
        else next.add(deviceId);
        return next;
      });
    }
    setSelectedDeviceId(deviceId);
    setSelectedWireId(null);
  }, []);

  const handleWireClick = useCallback((wireNumber: number) => {
    setSelectedWireId(wireNumber);
    const wire = overlay.result.wires.find(w => w.wireNumber === wireNumber);
    if (wire) {
      const device = overlay.devices.find(d => d.device_name === wire.to);
      if (device) setSelectedDeviceId(device.id);
    }
  }, [overlay.result.wires, overlay.devices]);

  const handleDeselect = useCallback(() => {
    setSelectedDeviceId(null);
    setSelectedDeviceIds(new Set());
    setSelectedWireId(null);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedDeviceId(null);
    setSelectedWireId(null);
  }, []);

  // ── Navigate to device on formboard ──
  const handleShowOnFormboard = useCallback((deviceId: string) => {
    setActiveTab('formboard');
    setSelectedDeviceId(deviceId);
    // Zoom-to-fit will be handled by the formboard view
  }, []);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // Cmd+K / Ctrl+K or / → command palette
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
        return;
      }

      // 1-5 → switch tabs
      const tabIdx = parseInt(e.key) - 1;
      if (tabIdx >= 0 && tabIdx < TABS.length && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setActiveTab(TABS[tabIdx].id);
        return;
      }

      // F → fit all
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setFitRequested(prev => prev + 1);
        return;
      }

      // Escape → deselect / close
      if (e.key === 'Escape') {
        e.preventDefault();
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else {
          handleDeselect();
        }
        return;
      }

      // Tab / Shift+Tab → cycle devices
      if (e.key === 'Tab') {
        e.preventDefault();
        const devices = overlay.devices;
        if (devices.length === 0) return;
        const currentIdx = selectedDeviceId ? devices.findIndex(d => d.id === selectedDeviceId) : -1;
        const nextIdx = e.shiftKey
          ? (currentIdx - 1 + devices.length) % devices.length
          : (currentIdx + 1) % devices.length;
        setSelectedDeviceId(devices[nextIdx].id);
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, handleDeselect, overlay.devices, selectedDeviceId]);

  // ── Loading state ──
  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 'calc(100vh - 42px)', background: C.bg, color: C.muted,
        fontFamily: "'Courier New', monospace", fontSize: 11,
      }}>
        LOADING HARNESS DATA...
      </div>
    );
  }

  // ── Shared view props ──
  const viewProps = {
    devices: overlay.devices,
    result: overlay.result,
    selectedDeviceId,
    selectedDeviceIds,
    selectedWireId,
    onDeviceClick: handleDeviceClick,
    onWireClick: handleWireClick,
    onDeselect: handleDeselect,
    fitRequested,
    vehicleId,
    zoneColors: ZONE_COLORS,
    drcMap: drc.drcMap,
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 42px)',
      background: C.bg, color: C.text,
      fontFamily: 'Arial, sans-serif',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* ── Status Bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '0 12px', height: 28,
        background: C.surface,
        borderBottom: `2px solid ${C.border}`,
        fontFamily: "'Courier New', monospace",
        fontSize: 10, fontWeight: 700,
        flexShrink: 0,
      }}>
        <span style={{ color: C.label, fontFamily: 'Arial', fontSize: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
          {vehicleInfo ? `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}` : 'VEHICLE'} — WIRING HARNESS
        </span>
        <span style={{ marginLeft: 'auto' }} />
        <StatusChip label="DEVICES" value={overlay.result.deviceCount} />
        <StatusChip label="WIRES" value={overlay.result.wireCount} />
        <StatusChip label="LENGTH" value={`${overlay.result.totalWireLengthFt} FT`} />
        <StatusChip label="AMPS" value={overlay.result.totalContinuousAmps} />
        <StatusChip label="ECU" value={overlay.result.recommendedConfig.ecu.model} />
        <StatusChip label="PDM" value={overlay.result.recommendedConfig.pdm.config} />
        <StatusChip label="COST" value={`$${Math.round(overlay.result.partsCost).toLocaleString()}`} />
        {overlay.result.warnings.length > 0 && (
          <span style={{ color: C.warn }}>
            {overlay.result.warnings.length} WARNINGS
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderLeft: `1px solid ${C.border}`, paddingLeft: 8 }}>
          <span style={{ color: C.label, fontFamily: 'Arial', fontSize: 7, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>DRC:</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <span style={{ width: 6, height: 6, background: C.pass, display: 'inline-block' }} />
            <span style={{ color: C.pass, fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700 }}>{drc.summary.pass}</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <span style={{ width: 6, height: 6, background: C.warn, display: 'inline-block' }} />
            <span style={{ color: C.warn, fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700 }}>{drc.summary.warn}</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <span style={{ width: 6, height: 6, background: C.fail, display: 'inline-block' }} />
            <span style={{ color: C.fail, fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700 }}>{drc.summary.fail}</span>
          </span>
        </span>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        height: 28, flexShrink: 0,
        background: C.bg,
        borderBottom: `2px solid ${C.border}`,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: activeTab === tab.id ? C.elevated : 'transparent',
              color: activeTab === tab.id ? C.active : C.label,
              border: 'none',
              borderBottom: activeTab === tab.id ? `2px solid ${C.active}` : '2px solid transparent',
              padding: '0 16px',
              fontFamily: 'Arial, sans-serif',
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              cursor: 'pointer',
              transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {tab.label}
            <span style={{ color: C.muted, marginLeft: 4, fontSize: 8 }}>{tab.key}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setCommandPaletteOpen(true)}
          style={{
            background: 'transparent',
            color: C.muted,
            border: `1px solid ${C.border}`,
            padding: '0 10px',
            fontFamily: "'Courier New', monospace",
            fontSize: 9,
            cursor: 'pointer',
            margin: '3px 8px',
          }}
        >
          SEARCH ⌘K
        </button>
      </div>

      {/* ── View Container ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* All views stay mounted but hidden for camera persistence */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'formboard' ? 'block' : 'none' }}>
          <FormboardView {...viewProps} cameraRef={cameraRefs.current.formboard} />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'schematics' ? 'block' : 'none' }}>
          <SchematicView {...viewProps} cameraRef={cameraRefs.current.schematics} />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: activeTab === '3d' ? 'block' : 'none' }}>
          <HarnessView3D {...viewProps} />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'data' ? 'block' : 'none' }}>
          <DataView {...viewProps} overlay={overlay} />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: activeTab === 'topology' ? 'block' : 'none' }}>
          <TopologyView
            devices={overlay.devices}
            wires={overlay.result.wires}
            result={overlay.result}
            selectedDeviceId={selectedDeviceId}
            selectedDeviceIds={selectedDeviceIds}
            selectedWireId={selectedWireId}
            onDeviceClick={(id, e) => handleDeviceClick(id, e.shiftKey)}
            onWireClick={handleWireClick}
            drcMap={drc.drcMap}
          />
        </div>

        {/* ── Detail Panel (slides in from right) ── */}
        <DeviceDetailPanel
          device={selectedDevice}
          wire={selectedWire}
          result={overlay.result}
          devices={overlay.devices}
          pinMaps={pinMaps}
          partsReception={partsReception}
          workOrderParts={workOrderParts}
          zoneColors={ZONE_COLORS}
          onClose={handleClosePanel}
          onShowOnFormboard={handleShowOnFormboard}
        />
      </div>

      {/* ── Command Palette ── */}
      {commandPaletteOpen && (
        <CommandPalette
          devices={overlay.devices}
          wires={overlay.result.wires}
          zoneColors={ZONE_COLORS}
          onSelectDevice={(id) => { handleDeviceClick(id); setCommandPaletteOpen(false); }}
          onSelectWire={(n) => { handleWireClick(n); setCommandPaletteOpen(false); }}
          onSwitchTab={(tab) => { setActiveTab(tab as ViewTab); setCommandPaletteOpen(false); }}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
    </div>
  );
}

// ── Status chip ─────────────────────────────────────────────────────
function StatusChip({ label, value }: { label: string; value: string | number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ color: '#a0a0b0', fontFamily: 'Arial', fontSize: 7, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
        {label}
      </span>
      <span style={{ color: '#e0e0e8', fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700 }}>
        {value}
      </span>
    </span>
  );
}
