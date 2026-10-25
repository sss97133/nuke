/** Shared popup chrome. Source readers keep their own content and evidence semantics. */
import React, { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PopupEntry } from './PopupStack';
import './popup-container.css';

interface Props {
  stack: PopupEntry[];
  onClose: (id: string) => void;
  onCloseTop: () => void;
  onToggleMinimize: (id: string) => void;
  onToggleExpanded: (id: string) => void;
}

const STACK_OFFSET = 20;
const ANIM_DURATION = 150;
const DEBOUNCE_MS = 300;

export function PopupContainer({ stack, onClose, onCloseTop, onToggleMinimize, onToggleExpanded }: Props) {
  const activePopups = stack.filter((e) => !e.minimized);
  const minimizedPopups = stack.filter((e) => e.minimized);

  // Escape closes top non-minimized popup
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activePopups.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        onCloseTop();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [activePopups.length, onCloseTop]);

  // Click on overlay closes top popup
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onCloseTop();
      }
    },
    [onCloseTop],
  );

  return createPortal(
    <>
      {/* Overlay — only when there are active (non-minimized) popups */}
      {activePopups.length > 0 && (
        <div
          onClick={handleOverlayClick}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9000,
            background: 'rgba(0,0,0,0.2)',
            transition: `background ${ANIM_DURATION}ms ease`,
          }}
        >
          {activePopups.map((entry, index) => (
            <PopupWindow
              key={entry.id}
              entry={entry}
              index={index}
              onClose={() => onClose(entry.id)}
              onMinimize={() => onToggleMinimize(entry.id)}
              onToggleExpanded={() => onToggleExpanded(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Minimized dock — horizontal strip at bottom of viewport */}
      {minimizedPopups.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 9100,
            display: 'flex',
            flexDirection: 'row',
            gap: 8,
            padding: '8px',
            overflowX: 'auto',
            pointerEvents: 'none',
          }}
        >
          {minimizedPopups.map((entry) => (
            <MinimizedBar
              key={entry.id}
              entry={entry}
              onRestore={() => onToggleMinimize(entry.id)}
              onClose={() => onClose(entry.id)}
            />
          ))}
        </div>
      )}
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Minimized bar — docked at bottom
// ---------------------------------------------------------------------------

function MinimizedBar({
  entry,
  onRestore,
  onClose,
}: {
  entry: PopupEntry;
  onRestore: () => void;
  onClose: () => void;
}) {
  return (
    <div className="popup-dock-item">
      <button type="button" className="popup-dock-restore" onClick={onRestore} aria-label={`Restore ${entry.title}`}>
        {entry.title}
      </button>
      <button type="button" className="popup-window-control" onClick={onClose} aria-label={`Close ${entry.title}`}>
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual popup window (active / non-minimized)
// ---------------------------------------------------------------------------

function PopupWindow({
  entry,
  index,
  onClose,
  onMinimize,
  onToggleExpanded,
}: {
  entry: PopupEntry;
  index: number;
  onClose: () => void;
  onMinimize: () => void;
  onToggleExpanded: () => void;
}) {
  // Drag state
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef<{ mouseX: number; mouseY: number; offX: number; offY: number }>({
    mouseX: 0, mouseY: 0, offX: 0, offY: 0,
  });

  // Resize state — user-dragged dimensions override entry.width
  const [resized, setResized] = useState<{ w: number; h: number } | null>(null);
  const resizing = useRef(false);
  const resizeStart = useRef<{ mouseX: number; mouseY: number; w: number; h: number }>({
    mouseX: 0, mouseY: 0, w: 0, h: 0,
  });
  const popupRef = useRef<HTMLDivElement>(null);

  // Reset resize when expanded state changes
  useEffect(() => {
    setResized(null);
  }, [entry.expanded]);

  // Search state -- debounced
  const [rawSearch, setRawSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRawSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(val);
    }, DEBOUNCE_MS);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // --- DRAG HANDLER ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from title bar (not buttons or search input)
    if ((e.target as HTMLElement).closest('[data-popup-close]')) return;
    if ((e.target as HTMLElement).closest('[data-popup-search]')) return;
    if ((e.target as HTMLElement).closest('[data-popup-btn]')) return;
    if ((e.target as HTMLElement).closest('[data-popup-resize]')) return;
    e.preventDefault();
    dragging.current = true;
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offX: dragOffset.x,
      offY: dragOffset.y,
    };

    const handleMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setDragOffset({
        x: dragStart.current.offX + (ev.clientX - dragStart.current.mouseX),
        y: dragStart.current.offY + (ev.clientY - dragStart.current.mouseY),
      });
    };

    const handleUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [dragOffset]);

  // --- RESIZE HANDLER ---
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    const rect = popupRef.current?.getBoundingClientRect();
    resizeStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      w: rect?.width ?? entry.width,
      h: rect?.height ?? 400,
    };

    const handleMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const newW = Math.max(280, resizeStart.current.w + (ev.clientX - resizeStart.current.mouseX));
      const newH = Math.max(200, resizeStart.current.h + (ev.clientY - resizeStart.current.mouseY));
      setResized({ w: newW, h: newH });
    };

    const handleUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [entry.width]);

  // Effective dimensions
  const effectiveWidth = resized?.w ?? entry.width;

  // Center on screen, then offset by stack position + drag
  const visibleWidth = `min(${effectiveWidth}px, calc(100vw - 32px))`;
  const centeredLeft = `calc(50% - ${visibleWidth} / 2 + ${index * STACK_OFFSET}px + ${dragOffset.x}px)`;
  const baseLeft = `clamp(16px, ${centeredLeft}, calc(100vw - ${visibleWidth} - 16px))`;
  const baseTop = `calc(15vh + ${index * STACK_OFFSET}px + ${dragOffset.y}px)`;

  // Inject searchQuery into content via cloneElement
  const contentWithProps = isValidElement(entry.content)
    ? cloneElement(entry.content as React.ReactElement<any>, {
        ...(entry.searchable ? { searchQuery } : {}),
        popupExpanded: entry.expanded,
      })
    : entry.content;

  return (
    <div
      ref={popupRef}
      className="popup-window"
      role="dialog"
      aria-label={entry.title}
      onClick={(e) => e.stopPropagation()}
      style={{
        left: baseLeft,
        top: baseTop,
        width: effectiveWidth,
        height: resized?.h ?? undefined,
        zIndex: 9001 + index,
        transition: resizing.current ? undefined : `width ${ANIM_DURATION}ms ease`,
      }}
    >
      <div className="popup-window-header" onMouseDown={handleMouseDown}>
        <span className="popup-window-title" title={entry.title}>{entry.title}</span>
        {entry.searchable && (
          <input
            data-popup-search
            className="popup-window-search"
            type="text"
            aria-label={`Search ${entry.title}`}
            value={rawSearch}
            onChange={handleSearchChange}
            placeholder="Search…"
          />
        )}
        <button type="button" data-popup-btn className="popup-window-control" onClick={onToggleExpanded} aria-label="Toggle expand" aria-pressed={entry.expanded}>
          {entry.expanded ? '−' : '+'}
        </button>
        <button type="button" data-popup-btn className="popup-window-control" onClick={onMinimize} aria-label="Minimize popup">—</button>
        <button type="button" data-popup-close className="popup-window-control" onClick={onClose} aria-label="Close popup">×</button>
      </div>
      <div className="popup-window-content">{contentWithProps}</div>
      <div data-popup-resize className="popup-window-resize" onMouseDown={handleResizeMouseDown} />
    </div>
  );
}
