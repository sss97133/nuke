/**
 * Pipeline Visualizer — the LIVE image-analysis pipeline, watched as it happens.
 *
 * Each photo is a card showing its real journey: received → analyzing → verdict landed,
 * led by the vehicle it's identified with, with the schema that landed (scene, build
 * phase, components, OCR, narrative). Fed by get_pipeline_events (auth.uid()-scoped),
 * which returns real stage events the drain emits as it works — not a replay of finished
 * rows with the fields cosmetically animated in.
 *
 * Route: /pipeline/analysis
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface PipelineEvent {
  event_id: string;
  stage: string;
  created_at: string;
  image_id: string;
  vehicle_id: string | null;
  vehicle: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  received_at: string | null;
  detail: Record<string, unknown> | null;
}

// One image's journey, assembled from its stage events.
interface Journey {
  image_id: string;
  vehicle_id: string | null;
  vehicle: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  received_at: string | null;
  stage: string;   // furthest stage reached
  last_at: string; // newest event time — the sort key
  detail: Record<string, unknown>;
}

const POLL_MS = 4000;
const MAX_CARDS = 120;

// Journey rail: the stages a frame passes through, in order.
const RAIL: { key: string; label: string }[] = [
  { key: 'received', label: 'received' },
  { key: 'analyzing', label: 'analyzing' },
  { key: 'verdict_landed', label: 'landed' },
];
const rank = (stage: string) => {
  const i = RAIL.findIndex((s) => s.key === stage);
  return i < 0 ? 0 : i;
};

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/_/g, ' ') : '');
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const ago = (iso: string | null): string => {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// Fold a batch of events into the journey map (mutates + returns it).
function merge(map: Map<string, Journey>, events: PipelineEvent[]): Map<string, Journey> {
  for (const e of events) {
    const j = map.get(e.image_id) ?? {
      image_id: e.image_id,
      vehicle_id: e.vehicle_id,
      vehicle: e.vehicle,
      thumbnail_url: e.thumbnail_url,
      image_url: e.image_url,
      received_at: e.received_at,
      stage: 'received',
      last_at: e.created_at,
      detail: {},
    };
    // Identity/media fields: take the freshest non-null.
    j.vehicle = e.vehicle ?? j.vehicle;
    j.vehicle_id = e.vehicle_id ?? j.vehicle_id;
    j.thumbnail_url = e.thumbnail_url ?? j.thumbnail_url;
    j.image_url = e.image_url ?? j.image_url;
    j.received_at = e.received_at ?? j.received_at;
    // Stage only advances; the verdict's detail is the payload we keep.
    if (rank(e.stage) >= rank(j.stage)) j.stage = e.stage;
    if (e.stage === 'verdict_landed' && e.detail) j.detail = e.detail;
    if (e.created_at > j.last_at) j.last_at = e.created_at;
    map.set(e.image_id, j);
  }
  return map;
}

export default function PipelineVisualizer() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [cards, setCards] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [, forceTick] = useState(0); // keep "Xs ago" live
  const mapRef = useRef<Map<string, Journey>>(new Map());
  const cursorRef = useRef<string | null>(null);

  const uid = session?.user?.id;

  const recompute = useCallback(() => {
    const arr = Array.from(mapRef.current.values())
      .sort((a, b) => b.last_at.localeCompare(a.last_at))
      .slice(0, MAX_CARDS);
    setCards(arr);
  }, []);

  const poll = useCallback(async (initial: boolean) => {
    if (!uid) return;
    const { data, error } = await supabase.rpc('get_pipeline_events', {
      p_since: initial ? null : cursorRef.current,
      p_limit: initial ? 120 : 60,
    });
    if (error) { setErr(error.message); if (initial) setLoading(false); return; }
    setErr(null);
    const incoming = (data || []) as PipelineEvent[];
    if (incoming.length) cursorRef.current = incoming[0].created_at; // newest first
    merge(mapRef.current, incoming);
    recompute();
    if (initial) setLoading(false);
  }, [uid, recompute]);

  useEffect(() => {
    if (authLoading) return;
    if (!session) { navigate('/login'); return; }
    poll(true);
    const id = setInterval(() => poll(false), POLL_MS);
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => { clearInterval(id); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, authLoading]);

  const landedLastHour = cards.filter(
    (c) => c.stage === 'verdict_landed' && Date.now() - new Date(c.last_at).getTime() < 3600_000,
  ).length;

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 12px', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', flexWrap: 'wrap',
        padding: '16px 0 10px', borderBottom: '2px solid var(--text, #111)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: 8, height: 8, background: '#16a34a',
            display: 'inline-block', animation: 'nukePulse 1.4s ease-in-out infinite' }} />
          <h1 style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', margin: 0 }}>Analysis Pipeline — Live</h1>
        </div>
        <span style={{ fontFamily: '"Courier New", monospace', fontSize: '12px', color: 'var(--text-muted,#888)' }}>
          {landedLastHour} landed / last hour
        </span>
      </div>
      <style>{`@keyframes nukePulse{0%,100%{opacity:1}50%{opacity:0.25}}
        @keyframes nukeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>

      {loading && <p style={{ color: 'var(--text-muted,#888)', fontSize: '12px', padding: '16px 0' }}>Connecting to pipeline…</p>}
      {err && <p style={{ color: 'var(--error,#e53e3e)', fontSize: '12px', padding: '8px 0' }}>{err}</p>}
      {!loading && cards.length === 0 && !err && (
        <p style={{ color: 'var(--text-muted,#888)', fontSize: '12px', padding: '16px 0' }}>
          No analysis activity yet. As the drain processes your photos, each one streams through here.
        </p>
      )}

      <div>
        {cards.map((c) => <JourneyCard key={c.image_id} j={c} onOpen={() => c.vehicle_id && navigate(`/vehicle/${c.vehicle_id}`)} />)}
      </div>
    </div>
  );
}

function JourneyCard({ j, onOpen }: { j: Journey; onOpen: () => void }) {
  const landed = j.stage === 'verdict_landed';
  const scene = text(j.detail.scene_type);
  const phase = text(j.detail.build_phase);
  const narrative = typeof j.detail.narrative === 'string' ? j.detail.narrative : '';
  const comps = num(j.detail.component_count);
  const ocr = num(j.detail.ocr_count);

  const rows: { k: string; v: string }[] = [];
  if (scene && scene !== 'unknown') rows.push({ k: 'scene', v: scene });
  if (phase && phase !== 'unknown') rows.push({ k: 'build phase', v: phase });
  if (comps && comps > 0) rows.push({ k: 'components', v: `${comps}` });
  if (ocr && ocr > 0) rows.push({ k: 'text read', v: `${ocr}` });

  return (
    <div style={{ display: 'flex', gap: '12px', padding: '14px 0', borderBottom: '1px solid var(--border,#e5e5e5)',
      animation: 'nukeIn 220ms cubic-bezier(0.16,1,0.3,1)' }}>
      <div onClick={onOpen}
        style={{ width: 88, height: 88, flexShrink: 0, cursor: 'pointer',
          background: 'var(--grey-100,#f0f0f0)', border: '2px solid var(--border,#e5e5e5)', overflow: 'hidden' }}>
        {(j.thumbnail_url || j.image_url) && (
          <img src={j.thumbnail_url || j.image_url || ''} alt="" loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
          <span onClick={onOpen}
            style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text,#111)', cursor: 'pointer' }}>
            {j.vehicle || 'Unidentified vehicle'}
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: '"Courier New", monospace',
            fontSize: '10px', color: 'var(--text-muted,#999)' }}>{ago(j.last_at)} ago</span>
        </div>

        <StageRail stage={j.stage} />

        {!landed && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted,#888)', marginTop: '6px' }}>
            reading the frame…
          </div>
        )}

        {landed && narrative && (
          <div style={{ fontSize: '13px', color: 'var(--text,#222)', margin: '6px 0 4px', lineHeight: 1.4 }}>
            {narrative}
          </div>
        )}

        {landed && rows.map((r) => (
          <div key={r.k} style={{ display: 'flex', gap: '10px', fontSize: '13px', lineHeight: '18px' }}>
            <span style={{ flex: '0 0 96px', textAlign: 'right', fontSize: '8px', fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted,#999)', paddingTop: '3px' }}>
              {r.k}
            </span>
            <span style={{ flex: 1, minWidth: 0, color: 'var(--text,#222)' }}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// received ─ analyzing ─ landed, current stage filled + (if in flight) pulsing.
function StageRail({ stage }: { stage: string }) {
  const at = rank(stage);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      {RAIL.map((s, i) => {
        const done = i <= at;
        const current = i === at && stage !== 'verdict_landed';
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {i > 0 && <span style={{ width: 14, height: 2, background: done ? 'var(--text,#111)' : 'var(--border,#ddd)' }} />}
            <span style={{
              fontSize: '8px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '1px 5px', lineHeight: '13px',
              border: `1px solid ${done ? 'var(--text,#111)' : 'var(--border,#ddd)'}`,
              background: done ? 'var(--text,#111)' : 'transparent',
              color: done ? 'var(--bg,#fff)' : 'var(--text-muted,#999)',
              animation: current ? 'nukePulse 1.2s ease-in-out infinite' : undefined,
            }}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}
