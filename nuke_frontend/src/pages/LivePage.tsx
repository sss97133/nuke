// LivePage.tsx
//
// Live-stream-as-homepage POC: HLS.js video + canvas overlay rendering bboxes
// from the `image_observations` Supabase Realtime feed (filter: source='live_poc').
// Right-rail atom feed shows the last 50 detections.
//
// NOTE ON DEPS: `hls.js` is NOT in package.json as of file creation
// (2026-04-26). Install with `npm i hls.js` in nuke_frontend/. Until then,
// the dynamic import below is gated and the player falls back to a stub
// <video> element with a "stream offline" placeholder.
//
// Route is intentionally NOT wired in App.tsx per task spec.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface BBox {
  x: number;        // 0..1 normalized OR pixel — handled in draw
  y: number;
  w: number;
  h: number;
  class?: string;
  confidence?: number;
  kind?: string;                 // entity kind for navigation (e.g. 'vehicle')
  resolved_entity_id?: string;
}

interface ImageObservationRow {
  id: string;
  source: string;
  observed_at: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
  bboxes?: BBox[] | null;
  observation_class?: string | null;
  confidence?: number | null;
  resolved_entity_id?: string | null;
  resolved_entity_kind?: string | null;
  // Realtime payloads include arbitrary columns; keep loose:
  [k: string]: unknown;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const STREAM_URL =
  (import.meta as any).env?.VITE_LIVE_STREAM_URL ||
  ''; // empty -> "stream offline" placeholder

function parseBboxes(row: ImageObservationRow): BBox[] {
  // The image_observations row may carry bboxes under a few shapes.
  // Be permissive: array on row, or nested under metadata/payload.
  const candidates: unknown[] = [
    (row as any).bboxes,
    (row as any).bbox,
    (row as any).detections,
    (row as any).metadata?.bboxes,
    (row as any).payload?.bboxes,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c as BBox[];
  }
  return [];
}

function thumbFor(row: ImageObservationRow): string | null {
  return (
    (row.thumbnail_url as string) ||
    (row.image_url as string) ||
    ((row as any).metadata?.thumbnail_url as string) ||
    null
  );
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export default function LivePage() {
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [feed, setFeed] = useState<ImageObservationRow[]>([]);
  const [latestBboxes, setLatestBboxes] = useState<BBox[]>([]);
  const [hlsAvailable, setHlsAvailable] = useState<boolean | null>(null);
  const [streamOnline, setStreamOnline] = useState<boolean>(false);

  // ----- HLS player setup -----
  useEffect(() => {
    let hlsInstance: any = null;
    let cancelled = false;

    async function setupHls() {
      const video = videoRef.current;
      if (!video || !STREAM_URL) {
        setHlsAvailable(false);
        setStreamOnline(false);
        return;
      }
      try {
        // Dynamic import so the bundle still builds when hls.js is absent.
        const mod: any = await import(/* @vite-ignore */ 'hls.js').catch(
          () => null
        );
        if (cancelled) return;
        const Hls = mod?.default ?? mod;
        if (!Hls) {
          setHlsAvailable(false);
          // Fallback: try native HLS (Safari)
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = STREAM_URL;
            setStreamOnline(true);
          }
          return;
        }
        setHlsAvailable(true);
        if (Hls.isSupported && Hls.isSupported()) {
          hlsInstance = new Hls();
          hlsInstance.loadSource(STREAM_URL);
          hlsInstance.attachMedia(video);
          hlsInstance.on(Hls.Events.MANIFEST_PARSED, () =>
            setStreamOnline(true)
          );
          hlsInstance.on(Hls.Events.ERROR, () => setStreamOnline(false));
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = STREAM_URL;
          setStreamOnline(true);
        }
      } catch {
        setHlsAvailable(false);
        setStreamOnline(false);
      }
    }

    setupHls();
    return () => {
      cancelled = true;
      try {
        hlsInstance?.destroy?.();
      } catch {
        /* noop */
      }
    };
  }, []);

  // ----- Realtime subscription -----
  useEffect(() => {
    const channel = supabase
      .channel('live-poc')
      .on(
        // @ts-expect-error - postgres_changes payload typing varies by client version
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'image_observations',
          filter: 'source=eq.live_poc',
        },
        (payload: any) => {
          const row = payload?.new as ImageObservationRow | undefined;
          if (!row) return;
          const bboxes = parseBboxes(row);
          setLatestBboxes(bboxes);
          setFeed((prev) => {
            const next = [row, ...prev];
            return next.slice(0, 50);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // ----- Canvas overlay sizing + draw -----
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    function resize() {
      if (!video || !canvas) return;
      const rect = video.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      draw();
    }

    function draw() {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!latestBboxes.length) return;

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00ff66';
      ctx.fillStyle = '#00ff66';
      ctx.font = '9px Arial';

      for (const b of latestBboxes) {
        // Auto-detect normalized vs pixel coords.
        const norm = b.x <= 1 && b.y <= 1 && b.w <= 1 && b.h <= 1;
        const x = norm ? b.x * canvas.width : b.x;
        const y = norm ? b.y * canvas.height : b.y;
        const w = norm ? b.w * canvas.width : b.w;
        const h = norm ? b.h * canvas.height : b.h;

        ctx.strokeRect(x, y, w, h);
        const label = [
          (b.class || '').toUpperCase(),
          b.confidence != null ? `${Math.round(b.confidence * 100)}%` : '',
        ]
          .filter(Boolean)
          .join(' ');
        if (label) {
          const tw = ctx.measureText(label).width + 6;
          ctx.fillRect(x, y - 12, tw, 12);
          ctx.save();
          ctx.fillStyle = '#000';
          ctx.fillText(label, x + 3, y - 3);
          ctx.restore();
        }
      }
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(video);
    window.addEventListener('resize', resize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [latestBboxes]);

  // ----- Click bbox -> navigate -----
  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !latestBboxes.length) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    for (const b of latestBboxes) {
      const norm = b.x <= 1 && b.y <= 1 && b.w <= 1 && b.h <= 1;
      const x = norm ? b.x * canvas.width : b.x;
      const y = norm ? b.y * canvas.height : b.y;
      const w = norm ? b.w * canvas.width : b.w;
      const h = norm ? b.h * canvas.height : b.h;
      if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) {
        const kind = b.kind || 'vehicle';
        const id = b.resolved_entity_id;
        if (id) {
          navigate(`/subject/${kind}/${id}`);
          return;
        }
      }
    }
  }

  // ----- Style tokens (inline; design-system compliant — Arial, 2px borders, 0 radius, no shadows) -----
  const styles = useMemo<Record<string, React.CSSProperties>>(
    () => ({
      page: {
        fontFamily: 'Arial, sans-serif',
        background: '#000',
        color: '#fff',
        minHeight: '100vh',
        padding: 12,
        boxSizing: 'border-box',
      },
      topBar: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '2px solid #fff',
        paddingBottom: 6,
        marginBottom: 12,
        fontSize: 9,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      },
      wordmark: {
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '0.08em',
      },
      devLink: {
        color: '#fff',
        textDecoration: 'none',
        borderBottom: '2px solid #fff',
        paddingBottom: 1,
        fontSize: 8,
      },
      grid: {
        display: 'grid',
        gridTemplateColumns: '1fr 300px',
        gap: 12,
        alignItems: 'start',
      },
      stage: {
        position: 'relative',
        border: '2px solid #fff',
        background: '#111',
        aspectRatio: '16 / 9',
        width: '100%',
        overflow: 'hidden',
      },
      video: {
        width: '100%',
        height: '100%',
        display: 'block',
        background: '#000',
      },
      canvas: {
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'auto',
        cursor: 'crosshair',
      },
      offline: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textTransform: 'uppercase',
        fontSize: 9,
        letterSpacing: '0.1em',
        color: '#888',
      },
      tagline: {
        textAlign: 'center',
        fontSize: 9,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        marginTop: 10,
        color: '#bbb',
      },
      rail: {
        border: '2px solid #fff',
        background: '#0a0a0a',
        height: 'calc(100vh - 80px)',
        overflowY: 'auto',
      },
      railHeader: {
        position: 'sticky',
        top: 0,
        background: '#000',
        borderBottom: '2px solid #fff',
        padding: '6px 8px',
        fontSize: 8,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      },
      railRow: {
        display: 'grid',
        gridTemplateColumns: '40px 1fr',
        gap: 8,
        padding: '6px 8px',
        borderBottom: '2px solid #1a1a1a',
        fontSize: 8,
        textTransform: 'uppercase',
        alignItems: 'center',
      },
      thumb: {
        width: 40,
        height: 30,
        objectFit: 'cover',
        border: '2px solid #222',
        background: '#222',
      },
      cls: { fontWeight: 700, color: '#00ff66' },
      conf: { color: '#888' },
      empty: {
        padding: 12,
        fontSize: 8,
        textTransform: 'uppercase',
        color: '#555',
      },
    }),
    []
  );

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div style={styles.wordmark}>NUKE</div>
        <a href="/developers" style={styles.devLink}>
          developers →
        </a>
      </div>

      <div style={styles.grid}>
        <div>
          <div style={styles.stage} ref={containerRef}>
            <video
              ref={videoRef}
              style={styles.video}
              autoPlay
              muted
              playsInline
              controls={false}
            />
            <canvas
              ref={canvasRef}
              style={styles.canvas}
              onClick={onCanvasClick}
            />
            {(!STREAM_URL || hlsAvailable === false || !streamOnline) && (
              <div style={styles.offline}>
                {!STREAM_URL
                  ? 'stream offline — set VITE_LIVE_STREAM_URL'
                  : hlsAvailable === false
                  ? 'stream offline — hls.js not installed'
                  : 'stream offline'}
              </div>
            )}
          </div>
          <div style={styles.tagline}>
            Skylar is working. The data is flowing.
          </div>
        </div>

        <div style={styles.rail}>
          <div style={styles.railHeader}>
            live detections · last {feed.length}
          </div>
          {feed.length === 0 && (
            <div style={styles.empty}>waiting for observations…</div>
          )}
          {feed.map((row) => {
            const t = thumbFor(row);
            const cls =
              (row.observation_class as string) ||
              (parseBboxes(row)[0]?.class ?? '—');
            const conf =
              (row.confidence as number | null) ??
              parseBboxes(row)[0]?.confidence ??
              null;
            const kind = (row.resolved_entity_kind as string) || 'vehicle';
            const id = row.resolved_entity_id as string | null;
            return (
              <div
                key={row.id}
                style={{
                  ...styles.railRow,
                  cursor: id ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (id) navigate(`/subject/${kind}/${id}`);
                }}
              >
                {t ? (
                  <img src={t} style={styles.thumb} alt={cls} />
                ) : (
                  <div style={styles.thumb} />
                )}
                <div>
                  <div style={styles.cls}>{cls}</div>
                  <div style={styles.conf}>
                    {conf != null ? `${Math.round(conf * 100)}%` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
