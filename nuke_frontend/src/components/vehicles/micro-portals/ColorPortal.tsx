import React from 'react';
import MicroPortal from './MicroPortal';
import PortalShell from './PortalShell';
import { usePaintCode } from '../../../hooks/usePaintCode';

interface ColorPortalProps {
  make?: string;
  color?: string;
  year?: number;
  activePortal: string | null;
  onOpen: (id: string | null) => void;
}

export default function ColorPortal({ make, color, year, activePortal, onOpen }: ColorPortalProps) {
  const isOpen = activePortal === 'color';
  const { data, state, isLoading, error } = usePaintCode(make, color, year, isOpen);

  const trigger = (
    <span>{color?.slice(0, 8) || '\u2014'}</span>
  );

  return (
    <MicroPortal
      portalId="color"
      activePortal={activePortal}
      onOpen={onOpen}
      trigger={trigger}
      width={240}
      disabled={!color}
    >
      <PortalShell
        title="Color Details"
        isLoading={isLoading}
        error={error}
        state={!color ? 'empty' : state}
        emptyContent={
          <div style={{ padding: '8px 0' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
              What color is this?
            </div>
            <div style={{
              padding: '6px 8px',
              border: '1px dashed var(--border)',
              borderRadius: '4px',
              fontSize: '8pt',
              color: 'var(--primary, #3b82f6)',
              cursor: 'pointer',
              textAlign: 'center',
            }}>
              + Add color
            </div>
          </div>
        }
        sparseContent={data && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              {/* Color swatch */}
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: data.hex_color || '#d1d5db',
                border: '2px solid var(--border)',
                flexShrink: 0,
              }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '9pt' }}>{data.name || color}</div>
                {data.type && (
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {data.type}
                  </div>
                )}
              </div>
            </div>
            {!data.code && (
              <div style={{ fontSize: '7pt', color: 'var(--primary, #3b82f6)', cursor: 'pointer' }}>
                Know the paint code?
              </div>
            )}
          </div>
        )}
        richContent={data && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: data.hex_color || '#d1d5db',
                border: '2px solid var(--border)',
                flexShrink: 0,
              }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '9pt' }}>{data.name || color}</div>
                {data.type && (
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {data.type}
                  </div>
                )}
              </div>
            </div>
            <div style={{ fontSize: '8pt' }}>
              {data.code && (
                <InfoRow label="Paint Code" value={data.code} />
              )}
              {data.hex_color && (
                <InfoRow label="Hex" value={data.hex_color} />
              )}
              {data.color_family && (
                <InfoRow label="Family" value={data.color_family} />
              )}
              {data.year_start && data.year_end && (
                <InfoRow label="Production" value={`${data.year_start}\u2013${data.year_end}`} />
              )}
            </div>
          </div>
        )}
      />
    </MicroPortal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{value}</span>
    </div>
  );
}
