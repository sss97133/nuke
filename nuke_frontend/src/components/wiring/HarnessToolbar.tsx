// HarnessToolbar.tsx — Top toolbar for the harness builder

import React from 'react';
import type { CanvasMode, HarnessState } from './harnessTypes';

interface Props {
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
  onAddEndpoint: () => void;
  onDelete: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onToggleCompleteness?: () => void;
  showCompleteness?: boolean;
  selection: HarnessState['selection'];
  endpointCount: number;
  connectionCount: number;
}

export function HarnessToolbar({
  mode, onModeChange, onAddEndpoint, onDelete,
  onZoomIn, onZoomOut, onZoomFit,
  onToggleCompleteness, showCompleteness,
  selection, endpointCount, connectionCount,
}: Props) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 6px',
      borderBottom: '2px solid var(--border)',
      background: 'var(--surface)',
      flexWrap: 'wrap',
    }}>
      {/* Mode buttons */}
      <div style={{ display: 'flex', gap: '2px' }}>
        <button
          className="button-win95"
          onClick={() => onModeChange('select')}
          style={{
            fontWeight: mode === 'select' ? 700 : 400,
            background: mode === 'select' ? 'var(--surface-hover)' : undefined,
          }}
          title="Select / Move (V)"
        >
          SELECT
        </button>
        <button
          className="button-win95"
          onClick={() => onModeChange('draw_wire')}
          style={{
            fontWeight: mode === 'draw_wire' ? 700 : 400,
            background: mode === 'draw_wire' ? 'var(--surface-hover)' : undefined,
          }}
          title="Draw Wire — click port to port (W)"
        >
          WIRE
        </button>
      </div>

      <div style={{ width: 1, height: 18, background: 'var(--border)' }} />

      {/* Actions */}
      <button className="button-win95" onClick={onAddEndpoint} title="Add new endpoint to canvas">
        + ENDPOINT
      </button>
      <button
        className="button-win95"
        onClick={onDelete}
        disabled={!selection.id}
        style={{ opacity: selection.id ? 1 : 0.4 }}
        title="Delete selected"
      >
        DELETE
      </button>

      <div style={{ width: 1, height: 18, background: 'var(--border)' }} />

      {/* Zoom */}
      <button className="button-win95" onClick={onZoomIn} title="Zoom in">+</button>
      <button className="button-win95" onClick={onZoomOut} title="Zoom out">−</button>
      <button className="button-win95" onClick={onZoomFit} title="Fit all">FIT</button>

      {onToggleCompleteness && (
        <>
          <div style={{ width: 1, height: 18, background: 'var(--border)' }} />
          <button
            className="button-win95"
            onClick={onToggleCompleteness}
            style={{
              fontWeight: showCompleteness ? 700 : 400,
              background: showCompleteness ? 'var(--surface-hover)' : undefined,
            }}
            title="Check harness completeness"
          >
            CHECK
          </button>
        </>
      )}

      {onToggleCompleteness && (
        <>
          <div style={{ width: 1, height: 18, background: 'var(--border)' }} />
          <button
            className="button-win95"
            onClick={onToggleCompleteness}
            style={{
              fontWeight: showCompleteness ? 700 : 400,
              background: showCompleteness ? 'var(--surface-hover)' : undefined,
            }}
            title="Check completeness"
          >
            CHECK
          </button>
        </>
      )}

      {/* Stats */}
      <div style={{ marginLeft: 'auto', fontSize: '8px', color: 'var(--text-muted)', fontFamily: '"Courier New", monospace' }}>
        {endpointCount} ENDPOINTS &middot; {connectionCount} WIRES
      </div>
    </div>
  );
}
