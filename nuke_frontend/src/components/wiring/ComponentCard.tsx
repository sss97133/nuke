// ComponentCard.tsx — Component detail card with drawing, connectors, docs, supplier
// Renders inside detail panel when clicking a device that has component_library data.

import React from 'react';
import type { LibraryComponent, ComponentConnector } from './useComponentLibrary';
import { ConnectorFaceView } from './ConnectorFaceView';
import type { ComponentPin } from './useComponentLibrary';
import type { WireSpec } from './overlayCompute';

// ── Shared styles ─────────────────────────────────────────────────────
const label: React.CSSProperties = {
  fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
  color: 'var(--text-secondary, #666)', fontWeight: 700, fontFamily: 'Arial, sans-serif',
};
const val: React.CSSProperties = {
  fontSize: '10px', fontFamily: '"Courier New", monospace', fontWeight: 700,
  color: 'var(--text, #2a2a2a)',
};
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
  padding: '3px 0', borderBottom: '1px solid var(--border, #bdbdbd)',
};
const sectionTitle: React.CSSProperties = {
  ...label, fontSize: '7px', letterSpacing: '1px', marginBottom: 4,
  paddingBottom: 3, borderBottom: '2px solid var(--text, #2a2a2a)',
};

// ── Props ─────────────────────────────────────────────────────────────
interface Props {
  component: LibraryComponent;
  wires?: WireSpec[];
  ecuModel?: string;
  onPinClick?: (pin: ComponentPin, wire?: WireSpec) => void;
  activeConnector?: string; // connector label to show expanded
  onConnectorSelect?: (label: string) => void;
}

export function ComponentCard({
  component, wires = [], ecuModel, onPinClick,
  activeConnector, onConnectorSelect,
}: Props) {
  const totalPins = component.connectors.reduce((s, c) => s + (c.pin_count || c.pins.length), 0);

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <div style={sectionTitle}>COMPONENT LIBRARY</div>

      {/* Identification */}
      <div style={row}>
        <span style={label}>MANUFACTURER</span>
        <span style={val}>{component.manufacturer}</span>
      </div>
      <div style={row}>
        <span style={label}>PART NUMBER</span>
        <span style={val}>{component.part_number}</span>
      </div>
      {component.category && (
        <div style={row}>
          <span style={label}>CATEGORY</span>
          <span style={val}>{component.category}{component.subcategory ? ` / ${component.subcategory}` : ''}</span>
        </div>
      )}
      {component.price_usd != null && (
        <div style={row}>
          <span style={label}>PRICE</span>
          <span style={val}>
            ${Number(component.price_usd).toLocaleString()}
            {component.price_source ? ` (${component.price_source})` : ''}
          </span>
        </div>
      )}
      {component.verified && (
        <div style={row}>
          <span style={label}>VERIFIED</span>
          <span style={{ ...val, color: 'var(--success, #16825d)' }}>YES</span>
        </div>
      )}

      {/* Dimensional drawing */}
      {component.drawings.length > 0 && (
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <div style={sectionTitle}>DIMENSIONAL DRAWING</div>
          {component.drawings.map(d => (
            <div key={d.id} style={{ marginBottom: 6 }}>
              {d.storage_url && (
                <div style={{
                  display: 'flex', justifyContent: 'center',
                  background: '#fff', padding: 6,
                  border: '1px solid var(--border)',
                  marginBottom: 4,
                }}>
                  <img
                    src={d.storage_url}
                    alt={`${component.name} ${d.drawing_type} ${d.view_angle || ''}`}
                    style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
              <div style={{ fontSize: '7px', color: 'var(--text-secondary)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>{d.drawing_type.toUpperCase()}</span>
                {d.view_angle && <span>VIEW: {d.view_angle.toUpperCase()}</span>}
                {d.scale && <span>SCALE: {d.scale}</span>}
                {d.source_page && <span>PAGE {d.source_page}</span>}
              </div>
              {d.dimensions_extracted && Object.keys(d.dimensions_extracted).length > 0 && (
                <div style={{ marginTop: 2 }}>
                  {Object.entries(d.dimensions_extracted).map(([k, v]) => (
                    <div key={k} style={row}>
                      <span style={label}>{k.replace(/_/g, ' ')}</span>
                      <span style={val}>{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Electrical spec from JSONB */}
      {component.electrical_spec && Object.keys(component.electrical_spec).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={sectionTitle}>ELECTRICAL SPECIFICATIONS</div>
          {Object.entries(component.electrical_spec).map(([k, v]) => (
            <div key={k} style={row}>
              <span style={label}>{k.replace(/_/g, ' ')}</span>
              <span style={val}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Connectors */}
      {component.connectors.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{
            ...sectionTitle,
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>CONNECTORS ({component.connectors.length})</span>
            <span style={{ fontWeight: 400 }}>{totalPins} TOTAL PINS</span>
          </div>

          {/* Connector tabs (if multiple) */}
          {component.connectors.length > 1 && (
            <div style={{ display: 'flex', gap: 0, marginBottom: 6 }}>
              {component.connectors.map(c => {
                const isActive = activeConnector === c.connector_label || (!activeConnector && c === component.connectors[0]);
                return (
                  <button
                    key={c.connector_label}
                    onClick={() => onConnectorSelect?.(c.connector_label)}
                    style={{
                      fontSize: '8px', fontFamily: 'Arial', fontWeight: isActive ? 700 : 400,
                      padding: '3px 10px', border: '2px solid var(--border)',
                      borderBottom: isActive ? 'none' : undefined,
                      background: isActive ? 'var(--bg, #f5f5f5)' : 'var(--surface)',
                      cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}
                  >
                    {c.connector_label} ({c.pin_count || c.pins.length}P)
                  </button>
                );
              })}
            </div>
          )}

          {/* Active connector face view */}
          {component.connectors.map(c => {
            const isActive = activeConnector === c.connector_label || (!activeConnector && c === component.connectors[0]);
            if (!isActive) return null;
            return (
              <ConnectorFaceView
                key={c.connector_label}
                connector={c}
                wires={wires}
                ecuModel={ecuModel}
                onPinClick={onPinClick}
              />
            );
          })}
        </div>
      )}

      {/* Links */}
      {(component.manufacturer_url || component.datasheet_url) && (
        <div style={{ marginTop: 8 }}>
          <div style={sectionTitle}>DOCUMENTS</div>
          {component.manufacturer_url && (
            <div style={row}>
              <span style={label}>PRODUCT PAGE</span>
              <span style={{ ...val, fontSize: '8px', wordBreak: 'break-all' }}>
                {component.manufacturer_url}
              </span>
            </div>
          )}
          {component.datasheet_url && (
            <div style={row}>
              <span style={label}>DATASHEET</span>
              <span style={{ ...val, fontSize: '8px', wordBreak: 'break-all' }}>
                {component.datasheet_url}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {component.notes && (
        <div style={{ marginTop: 8 }}>
          <div style={sectionTitle}>NOTES</div>
          <div style={{ fontSize: '9px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            {component.notes}
          </div>
        </div>
      )}
    </div>
  );
}
