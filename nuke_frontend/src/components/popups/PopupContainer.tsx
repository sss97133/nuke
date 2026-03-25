/**
 * PopupContainer — Renders the popup stack into a portal on document.body.
 *
 * Each popup:
 *   - White bg (#f5f5f5), 2px solid #2a2a2a border, zero radius
 *   - Title bar: #2a2a2a bg, white text, 9px UPPERCASE Arial, close X on right
 *   - Scrollable content, max-height 70vh
 *   - Stack offset: +20px right, +20px down per layer
 *   - Dim overlay: rgba(0,0,0,0.2) behind the BOTTOM popup only
 *   - Draggable by title bar
 *   - 150ms ease transitions
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PopupEntry } from './PopupStack';

interface Props {
  stack: PopupEntry[];
  onClose: (id: string) => void;
  onCloseTop: () => void;
}

const STACK_OFFSET = 20;
const ANIM_DURATION = 150;

export function PopupContainer({ stack, onClose, onCloseTop }: Props) {
  // Escape closes top popup
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        onCloseTop();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [stack.length, onCloseTop]);

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
      {stack.map((entry, index) => (
        <PopupWindow
          key={entry.id}
          entry={entry}
          index={index}
          onClose={() => onClose(entry.id)}
        />
      ))}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Individual popup window
// ---------------------------------------------------------------------------

function PopupWindow({
  entry,
  index,
  onClose,
}: {
  entry: PopupEntry;
  index: number;
  onClose: () => void;
}) {
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef<{ mouseX: number; mouseY: number; offX: number; offY: number }>({
    mouseX: 0, mouseY: 0, offX: 0, offY: 0,
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from title bar (not close button)
    if ((e.target as HTMLElement).closest('[data-popup-close]')) return;
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
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#2a2a2a',
          padding: '6px 8px',
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
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
          }}
        >
          {entry.title}
        </span>
        <button
          data-popup-close
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            fontFamily: 'Arial, sans-serif',
            fontSize: '12px',
            fontWeight: 700,
            lineHeight: 1,
            cursor: 'pointer',
            padding: '0 2px',
            marginLeft: '8px',
            flexShrink: 0,
            transition: `color ${ANIM_DURATION}ms ease`,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
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
        {entry.content}
      </div>
    </div>
  );
}
