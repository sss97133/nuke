import React, { useCallback, useRef, useEffect } from 'react';

interface ColumnDividerProps {
  onResize: (leftPercent: number) => void;
  onReset: () => void;
}

const ColumnDivider: React.FC<ColumnDividerProps> = ({ onResize, onReset }) => {
  const dividerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dividerRef.current?.classList.add('vp-col-divider--active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onDoubleClick = useCallback(() => {
    onReset();
  }, [onReset]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const parent = dividerRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(20, Math.min(80, (x / rect.width) * 100));
      onResize(pct);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      dividerRef.current?.classList.remove('vp-col-divider--active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onResize]);

  return (
    <div
      ref={dividerRef}
      className="vp-col-divider"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    />
  );
};

export default ColumnDivider;
