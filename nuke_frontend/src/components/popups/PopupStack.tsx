/**
 * PopupStack — Context provider that manages an ordered stack of popups.
 *
 * Every badge, every data point, every metric is clickable and opens a popup.
 * Popups stack. You can dig infinitely deep through the data topology
 * without ever leaving the feed.
 *
 * Stack behavior:
 *   - Each popup shifts 20px right + 20px down from the previous
 *   - Escape closes the TOP popup only
 *   - Click on dim overlay closes the TOP popup only
 *   - Popups are draggable by their title bar
 */

import React, {
  createContext,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { PopupContainer } from './PopupContainer';

export interface PopupEntry {
  id: string;
  title: string;
  content: ReactNode;
  width: number;
  searchable: boolean;
}

export interface PopupStackContextValue {
  stack: PopupEntry[];
  push: (content: ReactNode, title: string, width?: number, searchable?: boolean) => string;
  pop: (id: string) => void;
  popTop: () => void;
  closeAll: () => void;
}

export const PopupStackContext = createContext<PopupStackContextValue | null>(null);

let _popupId = 0;
function nextId(): string {
  return `popup-${++_popupId}-${Date.now()}`;
}

export function PopupStackProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<PopupEntry[]>([]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const push = useCallback((content: ReactNode, title: string, width = 420, searchable = true): string => {
    const id = nextId();
    setStack((prev) => [...prev, { id, title, content, width, searchable }]);
    return id;
  }, []);

  const pop = useCallback((id: string) => {
    setStack((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const popTop = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const closeAll = useCallback(() => {
    setStack([]);
  }, []);

  const value: PopupStackContextValue = { stack, push, pop, popTop, closeAll };

  return (
    <PopupStackContext.Provider value={value}>
      {children}
      {stack.length > 0 && (
        <PopupContainer stack={stack} onClose={pop} onCloseTop={popTop} />
      )}
    </PopupStackContext.Provider>
  );
}
