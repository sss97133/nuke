/**
 * GlobalDropZone — full-page drag-drop overlay
 *
 * Listens for file drags anywhere on the window.
 * Shows a full-screen overlay with drop target.
 * On drop: routes files to the appropriate handler.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export const GlobalDropZone: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const navigate = useNavigate();

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    // Only show overlay if files are being dragged (not text selections etc.)
    if (e.dataTransfer?.types?.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Dispatch a custom event that AIDataIngestionSearch can listen to
    const event = new CustomEvent('nuke:global-drop', {
      detail: { files: Array.from(files) }
    });
    window.dispatchEvent(event);
  }, []);

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return (
    <>
      {children}
      {isDragging && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(42, 42, 42, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              border: '2px solid var(--accent, #2a2a2a)',
              background: 'var(--surface, #ebebeb)',
              padding: '48px 64px',
              textAlign: 'center',
              maxWidth: 480,
            }}
          >
            <div style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text, #2a2a2a)',
              marginBottom: 8,
            }}>
              DROP FILES
            </div>
            <div style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '9px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--muted, #888)',
            }}>
              IMAGES &middot; DOCUMENTS &middot; VIN PHOTOS &middot; RECEIPTS
            </div>
          </div>
        </div>
      )}
    </>
  );
};
