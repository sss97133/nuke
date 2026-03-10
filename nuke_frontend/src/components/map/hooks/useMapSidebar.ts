import { useState, useCallback } from 'react';
import type { SidebarState } from '../types';

export function useMapSidebar() {
  const [stack, setStack] = useState<SidebarState[]>([]);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  const push = useCallback((state: SidebarState) => {
    setStack(prev => [...prev, state]);
  }, []);

  const pop = useCallback(() => {
    setStack(prev => prev.length > 1 ? prev.slice(0, -1) : []);
  }, []);

  const close = useCallback(() => {
    setStack([]);
  }, []);

  const openEventPin = useCallback((props: Record<string, unknown>) => {
    setStack([{ type: 'event-pin', data: props }]);
  }, []);

  const openVehicleDetail = useCallback((vehicleId: string) => {
    push({ type: 'vehicle-detail', data: { vehicleId } });
  }, [push]);

  const openOrgDetail = useCallback((orgId: string) => {
    setStack([{ type: 'org-detail', data: { orgId } }]);
  }, []);

  return { current, push, pop, close, openEventPin, openVehicleDetail, openOrgDetail };
}
