// HarnessSidebar.tsx — Right panel property inspector for selected node or edge

import React from 'react';
import type { HarnessState, HarnessEndpoint, WiringConnection, HarnessSection } from './harnessTypes';
import { ENDPOINT_TYPE_LABELS, SYSTEM_CATEGORY_LABELS, CONNECTOR_TYPES, LOCATION_ZONES, ALL_WIRE_COLORS } from './harnessConstants';
import { selectWireGauge, suggestFuseRating } from './harnessCalculations';

interface Props {
  state: HarnessState;
  onUpdateNode: (id: string, changes: Partial<HarnessEndpoint>) => void;
  onUpdateConnection: (id: string, changes: Partial<WiringConnection>) => void;
  sections: HarnessSection[];
  vehicleType: string | null;
}

export function HarnessSidebar({ state, onUpdateNode, onUpdateConnection, sections, vehicleType }: Props) {
  const { selection, endpoints, connections } = state;

  const selectedNode = selection.type === 'node' ? endpoints.find(ep => ep.id === selection.id) : null;
  const selectedEdge = selection.type === 'edge' ? connections.find(c => c.id === selection.id) : null;

  if (!selectedNode && !selectedEdge) {
    return (
      <div style={{
        width: 220,
        minWidth: 220,
        borderLeft: '2px solid var(--border)',
        background: 'var(--surface)',
        padding: '8px',
        overflow: 'auto',
      }}>
        <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
          PROPERTIES
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Select an endpoint or wire to edit its properties.
        </div>
        {state.design && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>
              DESIGN
            </div>
            <div style={{ fontSize: '10px', fontWeight: 700 }}>{state.design.name}</div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
              {state.design.ecu_platform || 'No ECU platform set'}
            </div>
          </div>
        )}
        {sections.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>
              SECTIONS
            </div>
            {sections.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                <div style={{ width: 8, height: 8, background: s.color || '#767676' }} />
                <span style={{ fontSize: '9px' }}>{s.name}</span>
                <span style={{ fontSize: '8px', color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: '"Courier New", monospace' }}>
                  {endpoints.filter(ep => ep.section_id === s.id).length}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // NODE EDITOR
  if (selectedNode) {
    return (
      <div style={{
        width: 220,
        minWidth: 220,
        borderLeft: '2px solid var(--border)',
        background: 'var(--surface)',
        padding: '8px',
        overflow: 'auto',
        fontSize: '10px',
      }}>
        <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
          ENDPOINT
        </div>

        <Field label="NAME">
          <input
            type="text"
            value={selectedNode.name}
            onChange={(e) => onUpdateNode(selectedNode.id, { name: e.target.value })}
            style={inputStyle}
          />
        </Field>

        <Field label="TYPE">
          <select
            value={selectedNode.endpoint_type}
            onChange={(e) => onUpdateNode(selectedNode.id, { endpoint_type: e.target.value as any })}
            style={inputStyle}
          >
            {Object.entries(ENDPOINT_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </Field>

        <Field label="SYSTEM">
          <select
            value={selectedNode.system_category || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { system_category: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">None</option>
            {Object.entries(SYSTEM_CATEGORY_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </Field>

        <Field label="SECTION">
          <select
            value={selectedNode.section_id || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { section_id: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">Unassigned</option>
            {sections.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'flex', gap: '4px' }}>
          <Field label="AMPS" style={{ flex: 1 }}>
            <input
              type="number"
              value={selectedNode.amperage_draw ?? ''}
              onChange={(e) => onUpdateNode(selectedNode.id, { amperage_draw: e.target.value ? parseFloat(e.target.value) : null })}
              style={inputStyle}
              step="0.1"
              min="0"
            />
          </Field>
          <Field label="PEAK" style={{ flex: 1 }}>
            <input
              type="number"
              value={selectedNode.peak_amperage ?? ''}
              onChange={(e) => onUpdateNode(selectedNode.id, { peak_amperage: e.target.value ? parseFloat(e.target.value) : null })}
              style={inputStyle}
              step="0.1"
              min="0"
            />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '4px' }}>
          <Field label="VOLTS" style={{ flex: 1 }}>
            <input
              type="number"
              value={selectedNode.voltage}
              onChange={(e) => onUpdateNode(selectedNode.id, { voltage: parseFloat(e.target.value) || 12 })}
              style={inputStyle}
              step="0.1"
            />
          </Field>
          <Field label="WATTS" style={{ flex: 1 }}>
            <input
              type="number"
              value={selectedNode.wattage ?? ''}
              onChange={(e) => onUpdateNode(selectedNode.id, { wattage: e.target.value ? parseFloat(e.target.value) : null })}
              style={inputStyle}
              step="1"
              min="0"
            />
          </Field>
        </div>

        <Field label="CONNECTOR">
          <select
            value={selectedNode.connector_type || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { connector_type: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">None</option>
            {CONNECTOR_TYPES.map(ct => (
              <option key={ct.value} value={ct.value}>{ct.label}</option>
            ))}
          </select>
        </Field>

        <Field label="LOCATION">
          <select
            value={selectedNode.location_zone || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { location_zone: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">Unknown</option>
            {LOCATION_ZONES.map(lz => (
              <option key={lz.value} value={lz.value}>{lz.label}</option>
            ))}
          </select>
        </Field>

        <Field label="PART #">
          <input
            type="text"
            value={selectedNode.part_number || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { part_number: e.target.value || null })}
            style={inputStyle}
            placeholder="e.g. M130, PDM30"
          />
        </Field>

        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <label style={{ fontSize: '8px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <input
              type="checkbox"
              checked={selectedNode.is_switched}
              onChange={(e) => onUpdateNode(selectedNode.id, { is_switched: e.target.checked })}
            />
            SWITCHED
          </label>
          <label style={{ fontSize: '8px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <input
              type="checkbox"
              checked={selectedNode.is_required}
              onChange={(e) => onUpdateNode(selectedNode.id, { is_required: e.target.checked })}
            />
            REQUIRED
          </label>
        </div>

        <Field label="NOTES" style={{ marginTop: '6px' }}>
          <textarea
            value={selectedNode.notes || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { notes: e.target.value || null })}
            style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }}
          />
        </Field>
      </div>
    );
  }

  // EDGE / CONNECTION EDITOR
  if (selectedEdge) {
    const fromEp = endpoints.find(ep => ep.id === selectedEdge.from_endpoint_id);
    const toEp = endpoints.find(ep => ep.id === selectedEdge.to_endpoint_id);
    const amps = selectedEdge.amperage_load || toEp?.amperage_draw || 0;
    const length = selectedEdge.length_ft || 5;
    const gaugeCalc = amps > 0 ? selectWireGauge({ amperage: amps, lengthFt: length }) : null;
    const fuseCalc = amps > 0 ? suggestFuseRating(amps) : null;

    return (
      <div style={{
        width: 220,
        minWidth: 220,
        borderLeft: '2px solid var(--border)',
        background: 'var(--surface)',
        padding: '8px',
        overflow: 'auto',
        fontSize: '10px',
      }}>
        <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
          WIRE
        </div>

        <div style={{ fontSize: '9px', marginBottom: '6px', lineHeight: 1.3 }}>
          <div><strong>{fromEp?.name || '?'}</strong></div>
          <div style={{ color: 'var(--text-muted)', fontSize: '8px' }}>→</div>
          <div><strong>{toEp?.name || '?'}</strong></div>
        </div>

        <Field label="WIRE COLOR">
          <select
            value={selectedEdge.wire_color || ''}
            onChange={(e) => onUpdateConnection(selectedEdge.id, { wire_color: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">Auto</option>
            {ALL_WIRE_COLORS.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>

        <Field label="WIRE GAUGE">
          <input
            type="text"
            value={selectedEdge.wire_gauge || selectedEdge.calculated_gauge || ''}
            onChange={(e) => onUpdateConnection(selectedEdge.id, { wire_gauge: e.target.value || null })}
            style={inputStyle}
            placeholder={gaugeCalc?.gauge || 'Auto'}
          />
        </Field>

        <div style={{ display: 'flex', gap: '4px' }}>
          <Field label="AMPS" style={{ flex: 1 }}>
            <input
              type="number"
              value={selectedEdge.amperage_load ?? ''}
              onChange={(e) => onUpdateConnection(selectedEdge.id, { amperage_load: e.target.value ? parseFloat(e.target.value) : null })}
              style={inputStyle}
              step="0.1"
            />
          </Field>
          <Field label="LENGTH (FT)" style={{ flex: 1 }}>
            <input
              type="number"
              value={selectedEdge.length_ft ?? ''}
              onChange={(e) => onUpdateConnection(selectedEdge.id, { length_ft: e.target.value ? parseFloat(e.target.value) : null })}
              style={inputStyle}
              step="0.5"
              min="0"
            />
          </Field>
        </div>

        {/* Calculated values */}
        {gaugeCalc && (
          <div style={{ marginTop: '6px', padding: '4px', background: 'var(--bg)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '3px' }}>
              CALCULATED
            </div>
            <div style={{ fontFamily: '"Courier New", monospace', fontSize: '9px', lineHeight: 1.5 }}>
              <div>Gauge: <strong>{gaugeCalc.gauge}</strong></div>
              <div>V-Drop: <strong>{gaugeCalc.actualVoltageDrop}V</strong> ({gaugeCalc.voltageDropPercent}%)</div>
              <div>Rating: <strong>{gaugeCalc.recommendation}</strong></div>
              {fuseCalc && <div>Fuse: <strong>{fuseCalc}A</strong></div>}
            </div>
          </div>
        )}

        <Field label="FUSE RATING (A)" style={{ marginTop: '6px' }}>
          <input
            type="number"
            value={selectedEdge.fuse_rating ?? ''}
            onChange={(e) => onUpdateConnection(selectedEdge.id, { fuse_rating: e.target.value ? parseInt(e.target.value) : null })}
            style={inputStyle}
            placeholder={fuseCalc ? String(fuseCalc) : ''}
          />
        </Field>

        <Field label="CONNECTOR">
          <select
            value={selectedEdge.connector_type || ''}
            onChange={(e) => onUpdateConnection(selectedEdge.id, { connector_type: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">None</option>
            {CONNECTOR_TYPES.map(ct => (
              <option key={ct.value} value={ct.value}>{ct.label}</option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <label style={{ fontSize: '8px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <input
              type="checkbox"
              checked={selectedEdge.is_shielded}
              onChange={(e) => onUpdateConnection(selectedEdge.id, { is_shielded: e.target.checked })}
            />
            SHIELDED
          </label>
          <label style={{ fontSize: '8px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <input
              type="checkbox"
              checked={selectedEdge.is_twisted_pair}
              onChange={(e) => onUpdateConnection(selectedEdge.id, { is_twisted_pair: e.target.checked })}
            />
            TWISTED PAIR
          </label>
          <label style={{ fontSize: '8px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <input
              type="checkbox"
              checked={selectedEdge.is_critical}
              onChange={(e) => onUpdateConnection(selectedEdge.id, { is_critical: e.target.checked })}
            />
            CRITICAL
          </label>
        </div>

        <Field label="NOTES" style={{ marginTop: '6px' }}>
          <textarea
            value={selectedEdge.notes || ''}
            onChange={(e) => onUpdateConnection(selectedEdge.id, { notes: e.target.value || null })}
            style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }}
          />
        </Field>
      </div>
    );
  }

  return null;
}

// Shared field wrapper
function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ marginBottom: '4px', ...style }}>
      <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '2px', letterSpacing: '0.3px' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '3px 4px',
  fontSize: '10px',
  fontFamily: 'Arial, sans-serif',
  border: '2px solid var(--border)',
  background: 'var(--bg)',
  boxSizing: 'border-box',
};
