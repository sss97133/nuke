// WiringTechView — the navigable tech packet for the K5 (and any vehicle with
// the same emitter shape). Functions are the lead element: every Condition
// expression is rendered in monospace, searchable, with cross-references to
// the outputs that consume it.
//
// Sections (top to bottom):
//   1. Header bar — vehicle, audit OK across both PDMs, download buttons
//   2. PDM30 Functions  (84 Conditions)         ← lead element
//   3. PDM30 Counters   (11)
//   4. PDM30 Outputs    (30, with driven_by link)
//   5. PDM30 Keypad     (15 bindings)
//   6. PDM15 Functions  (17)
//   7. PDM15 Outputs    (10)
//   8. Tech packet data (collapsible) — wire list / channel map / BOM
//
// All data sources are computed client-side except the bottom section, which
// hits the 5 RPCs via useTechPacket.

import React, { useMemo, useState } from 'react';
import {
  pdmConfigToYaml, auditPdmConfig,
} from './generatePdmConfig';
import {
  pdm15ConfigToYaml, auditPdm15Config,
} from './generatePdm15Config';
import type {
  PdmConfig, PdmCondition, PdmCounter, PdmOutputPin, PdmKeypadBinding,
} from './generatePdmConfig';
import { useTechPacket } from './useTechPacket';
import type { ManifestDevice } from './overlayCompute';
import { K5_FEATURES, type K5Features } from './k5Features';
import { deriveBodyConfig } from './deriveBodyConfig';
import { FeaturesPanel } from './FeaturesPanel';
import { pdmConfigToXml } from './generatePdmXml';

interface Props {
  vehicleId: string | undefined;
  vehicleName: string;
  manifest: ManifestDevice[];
}

const LABEL: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: '#e2e8f0',
};
const SUBLABEL: React.CSSProperties = { ...LABEL, color: '#9aa4b2', fontWeight: 500 };
const MONO: React.CSSProperties = {
  fontFamily: '"Courier New", monospace',
  fontSize: 12,
  color: '#d6deeb',
};
const MONO_SMALL: React.CSSProperties = { ...MONO, fontSize: 11 };

// ──────────────────────────────────────────────────────────────────────
// Helper — splits a Condition expression into clickable token spans
// (so a reference to another Condition becomes a link).
// ──────────────────────────────────────────────────────────────────────
function ExpressionTokens({
  expression, knownNames, onJump,
}: {
  expression: string;
  knownNames: Set<string>;
  onJump: (name: string) => void;
}) {
  // Match identifiers (allow dotted accessors like x.Status), keywords, ops, parens.
  const tokens = expression.split(/(\s+|[(),])/);
  return (
    <>
      {tokens.map((t, i) => {
        const base = t.replace(/\.(Status|Voltage|rising_edge|falling_edge|expired)$/, '');
        if (knownNames.has(base) && t.trim() !== '') {
          return (
            <span
              key={i}
              onClick={() => onJump(base)}
              style={{
                color: '#82aaff', cursor: 'pointer', textDecoration: 'underline',
                textDecorationStyle: 'dotted',
              }}
              title={`Jump to ${base}`}
            >{t}</span>
          );
        }
        if (/^(NOT|AND|OR|PULSE|FLASH|SET_RESET|HYSTERESIS|TOGGLE|COUNTER|PACK|CAN_RELAY|CAN_LINK_OK|AND_BITMASK|Equal_to|Greater_than|Less_than|Not_equal_to|TRUE|FALSE)$/.test(t.trim())) {
          return <span key={i} style={{ color: '#c792ea', fontWeight: 700 }}>{t}</span>;
        }
        if (/^[0-9]/.test(t.trim()) || /^0x[0-9a-fA-F]+$/.test(t.trim())) {
          return <span key={i} style={{ color: '#f78c6c' }}>{t}</span>;
        }
        return <span key={i}>{t}</span>;
      })}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Section: Functions (Conditions)
// ──────────────────────────────────────────────────────────────────────
function FunctionsSection({
  pdmName, conditions, counters, outputs, knownNames, search, onJump,
}: {
  pdmName: string;
  conditions: PdmCondition[];
  counters: PdmCounter[];
  outputs: PdmOutputPin[];
  knownNames: Set<string>;
  search: string;
  onJump: (name: string) => void;
}) {
  const consumers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const o of outputs) {
      const base = o.driven_by.replace(/\.(Status|Voltage|rising_edge|falling_edge|expired)$/, '');
      if (!map.has(base)) map.set(base, []);
      map.get(base)!.push(`OUT${o.out} ${o.device}`);
    }
    return map;
  }, [outputs]);

  const filtered = useMemo(() => {
    if (!search) return conditions;
    const s = search.toLowerCase();
    return conditions.filter(c =>
      c.name.toLowerCase().includes(s) ||
      c.expression.toLowerCase().includes(s) ||
      (c.note && c.note.toLowerCase().includes(s))
    );
  }, [conditions, search]);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <span style={LABEL}>{pdmName} FUNCTIONS / CONDITIONS</span>
        <span style={SUBLABEL}>{filtered.length}/{conditions.length} CONDITIONS · {counters.length} COUNTERS</span>
      </div>
      <div style={{ border: '2px solid #2a3142', background: '#0f1218' }}>
        {filtered.map((c, i) => {
          const used = consumers.get(c.name) || [];
          return (
            <div
              key={c.name}
              id={`fn-${c.name}`}
              style={{
                padding: '8px 12px',
                borderBottom: i < filtered.length - 1 ? '1px solid #1a1f2c' : 'none',
                background: i % 2 ? '#0f1218' : '#12161e',
              }}
            >
              <div style={{ ...MONO, fontSize: 13, lineHeight: '20px' }}>
                <span style={{ color: '#7fdbca', fontWeight: 700 }}>{c.name}</span>
                <span style={{ color: '#5a6473' }}>{' = '}</span>
                <ExpressionTokens expression={c.expression} knownNames={knownNames} onJump={onJump} />
              </div>
              {c.note && (
                <div style={{ ...MONO_SMALL, color: '#637488', marginTop: 4, fontSize: 10 }}>
                  // {c.note}
                </div>
              )}
              {used.length > 0 && (
                <div style={{ ...MONO_SMALL, color: '#9aa4b2', marginTop: 4, fontSize: 10 }}>
                  → drives: {used.join(' · ')}
                </div>
              )}
            </div>
          );
        })}
        {/* Counters appended */}
        {counters.length > 0 && (
          <div style={{ borderTop: '2px solid #2a3142', padding: '8px 12px', background: '#12161e' }}>
            <div style={{ ...SUBLABEL, marginBottom: 4 }}>COUNTERS</div>
            {counters.map(ct => (
              <div key={ct.name} style={{ ...MONO_SMALL, fontSize: 11, marginBottom: 2 }}>
                <span style={{ color: '#7fdbca' }}>{ct.name}</span>
                <span style={{ color: '#5a6473' }}>{' ← '}</span>
                <span style={{ color: '#82aaff' }}>{ct.source}</span>
                <span style={{ color: '#637488' }}>{' on '}{ct.on_edge}{'  /  overflow '}</span>
                <span style={{ color: '#f78c6c' }}>{ct.overflow_at}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Section: Output Pin Grid
// ──────────────────────────────────────────────────────────────────────
function OutputGrid({
  pdmName, outputs, totalSlots, onJumpToFunction,
}: {
  pdmName: string;
  outputs: PdmOutputPin[];
  totalSlots: number;
  onJumpToFunction: (name: string) => void;
}) {
  const occupied = new Map(outputs.map(o => [o.out, o]));
  const cells = Array.from({ length: totalSlots }, (_, i) => occupied.get(i + 1) || null);
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <span style={LABEL}>{pdmName} OUTPUTS</span>
        <span style={SUBLABEL}>{outputs.length}/{totalSlots} ASSIGNED</span>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4,
        border: '2px solid #2a3142', padding: 4, background: '#0f1218',
      }}>
        {cells.map((cell, idx) => {
          const ch = idx + 1;
          if (!cell) {
            return (
              <div key={ch} style={{
                border: '2px dashed #2a3142', padding: 6, minHeight: 56,
                ...MONO_SMALL, color: '#3d4658', fontSize: 10,
              }}>
                OUT{ch}<br/>(empty)
              </div>
            );
          }
          const isStayAlive = cell.stay_alive;
          const driven = cell.driven_by.replace(/\.(Status|Voltage|rising_edge|falling_edge|expired)$/, '');
          return (
            <div key={ch} style={{
              border: `2px solid ${isStayAlive ? '#f78c6c' : '#445069'}`,
              padding: 6, minHeight: 56, background: '#12161e',
            }}>
              <div style={{ ...MONO_SMALL, fontWeight: 700, color: '#7fdbca', fontSize: 10 }}>
                OUT{ch} · {cell.max_amps}A
              </div>
              <div style={{ ...MONO_SMALL, color: '#d6deeb', fontSize: 10, marginTop: 2 }}>
                {cell.device.length > 32 ? cell.device.slice(0, 32) + '…' : cell.device}
              </div>
              <div
                onClick={() => onJumpToFunction(driven)}
                style={{ ...MONO_SMALL, color: '#82aaff', fontSize: 9, marginTop: 2, cursor: 'pointer', textDecoration: 'underline' }}
                title={`Jump to ${driven}`}
              >
                ← {cell.driven_by}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ ...SUBLABEL, marginTop: 6, fontSize: 8 }}>
        ORANGE BORDER = STAY-ALIVE · DASHED = UNASSIGNED
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Section: Keypad bindings
// ──────────────────────────────────────────────────────────────────────
function KeypadSection({ bindings }: { bindings: PdmKeypadBinding[] }) {
  if (bindings.length === 0) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={LABEL}>KEYPAD BINDINGS · {bindings.length}</div>
      <div style={{ border: '2px solid #2a3142', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', ...MONO_SMALL }}>
          <thead>
            <tr style={{ background: '#1a1f2c', color: '#9aa4b2', fontSize: 9, textTransform: 'uppercase' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>PAGE</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>BTN</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>PRESS</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {bindings.map((b, i) => (
              <tr key={i} style={{ borderTop: '1px solid #1a1f2c', background: i % 2 ? '#0f1218' : '#12161e' }}>
                <td style={{ padding: '4px 8px' }}>{b.page}</td>
                <td style={{ padding: '4px 8px', color: '#7fdbca' }}>{b.button}</td>
                <td style={{ padding: '4px 8px', color: '#c792ea' }}>{b.press}</td>
                <td style={{ padding: '4px 8px', color: '#82aaff' }}>{b.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Section: Tech packet data tables (RPC-backed, collapsible)
// ──────────────────────────────────────────────────────────────────────
function TechPacketTables({ vehicleId }: { vehicleId: string }) {
  const tp = useTechPacket(vehicleId);
  const [expanded, setExpanded] = useState(false);
  if (tp.loading) {
    return <div style={{ ...SUBLABEL, padding: 16 }}>Loading tech packet…</div>;
  }
  if (tp.error) {
    return <div style={{ ...SUBLABEL, padding: 16, color: '#ef5350' }}>Tech packet error: {tp.error}</div>;
  }
  return (
    <div style={{ marginBottom: 32 }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ ...LABEL, cursor: 'pointer', padding: '8px 0', borderTop: '2px solid #2a3142' }}
      >
        {expanded ? '▼' : '▶'} TECH PACKET DATA · {tp.wireList.length} wires · {tp.pdmChannels.length} channel rows · {tp.bomWire.length} gauge×color · {tp.bomConnectors.length} connectors
      </div>
      {expanded && (
        <>
          {tp.manifest && (
            <div style={{ ...MONO_SMALL, padding: '8px 12px', border: '2px solid #2a3142', marginBottom: 8 }}>
              <div style={SUBLABEL}>MANIFEST SUMMARY</div>
              <div style={{ marginTop: 4 }}>
                {tp.manifest.devices_total} devices · {tp.manifest.devices_purchased} purchased · ${tp.manifest.spent_usd.toLocaleString()} spent · ${tp.manifest.pending_usd.toLocaleString()} pending · ${tp.manifest.total_spec_usd.toLocaleString()} total spec
              </div>
            </div>
          )}
          <DataTable title="WIRE LIST" rows={tp.wireList.slice(0, 200)} columns={[
            { key: 'src', label: 'SRC' },
            { key: 'circuit_code', label: 'CIRCUIT' },
            { key: 'from_component', label: 'FROM' },
            { key: 'to_component', label: 'TO' },
            { key: 'wire_gauge_awg', label: 'AWG' },
            { key: 'wire_color', label: 'COLOR' },
            { key: 'length_ft', label: 'FT' },
            { key: 'fuse_rating_amps', label: 'FUSE' },
          ]} />
          <DataTable title="PDM CHANNEL MAP" rows={tp.pdmChannels} columns={[
            { key: 'pdm', label: 'PDM' },
            { key: 'channel', label: 'CHANNEL' },
            { key: 'device', label: 'DEVICE' },
            { key: 'wire_gauge_awg', label: 'AWG' },
            { key: 'wire_color', label: 'COLOR' },
            { key: 'fuse_rating_amps', label: 'FUSE' },
            { key: 'circuit_code', label: 'CIRCUIT' },
          ]} />
          <DataTable title="BOM — WIRE BY GAUGE × COLOR" rows={tp.bomWire} columns={[
            { key: 'wire_gauge_awg', label: 'AWG' },
            { key: 'wire_color', label: 'COLOR' },
            { key: 'base_ft', label: 'BASE FT' },
            { key: 'order_ft', label: 'ORDER FT (+30%)' },
            { key: 'spool_size', label: 'SPOOL' },
          ]} />
          <DataTable title="BOM — CONNECTORS" rows={tp.bomConnectors} columns={[
            { key: 'device_model', label: 'DEVICE MODEL' },
            { key: 'connector_type', label: 'CONNECTOR' },
            { key: 'pin_count', label: 'PINS' },
            { key: 'qty', label: 'QTY' },
          ]} />
        </>
      )}
    </div>
  );
}

function DataTable<T extends Record<string, unknown>>({
  title, rows, columns,
}: {
  title: string;
  rows: T[];
  columns: { key: keyof T; label: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ ...LABEL, marginBottom: 4 }}>{title} · {rows.length}</div>
      <div style={{ border: '2px solid #2a3142', maxHeight: 360, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', ...MONO_SMALL, fontSize: 11 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#1a1f2c', zIndex: 1 }}>
            <tr style={{ color: '#9aa4b2', fontSize: 9, textTransform: 'uppercase' }}>
              {columns.map(c => (
                <th key={String(c.key)} style={{ padding: '6px 8px', textAlign: 'left' }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid #1a1f2c', background: i % 2 ? '#0f1218' : '#12161e' }}>
                {columns.map(c => (
                  <td key={String(c.key)} style={{ padding: '3px 8px', color: '#d6deeb' }}>
                    {r[c.key] === null || r[c.key] === undefined ? '—' : String(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Top-level component
// ──────────────────────────────────────────────────────────────────────

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function WiringTechView({ vehicleId, vehicleName, manifest: _manifest }: Props) {
  const [features, setFeatures] = useState<K5Features>(K5_FEATURES);
  const baseline = useMemo(() => deriveBodyConfig(K5_FEATURES, vehicleName), [vehicleName]);
  const derived = useMemo(() => deriveBodyConfig(features, vehicleName), [features, vehicleName]);
  const pdm30Cfg = derived.pdm30;
  const pdm15Cfg = derived.pdm15;
  const pdm30Audit = auditPdmConfig(pdm30Cfg);
  const pdm15Audit = auditPdm15Config(pdm15Cfg);

  const [search, setSearch] = useState('');

  // Build a single set of known names across both PDMs so cross-references
  // (e.g. PDM15 referencing relayed PDM30 channels) render as links.
  const knownNames = useMemo(() => {
    const s = new Set<string>();
    for (const cfg of [pdm30Cfg, pdm15Cfg]) {
      cfg.input_pins.forEach(p => s.add(p.channel_name));
      cfg.can_inputs.forEach(c => s.add(c.name));
      cfg.conditions.forEach(c => s.add(c.name));
      cfg.counters.forEach(c => s.add(c.name));
    }
    return s;
  }, [pdm30Cfg, pdm15Cfg]);

  const jump = (name: string) => {
    const el = document.getElementById(`fn-${name}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const auditPill = (ok: boolean) => (
    <span style={{
      ...LABEL, padding: '2px 8px', border: '2px solid',
      borderColor: ok ? '#22c55e' : '#ef4444',
      color: ok ? '#22c55e' : '#ef4444', fontSize: 9,
    }}>
      {ok ? 'AUDIT OK' : 'AUDIT FAIL'}
    </span>
  );

  if (!vehicleId) return null;

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto', background: '#0a0d12', color: '#d6deeb' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 12px', border: '2px solid #2a3142', background: '#12161e',
        marginBottom: 16, position: 'sticky', top: 0, zIndex: 5,
      }}>
        <span style={{ ...LABEL, fontSize: 11 }}>{vehicleName} — TECH PACKET</span>
        <span style={{ color: '#3d4658' }}>·</span>
        <span style={SUBLABEL}>PDM30</span>
        {auditPill(pdm30Audit.ok)}
        <span style={{ color: '#3d4658' }}>·</span>
        <span style={SUBLABEL}>PDM15</span>
        {auditPill(pdm15Audit.ok)}
        <span style={{ flex: 1 }} />
        <input
          type="text" placeholder="search functions…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            ...MONO_SMALL, padding: '4px 8px', background: '#0f1218',
            border: '2px solid #2a3142', color: '#d6deeb', width: 220,
          }}
        />
        <button
          onClick={() => downloadText(`${vehicleName.replace(/[^a-zA-Z0-9]/g,'_')}_PDM30.pdm`, pdmConfigToXml(pdm30Cfg))}
          style={{
            ...LABEL, padding: '4px 10px', border: '2px solid #22c55e',
            background: 'transparent', color: '#22c55e', cursor: 'pointer', fontSize: 9,
          }}
          title="PDM Manager-importable XML — reflects current Features panel state"
        >↓ PDM30.PDM</button>
        <button
          onClick={() => downloadText(`${vehicleName.replace(/[^a-zA-Z0-9]/g,'_')}_PDM15.pdm`, pdmConfigToXml(pdm15Cfg))}
          style={{
            ...LABEL, padding: '4px 10px', border: '2px solid #22c55e',
            background: 'transparent', color: '#22c55e', cursor: 'pointer', fontSize: 9,
          }}
          title="PDM Manager-importable XML — reflects current Features panel state"
        >↓ PDM15.PDM</button>
        <button
          onClick={() => downloadText(`${vehicleName.replace(/[^a-zA-Z0-9]/g,'_')}_PDM30.yaml`, pdmConfigToYaml(pdm30Cfg))}
          style={{
            ...LABEL, padding: '4px 10px', border: '2px solid #82aaff',
            background: 'transparent', color: '#82aaff', cursor: 'pointer', fontSize: 9,
          }}
          title="Human-readable spec — read alongside PDM Manager while authoring"
        >↓ YAML</button>
      </div>

      {/* Features panel — flip checkboxes, watch the PDM rebuild live */}
      <FeaturesPanel
        features={features}
        baselineStats={baseline.stats}
        currentStats={derived.stats}
        onChange={setFeatures}
        onReset={() => setFeatures(K5_FEATURES)}
      />

      {/* PDM30 */}
      <FunctionsSection
        pdmName="PDM30" conditions={pdm30Cfg.conditions} counters={pdm30Cfg.counters}
        outputs={pdm30Cfg.output_pins} knownNames={knownNames} search={search} onJump={jump}
      />
      <OutputGrid pdmName="PDM30" outputs={pdm30Cfg.output_pins} totalSlots={30} onJumpToFunction={jump} />
      <KeypadSection bindings={pdm30Cfg.keypad_bindings} />

      {/* PDM15 */}
      <FunctionsSection
        pdmName="PDM15" conditions={pdm15Cfg.conditions} counters={pdm15Cfg.counters}
        outputs={pdm15Cfg.output_pins} knownNames={knownNames} search={search} onJump={jump}
      />
      <OutputGrid pdmName="PDM15" outputs={pdm15Cfg.output_pins} totalSlots={15} onJumpToFunction={jump} />

      {/* RPC-backed tables */}
      <TechPacketTables vehicleId={vehicleId} />
    </div>
  );
}

export default WiringTechView;
