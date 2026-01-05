import { useEffect, useState, useCallback } from 'react';
import type { ContentActionEvent } from '../../services/streamActionsService';

type ActiveOverlay = {
  id: string;
  title: string;
  imageUrl: string | null;
  durationMs: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function VehicleMemeOverlay({
  lastEvent,
}: {
  lastEvent: ContentActionEvent | null;
}) {
  const [active, setActive] = useState<ActiveOverlay[]>([]);

  const removeOverlay = useCallback((id: string) => {
    setActive(prev => prev.filter(x => x.id !== id));
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    // Only show image memes
    if (!lastEvent.image_url) return;

    const durationMs = clamp(lastEvent.duration_ms ?? 2500, 500, 8000);
    const entry: ActiveOverlay = {
      id: lastEvent.id,
      title: lastEvent.title,
      imageUrl: lastEvent.image_url,
      durationMs,
    };

    setActive((prev) => [...prev, entry].slice(-4));

    const t = window.setTimeout(() => {
      removeOverlay(entry.id);
    }, durationMs);

    return () => window.clearTimeout(t);
  }, [lastEvent, removeOverlay]);

  if (active.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      overflow: 'hidden',
      zIndex: 100,
    }}>
      {active.map((item, idx) => {
        const top = 12 + idx * 140;
        return (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              left: '12px',
              top: `${top}px`,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px',
              maxWidth: '200px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              animation: 'memeIn 0.3s ease-out',
            }}
          >
            {item.imageUrl && (
              <img
                src={item.imageUrl}
                alt={item.title}
                style={{
                  maxHeight: '100px',
                  maxWidth: '100%',
                  display: 'block',
                  borderRadius: '4px',
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div style={{ 
              marginTop: '4px',
              fontSize: '8pt', 
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}>
              {item.title}
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes memeIn {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
