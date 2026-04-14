// LoomTopologyView.tsx — Node-based loom routing topology graph
// Shows how wire looms connect zones through junction nodes.

import React, { useMemo, useState } from 'react';
import type { ManifestDevice, WireSpec } from './overlayCompute';
import type { DRCDeviceResult } from './useDRC';

const ZONE_COLORS: Record<string, string> = {
  engine_bay: '#cc2222', firewall: '#cc6600', dash: '#2266cc',
  doors: '#8822cc', rear: '#22aa44', underbody: '#cc8833',
};

const DRC_COLORS: Record<string, string> = {
  pass: '#22aa44', warn: '#ccaa00', fail: '#cc2222',
};

// Topology positions for zone nodes (SVG coordinates)
const ZONE_POSITIONS: Record<string, { x: number; y: number }> = {
  engine_bay: { x: 120, y: 200 },
  firewall: { x: 300, y: 200 },
  dash: { x: 480, y: 200 },
  doors: { x: 480, y: 380 },
  rear: { x: 680, y: 200 },
  underbody: { x: 300, y: 380 },
};

// Junction nodes (where looms split/merge)
const JUNCTIONS = [
  { id: 'J1', label: 'FIREWALL GROMMET', x: 210, y: 200 },
  { id: 'J2', label: 'DASH JUNCTION', x: 390, y: 200 },
  { id: 'J3', label: 'REAR CROSSOVER', x: 580, y: 200 },
  { id: 'J4', label: 'UNDERBODY SPLIT', x: 300, y: 290 },
];

// Loom connections between zones through junctions
const LOOM_LINKS = [
  { from: 'engine_bay', to: 'J1' },
  { from: 'J1', to: 'firewall' },
  { from: 'firewall', to: 'J2' },
  { from: 'J2', to: 'dash' },
  { from: 'dash', to: 'J3' },
  { from: 'J3', to: 'rear' },
  { from: 'J2', to: 'J4' },
  { from: 'J4', to: 'underbody' },
  { from: 'J4', to: 'doors' },
];

interface Props {
  devices: ManifestDevice[];
  wires: WireSpec[];
  drcMap: Map<string, DRCDeviceResult>;
  selectedDeviceId: string | null;
  onDeviceClick: (id: string, e: React.MouseEvent) => void;
}

export function LoomTopologyView({
  devices, wires, drcMap, selectedDeviceId, onDeviceClick,
}: Props) {
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);

  // Compute wire counts per zone
  const zoneStats = useMemo(() => {
    const stats = new Map<string, { deviceCount: number; wireCount: number; totalAmps: number; drcFail: number; drcWarn: number }>();
    for (const zone of Object.keys(ZONE_POSITIONS)) {
      const zoneDevices = devices.filter(d => d.location_zone === zone);
      const zoneWires = wires.filter(w => {
        const toDevice = devices.find(d => d.device_name === w.to);
        return toDevice?.location_zone === zone;
      });
      const drcFail = zoneDevices.filter(d => drcMap.get(d.id)?.severity === 'fail').length;
      const drcWarn = zoneDevices.filter(d => drcMap.get(d.id)?.severity === 'warn').length;
      stats.set(zone, {
        deviceCount: zoneDevices.length,
        wireCount: zoneWires.length,
        totalAmps: zoneDevices.reduce((s, d) => s + (d.power_draw_amps || 0), 0),
        drcFail,
        drcWarn,
      });
    }
    return stats;
  }, [devices, wires, drcMap]);

  // Compute loom bundle wire counts
  const loomWireCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of LOOM_LINKS) {
      // Count wires that traverse this link
      const fromZone = link.from.startsWith('J') ? null : link.from;
      const toZone = link.to.startsWith('J') ? null : link.to;
      let count = 0;
      if (toZone) {
        count = wires.filter(w => {
          const toDevice = devices.find(d => d.device_name === w.to);
          return toDevice?.location_zone === toZone;
        }).length;
      } else if (fromZone) {
        count = wires.filter(w => {
          const toDevice = devices.find(d => d.device_name === w.to);
          return toDevice?.location_zone === fromZone;
        }).length;
      }
      counts.set(`${link.from}-${link.to}`, count);
    }
    return counts;
  }, [wires, devices]);

  const getPos = (id: string) => {
    if (ZONE_POSITIONS[id]) return ZONE_POSITIONS[id];
    const j = JUNCTIONS.find(j => j.id === id);
    return j ? { x: j.x, y: j.y } : { x: 400, y: 300 };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1a1a2e' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '4px 8px',
        borderBottom: '2px solid #2a2a5e', background: '#1e1e32', flexShrink: 0,
      }}>
        <span style={{ fontSize: '8px', fontWeight: 700, fontFamily: 'Arial', color: '#8888aa',
          textTransform: 'uppercase', letterSpacing: '1px' }}>
          LOOM TOPOLOGY — {devices.length} DEVICES — {wires.length} WIRES
        </span>
      </div>

      {/* SVG Canvas */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={850} height={500} viewBox="0 0 850 500" style={{ display: 'block' }}>
          {/* Background grid */}
          {Array.from({ length: 22 }).map((_, i) => (
            <line key={`gx${i}`} x1={i * 40} y1={0} x2={i * 40} y2={500} stroke="#2a2a3e" strokeWidth={0.3} />
          ))}
          {Array.from({ length: 13 }).map((_, i) => (
            <line key={`gy${i}`} x1={0} y1={i * 40} x2={850} y2={i * 40} stroke="#2a2a3e" strokeWidth={0.3} />
          ))}

          {/* Loom connections */}
          {LOOM_LINKS.map(link => {
            const from = getPos(link.from);
            const to = getPos(link.to);
            const wireCount = loomWireCounts.get(`${link.from}-${link.to}`) || 0;
            const thickness = Math.max(2, Math.min(8, wireCount / 3));
            return (
              <g key={`${link.from}-${link.to}`}>
                <line
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke="#444466" strokeWidth={thickness} strokeLinecap="round"
                />
                {wireCount > 0 && (
                  <text
                    x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 8}
                    fill="#8888aa" textAnchor="middle"
                    style={{ fontSize: '7px', fontFamily: '"Courier New"', fontWeight: 700 }}
                  >
                    {wireCount}W
                  </text>
                )}
              </g>
            );
          })}

          {/* Junction nodes */}
          {JUNCTIONS.map(j => (
            <g key={j.id}>
              <circle cx={j.x} cy={j.y} r={8} fill="#333355" stroke="#555577" strokeWidth={1.5} />
              <text x={j.x} y={j.y - 14} fill="#8888aa" textAnchor="middle"
                style={{ fontSize: '6px', fontFamily: 'Arial', fontWeight: 700, letterSpacing: '0.3px' }}>
                {j.label}
              </text>
            </g>
          ))}

          {/* Zone nodes */}
          {Object.entries(ZONE_POSITIONS).map(([zone, pos]) => {
            const stats = zoneStats.get(zone);
            const color = ZONE_COLORS[zone] || '#555577';
            const isHovered = hoveredZone === zone;
            const hasSelection = selectedDeviceId != null;
            const selectedInZone = hasSelection && devices.find(d => d.id === selectedDeviceId)?.location_zone === zone;
            const isDimmed = hasSelection && !selectedInZone;

            return (
              <g
                key={zone}
                onMouseEnter={() => setHoveredZone(zone)}
                onMouseLeave={() => setHoveredZone(null)}
                style={{ cursor: 'pointer', opacity: isDimmed ? 0.3 : 1, transition: 'opacity 200ms' }}
              >
                {/* Zone box */}
                <rect
                  x={pos.x - 55} y={pos.y - 35} width={110} height={70}
                  fill="#252540"
                  stroke={isHovered || selectedInZone ? '#00ddff' : color}
                  strokeWidth={isHovered || selectedInZone ? 2.5 : 1.5}
                />
                {/* Color accent */}
                <rect x={pos.x - 55} y={pos.y - 35} width={4} height={70} fill={color} />

                {/* Zone name */}
                <text x={pos.x} y={pos.y - 18} fill="#e0e0e8" textAnchor="middle"
                  style={{ fontSize: '8px', fontFamily: 'Arial', fontWeight: 700, letterSpacing: '0.5px' }}>
                  {zone.replace(/_/g, ' ').toUpperCase()}
                </text>

                {/* Stats */}
                <text x={pos.x} y={pos.y - 2} fill="#8888aa" textAnchor="middle"
                  style={{ fontSize: '7px', fontFamily: '"Courier New"', fontWeight: 700 }}>
                  {stats?.deviceCount || 0} DEV | {stats?.wireCount || 0} WIRES
                </text>
                <text x={pos.x} y={pos.y + 12} fill="#8888aa" textAnchor="middle"
                  style={{ fontSize: '7px', fontFamily: '"Courier New"' }}>
                  {(stats?.totalAmps || 0).toFixed(1)}A TOTAL
                </text>

                {/* DRC summary for zone */}
                {stats && (stats.drcFail > 0 || stats.drcWarn > 0) && (
                  <g>
                    {stats.drcFail > 0 && (
                      <>
                        <circle cx={pos.x + 40} cy={pos.y - 28} r={4} fill={DRC_COLORS.fail} />
                        <text x={pos.x + 40} y={pos.y - 26} fill="#fff" textAnchor="middle"
                          style={{ fontSize: '5px', fontFamily: '"Courier New"', fontWeight: 700 }}>
                          {stats.drcFail}
                        </text>
                      </>
                    )}
                    {stats.drcWarn > 0 && (
                      <>
                        <circle cx={pos.x + 30} cy={pos.y - 28} r={4} fill={DRC_COLORS.warn} />
                        <text x={pos.x + 30} y={pos.y - 26} fill="#1a1a2e" textAnchor="middle"
                          style={{ fontSize: '5px', fontFamily: '"Courier New"', fontWeight: 700 }}>
                          {stats.drcWarn}
                        </text>
                      </>
                    )}
                  </g>
                )}
              </g>
            );
          })}

          {/* Title */}
          <text x={425} y={480} fill="#555577" textAnchor="middle"
            style={{ fontSize: '8px', fontFamily: 'Arial', fontWeight: 700, letterSpacing: '1px' }}>
            1977 K5 BLAZER — HARNESS LOOM TOPOLOGY
          </text>
        </svg>
      </div>
    </div>
  );
}
