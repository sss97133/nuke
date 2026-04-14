// WiringPlan.tsx — Parent component for /vehicle/:vehicleId/wiring
// Manages tab switching, cross-view selection state, DRC, and command palette.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useOverlayCompute } from '../components/wiring/useOverlayCompute';
import type { ManifestDevice } from '../components/wiring/overlayCompute';
import { useDRC } from '../components/wiring/useDRC';
import { WiringWorkspace } from '../components/wiring/WiringWorkspace';
import { FormboardCanvas } from '../components/wiring/FormboardCanvas';
import { SchematicViewer } from '../components/wiring/SchematicViewer';
import { LoomTopologyView } from '../components/wiring/LoomTopologyView';
import { CommandPalette } from '../components/wiring/CommandPalette';
import { BulkEditPanel } from '../components/wiring/BulkEditPanel';
import { WiringDetailPanel } from '../components/wiring/WiringDetailPanel';
import { useWireCatalog } from '../components/wiring/useWireCatalog';
import { useComponentLibrary } from '../components/wiring/useComponentLibrary';
import { WIRE_TIERS } from '../components/wiring/harnessConstants';
import type { WireTier } from '../components/wiring/harnessConstants';

type TabId = 'formboard' | 'schematics' | 'topology' | 'data';

const TABS: { id: TabId; label: string }[] = [
  { id: 'formboard', label: 'FORMBOARD' },
  { id: 'schematics', label: 'SCHEMATICS' },
  { id: 'topology', label: 'TOPOLOGY' },
  { id: 'data', label: 'DATA' },
];

const C = {
  bg: '#1a1a2e',
  surface: '#1e1e32',
  border: '#2a2a5e',
  text: '#e0e0e8',
  textDim: '#8888aa',
  textMuted: '#555577',
  accent: '#00ddff',
};

const DRC_COLORS: Record<string, string> = {
  pass: '#22aa44', warn: '#ccaa00', fail: '#cc2222',
};

export default function WiringPlan() {
  const { vehicleId } = useParams();

  const [manifestDevices, setManifestDevices] = useState<ManifestDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('data');

  // Cross-view selection state
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [selectedWireId, setSelectedWireId] = useState<number | null>(null);

  // Command palette
  const [paletteOpen, setPaletteOpen] = useState(false);

  // DRC filter
  const [drcFilterSeverity, setDrcFilterSeverity] = useState<string | null>(null);

  // Wire tier
  const [tier, setTier] = useState<WireTier>('professional');

  // Load manifest
  useEffect(() => {
    async function init() {
      if (!vehicleId) return;
      setLoading(true);
      try {
        const { data } = await supabase
          .from('vehicle_build_manifest')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('device_category')
          .order('device_name');
        if (data) setManifestDevices(data as ManifestDevice[]);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [vehicleId]);

  // Computation hooks
  const { devices, result, terminations, updateDevice: overlayUpdateDevice } = useOverlayCompute(manifestDevices);
  const { drcMap, summary: drcSummary } = useDRC(devices, result);
  const { products, gaugeConversions } = useWireCatalog(tier);
  const { findComponent } = useComponentLibrary();

  // Selected device data
  const selectedDevice = useMemo(
    () => selectedDeviceId ? devices.find(d => d.id === selectedDeviceId) ?? null : null,
    [devices, selectedDeviceId],
  );
  const selectedWire = useMemo(
    () => selectedDevice ? result.wires.find(w => w.to === selectedDevice.device_name) : undefined,
    [selectedDevice, result.wires],
  );
  const selectedPdmChannel = useMemo(
    () => selectedDevice ? result.pdmChannels.find(ch => ch.devices.includes(selectedDevice.device_name)) : undefined,
    [selectedDevice, result.pdmChannels],
  );
  const selectedTermination = useMemo(
    () => selectedDevice ? terminations.find(t => t.deviceName === selectedDevice.device_name) : undefined,
    [selectedDevice, terminations],
  );
  const selectedLibraryComponent = useMemo(
    () => selectedDevice ? findComponent(selectedDevice.manufacturer || '', selectedDevice.part_number || '') : undefined,
    [selectedDevice, findComponent],
  );
  const selectedWireProduct = useMemo(
    () => selectedWire ? products.find(p => p.gauge_awg === selectedWire.gauge) : undefined,
    [selectedWire, products],
  );
  const selectedGaugeInfo = useMemo(
    () => selectedWire ? gaugeConversions.find(g => g.awg === selectedWire.gauge) : undefined,
    [selectedWire, gaugeConversions],
  );

  // Device click handler (supports multi-select with shift/ctrl)
  const handleDeviceClick = useCallback((id: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Add to multi-select
      setSelectedDeviceIds(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setSelectedDeviceId(null);
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle in multi-select
      setSelectedDeviceIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setSelectedDeviceId(null);
    } else {
      // Single select
      setSelectedDeviceIds(new Set());
      setSelectedDeviceId(prev => prev === id ? null : id);
    }
    setSelectedWireId(null);
  }, []);

  // Wire click handler
  const handleWireClick = useCallback((wireNumber: number) => {
    setSelectedWireId(prev => prev === wireNumber ? null : wireNumber);
    setSelectedDeviceId(null);
    setSelectedDeviceIds(new Set());
  }, []);

  // Clear selection on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (paletteOpen) { setPaletteOpen(false); return; }
        setSelectedDeviceId(null);
        setSelectedDeviceIds(new Set());
        setSelectedWireId(null);
        setDrcFilterSeverity(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen]);

  // Cmd+K handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Bulk edit update handler
  const handleBulkUpdate = useCallback((ids: string[], updates: Partial<ManifestDevice>) => {
    for (const id of ids) {
      overlayUpdateDevice(id, updates);
    }
    setSelectedDeviceIds(new Set());
  }, [overlayUpdateDevice]);

  // Command palette handlers
  const handlePaletteSelectDevice = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setSelectedDeviceIds(new Set());
    setSelectedWireId(null);
  }, []);

  const handlePaletteSelectWire = useCallback((wireNumber: number) => {
    setSelectedWireId(wireNumber);
    setSelectedDeviceId(null);
    setSelectedDeviceIds(new Set());
  }, []);

  const handlePaletteFilterZone = useCallback((_zone: string) => {
    // Navigate to data tab for zone filtering
    setActiveTab('data');
  }, []);

  const handlePaletteAction = useCallback((action: string) => {
    if (action === 'print-formboard') setActiveTab('formboard');
    else if (action === 'reset-view') {
      setSelectedDeviceId(null);
      setSelectedDeviceIds(new Set());
      setSelectedWireId(null);
    }
  }, []);

  // Stats
  const totalCost = result.partsCost + result.recommendedConfig.totalCost;
  const totalLength = result.wires.reduce((s, w) => s + w.lengthFt, 0);

  if (loading) return null;

  // Filter devices by DRC severity if active
  const filteredDevices = drcFilterSeverity
    ? devices.filter(d => drcMap.get(d.id)?.severity === drcFilterSeverity)
    : devices;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 42px)', fontFamily: 'Arial, sans-serif', background: C.bg, color: C.text }}>
      {/* ── Tab Bar + Status ────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '0 8px', height: 32,
        background: C.surface, borderBottom: `2px solid ${C.border}`, flexShrink: 0,
      }}>
        {/* Tabs */}
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              fontSize: '8px', fontWeight: 700, fontFamily: 'Arial', textTransform: 'uppercase',
              letterSpacing: '0.5px', padding: '6px 14px', border: 'none',
              borderBottom: activeTab === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.id ? C.accent : C.textDim,
              cursor: 'pointer', marginBottom: -2,
            }}
          >
            {tab.label}
          </button>
        ))}

        {/* Separator */}
        <div style={{ width: 1, height: 16, background: C.border, margin: '0 8px' }} />

        {/* Status chips */}
        <StatChip label="DEVICES" value={String(devices.length)} />
        <StatChip label="WIRES" value={String(result.wireCount)} />
        <StatChip label="LENGTH" value={`${Math.round(totalLength)}ft`} />
        <StatChip label="ECU" value={result.recommendedConfig.ecu.model} />
        <StatChip label="PDM" value={result.recommendedConfig.pdm.config} />
        <StatChip label="COST" value={`$${Math.round(totalCost).toLocaleString()}`} />

        {/* DRC Summary */}
        <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: '7px', fontWeight: 700, color: C.textMuted, letterSpacing: '0.5px', marginRight: 4 }}>DRC</span>
          <DrcChip count={drcSummary.pass} severity="pass" active={drcFilterSeverity === 'pass'}
            onClick={() => setDrcFilterSeverity(prev => prev === 'pass' ? null : 'pass')} />
          <DrcChip count={drcSummary.warn} severity="warn" active={drcFilterSeverity === 'warn'}
            onClick={() => setDrcFilterSeverity(prev => prev === 'warn' ? null : 'warn')} />
          <DrcChip count={drcSummary.fail} severity="fail" active={drcFilterSeverity === 'fail'}
            onClick={() => setDrcFilterSeverity(prev => prev === 'fail' ? null : 'fail')} />
        </div>

        {/* Tier selector + Cmd+K hint */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={tier}
            onChange={e => setTier(e.target.value as WireTier)}
            style={{
              fontSize: '7px', fontFamily: '"Courier New"', fontWeight: 700,
              padding: '2px 4px', border: `1px solid ${C.border}`, background: C.bg, color: C.text, cursor: 'pointer',
            }}
          >
            {WIRE_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button
            onClick={() => setPaletteOpen(true)}
            style={{
              fontSize: '7px', fontWeight: 700, fontFamily: '"Courier New"',
              padding: '2px 8px', border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textDim, cursor: 'pointer',
            }}
          >
            CMD+K
          </button>
        </div>
      </div>

      {/* ── View Content ────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {activeTab === 'formboard' && (
          <FormboardCanvas
            devices={filteredDevices}
            wires={result.wires}
            pdmChannels={result.pdmChannels}
            drcMap={drcMap}
            selectedDeviceId={selectedDeviceId}
            selectedDeviceIds={selectedDeviceIds}
            selectedWireId={selectedWireId}
            onDeviceClick={handleDeviceClick}
            onWireClick={handleWireClick}
            vehicleId={vehicleId}
          />
        )}

        {activeTab === 'schematics' && (
          <SchematicViewer
            devices={filteredDevices}
            wires={result.wires}
            pdmChannels={result.pdmChannels}
            drcMap={drcMap}
            selectedDeviceId={selectedDeviceId}
            selectedDeviceIds={selectedDeviceIds}
            selectedWireId={selectedWireId}
            onDeviceClick={handleDeviceClick}
            onWireClick={handleWireClick}
          />
        )}

        {activeTab === 'topology' && (
          <LoomTopologyView
            devices={filteredDevices}
            wires={result.wires}
            drcMap={drcMap}
            selectedDeviceId={selectedDeviceId}
            onDeviceClick={handleDeviceClick}
          />
        )}

        {activeTab === 'data' && (
          <WiringWorkspace
            initialDevices={manifestDevices}
            vehicleId={vehicleId}
            selectedDeviceId={selectedDeviceId}
            selectedDeviceIds={selectedDeviceIds}
            selectedWireId={selectedWireId}
            drcMap={drcMap}
            onDeviceClick={handleDeviceClick}
            onWireClick={handleWireClick}
          />
        )}

        {/* ── Detail Panel (single device selected) ──────────────── */}
        {selectedDevice && selectedDeviceIds.size === 0 && (
          <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', zIndex: 10 }}>
            <WiringDetailPanel
              device={selectedDevice}
              wire={selectedWire}
              pdmChannel={selectedPdmChannel}
              ecuModel={result.recommendedConfig.ecu.model}
              termination={selectedTermination}
              onClose={() => setSelectedDeviceId(null)}
              onSavePosition={() => {}}
              positionDirty={false}
              libraryComponent={selectedLibraryComponent}
              wireProduct={selectedWireProduct}
              gaugeInfo={selectedGaugeInfo}
              tierLabel={WIRE_TIERS.find(t => t.value === tier)?.label}
              allWires={result.wires}
            />
          </div>
        )}

        {/* ── Bulk Edit Panel (multi-select) ─────────────────────── */}
        {selectedDeviceIds.size > 1 && (
          <BulkEditPanel
            devices={devices}
            selectedIds={selectedDeviceIds}
            onClose={() => setSelectedDeviceIds(new Set())}
            onUpdate={handleBulkUpdate}
          />
        )}
      </div>

      {/* ── Command Palette ──────────────────────────────────────── */}
      <CommandPalette
        devices={devices}
        wires={result.wires}
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelectDevice={handlePaletteSelectDevice}
        onSelectWire={handlePaletteSelectWire}
        onFilterZone={handlePaletteFilterZone}
        onAction={handlePaletteAction}
      />
    </div>
  );
}

// ── Stat chip ────────────────────────────────────────────────────────
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginRight: 6 }}>
      <span style={{ fontSize: '7px', fontWeight: 700, letterSpacing: '0.5px', color: '#555577' }}>{label}</span>
      <span style={{ fontSize: '9px', fontFamily: '"Courier New"', fontWeight: 700, color: '#e0e0e8' }}>{value}</span>
    </div>
  );
}

// ── DRC Summary chip ─────────────────────────────────────────────────
function DrcChip({ count, severity, active, onClick }: {
  count: number; severity: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 3,
        padding: '2px 6px', border: `1px solid ${active ? DRC_COLORS[severity] : '#2a2a5e'}`,
        background: active ? DRC_COLORS[severity] : 'transparent',
        cursor: 'pointer', fontSize: '8px', fontFamily: '"Courier New"', fontWeight: 700,
        color: active ? '#1a1a2e' : DRC_COLORS[severity],
      }}
    >
      <span style={{
        width: 5, height: 5, display: 'inline-block',
        background: active ? '#1a1a2e' : DRC_COLORS[severity],
      }} />
      {count} {severity.toUpperCase()}
    </button>
  );
}
