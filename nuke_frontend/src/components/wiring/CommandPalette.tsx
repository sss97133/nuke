// CommandPalette.tsx — Cmd+K fuzzy search overlay
// Search devices, wires, zones, actions. Keyboard navigable.

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ManifestDevice, WireSpec } from './overlayCompute';

const C = {
  bg: '#1a1a2e',
  surface: '#1f1f35',
  elevated: '#252540',
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  active: '#00ddff',
} as const;

interface Props {
  devices: ManifestDevice[];
  wires: WireSpec[];
  zoneColors: Record<string, string>;
  onSelectDevice: (id: string) => void;
  onSelectWire: (wireNumber: number) => void;
  onSwitchTab: (tab: string) => void;
  onClose: () => void;
}

interface SearchResult {
  type: 'device' | 'wire' | 'zone' | 'action';
  id: string;
  label: string;
  detail: string;
  color?: string;
}

export function CommandPalette({ devices, wires, zoneColors, onSelectDevice, onSelectWire, onSwitchTab, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Build search index ──
  const allResults = useMemo((): SearchResult[] => {
    const results: SearchResult[] = [];

    // Actions
    results.push(
      { type: 'action', id: 'formboard', label: 'Go to Formboard', detail: 'View 1', color: C.active },
      { type: 'action', id: 'schematics', label: 'Go to Schematics', detail: 'View 2', color: C.active },
      { type: 'action', id: '3d', label: 'Go to 3D View', detail: 'View 3', color: C.active },
      { type: 'action', id: 'data', label: 'Go to Data', detail: 'View 4', color: C.active },
      { type: 'action', id: 'topology', label: 'Go to Topology', detail: 'View 5', color: C.active },
    );

    // Zones
    const zones = [...new Set(devices.map(d => d.location_zone).filter(Boolean))] as string[];
    for (const zone of zones) {
      const count = devices.filter(d => d.location_zone === zone).length;
      results.push({
        type: 'zone', id: zone, label: zone.replace(/_/g, ' ').toUpperCase(),
        detail: `${count} devices`, color: zoneColors[zone],
      });
    }

    // Devices
    for (const d of devices) {
      results.push({
        type: 'device', id: d.id,
        label: d.device_name,
        detail: [d.manufacturer, d.model_number, d.location_zone?.replace(/_/g, ' ')].filter(Boolean).join(' · '),
      });
    }

    // Wires
    for (const w of wires) {
      results.push({
        type: 'wire', id: String(w.wireNumber),
        label: `W${w.wireNumber}: ${w.label}`,
        detail: `${w.gauge}AWG ${w.color} ${w.from} → ${w.to}`,
      });
    }

    return results;
  }, [devices, wires, zoneColors]);

  // ── Fuzzy filter ──
  const filtered = useMemo(() => {
    if (!query.trim()) return allResults.slice(0, 20);
    const q = query.toLowerCase();
    return allResults.filter(r =>
      r.label.toLowerCase().includes(q) ||
      r.detail.toLowerCase().includes(q) ||
      r.type.includes(q)
    ).slice(0, 20);
  }, [query, allResults]);

  // Reset selection when results change
  useEffect(() => { setSelectedIdx(0); }, [filtered]);

  // ── Execute ──
  const executeResult = useCallback((result: SearchResult) => {
    switch (result.type) {
      case 'device': onSelectDevice(result.id); break;
      case 'wire': onSelectWire(parseInt(result.id)); break;
      case 'action': onSwitchTab(result.id); break;
      case 'zone': {
        const first = devices.find(d => d.location_zone === result.id);
        if (first) onSelectDevice(first.id);
        break;
      }
    }
  }, [devices, onSelectDevice, onSelectWire, onSwitchTab]);

  // ── Keyboard nav ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIdx]) executeResult(filtered[selectedIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [filtered, selectedIdx, executeResult, onClose]);

  // ── Scroll selected into view ──
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const typeIcons: Record<string, string> = {
    device: 'DEV', wire: 'WIR', zone: 'ZON', action: 'ACT',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 120,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 480, maxHeight: 400,
          background: C.bg, border: `2px solid ${C.border}`,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Input ── */}
        <div style={{ padding: '8px 12px', borderBottom: `2px solid ${C.border}` }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search devices, wires, zones..."
            style={{
              width: '100%', background: 'transparent', border: 'none', outline: 'none',
              color: C.text, fontFamily: "'Courier New', monospace", fontSize: 13, fontWeight: 700,
            }}
          />
        </div>

        {/* ── Results ── */}
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.map((r, i) => (
            <div
              key={`${r.type}-${r.id}`}
              onClick={() => executeResult(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px',
                background: i === selectedIdx ? C.elevated : 'transparent',
                cursor: 'pointer',
                borderLeft: i === selectedIdx ? `2px solid ${C.active}` : '2px solid transparent',
              }}
            >
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: 7, fontWeight: 700,
                color: r.color || C.muted, minWidth: 24,
              }}>
                {typeIcons[r.type]}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'Courier New', monospace", fontSize: 11, fontWeight: 700,
                  color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {r.label}
                </div>
                <div style={{
                  fontFamily: 'Arial', fontSize: 8, color: C.muted,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {r.detail}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{
              padding: 16, textAlign: 'center',
              color: C.muted, fontFamily: "'Courier New', monospace", fontSize: 10,
            }}>
              NO RESULTS
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
