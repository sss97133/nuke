// WiringDetailPanel.tsx — Right-side flyout showing full-resolution device data
// Opens on device click. Shows every field for the selected device.

import React, { useState } from 'react';
import type { ManifestDevice, WireSpec, PDMChannel } from './overlayCompute';
import type { TerminationRecord, WireEndpointBOM } from './terminationCompute';

interface Props {
  device: ManifestDevice;
  wire?: WireSpec;
  pdmChannel?: PDMChannel;
  ecuModel: string;
  termination?: TerminationRecord;
  onClose: () => void;
  onSavePosition: () => void;
  onUrlSwap?: (url: string) => void;
  positionDirty: boolean;
}

// Shared label style
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
const section: React.CSSProperties = {
  marginBottom: 12,
};
const sectionTitle: React.CSSProperties = {
  ...label, fontSize: '7px', letterSpacing: '1px', marginBottom: 4,
  paddingBottom: 3, borderBottom: '2px solid var(--text, #2a2a2a)',
};

// URL Swap field — paste URL to update part data
function UrlSwapField({ onUrlSwap }: { onUrlSwap: (url: string) => void }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleSubmit = () => {
    if (!url.trim()) return;
    setStatus('loading');
    try {
      onUrlSwap(url.trim());
      setStatus('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: '7px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4,
        paddingBottom: 3, borderBottom: '2px solid var(--text, #2a2a2a)',
        color: 'var(--text-secondary, #666)', fontWeight: 700,
      }}>PASTE PRODUCT URL</div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="https://prowireusa.com/..."
          style={{
            flex: 1, fontSize: '9px', fontFamily: '"Courier New", monospace',
            padding: '4px 6px', border: '2px solid var(--border, #bdbdbd)',
            background: 'var(--bg, #f5f5f5)', outline: 'none',
          }}
        />
        <button
          onClick={handleSubmit}
          style={{
            fontSize: '8px', fontFamily: 'Arial', fontWeight: 700,
            padding: '4px 8px', border: '2px solid var(--text, #2a2a2a)',
            background: status === 'success' ? 'var(--success, #16825d)' : status === 'error' ? 'var(--error, #d13438)' : 'var(--text, #2a2a2a)',
            color: 'var(--bg, #f5f5f5)', cursor: 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}
        >
          {status === 'loading' ? '...' : status === 'success' ? 'OK' : status === 'error' ? 'ERR' : 'LINK'}
        </button>
      </div>
    </div>
  );
}

// Termination endpoint display helper
function EndpointBOM({ ep, side }: { ep: WireEndpointBOM; side: string }) {
  const t = ep.termination;
  const hasMissing = ep.missingParts.length > 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: '7px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary, #666)', fontWeight: 700 }}>
          {side} — {ep.deviceName}
        </span>
        <span style={{
          fontSize: '7px', fontWeight: 700, fontFamily: '"Courier New", monospace',
          color: hasMissing ? 'var(--error, #d13438)' : 'var(--success, #16825d)',
        }}>
          {hasMissing ? 'INCOMPLETE' : 'READY'}
        </span>
      </div>
      {[
        { label: 'HOUSING', value: t.housing },
        { label: 'CONTACT M', value: t.contactMale },
        { label: 'CONTACT F', value: t.contactFemale },
        { label: 'PIN SEAL', value: t.pinSeal || '—' },
        { label: 'WEDGE LOCK', value: t.wedgeLock || '—' },
        { label: 'BOOT', value: t.boot || '—' },
        { label: 'CRIMP TOOL', value: t.crimpTool },
      ].map(({ label: lb, value }) => (
        <div key={lb} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '2px 0', borderBottom: '1px solid var(--border, #bdbdbd)',
        }}>
          <span style={{ fontSize: '7px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-secondary, #666)', fontWeight: 700 }}>{lb}</span>
          <span style={{
            fontSize: '9px', fontFamily: '"Courier New", monospace', fontWeight: 700,
            color: value === 'UNKNOWN' ? 'var(--error, #d13438)' : 'var(--text, #2a2a2a)',
          }}>{value}</span>
        </div>
      ))}
      {hasMissing && (
        <div style={{ marginTop: 3, fontSize: '7px', color: 'var(--error, #d13438)', fontWeight: 700, textTransform: 'uppercase' }}>
          MISSING: {ep.missingParts.join(', ')}
        </div>
      )}
    </div>
  );
}

export function WiringDetailPanel({
  device, wire, pdmChannel, ecuModel, termination, onClose, onSavePosition, onUrlSwap, positionDirty,
}: Props) {
  // Compute completeness
  const fields = [
    'manufacturer', 'model_number', 'part_number', 'pin_count',
    'power_draw_amps', 'signal_type', 'connector_type', 'wire_gauge_recommended',
    'location_zone', 'price',
  ] as const;
  const filled = fields.filter(f => device[f] != null && device[f] !== '' && device[f] !== 0).length;
  const completeness = Math.round((filled / fields.length) * 100);

  return (
    <div
      onWheel={(e) => e.stopPropagation()}
      style={{
        width: 380,
        minWidth: 380,
        height: '100%',
        background: 'var(--bg, #f5f5f5)',
        borderLeft: '2px solid var(--text, #2a2a2a)',
        overflowY: 'auto',
        overflowX: 'hidden',
        fontFamily: 'Arial, sans-serif',
        color: 'var(--text, #2a2a2a)',
      }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '2px solid var(--text, #2a2a2a)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <div style={{
            fontSize: '11px', fontWeight: 700, lineHeight: 1.2, marginBottom: 2,
          }}>
            {device.device_name}
          </div>
          <div style={{
            fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
            color: 'var(--text-secondary, #666)',
          }}>
            {device.device_category} {device.manufacturer ? `/ ${device.manufacturer}` : ''}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24, height: 24, border: '2px solid var(--border, #bdbdbd)',
            background: 'transparent', cursor: 'pointer', fontSize: '12px',
            fontWeight: 700, lineHeight: '20px', textAlign: 'center',
            color: 'var(--text-secondary, #666)',
          }}
        >
          ×
        </button>
      </div>

      {/* Product Image */}
      {device.product_image_url && (
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border, #bdbdbd)',
          display: 'flex', justifyContent: 'center',
          background: '#fff',
        }}>
          <img
            src={device.product_image_url}
            alt={device.device_name}
            style={{
              maxWidth: '100%',
              maxHeight: 180,
              objectFit: 'contain',
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      <div style={{ padding: '10px 14px' }}>
        {/* Completeness indicator */}
        <div style={section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={label}>DATA COMPLETENESS</span>
            <span style={{ ...val, fontSize: '9px', color: completeness >= 80 ? 'var(--success, #16825d)' : completeness >= 50 ? 'var(--warning, #b05a00)' : 'var(--error, #d13438)' }}>
              {completeness}%
            </span>
          </div>
          <div style={{ height: 3, background: 'var(--border, #bdbdbd)' }}>
            <div style={{
              height: 3, width: `${completeness}%`,
              background: completeness >= 80 ? 'var(--success, #16825d)' : completeness >= 50 ? 'var(--warning, #b05a00)' : 'var(--error, #d13438)',
              transition: 'width 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }} />
          </div>
        </div>

        {/* Identification */}
        <div style={section}>
          <div style={sectionTitle}>IDENTIFICATION</div>
          <div style={row}>
            <span style={label}>CATEGORY</span>
            <span style={val}>{device.device_category}</span>
          </div>
          {device.manufacturer && (
            <div style={row}>
              <span style={label}>MANUFACTURER</span>
              <span style={val}>{device.manufacturer}</span>
            </div>
          )}
          {device.model_number && (
            <div style={row}>
              <span style={label}>MODEL</span>
              <span style={val}>{device.model_number}</span>
            </div>
          )}
          {device.part_number && (
            <div style={row}>
              <span style={label}>PART NUMBER</span>
              <span style={val}>{device.part_number}</span>
            </div>
          )}
        </div>

        {/* Electrical Specs */}
        <div style={section}>
          <div style={sectionTitle}>ELECTRICAL SPECS</div>
          <div style={row}>
            <span style={label}>PIN COUNT</span>
            <span style={val}>{device.pin_count || '—'}</span>
          </div>
          <div style={row}>
            <span style={label}>POWER DRAW</span>
            <span style={val}>{device.power_draw_amps != null ? `${device.power_draw_amps}A` : '—'}</span>
          </div>
          <div style={row}>
            <span style={label}>SIGNAL TYPE</span>
            <span style={val}>{device.signal_type || '—'}</span>
          </div>
          <div style={row}>
            <span style={label}>CONNECTOR</span>
            <span style={val}>{device.connector_type || '—'}</span>
          </div>
          <div style={row}>
            <span style={label}>WIRE GAUGE</span>
            <span style={val}>{device.wire_gauge_recommended ? `${device.wire_gauge_recommended} AWG` : '—'}</span>
          </div>
          <div style={row}>
            <span style={label}>SHIELDING</span>
            <span style={val}>{device.requires_shielding ? 'YES' : 'NO'}</span>
          </div>
          <div style={row}>
            <span style={label}>PDM CONTROLLED</span>
            <span style={val}>{device.pdm_controlled !== false ? 'YES' : 'NO'}</span>
          </div>
        </div>

        {/* Wire Info (from computed wires) */}
        {wire && (
          <div style={section}>
            <div style={sectionTitle}>WIRE</div>
            <div style={row}>
              <span style={label}>COLOR</span>
              <span style={val}>{wire.color}</span>
            </div>
            <div style={row}>
              <span style={label}>GAUGE</span>
              <span style={val}>{wire.gauge} AWG</span>
            </div>
            <div style={row}>
              <span style={label}>LENGTH</span>
              <span style={val}>{wire.lengthFt.toFixed(1)} ft</span>
            </div>
            <div style={row}>
              <span style={label}>FROM</span>
              <span style={val}>{wire.from}</span>
            </div>
            <div style={row}>
              <span style={label}>TO</span>
              <span style={val}>{wire.to}</span>
            </div>
            <div style={row}>
              <span style={label}>VOLTAGE DROP</span>
              <span style={{
                ...val,
                color: wire.voltageDropPct > 3 ? 'var(--error, #d13438)' : wire.voltageDropPct > 2 ? 'var(--warning, #b05a00)' : undefined,
              }}>
                {wire.voltageDrop.toFixed(3)}V ({wire.voltageDropPct.toFixed(1)}%)
              </span>
            </div>
            {wire.isShielded && (
              <div style={row}>
                <span style={label}>SHIELDED</span>
                <span style={val}>YES</span>
              </div>
            )}
            {wire.isTwistedPair && (
              <div style={row}>
                <span style={label}>TWISTED PAIR</span>
                <span style={val}>YES</span>
              </div>
            )}
            {wire.fuseRating && (
              <div style={row}>
                <span style={label}>FUSE</span>
                <span style={val}>{wire.fuseRating}A</span>
              </div>
            )}
          </div>
        )}

        {/* PDM/ECU Connection */}
        {pdmChannel && (
          <div style={section}>
            <div style={sectionTitle}>PDM CONNECTION</div>
            <div style={row}>
              <span style={label}>PDM CHANNEL</span>
              <span style={val}>OUT{pdmChannel.channel}</span>
            </div>
            <div style={row}>
              <span style={label}>MAX RATING</span>
              <span style={val}>{pdmChannel.maxAmps}A</span>
            </div>
            <div style={row}>
              <span style={label}>TOTAL LOAD</span>
              <span style={{
                ...val,
                color: pdmChannel.totalAmps > pdmChannel.maxAmps ? 'var(--error, #d13438)' : undefined,
              }}>
                {pdmChannel.totalAmps.toFixed(1)}A
              </span>
            </div>
          </div>
        )}

        {!pdmChannel && wire && (
          <div style={section}>
            <div style={sectionTitle}>ECU CONNECTION</div>
            <div style={row}>
              <span style={label}>ECU MODEL</span>
              <span style={val}>{ecuModel}</span>
            </div>
            <div style={row}>
              <span style={label}>CONNECTION</span>
              <span style={val}>{wire.from}</span>
            </div>
          </div>
        )}

        {/* Position */}
        <div style={section}>
          <div style={sectionTitle}>POSITION</div>
          <div style={row}>
            <span style={label}>ZONE</span>
            <span style={val}>{device.location_zone?.replace(/_/g, ' ') || '—'}</span>
          </div>
          <div style={row}>
            <span style={label}>X</span>
            <span style={val}>{(device.pos_x_pct || 0).toFixed(1)}%</span>
          </div>
          <div style={row}>
            <span style={label}>Y</span>
            <span style={val}>{(device.pos_y_pct || 0).toFixed(1)}%</span>
          </div>
          {positionDirty && (
            <button
              onClick={onSavePosition}
              style={{
                width: '100%', marginTop: 6,
                fontSize: '9px', fontFamily: 'Arial', fontWeight: 700,
                padding: '6px', border: '2px solid var(--text, #2a2a2a)',
                background: 'var(--text, #2a2a2a)', color: 'var(--bg, #f5f5f5)',
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
              }}
            >
              SAVE POSITION
            </button>
          )}
        </div>

        {/* Cost */}
        <div style={section}>
          <div style={sectionTitle}>COST</div>
          <div style={row}>
            <span style={label}>PRICE</span>
            <span style={val}>{device.price ? `$${device.price.toLocaleString()}` : '—'}</span>
          </div>
          <div style={row}>
            <span style={label}>PURCHASED</span>
            <span style={{ ...val, color: device.purchased ? 'var(--success, #16825d)' : 'var(--text-secondary, #666)' }}>
              {device.purchased ? 'YES' : 'NO'}
            </span>
          </div>
          <div style={row}>
            <span style={label}>STATUS</span>
            <span style={val}>{device.status || '—'}</span>
          </div>
          <div style={row}>
            <span style={label}>COMPLETION</span>
            <span style={val}>{device.pct_complete != null ? `${device.pct_complete}%` : '—'}</span>
          </div>
        </div>

        {/* Termination BOM */}
        {termination && (
          <div style={section}>
            <div style={{
              ...sectionTitle,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>TERMINATION BOM</span>
              <span style={{
                fontSize: '7px', fontFamily: '"Courier New", monospace', fontWeight: 700,
                color: termination.readyToTerminate ? 'var(--success, #16825d)' : 'var(--error, #d13438)',
              }}>
                {termination.readyToTerminate ? 'READY' : `${termination.missingParts.length} MISSING`}
              </span>
            </div>

            <EndpointBOM ep={termination.sourceEndpoint} side="SOURCE" />
            <EndpointBOM ep={termination.deviceEndpoint} side="DEVICE" />

            {/* Heat shrink */}
            <div style={row}>
              <span style={label}>HEAT SHRINK</span>
              <span style={val}>{termination.heatShrink.pn} ({termination.heatShrink.size})</span>
            </div>

            {/* Label */}
            <div style={row}>
              <span style={label}>WIRE LABEL</span>
              <span style={{ ...val, fontSize: '8px' }}>{termination.sourceEndpoint.termination.label || '—'}</span>
            </div>
          </div>
        )}

        {/* URL Swap */}
        {onUrlSwap && (
          <UrlSwapField onUrlSwap={onUrlSwap} />
        )}
      </div>
    </div>
  );
}
