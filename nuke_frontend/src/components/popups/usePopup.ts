/**
 * usePopup — Hook to open/close stacking popups from anywhere in the tree.
 *
 * Usage:
 *   const { openPopup, closePopup, closeAll } = usePopup();
 *   openPopup(<VehiclePopup vehicle={v} />, 'VEHICLE');
 */

import { useContext, useCallback } from 'react';
import type { ReactNode } from 'react';
import { PopupStackContext } from './PopupStack';

export function usePopup() {
  const ctx = useContext(PopupStackContext);
  if (!ctx) {
    throw new Error('usePopup must be used within a <PopupStackProvider>');
  }

  const openPopup = useCallback(
    (content: ReactNode, title: string, width?: number, searchable?: boolean) => {
      return ctx.push(content, title, width, searchable);
    },
    [ctx],
  );

  const closePopup = useCallback(
    (id: string) => {
      ctx.pop(id);
    },
    [ctx],
  );

  const closeTop = useCallback(() => {
    ctx.popTop();
  }, [ctx]);

  const closeAll = useCallback(() => {
    ctx.closeAll();
  }, [ctx]);

  return { openPopup, closePopup, closeTop, closeAll, stack: ctx.stack };
}
