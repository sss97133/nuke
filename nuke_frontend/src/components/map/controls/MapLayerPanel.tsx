import React from 'react';
import type { MapMode } from '../types';
import { MAP_FONT, DEFAULT_MIN_CONFIDENCE, APPROX_MIN_CONFIDENCE } from '../constants';

interface Props {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  showBusinesses: boolean;
  onToggleBusinesses: () => void;
  showCollections: boolean;
  onToggleCollections: () => void;
  showApproximate: boolean;
  onToggleApproximate: () => void;
  totalEvents: number;
}

export default function MapLayerPanel({
  mode, onModeChange,
  showBusinesses, onToggleBusinesses,
  showCollections, onToggleCollections,
  showApproximate, onToggleApproximate,
  totalEvents,
}: Props) {
  return (
    <div style={{
      background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)',
      padding: '10px 12px', fontFamily: MAP_FONT, minWidth: 160,
    }}>
      {/* Count */}
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {totalEvents.toLocaleString()} EVENTS
      </div>

      {/* Mode toggle */}
      <div style={{ marginBottom: 8 }}>
        <div style={labelStyle}>MODE</div>
        <div style={{ display: 'flex', gap: 2 }}>
          <ModeButton label="POINTS" active={mode === 'points'} onClick={() => onModeChange('points')} />
          <ModeButton label="THERMAL" active={mode === 'thermal'} onClick={() => onModeChange('thermal')} />
          <ModeButton label="COUNTY" active={mode === 'county'} onClick={() => onModeChange('county')} />
        </div>
      </div>

      {/* Toggles */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Toggle label="BUSINESSES" checked={showBusinesses} onChange={onToggleBusinesses} />
        <Toggle label="COLLECTIONS" checked={showCollections} onChange={onToggleCollections} />
        <Toggle label="SHOW APPROX" checked={showApproximate} onChange={onToggleApproximate} />
      </div>
    </div>
  );
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '4px 0', fontSize: 8, fontWeight: 700, fontFamily: MAP_FONT,
      background: active ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
      border: `1px solid ${active ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255,255,255,0.15)'}`,
      color: active ? 'rgba(245, 158, 11, 1)' : 'rgba(255,255,255,0.5)',
      cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>
      {label}
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 8, color: 'rgba(255,255,255,0.6)' }}>
      <div style={{
        width: 8, height: 8, border: '1px solid rgba(255,255,255,0.3)',
        background: checked ? 'rgba(245, 158, 11, 0.8)' : 'transparent',
        transition: 'background 120ms ease',
      }} onClick={onChange} />
      <span style={{ letterSpacing: '0.3px' }}>{label}</span>
    </label>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 7, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: 4,
};
