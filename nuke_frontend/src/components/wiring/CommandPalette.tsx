// CommandPalette.tsx — Cmd+K search-everything overlay
// Fuzzy searches devices, wires, zones, and actions.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ManifestDevice, WireSpec } from './overlayCompute';

type ResultCategory = 'DEVICES' | 'WIRES' | 'ZONES' | 'ACTIONS';

interface SearchResult {
  id: string;
  category: ResultCategory;
  label: string;
  description: string;
  imageUrl?: string;
  data?: { deviceId?: string; wireNumber?: number; zone?: string; action?: string };
}

interface Props {
  devices: ManifestDevice[];
  wires: WireSpec[];
  isOpen: boolean;
  onClose: () => void;
  onSelectDevice: (deviceId: string) => void;
  onSelectWire: (wireNumber: number) => void;
  onFilterZone: (zone: string) => void;
  onAction: (action: string) => void;
}

// Simple fuzzy match — checks if all query chars appear in order in the target
function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return 100 - q.length; // Exact substring match scores highest
  let qi = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      score += 10;
      // Bonus for matching at start or after separator
      if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '_') score += 5;
    }
  }
  return qi === q.length ? score : -1;
}

const ACTIONS: { id: string; label: string; description: string }[] = [
  { id: 'export-bom', label: 'Export BOM', description: 'Generate Bill of Materials spreadsheet' },
  { id: 'export-cutlist', label: 'Export Cut List', description: 'Generate wire cutting list' },
  { id: 'print-formboard', label: 'Print Formboard', description: 'Print 1:1 formboard layout' },
  { id: 'reset-view', label: 'Reset View', description: 'Reset zoom and pan to default' },
];

export function CommandPalette({
  devices, wires, isOpen, onClose, onSelectDevice, onSelectWire, onFilterZone, onAction,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build search results
  const results = useMemo((): SearchResult[] => {
    if (!query.trim()) {
      // Show recent/popular items when empty
      const items: SearchResult[] = [];
      // Show first few devices
      devices.slice(0, 5).forEach(d => {
        items.push({
          id: `device-${d.id}`,
          category: 'DEVICES',
          label: d.device_name,
          description: `${d.device_category} | ${d.location_zone?.replace(/_/g, ' ') || '—'}`,
          imageUrl: d.product_image_url || undefined,
          data: { deviceId: d.id },
        });
      });
      // Show zones
      const zones = [...new Set(devices.map(d => d.location_zone).filter(Boolean))] as string[];
      zones.forEach(z => {
        const count = devices.filter(d => d.location_zone === z).length;
        items.push({
          id: `zone-${z}`,
          category: 'ZONES',
          label: z.replace(/_/g, ' '),
          description: `${count} devices`,
          data: { zone: z },
        });
      });
      // Show actions
      ACTIONS.forEach(a => {
        items.push({
          id: `action-${a.id}`,
          category: 'ACTIONS',
          label: a.label,
          description: a.description,
          data: { action: a.id },
        });
      });
      return items;
    }

    const items: SearchResult[] = [];

    // Search devices
    devices.forEach(d => {
      const fields = [d.device_name, d.manufacturer || '', d.part_number || '', d.device_category || ''];
      const bestScore = Math.max(...fields.map(f => fuzzyMatch(query, f)));
      if (bestScore >= 0) {
        items.push({
          id: `device-${d.id}`,
          category: 'DEVICES',
          label: d.device_name,
          description: `${d.device_category} | ${d.location_zone?.replace(/_/g, ' ') || '—'} | ${d.manufacturer || ''}`,
          imageUrl: d.product_image_url || undefined,
          data: { deviceId: d.id },
        });
      }
    });

    // Search wires
    wires.forEach(w => {
      const fields = [w.label, w.from, w.to, w.color, `W${w.wireNumber}`];
      const bestScore = Math.max(...fields.map(f => fuzzyMatch(query, f)));
      if (bestScore >= 0) {
        items.push({
          id: `wire-${w.wireNumber}`,
          category: 'WIRES',
          label: `W${w.wireNumber}: ${w.label}`,
          description: `${w.from} → ${w.to} | ${w.gauge}AWG ${w.color}`,
          data: { wireNumber: w.wireNumber },
        });
      }
    });

    // Search zones
    const zones = [...new Set(devices.map(d => d.location_zone).filter(Boolean))] as string[];
    zones.forEach(z => {
      if (fuzzyMatch(query, z.replace(/_/g, ' ')) >= 0) {
        const count = devices.filter(d => d.location_zone === z).length;
        items.push({
          id: `zone-${z}`,
          category: 'ZONES',
          label: z.replace(/_/g, ' '),
          description: `${count} devices`,
          data: { zone: z },
        });
      }
    });

    // Search actions
    ACTIONS.forEach(a => {
      if (fuzzyMatch(query, a.label) >= 0 || fuzzyMatch(query, a.description) >= 0) {
        items.push({
          id: `action-${a.id}`,
          category: 'ACTIONS',
          label: a.label,
          description: a.description,
          data: { action: a.id },
        });
      }
    });

    // Also check for special queries
    if (fuzzyMatch(query, 'unpurchased') >= 0) {
      const count = devices.filter(d => !d.purchased).length;
      items.unshift({
        id: 'filter-unpurchased',
        category: 'ACTIONS',
        label: 'Filter: Unpurchased',
        description: `Show ${count} unpurchased devices`,
        data: { action: 'filter-unpurchased' },
      });
    }

    return items.slice(0, 30); // Cap results
  }, [query, devices, wires]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = results[selectedIndex];
      if (result) handleSelect(result);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [results, selectedIndex, onClose]);

  const handleSelect = useCallback((result: SearchResult) => {
    onClose();
    if (result.data?.deviceId) onSelectDevice(result.data.deviceId);
    else if (result.data?.wireNumber) onSelectWire(result.data.wireNumber);
    else if (result.data?.zone) onFilterZone(result.data.zone);
    else if (result.data?.action) onAction(result.data.action);
  }, [onClose, onSelectDevice, onSelectWire, onFilterZone, onAction]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0, 0, 0, 0.7)', display: 'flex', justifyContent: 'center',
        paddingTop: '15vh', fontFamily: 'Arial, sans-serif',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 440, maxHeight: '60vh', display: 'flex', flexDirection: 'column',
          background: '#1e1e32', border: '2px solid #2a2a5e',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ padding: '10px 12px', borderBottom: '2px solid #2a2a5e' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="SEARCH DEVICES, WIRES, ZONES, ACTIONS..."
            style={{
              width: '100%', fontSize: '11px', fontWeight: 700, fontFamily: 'Arial',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              padding: '8px 10px', border: '2px solid #2a2a5e',
              background: '#1a1a2e', color: '#e0e0e8', outline: 'none',
            }}
          />
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {results.length === 0 && query && (
            <div style={{
              padding: '20px 12px', textAlign: 'center',
              fontSize: '9px', color: '#555577', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
              NO RESULTS
            </div>
          )}

          {/* Group by category */}
          {(['DEVICES', 'WIRES', 'ZONES', 'ACTIONS'] as ResultCategory[]).map(cat => {
            const catResults = results.filter(r => r.category === cat);
            if (catResults.length === 0) return null;
            return (
              <div key={cat}>
                <div style={{
                  padding: '6px 12px', fontSize: '7px', fontWeight: 700,
                  color: '#555577', letterSpacing: '1px',
                  borderBottom: '1px solid #2a2a5e', background: '#1a1a2e',
                }}>
                  {cat}
                </div>
                {catResults.map(result => {
                  const globalIdx = results.indexOf(result);
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <div
                      key={result.id}
                      onClick={() => handleSelect(result)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 12px', cursor: 'pointer',
                        background: isSelected ? '#2a2a5e' : 'transparent',
                        borderBottom: '1px solid #252540',
                      }}
                    >
                      {result.imageUrl && (
                        <img
                          src={result.imageUrl}
                          alt=""
                          style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0, background: '#ffffff' }}
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '9px', fontWeight: 700, color: '#e0e0e8',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {result.label}
                        </div>
                        <div style={{
                          fontSize: '7px', color: '#8888aa', fontFamily: '"Courier New"',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {result.description}
                        </div>
                      </div>
                      {isSelected && (
                        <span style={{
                          fontSize: '7px', color: '#00ddff', fontWeight: 700,
                          fontFamily: '"Courier New"', flexShrink: 0,
                        }}>
                          ENTER
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '6px 12px', borderTop: '2px solid #2a2a5e',
          display: 'flex', gap: 12, fontSize: '7px', color: '#555577',
          fontFamily: '"Courier New"', fontWeight: 700,
        }}>
          <span>↑↓ NAVIGATE</span>
          <span>ENTER SELECT</span>
          <span>ESC CLOSE</span>
        </div>
      </div>
    </div>
  );
}
