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
        @keyframes nukeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
        @keyframes nukeLine{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}`}</style>

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
          const st = (r.state || {}) as Record<string, string>;
          // The schema fields that landed for this frame, in fill order — the cascade.
          const fields: { k: string; v: React.ReactNode; mono?: boolean }[] = [];
          if (r.scene_type && r.scene_type !== 'unknown') fields.push({ k: 'scene_type', v: label(r.scene_type) });
          if (r.build_phase && r.build_phase !== 'unknown') fields.push({ k: 'build_phase', v: label(r.build_phase) });
          if (st.paint_state) fields.push({ k: 'paint_state', v: label(st.paint_state) });
          if (st.completeness) fields.push({ k: 'completeness', v: label(st.completeness) });
          if (st.rust_severity && st.rust_severity !== 'none') fields.push({ k: 'rust', v: label(st.rust_severity) });
          for (const c of comps.slice(0, 8)) {
            fields.push({
              k: 'component',
              v: (<>{c.label}{c.part_number_guess && (
                <span style={{ fontFamily: '"Courier New", monospace', color: 'var(--accent,#2563eb)' }}> #{c.part_number_guess}</span>
              )}</>),
            });
          }
          for (const t of ocr.slice(0, 5)) fields.push({ k: 'ocr', v: t.text, mono: true });
          return (
            <div key={r.image_id} style={{
              display: 'flex', gap: '12px', padding: '12px 0', borderBottom: '1px solid var(--border,#e5e5e5)',
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

              {/* the schema filling itself, field by field */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
                  <span
                    onClick={() => navigate(`/vehicle/${r.vehicle_id}`)}
                    style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text,#111)', cursor: 'pointer' }}>
                    {r.vehicle || 'Unknown vehicle'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: '"Courier New", monospace',
                    fontSize: '10px', color: 'var(--text-muted,#999)' }}>{ago(r.landed_at)} ago</span>
                </div>

                {r.narrative && (
                  <div style={{ fontSize: '12px', color: 'var(--text,#222)', marginBottom: '6px', lineHeight: 1.35,
                    animation: isNew ? 'nukeLine 300ms cubic-bezier(0.16,1,0.3,1) both' : undefined }}>
                    {r.narrative}
                  </div>
                )}

                {fields.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '13px', lineHeight: '18px',
                    animation: isNew ? 'nukeLine 300ms cubic-bezier(0.16,1,0.3,1) both' : undefined,
                    animationDelay: isNew ? `${i * 55}ms` : undefined }}>
                    <span style={{ flex: '0 0 104px', textAlign: 'right', fontSize: '8px', fontWeight: 700,
                      letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted,#999)',
                      paddingTop: '3px' }}>{f.k}</span>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--text,#222)',
                      fontFamily: f.mono ? '"Courier New", monospace' : 'inherit' }}>{f.v}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
