/**
 * LocalDiscover.tsx — the onboarding surface, spec'd per:
 *   docs/architecture/IMAGE_OWNERSHIP_ONTOLOGY.md
 *   docs/architecture/IMAGE_REVIEW_PASSES.md
 *   docs/library/reference/encyclopedia/02-observation-model.md
 *
 * Vocabulary (matches the library — don't drift):
 *   OBSERVATION — any testimony about a vehicle (photo, receipt, comment…);
 *                 kind-tagged, tier-scored, append-only, never overwritten.
 *   IMAGE — a media observation with 4 independent relationships:
 *                 storage · attribution · subject · provenance
 *   SUBJECT — which vehicle the image depicts; EARNED via Pass 2, not assumed.
 *
 * Reads:
 *   /local/state.json                                 — counts: active, by_kind, by_tier
 *   /local/unassigned.json                            — images whose subject hasn't been earned
 *   /local/discovery/thumbs/*.jpg                     — browser-safe 480px JPEGs
 *
 * Route: /my/discover
 */

import { useEffect, useMemo, useState } from 'react';

type GlobalState = {
  generated_at: string;
  observations: {
    total: number;
    active: number;
    superseded: number;
    by_kind: Record<string, number>;
    by_tier: Record<string, number>;
  };
  images: {
    total: number;
    auto_assigned_subject: number;
    in_review: number;
    unassigned: number;
    auto_threshold: number;
  };
};

type UnassignedImage = {
  image_id: string;
  thumb: string | null;
  taken_at: string | null;
  gps: [number, number] | null;
  device_model: string | null;
  attribution_confidence: number;
  subject_candidate_vehicle_id: string | null;
  subject_candidate_confidence: number;
  subject_method: string;
};

type Unassigned = {
  generated_at: string;
  count: number;
  items: UnassignedImage[];
};

export default function LocalDiscover() {
  const [state, setState] = useState<GlobalState | null>(null);
  const [unassigned, setUnassigned] = useState<Unassigned | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, u] = await Promise.all([
          fetch('/local/state.json').then(r => r.ok ? r.json() : null),
          fetch('/local/unassigned.json').then(r => r.ok ? r.json() : null),
        ]);
        if (!s || !u) {
          setError('No local state computed yet. Run: python3 scripts/local-pass1-exif.py --days 7 && python3 scripts/local-compute-state.py');
          return;
        }
        setState(s);
        setUnassigned(u);
      } catch (e: any) {
        setError(`failed: ${e?.message || String(e)}`);
      }
    })();
  }, []);

  /** Group unassigned images by temporal + GPS proximity — the scaffold a
   *  visual classifier or a human reviewer actually needs to work against. */
  const clusters = useMemo(() => {
    if (!unassigned) return [];
    type Cluster = {
      key: string;
      started_at: string;
      ended_at: string;
      lat: number | null;
      lng: number | null;
      images: UnassignedImage[];
    };
    const out: Cluster[] = [];
    const sorted = [...unassigned.items].sort((a, b) => (a.taken_at || '').localeCompare(b.taken_at || ''));
    let cur: Cluster | null = null;
    const GAP_MIN = 20;
    const R_METERS = 200;
    const haversine = (la1: number, ln1: number, la2: number, ln2: number): number => {
      const R = 6371000;
      const p1 = (la1 * Math.PI) / 180, p2 = (la2 * Math.PI) / 180;
      const dp = ((la2 - la1) * Math.PI) / 180;
      const dl = ((ln2 - ln1) * Math.PI) / 180;
      const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(a));
    };
    for (const img of sorted) {
      if (!img.taken_at) continue;
      const t = new Date(img.taken_at).getTime();
      const [lat, lng] = img.gps || [null, null];
      const startNew = (): Cluster => ({
        key: `c_${out.length}_${img.taken_at}`,
        started_at: img.taken_at!,
        ended_at: img.taken_at!,
        lat, lng, images: [],
      });
      if (!cur) cur = startNew();
      const lastT = new Date(cur.ended_at).getTime();
      const gap = (t - lastT) / 1000 / 60;
      const gpsJump = lat != null && lng != null && cur.lat != null && cur.lng != null
        ? haversine(lat, lng, cur.lat, cur.lng) : 0;
      if (gap > GAP_MIN || gpsJump > R_METERS) {
        out.push(cur);
        cur = startNew();
      }
      cur.ended_at = img.taken_at!;
      cur.images.push(img);
      if (lat != null && lng != null) {
        if (cur.lat == null) { cur.lat = lat; cur.lng = lng; }
        else {
          const n = cur.images.length;
          cur.lat = (cur.lat * (n - 1) + lat) / n;
          cur.lng = (cur.lng * (n - 1) + lng) / n;
        }
      }
    }
    if (cur) out.push(cur);
    return out;
  }, [unassigned]);

  if (error) return <div style={page}><div style={errorBox}>{error}</div></div>;
  if (!state || !unassigned) return <div style={page}><div style={loading}>computing state…</div></div>;

  return (
    <div style={page}>
      <div style={header}>
        <div>
          <div style={headerKicker}>LOCAL-FIRST · NO CLOUD · OBSERVATION-NATIVE</div>
          <h1 style={headerTitle}>
            {state.observations.active.toLocaleString()} active observations · {state.images.total} images
          </h1>
          <div style={headerSub}>
            scanned {timeAgo(state.generated_at)} · source: <code style={codeInline}>~/Pictures/Photos Library.photoslibrary/originals/</code>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/my/k5" style={btnSecondary}>K5 →</a>
        </div>
      </div>

      {/* Global state strip — observations by kind, images by subject state */}
      <div style={statsRow}>
        <div style={statCell}>
          <div style={statLabel}>OBSERVATIONS · ACTIVE</div>
          <div style={statValue}>{state.observations.active}</div>
          <div style={statMeta}>{state.observations.superseded} superseded (preserved)</div>
        </div>
        <div style={statCell}>
          <div style={statLabel}>OBSERVATIONS · BY KIND</div>
          <div style={statValue}>
            {Object.entries(state.observations.by_kind).map(([k, n]) => (
              <span key={k} style={{ marginRight: 12 }}>
                <span style={{ color: '#64748b' }}>{k}</span> {n}
              </span>
            ))}
          </div>
        </div>
        <div style={statCell}>
          <div style={statLabel}>IMAGES · SUBJECT STATE</div>
          <div style={statValue}>
            <span style={{ color: '#22c55e' }}>{state.images.auto_assigned_subject}</span>
            <span style={{ color: '#64748b' }}> assigned · </span>
            <span style={{ color: '#eab308' }}>{state.images.in_review}</span>
            <span style={{ color: '#64748b' }}> review · </span>
            <span style={{ color: '#ef4444' }}>{state.images.unassigned}</span>
            <span style={{ color: '#64748b' }}> orphan</span>
          </div>
          <div style={statMeta}>auto-threshold ≥ {state.images.auto_threshold}</div>
        </div>
      </div>

      {/* Pass 2 banner */}
      <div style={pass2Banner}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>
          ⓘ Pass 2 (visual classifier) has not run yet.
        </div>
        <div style={{ color: '#94a3b8', lineHeight: 1.5 }}>
          All {state.images.unassigned} images have <code style={codeInline}>subject_vehicle_id = null</code>. Per{' '}
          <code style={codeInline}>IMAGE_OWNERSHIP_ONTOLOGY.md</code>, the subject is <em>earned</em>, not
          assumed — Pass 1 only writes <em>attribution</em> (who captured it,
          via EXIF device match). Pass 2 will propose candidate vehicles with a
          confidence score; anything ≥ {state.images.auto_threshold} auto-assigns, the rest routes to
          the review queue. False splits are acceptable; false merges are catastrophic.
        </div>
      </div>

      <div style={explainer}>
        Orphan images grouped into temporal + GPS clusters below — these are
        what Pass 2 (or a human) will classify. A cluster is photos within 20&nbsp;min
        at the same GPS point: usually one vehicle, one work session. Clicking a
        cluster opens the images; future Pass 2 proposals will surface here first
        with confidence scores.
      </div>

      {/* Cluster cards */}
      <div style={{ display: 'grid', gap: 10 }}>
        {clusters
          .sort((a, b) => b.images.length - a.images.length)
          .map(c => (
            <ClusterCard key={c.key} cluster={c} />
          ))}
      </div>
    </div>
  );
}

function ClusterCard({ cluster }: { cluster: { started_at: string; ended_at: string; lat: number | null; lng: number | null; images: UnassignedImage[] } }) {
  const preview = cluster.images.slice(0, 10);
  return (
    <div style={card}>
      <div style={cardHead}>
        <div>
          <div style={cardTitle}>
            {cluster.started_at.slice(0, 16).replace('T', ' ')} · {cluster.images.length} images
          </div>
          <div style={cardMeta}>
            {humanizeDuration(cluster.started_at, cluster.ended_at)}
            {cluster.lat != null && ` · ${cluster.lat.toFixed(4)}, ${cluster.lng!.toFixed(4)}`}
            {cluster.lat != null && (
              <> · <a
                href={`https://www.google.com/maps/search/?api=1&query=${cluster.lat},${cluster.lng}`}
                target="_blank" rel="noreferrer" style={mapLink}
              >map</a></>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={pendingPill}>awaiting Pass 2</span>
        </div>
      </div>
      <div style={cardStrip}>
        {preview.map(img => (
          img.thumb ? (
            <img
              key={img.image_id}
              src={img.thumb}
              alt=""
              loading="lazy"
              style={cardThumb}
            />
          ) : null
        ))}
        {cluster.images.length > preview.length && (
          <div style={cardMore}>+{cluster.images.length - preview.length}</div>
        )}
      </div>
    </div>
  );
}

function humanizeDuration(start: string, end: string): string {
  const dt = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  if (dt < 60) return `${Math.round(dt)}s`;
  if (dt < 3600) return `${Math.round(dt / 60)}m`;
  return `${(dt / 3600).toFixed(1)}h`;
}
function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// Styles
const page: React.CSSProperties = { padding: 20, background: '#0f172a', minHeight: '100vh', color: '#e2e8f0', fontFamily: 'Arial, sans-serif' };
const header: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 16, borderBottom: '2px solid #334', marginBottom: 16 };
const headerKicker: React.CSSProperties = { fontSize: 9, color: '#64748b', letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' };
const headerTitle: React.CSSProperties = { margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.2px' };
const headerSub: React.CSSProperties = { fontFamily: 'Courier New', fontSize: 10, color: '#94a3b8', marginTop: 6 };
const btnSecondary: React.CSSProperties = { padding: '8px 14px', background: 'transparent', color: '#94a3b8', border: '2px solid #334', textDecoration: 'none', fontFamily: 'Arial', fontSize: 10, fontWeight: 700, letterSpacing: 0.5 };
const statsRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 1, marginBottom: 12, background: '#334', border: '2px solid #334' };
const statCell: React.CSSProperties = { padding: 10, background: '#1e293b' };
const statLabel: React.CSSProperties = { fontSize: 8, color: '#64748b', letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' };
const statValue: React.CSSProperties = { fontFamily: 'Courier New', fontSize: 12, color: '#e2e8f0', fontWeight: 700, lineHeight: 1.4 };
const statMeta: React.CSSProperties = { fontSize: 9, color: '#64748b', marginTop: 3, fontFamily: 'Courier New' };
const pass2Banner: React.CSSProperties = { padding: 12, background: '#1e293b', border: '2px solid #334', borderLeft: '4px solid #6c8cff', marginBottom: 12, fontSize: 11 };
const explainer: React.CSSProperties = { padding: 12, background: '#1e293b', border: '2px solid #334', marginBottom: 12, fontSize: 11, color: '#94a3b8', lineHeight: 1.5 };
const codeInline: React.CSSProperties = { fontFamily: 'Courier New', background: '#0f172a', padding: '1px 4px', border: '1px solid #334', color: '#cbd5e1' };
const card: React.CSSProperties = { background: '#1e293b', border: '2px solid #334' };
const cardHead: React.CSSProperties = { padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334' };
const cardTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#e2e8f0' };
const cardMeta: React.CSSProperties = { fontFamily: 'Courier New', fontSize: 10, color: '#64748b', marginTop: 2 };
const cardStrip: React.CSSProperties = { display: 'flex', gap: 2, padding: 2, overflowX: 'auto' };
const cardThumb: React.CSSProperties = { width: 120, height: 90, objectFit: 'cover', display: 'block', flexShrink: 0 };
const cardMore: React.CSSProperties = { width: 120, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', border: '1px solid #334', fontFamily: 'Courier New', fontSize: 12, color: '#6c8cff', flexShrink: 0 };
const pendingPill: React.CSSProperties = { padding: '2px 8px', background: '#1e293b', border: '1px solid #334', fontFamily: 'Courier New', fontSize: 9, color: '#eab308', letterSpacing: 0.5, textTransform: 'uppercase' };
const mapLink: React.CSSProperties = { color: '#6c8cff', textDecoration: 'none' };
const errorBox: React.CSSProperties = { padding: 20, background: '#7f1d1d', border: '2px solid #991b1b', color: '#fecaca', fontFamily: 'Courier New', fontSize: 12, maxWidth: 700 };
const loading: React.CSSProperties = { padding: 20, color: '#64748b', fontFamily: 'Courier New', fontSize: 12 };
