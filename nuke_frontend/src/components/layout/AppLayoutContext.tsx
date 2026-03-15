import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode, ReactElement } from 'react';

export type VehicleTab = {
  vehicleId: string;
  title: string;
};

interface AppLayoutContextValue {
  isInsideAppLayout: boolean;
  vehicleTabs: VehicleTab[];
  activeVehicleId?: string;
  openVehicleTab: (tab: VehicleTab) => void;
  closeVehicleTab: (vehicleId: string) => void;
  setActiveVehicleTab: (vehicleId?: string) => void;
  /** Contextual toolbar rendered inside the header-wrapper (sticky, auto-measured). */
  toolbarSlot: ReactElement | null;
  setToolbarSlot: (content: ReactElement | null) => void;
  /** Stack of recently closed tabs (for reopen-last-closed) */
  reopenLastClosedTab: () => VehicleTab | undefined;
}

const AppLayoutContext = createContext<AppLayoutContextValue>({
  isInsideAppLayout: false,
  vehicleTabs: [],
  activeVehicleId: undefined,
  openVehicleTab: () => undefined,
  closeVehicleTab: () => undefined,
  setActiveVehicleTab: () => undefined,
  toolbarSlot: null,
  setToolbarSlot: () => {},
  reopenLastClosedTab: () => undefined,
});

export const AppLayoutProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [vehicleTabs, setVehicleTabs] = useState<VehicleTab[]>([]);
  const [activeVehicleId, setActiveVehicleId] = useState<string | undefined>(undefined);
  const [toolbarSlot, setToolbarSlot] = useState<ReactElement | null>(null);
  const closedTabStackRef = useRef<VehicleTab[]>([]);

  const openVehicleTab = useCallback((tab: VehicleTab) => {
    const vid = String(tab.vehicleId || '').trim();
    if (!vid) return;
    const incomingTitle = String(tab.title || '').trim();

    setVehicleTabs((prev) => {
      const existingTitle = prev.find((t) => t.vehicleId === vid)?.title;
      const title = incomingTitle || String(existingTitle || '').trim() || 'Vehicle';
      const next = prev.filter((t) => t.vehicleId !== vid);
      next.unshift({ vehicleId: vid, title });
      return next.slice(0, 10);
    });
    setActiveVehicleId(vid);
  }, []);

  const closeVehicleTab = useCallback((vehicleId: string) => {
    const vid = String(vehicleId || '').trim();
    if (!vid) return;

    setVehicleTabs((prev) => {
      const closing = prev.find((t) => t.vehicleId === vid);
      if (closing) {
        closedTabStackRef.current = [closing, ...closedTabStackRef.current].slice(0, 20);
      }
      return prev.filter((t) => t.vehicleId !== vid);
    });
    setActiveVehicleId((prevActive) => (prevActive === vid ? undefined : prevActive));
  }, []);

  const setActiveVehicleTab = useCallback((vehicleId?: string) => {
    const vid = vehicleId ? String(vehicleId).trim() : undefined;
    setActiveVehicleId(vid || undefined);
  }, []);

  const reopenLastClosedTab = useCallback(() => {
    const tab = closedTabStackRef.current.shift();
    if (tab) {
      openVehicleTab(tab);
    }
    return tab;
  }, [openVehicleTab]);

  const value = useMemo<AppLayoutContextValue>(() => {
    return {
      isInsideAppLayout: true,
      vehicleTabs,
      activeVehicleId,
      openVehicleTab,
      closeVehicleTab,
      setActiveVehicleTab,
      toolbarSlot,
      setToolbarSlot,
      reopenLastClosedTab,
    };
  }, [vehicleTabs, activeVehicleId, openVehicleTab, closeVehicleTab, setActiveVehicleTab, toolbarSlot, reopenLastClosedTab]);

  return (
    <AppLayoutContext.Provider value={value}>
      {children}
    </AppLayoutContext.Provider>
  );
};

export const useAppLayoutContext = () => useContext(AppLayoutContext);

/**
 * Hook to check if we're already inside an AppLayout
 * Returns true if already wrapped, false otherwise
 * 
 * CRITICAL: If already wrapped, this prevents duplicate headers/footers in production
 */
export const usePreventDoubleLayout = () => {
  const { isInsideAppLayout } = useAppLayoutContext();
  
  if (isInsideAppLayout) {
    // Only log in development - in production, silently prevent duplicates
    if (import.meta.env.DEV) {
      const errorMsg = 
        '🚨 DOUBLE APPLAYOUT DETECTED!\n\n' +
        'AppLayout is already provided at the route level in App.tsx.\n' +
        'Pages should NOT wrap themselves in AppLayout.\n\n' +
        'Fix: Remove the AppLayout wrapper from your page component.\n' +
        'Just return your content directly.\n\n' +
        'Example:\n' +
        '  // ❌ WRONG:\n' +
        '  return <AppLayout><div>Content</div></AppLayout>;\n\n' +
        '  // ✅ CORRECT:\n' +
        '  return <div>Content</div>;';
      
      console.error('⚠️', errorMsg);
    }
    // Return true so AppLayoutInner can return null and prevent duplicate rendering
  }
  
  return isInsideAppLayout;
};

