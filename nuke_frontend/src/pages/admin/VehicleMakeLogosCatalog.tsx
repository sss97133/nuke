import React from 'react';

type MakeLogoItem = {
  label: string;
  alt_labels?: string[];
  status?: 'active' | 'defunct' | 'unknown' | string;
  start_year?: number | null;
  end_year?: number | null;
  start_decade?: string | null;
  country?: string | null;
  types?: string[];
  wikidata_id?: string | null;
  wikidata_url?: string | null;
  official_website?: string | null;
  commons_logo_filename?: string | null;
  commons_logo_file_page?: string | null;
  commons_logo_download_url?: string | null;
  logo_thumb_url?: string | null;
};

type MakeLogoPayload = {
  generated_at: string;
  thumb_width: number;
  count: number;
  items: MakeLogoItem[];
};

const PAGE_SIZE = 200;

function badgeStyle(kind: 'active' | 'defunct' | 'unknown') {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 8px',
    border: '1px solid var(--text)',
    fontSize: '9px',
    fontWeight: 700,
    background: 'var(--bg)'
  };
  if (kind === 'active') return { ...base, color: 'var(--success)', borderColor: 'var(--success)' };
  if (kind === 'defunct') return { ...base, color: 'var(--error)', borderColor: 'var(--error)' };
  return { ...base, color: 'var(--text-secondary)', borderColor: 'var(--text-secondary)' };
}

export default function VehicleMakeLogosCatalog() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [payload, setPayload] = React.useState<MakeLogoPayload | null>(null);

  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<'all' | 'active' | 'defunct' | 'unknown'>('all');
  const [hasLogo, setHasLogo] = React.useState(true);
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/admin_catalog/vehicle_make_logos.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as MakeLogoPayload;
        if (!cancelled) setPayload(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load catalog');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = React.useMemo(() => {
    const items = payload?.items || [];
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (hasLogo && !it.commons_logo_filename) return false;
      if (status !== 'all' && (it.status || 'unknown') !== status) return false;
      if (!q) return true;
      const label = (it.label || '').toLowerCase();
      const alts = (it.alt_labels || []).join(' ').toLowerCase();
      const country = (it.country || '').toLowerCase();
      const types = (it.types || []).join(' ').toLowerCase();
      return (
        label.includes(q) ||
        alts.includes(q) ||
        country.includes(q) ||
        types.includes(q) ||
        (it.wikidata_id || '').toLowerCase().includes(q)
      );
    });
  }, [payload, search, status, hasLogo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  React.useEffect(() => {
    setPage(1);
  }, [search, status, hasLogo]);

  const pageItems = React.useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  return (
    <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
      <div style={{ marginBottom: '16px', borderBottom: '2px solid var(--text)', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '19px', fontWeight: 700, textTransform: 'uppercase' }}>
              Vehicle Make Logos Catalog
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px' }}>
              Source: Wikidata + Wikimedia Commons • Generated: {payload?.generated_at || '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <a
              href="/admin_catalog/vehicle_make_logos.csv"
              style={{
                padding: '8px 10px',
                fontSize: '11px',
                fontWeight: 700,
                border: '2px solid var(--text)',
                background: 'var(--text)',
                color: 'var(--bg)',
                textDecoration: 'none'
              }}
            >
              Download CSV
            </a>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
          padding: '12px',
          background: 'var(--bg)',
          border: '2px solid var(--text)'
        }}
      >
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>SEARCH</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Make, alt label, country, type, QID…"
            style={{
              width: '100%',
              padding: '6px',
              fontSize: '11px',
              border: '1px solid var(--text)',
              fontFamily: 'inherit'
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>STATUS</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            style={{
              width: '100%',
              padding: '6px',
              fontSize: '11px',
              border: '1px solid var(--text)',
              fontFamily: 'inherit'
            }}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="defunct">Defunct</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, display: 'block', marginBottom: '4px' }}>LOGO</label>
          <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={hasLogo} onChange={(e) => setHasLogo(e.target.checked)} />
            Has logo (P154)
          </label>
          <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '6px' }}>
            Showing {filtered.length.toLocaleString()} / {(payload?.count || 0).toLocaleString()}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            onClick={() => {
              setSearch('');
              setStatus('all');
              setHasLogo(true);
            }}
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 700,
              border: '2px solid var(--text)',
              background: 'var(--surface)',
              cursor: 'pointer'
            }}
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', fontSize: '11px', color: 'var(--text-disabled)' }}>Loading...</div>
      ) : error ? (
        <div style={{ padding: '16px', border: '2px solid var(--error)', background: 'var(--bg)', color: 'var(--error)', fontSize: '11px' }}>
          Failed to load admin catalog: {error}
          <div style={{ marginTop: '8px', color: 'var(--text)' }}>
            Expected file: <code>/admin_catalog/vehicle_make_logos.json</code>
          </div>
        </div>
      ) : (
        <div style={{ background: 'var(--bg)', border: '2px solid var(--text)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)', borderBottom: '2px solid var(--text)' }}>
                <tr>
                  <th style={{ padding: '10px', textAlign: 'left', fontWeight: 700, width: '70px' }}>LOGO</th>
                  <th style={{ padding: '10px', textAlign: 'left', fontWeight: 700 }}>MAKE</th>
                  <th style={{ padding: '10px', textAlign: 'left', fontWeight: 700, width: '110px' }}>STATUS</th>
                  <th style={{ padding: '10px', textAlign: 'left', fontWeight: 700, width: '140px' }}>YEARS</th>
                  <th style={{ padding: '10px', textAlign: 'left', fontWeight: 700, width: '160px' }}>COUNTRY</th>
                  <th style={{ padding: '10px', textAlign: 'left', fontWeight: 700, minWidth: '240px' }}>TYPE</th>
                  <th style={{ padding: '10px', textAlign: 'left', fontWeight: 700, width: '200px' }}>LINKS</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((it, idx) => {
                  const s = (it.status as any) || 'unknown';
                  const years =
                    it.start_year || it.end_year
                      ? `${it.start_year || '—'}–${it.end_year || '—'}`
                      : it.start_decade || '—';
                  return (
                    <tr key={`${it.wikidata_id || it.label}-${idx}`} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px' }}>
                        {it.logo_thumb_url ? (
                          <a href={it.commons_logo_file_page || it.logo_thumb_url} target="_blank" rel="noreferrer">
                            <img
                              src={it.logo_thumb_url}
                              alt={`${it.label} logo`}
                              loading="lazy"
                              style={{ width: '48px', height: '48px', objectFit: 'contain', border: '1px solid var(--border)', background: 'var(--bg)' }}
                            />
                          </a>
                        ) : (
                          <div
                            style={{
                              width: '48px',
                              height: '48px',
                              border: '1px solid var(--border)',
                              background: 'var(--bg)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '9px',
                              color: 'var(--text-disabled)'
                            }}
                          >
                            —
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ fontWeight: 700 }}>{it.label}</div>
                        {it.alt_labels && it.alt_labels.length > 0 ? (
                          <div style={{ marginTop: '2px', fontSize: '9px', color: 'var(--text-secondary)' }}>
                            {it.alt_labels.slice(0, 3).join(' • ')}
                            {it.alt_labels.length > 3 ? ` • +${it.alt_labels.length - 3} more` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <span style={badgeStyle(s === 'active' ? 'active' : s === 'defunct' ? 'defunct' : 'unknown')}>
                          {String(s).toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '10px', fontFamily: "'Courier New', monospace" }}>{years}</td>
                      <td style={{ padding: '10px' }}>{it.country || '—'}</td>
                      <td style={{ padding: '10px', fontSize: '9px', color: 'var(--text)' }}>
                        {(it.types || []).slice(0, 3).join(' • ') || '—'}
                        {(it.types || []).length > 3 ? <span style={{ color: 'var(--text-secondary)' }}> • +{(it.types || []).length - 3} more</span> : null}
                      </td>
                      <td style={{ padding: '10px', fontSize: '9px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {it.wikidata_url ? (
                            <a href={it.wikidata_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                              Wikidata
                            </a>
                          ) : null}
                          {it.commons_logo_file_page ? (
                            <a href={it.commons_logo_file_page} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                              Commons
                            </a>
                          ) : null}
                          {it.official_website ? (
                            <a href={it.official_website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                              Website
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div
            style={{
              borderTop: '2px solid var(--text)',
              padding: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg)'
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={{
                padding: '8px 16px',
                fontSize: '11px',
                fontWeight: 700,
                border: '2px solid var(--text)',
                background: currentPage === 1 ? 'var(--text-disabled)' : 'var(--bg)',
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
              }}
            >
              ← PREV
            </button>
            <div style={{ fontSize: '11px' }}>
              Page {currentPage} of {totalPages} • Showing {pageItems.length} rows (of {filtered.length.toLocaleString()})
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              style={{
                padding: '8px 16px',
                fontSize: '11px',
                fontWeight: 700,
                border: '2px solid var(--text)',
                background: currentPage === totalPages ? 'var(--text-disabled)' : 'var(--bg)',
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
              }}
            >
              NEXT →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


