import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

type ComponentSeen = { label: string; confidence?: number; part_number_guess?: string | null };

type StreamAtom = {
  id: string;
  observed_at: string | null;
  ingested_at: string;
  confidence: string | null;
  confidence_score: number | null;
  content_text: string | null;
  structured_data: {
    image_id?: string;
    scene_type?: string;
    build_phase_guess?: string;
    analysis_kind?: string;
    components_seen?: ComponentSeen[];
    state_observations?: {
      rust_severity?: string;
      paint_state?: string;
      completeness?: string;
      damage_callouts?: string[];
    };
    workshop_signals?: {
      tools_visible?: string[];
      fixturing?: string;
      weld_quality?: string;
      lighting?: string;
    };
    presence?: { person?: boolean; dog?: boolean; place_hint?: string | null };
  } | null;
};

type ImageMeta = { id: string; image_url: string | null; file_name: string | null };

const PAGE_SIZE = 30;

const AnalysisStreamPage: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [atoms, setAtoms] = useState<StreamAtom[]>([]);
  const [images, setImages] = useState<Record<string, ImageMeta>>({});
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const justArrivedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('vehicle_observations')
        .select('id, observed_at, ingested_at, confidence, confidence_score, content_text, structured_data')
        .eq('vehicle_id', vehicleId)
        .eq('kind', 'condition')
        .contains('structured_data', { analysis_kind: 'image_deep_byok' })
        .order('ingested_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (cancelled) return;
      if (error) {
        console.error('AnalysisStream initial fetch error:', error);
        setLoading(false);
        return;
      }
      const rows = (data || []) as StreamAtom[];
      setAtoms(rows);
      await loadImagesFor(rows);
      setLoading(false);
    })();

    const channel = supabase
      .channel(`analysis-stream-${vehicleId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'vehicle_observations',
          filter: `vehicle_id=eq.${vehicleId}`,
        },
        async (payload) => {
          const row = payload.new as StreamAtom & { kind?: string; vehicle_id?: string };
          if (row.kind !== 'condition') return;
          if (row.structured_data?.analysis_kind !== 'image_deep_byok') return;
          justArrivedRef.current.add(row.id);
          setNewCount((c) => c + 1);
          setAtoms((prev) => [row, ...prev].slice(0, PAGE_SIZE * 3));
          await loadImagesFor([row]);
          setTimeout(() => {
            justArrivedRef.current.delete(row.id);
          }, 4000);
        },
      )
      .subscribe((status) => {
        setStreaming(status === 'SUBSCRIBED');
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [vehicleId]);

  async function loadImagesFor(rows: StreamAtom[]) {
    const need = rows
      .map((r) => r.structured_data?.image_id)
      .filter((id): id is string => !!id)
      .filter((id) => !images[id]);
    if (need.length === 0) return;
    const { data } = await supabase
      .from('vehicle_images')
      .select('id, image_url, file_name')
      .in('id', need);
    if (!data) return;
    setImages((prev) => {
      const next = { ...prev };
      for (const im of data) next[im.id] = im;
      return next;
    });
  }

  if (!vehicleId) return null;

  return (
    <div style={{ padding: '12px', fontFamily: 'Arial, sans-serif' }}>
      <Link
        to={`/vehicle/${vehicleId}`}
        style={{
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-secondary)',
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 12,
        }}
      >
        ← back to vehicle
      </Link>

      <div
        style={{
          border: '2px solid var(--ink-primary)',
          padding: 12,
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--ink-secondary)' }}>
            live analysis stream
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
            deep image analysis · BYOK pipeline
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-secondary)', marginTop: 4 }}>
            atoms landing in <code>vehicle_observations</code> (kind=condition, analysis_kind=image_deep_byok).
            Sourced from <code>vehicle_images.ai_scan_metadata.byok_deep_analysis</code> jsonb.
          </div>
        </div>
        <div
          style={{
            border: '2px solid var(--ink-primary)',
            padding: '6px 10px',
            fontSize: 9,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            background: streaming ? 'var(--ink-primary)' : 'transparent',
            color: streaming ? 'var(--bg)' : 'var(--ink-primary)',
            whiteSpace: 'nowrap',
          }}
          title={streaming ? 'Subscribed to postgres_changes' : 'Connecting…'}
        >
          {streaming ? '● live' : '○ connecting'}
        </div>
      </div>

      {newCount > 0 && (
        <div
          style={{
            border: '2px solid var(--accent, var(--ink-primary))',
            padding: '6px 10px',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          {newCount} new atom{newCount === 1 ? '' : 's'} landed since you arrived
        </div>
      )}

      {loading && (
        <div style={{ fontSize: 11, color: 'var(--ink-secondary)' }}>loading recent atoms…</div>
      )}

      {!loading && atoms.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--ink-secondary)', padding: 24, border: '2px dashed var(--ink-secondary)' }}>
          no deep-analysis atoms have been ingested for this vehicle yet.
          Run <code>scripts/deep-image-analysis-byok.mjs ingest --sink ...</code> to seed.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {atoms.map((a, atomIdx) => {
          const isNew = justArrivedRef.current.has(a.id);
          const imgId = a.structured_data?.image_id;
          const meta = imgId ? images[imgId] : null;
          const thumb = meta?.image_url ? optimizeImageUrl(meta.image_url, 'small') || meta.image_url : null;
          const eager = atomIdx < 3;
          const components = a.structured_data?.components_seen || [];
          const state = a.structured_data?.state_observations || {};
          const shop = a.structured_data?.workshop_signals || {};
          return (
            <Link
              key={a.id}
              to={`/vehicle/${vehicleId}/observation/${a.id}`}
              style={{
                display: 'flex',
                gap: 10,
                border: `2px solid ${isNew ? 'var(--accent, var(--ink-primary))' : 'var(--ink-primary)'}`,
                padding: 10,
                textDecoration: 'none',
                color: 'inherit',
                background: isNew ? 'var(--bg-hover, transparent)' : 'transparent',
                transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <div
                style={{
                  width: 160,
                  height: 200,
                  border: '2px solid var(--ink-primary)',
                  background: '#111',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    loading={eager ? 'eager' : 'lazy'}
                    decoding="async"
                    {...(eager ? { fetchpriority: 'high' as 'high' } : {})}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center',
                      display: 'block',
                    }}
                  />
                ) : (
                  <span style={{ color: '#666', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    loading image…
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', border: '2px solid var(--ink-primary)', padding: '1px 6px' }}>
                    {a.structured_data?.scene_type || 'unknown'}
                  </span>
                  <span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', border: '2px solid var(--ink-primary)', padding: '1px 6px' }}>
                    phase: {a.structured_data?.build_phase_guess || 'unknown'}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--ink-secondary)' }}>
                    conf {Math.round((a.confidence_score ?? 0) * 100)}%
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--ink-secondary)' }}>
                    observed {fmtDate(a.observed_at)}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--ink-secondary)' }}>
                    ingested {fmtRelative(a.ingested_at)}
                  </span>
                  {isNew && (
                    <span style={{ fontSize: 8, color: 'var(--accent, var(--ink-primary))', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                      ● just landed
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>{a.content_text || '(no narrative)'}</div>
                {components.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--ink-secondary)', marginBottom: 4 }}>
                    <strong style={{ color: 'var(--ink-primary)' }}>components ({components.length}):</strong>{' '}
                    {components.slice(0, 6).map((c) => c.label).join(', ')}
                    {components.length > 6 ? ` +${components.length - 6} more` : ''}
                  </div>
                )}
                {(state.rust_severity || state.paint_state || state.completeness) && (
                  <div style={{ fontSize: 10, color: 'var(--ink-secondary)' }}>
                    <strong style={{ color: 'var(--ink-primary)' }}>state:</strong>{' '}
                    rust={state.rust_severity || '—'} · paint={state.paint_state || '—'} · completeness={state.completeness || '—'}
                  </div>
                )}
                {(shop.fixturing || shop.lighting || shop.weld_quality) && (
                  <div style={{ fontSize: 10, color: 'var(--ink-secondary)' }}>
                    <strong style={{ color: 'var(--ink-primary)' }}>shop:</strong>{' '}
                    fixturing={shop.fixturing || '—'} · lighting={shop.lighting || '—'} · welds={shop.weld_quality || '—'}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

export default AnalysisStreamPage;
