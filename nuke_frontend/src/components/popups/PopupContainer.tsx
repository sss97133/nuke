/**
 * PopupContainer — Finder-style popup windows with minimize, size toggle, and dock.
 *
 * Each popup:
 *   - White bg (#f5f5f5), 2px solid #2a2a2a border, zero radius
 *   - Title bar: #2a2a2a bg, white text, 9px UPPERCASE Arial
 *   - Title bar layout: TITLE | [search input] | [S] [M] [L] | [---] [X]
 *   - S/M/L size toggle: 360px / 460px / 700px
 *   - Minimize (---) collapses to title bar docked at viewport bottom
 *   - Scrollable content, max-height 70vh
 *   - Stack offset: +20px right, +20px down per layer
 *   - Dim overlay: rgba(0,0,0,0.2) behind the BOTTOM popup only
 *   - Draggable by title bar
 *   - 150ms ease transitions
 */

import React, { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PopupEntry, PopupSize } from './PopupStack';

interface Props {
  stack: PopupEntry[];
  onClose: (id: string) => void;
  onCloseTop: () => void;
  onToggleMinimize: (id: string) => void;
  onSetSize: (id: string, size: PopupSize) => void;
}

const STACK_OFFSET = 20;
const ANIM_DURATION = 150;
const DEBOUNCE_MS = 300;

const SIZES: PopupSize[] = ['s', 'm', 'l'];

// Shared button style for title bar controls (16x16, 2px border, Courier New, zero radius)
const titleBarBtnBase: React.CSSProperties = {
  width: 16,
  height: 16,
  padding: 0,
  border: '2px solid rgba(255,255,255,0.3)',
  borderRadius: 0,
  background: 'none',
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: '8px',
  fontWeight: 700,
  lineHeight: '12px',
  textAlign: 'center',
  cursor: 'pointer',
  flexShrink: 0,
  transition: `all ${ANIM_DURATION}ms ease`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export function PopupContainer({ stack, onClose, onCloseTop, onToggleMinimize, onSetSize }: Props) {
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
              onSetSize={(size) => onSetSize(entry.id, size)}
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
            gap: 2,
            padding: '0 4px 4px',
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
    <div
      onClick={onRestore}
      style={{
        height: 24,
        background: 'var(--surface, #f5f5f5)',
        border: '2px solid #2a2a2a',
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
        cursor: 'pointer',
        pointerEvents: 'auto',
        maxWidth: 240,
        transition: `background ${ANIM_DURATION}ms ease`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-hover, #e0e0e0)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--surface, #f5f5f5)';
      }}
    >
      <span
        style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '9px',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: '#2a2a2a',
          lineHeight: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {entry.title}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          ...titleBarBtnBase,
          color: '#2a2a2a',
          borderColor: 'rgba(0,0,0,0.2)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#000';
          e.currentTarget.style.borderColor = '#2a2a2a';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#2a2a2a';
          e.currentTarget.style.borderColor = 'rgba(0,0,0,0.2)';
        }}
        aria-label="Close popup"
      >
        X
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
  onSetSize,
}: {
  entry: PopupEntry;
  index: number;
  onClose: () => void;
  onMinimize: () => void;
  onSetSize: (size: PopupSize) => void;
}) {
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef<{ mouseX: number; mouseY: number; offX: number; offY: number }>({
    mouseX: 0, mouseY: 0, offX: 0, offY: 0,
  });

  // Search state -- debounced
  const [rawSearch, setRawSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from title bar (not buttons or search input)
    if ((e.target as HTMLElement).closest('[data-popup-close]')) return;
    if ((e.target as HTMLElement).closest('[data-popup-search]')) return;
    if ((e.target as HTMLElement).closest('[data-popup-btn]')) return;
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

  // Center on screen, then offset by stack position + drag
  const baseLeft = `calc(50% - ${entry.width / 2}px + ${index * STACK_OFFSET}px + ${dragOffset.x}px)`;
  const baseTop = `calc(15vh + ${index * STACK_OFFSET}px + ${dragOffset.y}px)`;

  // Inject searchQuery and popupSize into content via cloneElement
  const contentWithProps = isValidElement(entry.content)
    ? cloneElement(entry.content as React.ReactElement<any>, {
        ...(entry.searchable ? { searchQuery } : {}),
        popupSize: entry.size,
      })
    : entry.content;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: baseLeft,
        top: baseTop,
        width: entry.width,
        maxWidth: 'calc(100vw - 32px)',
        background: '#f5f5f5',
        border: '2px solid #2a2a2a',
        borderRadius: 0,
        zIndex: 9001 + index,
        display: 'flex',
        flexDirection: 'column',
        animation: `popupSlideIn ${ANIM_DURATION}ms ease`,
        transition: `width ${ANIM_DURATION}ms ease`,
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          background: '#2a2a2a',
          padding: '6px 8px',
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
          gap: 4,
        }}
      >
        {/* Title */}
        <span
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '9px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: '#fff',
            lineHeight: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            maxWidth: '35%',
          }}
        >
          {entry.title}
        </span>

        {/* Search input */}
        {entry.searchable && (
          <input
            data-popup-search
            type="text"
            value={rawSearch}
            onChange={handleSearchChange}
            placeholder="SEARCH..."
            style={{
              flex: 1,
              minWidth: 0,
              height: 18,
              padding: '0 4px',
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 8,
              color: '#1a1a1a',
              background: 'var(--surface, #f5f5f5)',
              border: '2px solid var(--border, #555)',
              borderRadius: 0,
              outline: 'none',
              lineHeight: '18px',
            }}
          />
        )}

        {/* Spacer when no search */}
        {!entry.searchable && <div style={{ flex: 1 }} />}

        {/* Size toggle buttons: S M L */}
        <div data-popup-btn style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {SIZES.map((s) => (
            <SizeButton
              key={s}
              label={s.toUpperCase()}
              active={entry.size === s}
              onClick={() => onSetSize(s)}
            />
          ))}
        </div>

        {/* Minimize button */}
        <button
          data-popup-btn
          onClick={onMinimize}
          style={{
            ...titleBarBtnBase,
            color: 'rgba(255,255,255,0.6)',
            borderColor: 'rgba(255,255,255,0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
          }}
          aria-label="Minimize popup"
        >
          &mdash;
        </button>

        {/* Close button */}
        <button
          data-popup-close
          onClick={onClose}
          style={{
            ...titleBarBtnBase,
            color: 'rgba(255,255,255,0.6)',
            borderColor: 'rgba(255,255,255,0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
          }}
          aria-label="Close popup"
        >
          X
        </button>
      </div>

      {/* Scrollable content */}
      <div
        style={{
          overflowY: 'auto',
          maxHeight: '70vh',
          padding: 0,
        }}
      >
        {contentWithProps}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Size toggle button (S / M / L)
// ---------------------------------------------------------------------------

function SizeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-popup-btn
      onClick={onClick}
      style={{
        ...titleBarBtnBase,
        color: active ? '#2a2a2a' : 'rgba(255,255,255,0.6)',
        background: active ? '#fff' : 'none',
        borderColor: active ? '#fff' : 'rgba(255,255,255,0.3)',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color = '#fff';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
        }
      }}
      aria-label={`Size ${label}`}
    >
      {label}
    </button>
  );
}
