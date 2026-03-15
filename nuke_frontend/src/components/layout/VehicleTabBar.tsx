import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppLayoutContext } from './AppLayoutContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import './VehicleTabBar.css';

export const VehicleTabBar: React.FC = () => {
  const { vehicleTabs, activeVehicleId, closeVehicleTab, setActiveVehicleTab } = useAppLayoutContext();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const handleClose = useCallback((vehicleId: string) => {
    const wasActive = vehicleId === activeVehicleId;
    const nextId = wasActive
      ? (vehicleTabs.find((x) => x.vehicleId !== vehicleId)?.vehicleId || '')
      : '';
    closeVehicleTab(vehicleId);
    if (wasActive) {
      if (nextId) {
        setActiveVehicleTab(nextId);
        navigate(`/vehicle/${nextId}`);
      } else {
        setActiveVehicleTab(undefined);
        navigate('/');
      }
    }
  }, [activeVehicleId, vehicleTabs, closeVehicleTab, setActiveVehicleTab, navigate]);

  // Keyboard: Cmd+W closes active tab, [ and ] switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd+W / Ctrl+W — close active tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w' && activeVehicleId && vehicleTabs.length > 0) {
        e.preventDefault();
        handleClose(activeVehicleId);
        return;
      }

      // [ and ] — switch tabs (only when not in an input)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (vehicleTabs.length < 2 || !activeVehicleId) return;

      const currentIdx = vehicleTabs.findIndex((t) => t.vehicleId === activeVehicleId);
      if (currentIdx < 0) return;

      let nextIdx = -1;
      if (e.key === '[') nextIdx = (currentIdx - 1 + vehicleTabs.length) % vehicleTabs.length;
      if (e.key === ']') nextIdx = (currentIdx + 1) % vehicleTabs.length;

      if (nextIdx >= 0) {
        const tab = vehicleTabs[nextIdx];
        setActiveVehicleTab(tab.vehicleId);
        navigate(`/vehicle/${tab.vehicleId}`);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeVehicleId, vehicleTabs, handleClose, setActiveVehicleTab, navigate]);

  // On mobile, hide when only one tab
  if (isMobile && vehicleTabs.length <= 1) return null;
  // Always show the home tab; hide vehicle tabs if empty
  const showBar = vehicleTabs.length > 0;
  if (!showBar) return null;

  return (
    <div className="vehicle-tab-bar">
      {/* Home tab — always first, links to feed */}
      <div
        className={`vehicle-tab home-tab${!activeVehicleId ? ' active' : ''}`}
        onClick={() => {
          setActiveVehicleTab(undefined);
          navigate('/');
        }}
      >
        <span className="tab-title" title="Feed">&#9638;</span>
      </div>

      {/* Vehicle tabs */}
      {vehicleTabs.map((t) => {
        const isActive = !!activeVehicleId && t.vehicleId === activeVehicleId;
        return (
          <div
            key={t.vehicleId}
            className={`vehicle-tab${isActive ? ' active' : ''}`}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                handleClose(t.vehicleId);
              }
            }}
          >
            <button
              type="button"
              className="tab-title"
              onClick={() => {
                setActiveVehicleTab(t.vehicleId);
                navigate(`/vehicle/${t.vehicleId}`);
              }}
              title={t.title}
            >
              {t.title}
            </button>
            <button
              type="button"
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                handleClose(t.vehicleId);
              }}
              aria-label="Close tab"
              title="Close"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
};
