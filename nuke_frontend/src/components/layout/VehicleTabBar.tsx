import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppLayoutContext } from './AppLayoutContext';

export const VehicleTabBar: React.FC = () => {
  const { vehicleTabs, activeVehicleId, closeVehicleTab, setActiveVehicleTab } = useAppLayoutContext();
  const navigate = useNavigate();

  if (vehicleTabs.length === 0) return null;

  return (
    <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
      <div className="content-container">
        <div style={{ display: 'flex', gap: '2px', padding: '4px 0', overflowX: 'auto', alignItems: 'center' }}>
          {vehicleTabs.map((t) => {
            const isActive = !!activeVehicleId && t.vehicleId === activeVehicleId;
            return (
              <div
                key={t.vehicleId}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  border: '1px solid var(--border)',
                  background: isActive ? 'var(--grey-600)' : 'var(--white)',
                  color: isActive ? 'var(--white)' : 'var(--text)',
                  height: '24px',
                  maxWidth: '240px',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveVehicleTab(t.vehicleId);
                    navigate(`/vehicle/${t.vehicleId}`);
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontSize: '8pt',
                    padding: '0 8px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '210px',
                    textAlign: 'left',
                  }}
                  title={t.title}
                >
                  {t.title}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const wasActive = t.vehicleId === activeVehicleId;
                    const nextId = wasActive ? (vehicleTabs.find((x) => x.vehicleId !== t.vehicleId)?.vehicleId || '') : '';
                    closeVehicleTab(t.vehicleId);
                    if (wasActive) {
                      if (nextId) {
                        setActiveVehicleTab(nextId);
                        navigate(`/vehicle/${nextId}`);
                      } else {
                        setActiveVehicleTab(undefined);
                        navigate('/');
                      }
                    }
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontSize: '9pt',
                    padding: '0 6px',
                    height: '100%',
                  }}
                  aria-label="Close tab"
                  title="Close"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
