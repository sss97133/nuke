import { useEffect, useMemo, useState } from 'react';
import type { StreamActionEvent } from '../../services/streamActionsService';

type ActiveOverlay = {
  id: string;
  title: string;
  renderText: string | null;
  imageUrl: string | null;
  soundKey: string | null;
  durationMs: number;
  createdAt: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function playSoundEffect(soundKey: string) {
  // Use WebAudio so we can ship without binary audio assets.
  const AudioContextAny: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextAny) return;
  const ctx = new AudioContextAny();

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.06;
  master.connect(ctx.destination);

  const mkOsc = (freq: number, type: OscillatorType, start: number, dur: number, gain: number) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now + start);
    g.gain.setValueAtTime(0.0001, now + start);
    g.gain.exponentialRampToValueAtTime(gain, now + start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  };

  switch (soundKey) {
    case 'rimshot': {
      // quick "thunk" + "tick"
      mkOsc(180, 'triangle', 0, 0.12, 0.08);
      mkOsc(740, 'square', 0.06, 0.07, 0.05);
      break;
    }
    case 'airhorn_short': {
      mkOsc(440, 'sawtooth', 0, 0.25, 0.07);
      mkOsc(660, 'sawtooth', 0.03, 0.25, 0.05);
      mkOsc(880, 'sawtooth', 0.06, 0.22, 0.04);
      break;
    }
    case 'hype_drop': {
      mkOsc(880, 'square', 0, 0.12, 0.06);
      mkOsc(660, 'square', 0.12, 0.12, 0.06);
      mkOsc(440, 'square', 0.24, 0.18, 0.06);
      break;
    }
    case 'slow_clap': {
      mkOsc(220, 'triangle', 0, 0.10, 0.06);
      mkOsc(220, 'triangle', 0.35, 0.10, 0.06);
      mkOsc(220, 'triangle', 0.75, 0.10, 0.06);
      break;
    }
    default: {
      mkOsc(520, 'triangle', 0, 0.12, 0.05);
      break;
    }
  }

  // Auto-close audio context after a short window
  setTimeout(() => {
    try {
      ctx.close();
    } catch {}
  }, 1400);
}

export default function StreamActionOverlay({
  lastEvent,
}: {
  lastEvent: StreamActionEvent | null;
}) {
  const [active, setActive] = useState<ActiveOverlay[]>([]);

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
    if (!lastEvent) return;

    const durationMs = clamp(lastEvent.duration_ms ?? 1800, 250, 10000);
    const entry: ActiveOverlay = {
      id: lastEvent.id,
      title: lastEvent.title,
      renderText: lastEvent.render_text,
      imageUrl: lastEvent.image_url,
      soundKey: lastEvent.sound_key,
      durationMs,
      createdAt: Date.now(),
    };

    setActive((prev) => [...prev, entry].slice(-6));

    if (entry.soundKey) {
      try {
        playSoundEffect(entry.soundKey);
      } catch {
        // ignore audio failures
      }
    }

    const t = window.setTimeout(() => {
      setActive((prev) => prev.filter((x) => x.id !== entry.id));
    }, durationMs);

    return () => window.clearTimeout(t);
  }, [lastEvent]);

  return (
    <div style={containerStyle}>
      {active.map((item, idx) => {
        const top = 12 + idx * 56;
        return (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              left: '12px',
              top: `${top}px`,
              background: 'rgba(0, 0, 0, 0.78)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              padding: '8px 10px',
              maxWidth: '70%',
              fontSize: '10pt',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: item.renderText ? '4px' : 0 }}>
              {item.title}
            </div>
            {item.renderText && <div style={{ opacity: 0.95 }}>{item.renderText}</div>}
            {item.imageUrl && (
              <img
                src={item.imageUrl}
                alt={item.title}
                style={{
                  marginTop: '6px',
                  maxHeight: '140px',
                  maxWidth: '100%',
                  objectFit: 'contain',
                  display: 'block',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}


