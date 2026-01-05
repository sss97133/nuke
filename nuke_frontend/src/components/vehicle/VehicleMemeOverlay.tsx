import { useEffect, useMemo, useState, useCallback } from 'react';
import type { ContentActionEvent } from '../../services/streamActionsService';

type ActiveOverlay = {
  id: string;
  title: string;
  renderText: string | null;
  imageUrl: string | null;
  soundKey: string | null;
  durationMs: number;
  entryTime: number;
  randomX: number; // Random horizontal offset for variety
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function playSoundEffect(soundKey: string) {
  const AudioContextAny: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextAny) return;
  const ctx = new AudioContextAny();

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.08;
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
      mkOsc(180, 'triangle', 0, 0.12, 0.1);
      mkOsc(740, 'square', 0.06, 0.07, 0.06);
      break;
    }
    case 'airhorn_short': {
      mkOsc(440, 'sawtooth', 0, 0.25, 0.09);
      mkOsc(660, 'sawtooth', 0.03, 0.25, 0.07);
      mkOsc(880, 'sawtooth', 0.06, 0.22, 0.05);
      break;
    }
    case 'hype_drop': {
      mkOsc(880, 'square', 0, 0.12, 0.08);
      mkOsc(660, 'square', 0.12, 0.12, 0.08);
      mkOsc(440, 'square', 0.24, 0.18, 0.08);
      break;
    }
    case 'slow_clap': {
      mkOsc(220, 'triangle', 0, 0.10, 0.08);
      mkOsc(220, 'triangle', 0.35, 0.10, 0.08);
      mkOsc(220, 'triangle', 0.75, 0.10, 0.08);
      break;
    }
    default: {
      // Default "pop" sound for meme drops
      mkOsc(800, 'sine', 0, 0.08, 0.06);
      mkOsc(600, 'sine', 0.03, 0.1, 0.05);
      break;
    }
  }

  setTimeout(() => {
    try {
      ctx.close();
    } catch {}
  }, 1400);
}

// CSS keyframe animations injected once
const styleId = 'meme-overlay-animations';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes memeSlideIn {
      0% {
        opacity: 0;
        transform: translateX(-30px) scale(0.8);
      }
      50% {
        opacity: 1;
        transform: translateX(5px) scale(1.05);
      }
      100% {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }
    
    @keyframes memeSlideOut {
      0% {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
      100% {
        opacity: 0;
        transform: translateX(20px) scale(0.9);
      }
    }
    
    @keyframes memePulse {
      0%, 100% {
        box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.4);
      }
      50% {
        box-shadow: 0 0 0 8px rgba(102, 126, 234, 0);
      }
    }
    
    @keyframes memeGlow {
      0%, 100% {
        filter: drop-shadow(0 0 8px rgba(102, 126, 234, 0.3));
      }
      50% {
        filter: drop-shadow(0 0 16px rgba(102, 126, 234, 0.6));
      }
    }
    
    @keyframes imageReveal {
      0% {
        clip-path: inset(100% 0 0 0);
        opacity: 0;
      }
      100% {
        clip-path: inset(0 0 0 0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
}

export default function VehicleMemeOverlay({
  lastEvent,
}: {
  lastEvent: ContentActionEvent | null;
}) {
  const [active, setActive] = useState<ActiveOverlay[]>([]);
  const [exiting, setExiting] = useState<Set<string>>(new Set());

  const containerStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      inset: 0,
      pointerEvents: 'none' as const,
      overflow: 'hidden' as const,
      zIndex: 100,
    }),
    []
  );

  const removeOverlay = useCallback((id: string) => {
    setExiting(prev => new Set([...prev, id]));
    // Actually remove after exit animation
    setTimeout(() => {
      setActive(prev => prev.filter(x => x.id !== id));
      setExiting(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 300);
  }, []);

  useEffect(() => {
    if (!lastEvent) return;

    const durationMs = clamp(lastEvent.duration_ms ?? 2500, 500, 10000);
    const entry: ActiveOverlay = {
      id: lastEvent.id,
      title: lastEvent.title,
      renderText: lastEvent.render_text,
      imageUrl: lastEvent.image_url,
      soundKey: lastEvent.sound_key,
      durationMs,
      entryTime: Date.now(),
      randomX: Math.random() * 20, // 0-20px random offset
    };

    setActive((prev) => [...prev, entry].slice(-6)); // Max 6 overlays

    if (entry.soundKey) {
      try {
        playSoundEffect(entry.soundKey);
      } catch {}
    } else {
      // Play default "pop" for all meme drops
      try {
        playSoundEffect('pop');
      } catch {}
    }

    const t = window.setTimeout(() => {
      removeOverlay(entry.id);
    }, durationMs);

    return () => window.clearTimeout(t);
  }, [lastEvent, removeOverlay]);

  if (active.length === 0) return null;

  return (
    <div style={containerStyle}>
      {active.map((item, idx) => {
        const isExiting = exiting.has(item.id);
        const hasImage = !!item.imageUrl;
        const top = 16 + idx * (hasImage ? 180 : 70);
        
        return (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              left: `${16 + item.randomX}px`,
              top: `${top}px`,
              background: hasImage 
                ? 'linear-gradient(135deg, rgba(15, 15, 30, 0.95) 0%, rgba(20, 20, 40, 0.95) 100%)'
                : 'linear-gradient(135deg, rgba(102, 126, 234, 0.9) 0%, rgba(118, 75, 162, 0.9) 100%)',
              color: 'white',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '12px',
              padding: hasImage ? '12px' : '12px 16px',
              maxWidth: hasImage ? '280px' : '300px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(8px)',
              animation: isExiting 
                ? 'memeSlideOut 0.3s ease-out forwards' 
                : 'memeSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards, memePulse 2s ease-in-out infinite',
            }}
          >
            {/* Title Bar */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              marginBottom: hasImage || item.renderText ? '8px' : 0,
            }}>
              <span style={{ fontSize: '14px' }}>🔥</span>
              <div style={{ 
                fontWeight: 700, 
                fontSize: hasImage ? '13px' : '15px',
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                textShadow: '0 2px 4px rgba(0,0,0,0.3)',
              }}>
                {item.title}
              </div>
            </div>

            {/* Render Text */}
            {item.renderText && !hasImage && (
              <div style={{ 
                fontSize: '12px',
                opacity: 0.9,
                marginTop: '4px',
              }}>
                {item.renderText}
              </div>
            )}

            {/* Image */}
            {hasImage && item.imageUrl && (
              <div style={{
                marginTop: '4px',
                borderRadius: '8px',
                overflow: 'hidden',
                background: 'rgba(0,0,0,0.3)',
              }}>
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  style={{
                    maxHeight: '120px',
                    maxWidth: '100%',
                    width: 'auto',
                    display: 'block',
                    margin: '0 auto',
                    animation: 'imageReveal 0.5s ease-out forwards, memeGlow 2s ease-in-out infinite',
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}

            {/* Render text under image */}
            {item.renderText && hasImage && (
              <div style={{ 
                fontSize: '11px',
                opacity: 0.8,
                marginTop: '8px',
                textAlign: 'center',
                fontStyle: 'italic',
              }}>
                "{item.renderText}"
              </div>
            )}

            {/* Progress bar */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '3px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '0 0 12px 12px',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
                animation: `shrinkWidth ${item.durationMs}ms linear forwards`,
                transformOrigin: 'left',
              }} />
            </div>
          </div>
        );
      })}

      {/* Add shrink animation */}
      <style>{`
        @keyframes shrinkWidth {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}
