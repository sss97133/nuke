/**
 * LocalVehicle.tsx — user-centric, local-first vehicle view.
 *
 * Reads the on-disk store written by scripts/local-vehicle-ingest.py:
 *   /local/registry.json                              — slug → id lookup
 *   /local/vehicles/<id>/profile.json                 — canonical vehicle doc
 *   /local/vehicles/<id>/photos/index.json            — photo array with EXIF
 *
 * Zero Supabase. Zero auth. Works when the DB is paused, when you're offline
 * in a garage, and when the wire agent has no network. Sync to the remote
 * DB happens separately (scripts/sync-local-to-remote.py), forward-only.
 *
 * Route: /my/:slug
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

type RegistryEntry = {
  id: string;
  slug: string;
  year: number;
  make: string;
  model: string;
  profile_path: string;
};

type Profile = {
  id: string;
  slug: string;
  year: number;
  make: string;
  model: string;
  nickname?: string;
  identity?: { drivetrain_factory?: string; drivetrain_current?: string };
  build?: Record<string, string>;
  harness?: Record<string, string>;
  sync?: { mode: string; supabase_status: string; last_push_to_remote: string | null };
};

type PhotoRecord = {
  id: string;
  filename: string;
  original_name: string;
  bytes: number;
  ingested_at: string;
  exif: {
    contentcreationdate?: string;
    latitude?: string;
    longitude?: string;
    pixelwidth?: string;
    pixelheight?: string;
    acquisitionmake?: string;
    acquisitionmodel?: string;
  };
};

type PhotosIndex = {
  vehicle_id: string;
  photos: PhotoRecord[];
  last_ingest_at: string | null;
  total_count: number;
};

type WeekRollup = {
  window_days: number;
  generated_at: string;
  totals: {
    photos: number;
    receipts: number;
    receipts_dollars: number;
    bank_txns: number;
    bank_debits_dollars: number;
    bank_credits_dollars: number;
    wiring_receipts: number;
    build_plan_changes: number;
    timeline_events: number;
  };
  receipts: Array<{ date: string; merchant: string; total: number; receipt_type: string; vehicle_hint: string | null; source_file: string; payment_method: string | null }>;
  bank_txns: Array<{ date: string; description: string; amount: number; account: string }>;
  wiring_receipts: Array<{ id: string; date: string; title: string; status: string; path: string }>;
  build_plan_changes: Array<{ file: string; mtime: string; size_bytes: number }>;
  timeline: Array<Record<string, any>>;
};

export default function LocalVehicle() {
  const { slug } = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photos, setPhotos] = useState<PhotosIndex | null>(null);
  const [week, setWeek] = useState<WeekRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoRecord | null>(null);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const reg = await fetch('/local/registry.json').then(r => r.json());
        const entry: RegistryEntry | undefined = reg.vehicles.find(
          (v: RegistryEntry) => v.slug === slug || v.id === slug
        );
        if (!entry) {
          setError(`no local vehicle with slug "${slug}" — add one under nuke_frontend/public/local/vehicles/<id>/profile.json and register it in registry.json`);
          return;
        }
        const [p, idx, wk] = await Promise.all([
          fetch(entry.profile_path).then(r => r.json()),
          fetch(`/local/vehicles/${entry.id}/photos/index.json`).then(r => r.ok ? r.json() : { photos: [], total_count: 0, last_ingest_at: null, vehicle_id: entry.id }),
          fetch(`/local/vehicles/${entry.id}/week.json`).then(r => r.ok ? r.json() : null),
        ]);
        setProfile(p);
        setPhotos(idx);
        setWeek(wk);
      } catch (e: any) {
        setError(`failed to load local store: ${e?.message || String(e)}`);
      }
    })();
  }, [slug]);

  if (error) {
    return (
      <div style={page}>
        <div style={errorBox}>{error}</div>
      </div>
    );
  }
  if (!profile) return <div style={page}><div style={loading}>loading local store…</div></div>;

  return (
    <div style={page}>
      {/* Header */}
      <div style={header}>
        <div>
          <div style={headerKicker}>LOCAL · {profile.sync?.supabase_status || 'unknown'}</div>
          <h1 style={headerTitle}>
            {profile.year} {profile.make} {profile.model}
            {profile.nickname && <span style={headerNickname}> · {profile.nickname}</span>}
          </h1>
          <div style={headerSub}>
            {profile.identity?.drivetrain_current || profile.identity?.drivetrain_factory}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link to={`/vehicle/${profile.id}/wiring`} style={btnPrimary}>WIRING PLAN →</Link>
          <Link to={`/vehicle/${profile.id}`} style={btnSecondary}>FULL PROFILE</Link>
        </div>
      </div>

      {/* Build stats */}
      {profile.build && (
        <div style={statsRow}>
          {Object.entries(profile.build).map(([k, v]) => (
            <div key={k} style={statCell}>
              <div style={statLabel}>{k.replace(/_/g, ' ').toUpperCase()}</div>
              <div style={statValue}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── WEEK OF WORK ──────────────────────────────────────────
          Aggregated from all local sources via scripts/local-week-rollup.py.
          Receipts, bank txns, wiring receipts, build-plan deltas, timeline. */}
      {week && (
        <div style={section}>
          <div style={sectionHeader}>
            <span>LAST {week.window_days} DAYS</span>
            <span style={sectionMeta}>
              rolled up {timeAgo(week.generated_at)} · re-run:
              {' '}<code style={codeInline}>python3 scripts/local-week-rollup.py --days {week.window_days}</code>
            </span>
          </div>

          {/* Top-line counters */}
          <div style={{ ...statsRow, marginBottom: 0, border: 'none', borderBottom: '2px solid #334' }}>
            <div style={statCell}>
              <div style={statLabel}>PHOTOS</div>
              <div style={statValue}>{week.totals.photos}</div>
            </div>
            <div style={statCell}>
              <div style={statLabel}>RECEIPTS</div>
              <div style={statValue}>{week.totals.receipts} · ${week.totals.receipts_dollars.toLocaleString()}</div>
            </div>
            <div style={statCell}>
              <div style={statLabel}>BANK TXNS</div>
              <div style={statValue}>
                {week.totals.bank_txns}
                {week.totals.bank_debits_dollars !== 0 && (
                  <> · <span style={{ color: '#ef4444' }}>-${Math.abs(week.totals.bank_debits_dollars).toLocaleString()}</span></>
                )}
              </div>
            </div>
            <div style={statCell}>
              <div style={statLabel}>WIRING RECEIPTS</div>
              <div style={statValue}>{week.totals.wiring_receipts}</div>
            </div>
            <div style={statCell}>
              <div style={statLabel}>BUILD-PLAN CHANGES</div>
              <div style={statValue}>{week.totals.build_plan_changes}</div>
            </div>
          </div>

          {/* Receipts list */}
          {week.receipts.length > 0 && (
            <div style={subsection}>
              <div style={subsectionTitle}>Receipts ({week.receipts.length})</div>
              <div style={tableWrap}>
                {week.receipts.map((r, i) => (
                  <div key={i} style={tableRow}>
                    <span style={tableDate}>{r.date}</span>
                    <span style={tableMain}>{r.merchant || '—'}</span>
                    <span style={tableMeta}>{r.receipt_type || ''}</span>
                    <span style={tableAmount}>${(r.total ?? 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Wiring receipts list */}
          {week.wiring_receipts.length > 0 && (
            <div style={subsection}>
              <div style={subsectionTitle}>Wiring Receipts ({week.wiring_receipts.length})</div>
              <div style={tableWrap}>
                {week.wiring_receipts.map((wr) => (
                  <div key={wr.id} style={tableRow}>
                    <span style={tableDate}>{wr.date}</span>
                    <span style={tableMain}>{wr.title}</span>
                    <span style={{ ...tableMeta, color: wr.status === 'executed' ? '#22c55e' : wr.status === 'validated' ? '#6c8cff' : '#eab308' }}>
                      {wr.status}
                    </span>
                    <span style={tableAmount}>
                      <a href={wr.path.replace(/^\/docs/, '/@docs')} style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 9 }}>
                        {wr.id}
                      </a>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Build-plan file changes */}
          {week.build_plan_changes.length > 0 && (
            <div style={subsection}>
              <div style={subsectionTitle}>Build-Plan Files Touched ({week.build_plan_changes.length})</div>
              <div style={tableWrap}>
                {week.build_plan_changes.map((c, i) => (
                  <div key={i} style={tableRow}>
                    <span style={tableDate}>{c.mtime.slice(0, 16).replace('T', ' ')}</span>
                    <span style={tableMain}>{c.file}</span>
                    <span style={tableMeta}></span>
                    <span style={tableAmount}>{(c.size_bytes / 1024).toFixed(1)} KB</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bank transactions */}
          {week.bank_txns.length > 0 && (
            <div style={subsection}>
              <div style={subsectionTitle}>Bank Transactions ({week.bank_txns.length})</div>
              <div style={tableWrap}>
                {week.bank_txns.slice(0, 20).map((t, i) => (
                  <div key={i} style={tableRow}>
                    <span style={tableDate}>{t.date}</span>
                    <span style={tableMain}>{t.description}</span>
                    <span style={tableMeta}>{t.account}</span>
                    <span style={{ ...tableAmount, color: t.amount < 0 ? '#ef4444' : '#22c55e' }}>
                      {t.amount < 0 ? '-' : '+'}${Math.abs(t.amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {week.totals.receipts === 0 && week.totals.bank_txns === 0 && week.totals.wiring_receipts === 0 && week.totals.build_plan_changes === 0 && (
            <div style={empty}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Nothing logged in the last {week.window_days} days.</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>
                Widen the window: <code style={codeInline}>python3 scripts/local-week-rollup.py --days 30</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Photo gallery */}
      <div style={section}>
        <div style={sectionHeader}>
          <span>PHOTOS</span>
          <span style={sectionMeta}>
            {photos?.total_count || 0} total
            {photos?.last_ingest_at && ` · last ingest ${timeAgo(photos.last_ingest_at)}`}
          </span>
        </div>

        {!photos || photos.total_count === 0 ? (
          <div style={empty}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>No photos yet.</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>
              Drop photos into <code style={codeInline}>local/inbox/{profile.slug}/</code><br />
              then run: <code style={codeInline}>python3 scripts/local-vehicle-ingest.py {profile.slug}</code>
            </div>
          </div>
        ) : (
          <div style={gallery}>
            {photos.photos.map(ph => (
              <div
                key={ph.id}
                style={thumb}
                onClick={() => setSelectedPhoto(ph)}
                title={ph.original_name}
              >
                <img
                  src={`/local/vehicles/${photos.vehicle_id}/photos/${ph.filename}`}
                  alt={ph.original_name}
                  loading="lazy"
                  style={thumbImg}
                />
                <div style={thumbDate}>{formatPhotoDate(ph)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Harness files shortcut */}
      {profile.harness && (
        <div style={section}>
          <div style={sectionHeader}>
            <span>HARNESS DELIVERABLES</span>
            <span style={sectionMeta}>ship-ready files served from /build-plan/</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
            {Object.entries(profile.harness).map(([k, v]) => (
              <a key={k} href={v} download style={fileLink}>
                <div style={fileLinkKind}>{v.split('.').pop()?.toUpperCase()}</div>
                <div style={fileLinkName}>{k.replace(/_/g, ' ')}</div>
                <div style={fileLinkPath}>{v}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {selectedPhoto && (
        <div style={lightbox} onClick={() => setSelectedPhoto(null)}>
          <img
            src={`/local/vehicles/${photos!.vehicle_id}/photos/${selectedPhoto.filename}`}
            alt={selectedPhoto.original_name}
            style={lightboxImg}
          />
          <div style={lightboxMeta} onClick={e => e.stopPropagation()}>
            <div><b>{selectedPhoto.original_name}</b></div>
            <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 4 }}>
              {formatPhotoDate(selectedPhoto)} · {selectedPhoto.exif.pixelwidth}×{selectedPhoto.exif.pixelheight}
              {selectedPhoto.exif.acquisitionmodel && ` · ${selectedPhoto.exif.acquisitionmodel}`}
              {selectedPhoto.exif.latitude && selectedPhoto.exif.longitude &&
                ` · ${parseFloat(selectedPhoto.exif.latitude).toFixed(4)}, ${parseFloat(selectedPhoto.exif.longitude).toFixed(4)}`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatPhotoDate(p: PhotoRecord): string {
  const s = p.exif.contentcreationdate;
  if (!s) return '—';
  return s.slice(0, 16).replace('T', ' ');
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// Styles — respects unified design system rules: Arial, Courier for mono,
// zero border-radius, zero shadows, 2px borders.
const page: React.CSSProperties = {
  padding: 20, background: '#0f172a', minHeight: '100vh', color: '#e2e8f0',
  fontFamily: 'Arial, sans-serif',
};
const header: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
  paddingBottom: 16, borderBottom: '2px solid #334', marginBottom: 16,
};
const headerKicker: React.CSSProperties = {
  fontSize: 9, color: '#64748b', letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase',
};
const headerTitle: React.CSSProperties = {
  margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.3px',
};
const headerNickname: React.CSSProperties = { color: '#64748b', fontWeight: 400 };
const headerSub: React.CSSProperties = {
  fontFamily: 'Courier New', fontSize: 11, color: '#94a3b8', marginTop: 6,
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 14px', background: '#6c8cff', color: '#0f172a',
  border: '2px solid #6c8cff', textDecoration: 'none',
  fontFamily: 'Arial', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 14px', background: 'transparent', color: '#94a3b8',
  border: '2px solid #334', textDecoration: 'none',
  fontFamily: 'Arial', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
};
const statsRow: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 1, marginBottom: 16, background: '#334', border: '2px solid #334',
};
const statCell: React.CSSProperties = {
  padding: '8px 10px', background: '#1e293b',
};
const statLabel: React.CSSProperties = {
  fontSize: 8, color: '#64748b', letterSpacing: 0.5, marginBottom: 4,
};
const statValue: React.CSSProperties = {
  fontFamily: 'Courier New', fontSize: 11, color: '#e2e8f0', fontWeight: 700,
};
const section: React.CSSProperties = {
  background: '#1e293b', border: '2px solid #334', marginBottom: 16,
};
const sectionHeader: React.CSSProperties = {
  padding: '8px 12px', background: '#0f172a',
  borderBottom: '2px solid #334',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
};
const sectionMeta: React.CSSProperties = {
  fontFamily: 'Courier New', color: '#64748b', fontSize: 10, fontWeight: 400,
};
const empty: React.CSSProperties = {
  padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12,
};
const codeInline: React.CSSProperties = {
  fontFamily: 'Courier New', background: '#0f172a', padding: '1px 4px',
  border: '1px solid #334', color: '#cbd5e1',
};
const gallery: React.CSSProperties = {
  padding: 12,
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8,
};
const thumb: React.CSSProperties = {
  cursor: 'pointer', background: '#0f172a', border: '1px solid #334',
  transition: 'border-color 0.12s',
};
const thumbImg: React.CSSProperties = {
  width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block',
};
const thumbDate: React.CSSProperties = {
  padding: '4px 6px', fontFamily: 'Courier New', fontSize: 9, color: '#64748b',
  borderTop: '1px solid #334',
};
const fileLink: React.CSSProperties = {
  display: 'block', padding: 10, background: '#0f172a', border: '1px solid #334',
  color: '#cbd5e1', textDecoration: 'none',
};
const fileLinkKind: React.CSSProperties = {
  fontSize: 8, color: '#6c8cff', letterSpacing: 0.5, fontWeight: 700, marginBottom: 4,
};
const fileLinkName: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3,
};
const fileLinkPath: React.CSSProperties = {
  fontFamily: 'Courier New', fontSize: 9, color: '#64748b', marginTop: 4,
};
const lightbox: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100, cursor: 'pointer',
};
const lightboxImg: React.CSSProperties = {
  maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain',
};
const lightboxMeta: React.CSSProperties = {
  position: 'absolute', bottom: 20, left: 20, right: 20,
  background: 'rgba(30,41,59,0.95)', border: '1px solid #334',
  padding: 10, fontFamily: 'Arial', fontSize: 11, color: '#e2e8f0',
  cursor: 'default',
};
const errorBox: React.CSSProperties = {
  padding: 20, background: '#7f1d1d', border: '2px solid #991b1b',
  color: '#fecaca', fontFamily: 'Courier New', fontSize: 12, maxWidth: 600,
};
const loading: React.CSSProperties = {
  padding: 20, color: '#64748b', fontFamily: 'Courier New', fontSize: 12,
};
const subsection: React.CSSProperties = {
  borderTop: '1px solid #334',
};
const subsectionTitle: React.CSSProperties = {
  padding: '6px 12px', background: '#0f172a',
  fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
  color: '#94a3b8', textTransform: 'uppercase',
  borderBottom: '1px solid #334',
};
const tableWrap: React.CSSProperties = {
  maxHeight: 280, overflowY: 'auto',
};
const tableRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr 100px 110px',
  gap: 8, padding: '4px 12px',
  borderBottom: '1px solid #1e293b',
  fontSize: 11, alignItems: 'center',
};
const tableDate: React.CSSProperties = {
  fontFamily: 'Courier New', fontSize: 10, color: '#64748b',
};
const tableMain: React.CSSProperties = {
  color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const tableMeta: React.CSSProperties = {
  fontFamily: 'Courier New', fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5,
};
const tableAmount: React.CSSProperties = {
  fontFamily: 'Courier New', fontSize: 11, color: '#e2e8f0', textAlign: 'right', fontWeight: 700,
};
