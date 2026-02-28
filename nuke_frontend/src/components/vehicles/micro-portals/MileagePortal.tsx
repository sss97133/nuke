import React from 'react';
import MicroPortal from './MicroPortal';
import PortalShell from './PortalShell';
import { useMileageHistory } from '../../../hooks/useMileageHistory';

interface MileagePortalProps {
  vehicleId: string;
  mileage?: number;
  year?: number;
  activePortal: string | null;
  onOpen: (id: string | null) => void;
}

export default function MileagePortal({ vehicleId, mileage, year, activePortal, onOpen }: MileagePortalProps) {
  const isOpen = activePortal === 'mileage';
  const { data, state, isLoading, error } = useMileageHistory(vehicleId, isOpen);

  // Calculate miles/year if we have year and mileage
  const currentYear = new Date().getFullYear();
  const vehicleAge = year ? currentYear - year : null;
  const milesPerYear = mileage && vehicleAge && vehicleAge > 0 ? Math.round(mileage / vehicleAge) : null;
  const mileageLevel = milesPerYear != null
    ? milesPerYear < 5000 ? 'Low' : milesPerYear < 12000 ? 'Average' : 'High'
    : null;

  const trigger = (
    <span>{mileage ? mileage.toLocaleString() : '\u2014'}</span>
  );

  return (
    <MicroPortal
      portalId="mileage"
      activePortal={activePortal}
      onOpen={onOpen}
      trigger={trigger}
      width={260}
      disabled={!mileage && (!data || data.length === 0)}
    >
      <PortalShell
        title="Mileage History"
        isLoading={isLoading}
        error={error}
        state={!mileage && state === 'empty' ? 'empty' : state}
        emptyContent={
          <div style={{ padding: '8px 0' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              No mileage history. Snap your odometer to start tracking.
            </div>
            <div style={{
              padding: '6px 8px',
              border: '1px dashed var(--border)',
              borderRadius: '4px',
              fontSize: '11px',
              color: 'var(--primary, #3b82f6)',
              cursor: 'pointer',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}>
              <span style={{ fontSize: '16px' }}>&#128247;</span> Add odometer reading
            </div>
          </div>
        }
        sparseContent={
          <div>
            {mileage && (
              <div style={{
                fontSize: '21px',
                fontWeight: 700,
                fontFamily: 'ui-monospace, "SF Mono", monospace',
                letterSpacing: '1px',
                marginBottom: '6px',
              }}>
                {mileage.toLocaleString()}
                <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '4px' }}>mi</span>
              </div>
            )}
            {milesPerYear != null && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                ~{milesPerYear.toLocaleString()} mi/year
                {mileageLevel && (
                  <span style={{
                    marginLeft: '6px',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    fontSize: '9px',
                    fontWeight: 600,
                    background: mileageLevel === 'Low' ? 'color-mix(in srgb, var(--success) 12%, transparent)' : mileageLevel === 'Average' ? 'color-mix(in srgb, var(--warning) 12%, transparent)' : 'color-mix(in srgb, var(--error) 12%, transparent)',
                    color: mileageLevel === 'Low' ? 'var(--success)' : mileageLevel === 'Average' ? 'var(--warning)' : 'var(--error)',
                  }}>
                    {mileageLevel}
                  </span>
                )}
              </div>
            )}
            {data && data.length > 0 && (
              <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                {data.length} reading{data.length !== 1 ? 's' : ''} tracked
              </div>
            )}
          </div>
        }
        richContent={data && (
          <div>
            {/* Simple text-based accumulation display */}
            <div style={{ marginBottom: '8px' }}>
              {data.map((pt, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '2px 0', borderBottom: '1px solid var(--border)',
                  fontSize: '11px',
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {new Date(pt.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                  </span>
                  <span style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>
                    {pt.mileage.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            {milesPerYear != null && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Accumulation rate: ~{milesPerYear.toLocaleString()} mi/year
                {mileageLevel && (
                  <span style={{
                    marginLeft: '6px',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    fontSize: '9px',
                    fontWeight: 600,
                    background: mileageLevel === 'Low' ? 'color-mix(in srgb, var(--success) 12%, transparent)' : mileageLevel === 'Average' ? 'color-mix(in srgb, var(--warning) 12%, transparent)' : 'color-mix(in srgb, var(--error) 12%, transparent)',
                    color: mileageLevel === 'Low' ? 'var(--success)' : mileageLevel === 'Average' ? 'var(--warning)' : 'var(--error)',
                  }}>
                    {mileageLevel}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      />
    </MicroPortal>
  );
}
