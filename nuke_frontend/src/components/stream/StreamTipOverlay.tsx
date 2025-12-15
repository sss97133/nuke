import { useEffect, useMemo, useState } from 'react';

export type StreamTipEvent = {
  id: string;
  stream_id: string;
  streamer_id: string | null;
  sender_id: string | null;
  amount_cents: number;
  message: string | null;
  created_at: string;
};

type ActiveTip = {
  id: string;
  amountCents: number;
  message: string | null;
};

export default function StreamTipOverlay({ lastTip }: { lastTip: StreamTipEvent | null }) {
  const [active, setActive] = useState<ActiveTip[]>([]);

  const containerStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      inset: 0,
      pointerEvents: 'none' as const,
      overflow: 'hidden' as const,
    }),
    []
  );

  useEffect(() => {
    if (!lastTip) return;
    const entry: ActiveTip = {
      id: lastTip.id,
      amountCents: lastTip.amount_cents || 0,
      message: lastTip.message || null,
    };
    setActive((prev) => [...prev, entry].slice(-4));

    const t = window.setTimeout(() => {
      setActive((prev) => prev.filter((x) => x.id !== entry.id));
    }, 3500);
    return () => window.clearTimeout(t);
  }, [lastTip]);

  return (
    <div style={containerStyle}>
      {active.map((t, idx) => (
        <div
          key={t.id}
          style={{
            position: 'absolute',
            right: '12px',
            top: `${12 + idx * 64}px`,
            background: 'rgba(17, 24, 39, 0.88)',
            color: 'white',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            padding: '10px 12px',
            minWidth: '220px',
            maxWidth: '360px',
          }}
        >
          <div style={{ fontSize: '10pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
            TIP: ${((t.amountCents || 0) / 100).toFixed(2)}
          </div>
          {t.message && (
            <div style={{ marginTop: 6, fontSize: '9pt', opacity: 0.95 }}>
              {t.message}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


