import React from 'react';
import MicroPortal from './MicroPortal';
import { getTransmissionDefinition } from '../../../services/powertrainDefinitionService';

/**
 * TransmissionPortal — click the transmission to see spec details.
 *
 * Adapter: wraps existing getTransmissionDefinition() content
 * in the MicroPortal frame. Minimal new code.
 */

interface TransmissionPortalProps {
  transmission?: string;
  activePortal: string | null;
  onOpen: (id: string | null) => void;
}

export default function TransmissionPortal({ transmission, activePortal, onOpen }: TransmissionPortalProps) {
  const definition = transmission ? getTransmissionDefinition(transmission) : null;

  const trigger = (
    <span>{transmission?.slice(0, 6) || '\u2014'}</span>
  );

  return (
    <MicroPortal
      portalId="transmission"
      activePortal={activePortal}
      onOpen={onOpen}
      trigger={trigger}
      width={260}
      disabled={!transmission}
    >
      <div style={{ padding: '10px 12px' }}>
        <div style={{
          fontSize: '7pt', fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px',
        }}>
          Transmission
        </div>

        {definition && definition.known ? (
          <div style={{ fontSize: '8pt' }}>
            <div style={{ fontWeight: 600, fontSize: '10pt', marginBottom: '4px' }}>
              {definition.title}
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span style={{
                padding: '1px 5px', borderRadius: '3px',
                background: 'var(--bg-secondary, #f3f4f6)',
                fontSize: '7pt', fontWeight: 500,
                textTransform: 'uppercase',
              }}>
                {definition.label}
              </span>
            </div>
            {definition.summary && (
              <div style={{ color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: '6px' }}>
                {definition.summary}
              </div>
            )}
            {definition.details && definition.details.length > 0 && (
              <ul style={{ margin: '0 0 6px', paddingLeft: '14px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {definition.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div style={{ fontSize: '8pt' }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>{transmission}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '7pt' }}>
              No detailed spec information available
            </div>
          </div>
        )}
      </div>
    </MicroPortal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '8pt' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
