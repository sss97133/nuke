/**
 * Pipeline Visualizer — the live view of image analysis as it happens.
 *
 * Not a progress bar and not a per-vehicle widget: a stream of the actual data pipeline,
 * newest first, line by line, as each frame's verdict lands. Each line shows what was
 * extracted (scene, build phase, components w/ part numbers, OCR text, state) plus the
 * derived-stage flags (hashed / session / dedup / match). Flow visible == healthy AND
 * valuable in one surface. Fed by get_analysis_stream (incremental cursor, no model spend).
 *
 * Route: /pipeline
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface Component { label?: string; confidence?: number; part_number_guess?: string | null; }
interface TextRegion { text?: string; confidence?: number; }
interface StreamRow {
  image_id: string;
  vehicle_id: string;
  vehicle: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  landed_at: string;
  scene_type: string | null;
  build_phase: string | null;
  narrative: string | null;
  components: Component[] | null;
  text_regions: TextRegion[] | null;
  state: Record<string, unknown> | null;
  hashed: boolean;
  sessioned: boolean;
  is_duplicate: boolean;
  match_status: string | null;
}

const POLL_MS = 4000;
const MAX_ROWS = 200;

const label = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '');
const ago = (iso: string): string => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// 8-9px ALL-CAPS marker (design system).
function Chip({ text, tone = 'muted', title }: { text: string; tone?: 'muted' | 'on' | 'value'; title?: string }) {
  const colors = {
    muted: { bg: 'transparent', fg: 'var(--text-muted, #888)', bd: 'var(--border, #333)' },
    on: { bg: 'var(--text, #111)', fg: 'var(--bg, #fff)', bd: 'var(--text, #111)' },
    value: { bg: 'transparent', fg: 'var(--accent, #2563eb)', bd: 'var(--accent, #2563eb)' },
  }[tone];
  return (
    <span title={title} style={{
      display: 'inline-block', fontSize: '8px', fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', padding: '1px 4px', marginRight: '4px', lineHeight: '12px',
      fontFamily: 'Arial, Helvetica, sans-serif',
      background: colors.bg, color: colors.fg, border: `1px solid ${colors.bd}`,
    }}>{text}</span>
  );
}

export default function PipelineVisualizer() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<StreamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [, forceTick] = useState(0); // re-render so "Xs ago" stays live
  const cursorRef = useRef<string | null>(null);
  const newIdsRef = useRef<Set<string>>(new Set());

  const uid = session?.user?.id;

  const poll = useCallback(async (initial: boolean) => {
    if (!uid) return;
    const { data, error } = await supabase.rpc('get_analysis_stream', {
      p_user_id: uid,
      p_since: initial ? null : cursorRef.current,
      p_limit: initial ? 60 : 40,
    });
    if (error) { setErr(error.message); return; }
    setErr(null);
    const incoming = (data || []) as StreamRow[];
    if (incoming.length) cursorRef.current = incoming[0].landed_at; // rows are landed_at DESC
    if (incoming.length) {
      newIdsRef.current = new Set(incoming.map((r) => r.image_id));
      setRows((prev) => {
        const byId = new Map<string, StreamRow>();
        for (const r of incoming) byId.set(r.image_id, r);
        for (const r of prev) if (!byId.has(r.image_id)) byId.set(r.image_id, r);
        return Array.from(byId.values())
          .sort((a, b) => b.landed_at.localeCompare(a.landed_at))
          .slice(0, MAX_ROWS);
      });
    } else if (!initial) {
      newIdsRef.current = new Set();
    }
    if (initial) setLoading(false);
  }, [uid]);

  useEffect(() => {
    if (authLoading) return;
    if (!session) { navigate('/login'); return; }
    poll(true);
    const id = setInterval(() => poll(false), POLL_MS);
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => { clearInterval(id); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, authLoading]);

  const lastHour = rows.filter((r) => Date.now() - new Date(r.landed_at).getTime() < 3600_000).length;
  const newest = rows[0]?.landed_at;

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 12px', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* Header / pulse */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', flexWrap: 'wrap',
        padding: '16px 0 10px', borderBottom: '2px solid var(--text, #111)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: 8, height: 8, background: '#16a34a', borderRadius: 0,
            display: 'inline-block', animation: 'nukePulse 1.4s ease-in-out infinite' }} />
          <h1 style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', margin: 0 }}>Analysis Pipeline — Live</h1>
        </div>
        <span style={{ fontFamily: '"Courier New", monospace', fontSize: '12px', color: 'var(--text-muted,#888)' }}>
          {lastHour} landed / last hour
        </span>
        {newest && (
          <span style={{ fontFamily: '"Courier New", monospace', fontSize: '12px', color: 'var(--text-muted,#888)' }}>
            newest {ago(newest)} ago
          </span>
        )}
      </div>
      <style>{`@keyframes nukePulse{0%,100%{opacity:1}50%{opacity:0.25}}
        @keyframes nukeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>

      {loading && <p style={{ color: 'var(--text-muted,#888)', fontSize: '12px', padding: '16px 0' }}>Connecting to pipeline…</p>}
      {err && <p style={{ color: 'var(--error,#e53e3e)', fontSize: '12px', padding: '8px 0' }}>{err}</p>}
      {!loading && rows.length === 0 && !err && (
        <p style={{ color: 'var(--text-muted,#888)', fontSize: '12px', padding: '16px 0' }}>
          No frames analyzed yet. As the drain processes your photos, they stream in here.
        </p>
      )}

      {/* Stream */}
      <div>
        {rows.map((r) => {
          const isNew = newIdsRef.current.has(r.image_id);
          const comps = Array.isArray(r.components) ? r.components.filter((c) => c?.label) : [];
          const ocr = Array.isArray(r.text_regions) ? r.text_regions.filter((t) => t?.text) : [];
          const partNos = comps.map((c) => c.part_number_guess).filter(Boolean) as string[];
          return (
            <div key={r.image_id} style={{
              display: 'flex', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border,#e5e5e5)',
              animation: isNew ? 'nukeIn 220ms cubic-bezier(0.16,1,0.3,1)' : undefined,
            }}>
              {/* thumbnail */}
              <div
                onClick={() => navigate(`/vehicle/${r.vehicle_id}`)}
                style={{ width: 84, height: 84, flexShrink: 0, cursor: 'pointer',
                  background: 'var(--grey-100,#f0f0f0)', border: '2px solid var(--border,#e5e5e5)',
                  overflow: 'hidden' }}>
                {r.thumbnail_url && (
                  <img src={r.thumbnail_url} alt="" loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
              </div>

              {/* extracted payload */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
                  {r.scene_type && r.scene_type !== 'unknown' && <Chip text={label(r.scene_type)} tone="on" />}
                  {r.build_phase && r.build_phase !== 'unknown' && <Chip text={label(r.build_phase)} />}
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text,#111)' }}>
                    {r.vehicle || 'Unknown vehicle'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: '"Courier New", monospace',
                    fontSize: '10px', color: 'var(--text-muted,#999)' }}>{ago(r.landed_at)} ago</span>
                </div>

                {r.narrative && (
                  <div style={{ fontSize: '12px', color: 'var(--text,#222)', marginBottom: '4px', lineHeight: 1.35 }}>
                    {r.narrative}
                  </div>
                )}

                {/* components — the "what's in this photo" */}
                {comps.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted,#555)', marginBottom: '3px' }}>
                    {comps.slice(0, 6).map((c, i) => (
                      <span key={i} style={{ marginRight: '10px', whiteSpace: 'nowrap' }}>
                        {c.label}
                        {c.part_number_guess && (
                          <span style={{ fontFamily: '"Courier New", monospace', color: 'var(--accent,#2563eb)' }}>
                            {' '}#{c.part_number_guess}
                          </span>
                        )}
                      </span>
                    ))}
                    {comps.length > 6 && <span>+{comps.length - 6} more</span>}
                  </div>
                )}

                {/* OCR — VINs, stampings, brands read off the metal */}
                {ocr.length > 0 && (
                  <div style={{ marginBottom: '3px' }}>
                    {ocr.slice(0, 4).map((t, i) => (
                      <span key={i} title="OCR text" style={{ display: 'inline-block',
                        fontFamily: '"Courier New", monospace', fontSize: '10px',
                        padding: '1px 5px', marginRight: '4px',
                        border: '1px solid var(--accent,#2563eb)', color: 'var(--accent,#2563eb)' }}>
                        {t.text}
                      </span>
                    ))}
                  </div>
                )}

                {/* derived pipeline stages this frame passed through */}
                <div>
                  <Chip text="analyzed" tone="on" />
                  {r.hashed && <Chip text="hashed" />}
                  {r.sessioned && <Chip text="session" />}
                  {r.is_duplicate && <Chip text="dup" title="burst duplicate" />}
                  {partNos.length > 0 && <Chip text={`${partNos.length} part#`} tone="value" />}
                  {r.match_status && r.match_status !== 'pending' && <Chip text={label(r.match_status)} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
