/**
 * PublicationProfile
 *
 * Shows a publication SERIES (e.g., all L'Officiel St Barth issues).
 * Route: /publishing/:slug  where slug = publisher_slug
 *
 * The publications table uses publisher_slug for the series and each row is an issue.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface PubRow {
  id: string;
  publisher_slug: string;
  title: string;
  slug: string;
  publication_type: string | null;
  issue_number: string | null;
  page_count: number | null;
  publication_date: string | null;
  cover_image_url: string | null;
  language: string | null;
  metadata: Record<string, unknown>;
}

interface CreditRow {
  person_name: string;
  role: string;
  confidence: number;
}

interface FeatureRow {
  org_id: string | null;
  org_name_printed: string | null;
  printed_page: number | null;
  page: number | null;
  category: string | null;
  feature_kind: string | null;
}

interface FeatureOrg {
  name: string | null;
  slug: string | null;
}

const S: Record<string, React.CSSProperties> = {
  container: { padding: '0 12px', maxWidth: '960px', margin: '0 auto' },
  header: {
    fontFamily: 'Arial, sans-serif', fontSize: '11px', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text)',
    margin: 0, padding: 'var(--space-3) 0',
  },
  badgeBar: {
    display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: 'var(--space-3)',
    paddingBottom: 'var(--space-2)', borderBottom: '2px solid var(--border)',
  },
  badge: {
    fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '2px 6px', border: '1px solid var(--border)', color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  },
  columns: { display: 'grid', gridTemplateColumns: '55% 45%', gap: 'var(--space-3)' },
  widget: {
    border: '2px solid var(--border)', borderRadius: 0, boxShadow: 'none',
    marginBottom: 'var(--space-3)', background: 'var(--surface)',
  },
  widgetHeader: {
    minHeight: '32px', padding: '10px 16px', borderBottom: '1px solid var(--border)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  widgetLabel: {
    fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-secondary)',
  },
  widgetCount: {
    fontFamily: '"Courier New", Courier, monospace', fontSize: '7px', color: 'var(--text-disabled)',
  },
  widgetBody: { padding: '10px 16px 14px' },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '4px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer',
    transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
  },
  rowLabel: { fontFamily: 'Arial, sans-serif', fontSize: '9px', color: 'var(--text)' },
  rowMono: {
    fontFamily: '"Courier New", Courier, monospace', fontSize: '9px', color: 'var(--text-secondary)',
  },
  keyLabel: {
    fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-secondary)',
    marginBottom: '2px',
  },
  value: { fontFamily: 'Arial, sans-serif', fontSize: '9px', color: 'var(--text)', marginBottom: '8px' },
  coverImg: {
    width: '100%', maxHeight: '300px', objectFit: 'cover',
    border: '2px solid var(--border)', borderRadius: 0, marginBottom: 'var(--space-3)',
  },
  empty: {
    fontFamily: 'Arial, sans-serif', fontSize: '9px', color: 'var(--text-secondary)',
    textTransform: 'uppercase', letterSpacing: '0.04em', padding: 'var(--space-4)', textAlign: 'center',
  },
};

export default function PublicationProfile() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [issues, setIssues] = useState<PubRow[]>([]);
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [featureOrgs, setFeatureOrgs] = useState<Record<string, FeatureOrg>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    async function load() {
      setLoading(true);

      const pubRes = await supabase
        .from('publications')
        .select('*')
        .eq('publisher_slug', slug)
        .order('publication_date', { ascending: false });

      // Scope credits to this publication's rows (credits carry publication_id)
      const pubIds = (pubRes.data ?? []).map((p: { id: string }) => p.id);
      const credRes = pubIds.length > 0
        ? await supabase
            .from('nuke_production_credits')
            .select('person_name, role, confidence')
            .in('publication_id', pubIds)
        : { data: [] };

      // Advertiser graph (Guest Book) — the view may not exist yet; treat errors as empty
      let featRows: FeatureRow[] = [];
      const orgMap: Record<string, FeatureOrg> = {};
      if (pubIds.length > 0) {
        const featRes = await supabase
          .from('publication_features_public')
          .select('org_id, org_name_printed, printed_page, page, category, feature_kind')
          .in('publication_id', pubIds)
          .order('page', { ascending: true });
        if (!featRes.error && featRes.data) {
          featRows = featRes.data as FeatureRow[];
          const orgIds = Array.from(new Set(featRows.map(f => f.org_id).filter((x): x is string => !!x)));
          if (orgIds.length > 0) {
            const orgRes = await supabase
              .from('organizations')
              .select('id, name, slug')
              .in('id', orgIds);
            for (const o of (orgRes.data ?? []) as { id: string; name: string | null; slug: string | null }[]) {
              orgMap[o.id] = { name: o.name, slug: o.slug };
            }
          }
        }
      }

      if (cancelled) return;
      setIssues((pubRes.data ?? []) as PubRow[]);
      setCredits((credRes.data ?? []) as CreditRow[]);
      setFeatures(featRows);
      setFeatureOrgs(orgMap);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <div style={S.container}>
        <h1 style={S.header}>{slug?.replace(/_/g, ' ')}</h1>
        <p style={{ ...S.rowMono, padding: 'var(--space-4)' }}>Loading...</p>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div style={S.container}>
        <h1 style={S.header}>{slug}</h1>
        <p style={S.empty}>No issues found for this publication</p>
      </div>
    );
  }

  const seriesName = issues[0].title?.replace(/#\d+.*/, '').trim() || slug || '';
  const pubType = issues[0].publication_type;
  const language = issues[0].language;
  const totalPages = issues.reduce((s, i) => s + (i.page_count || 0), 0);
  const dates = issues.map(i => i.publication_date).filter(Boolean).sort();
  const latestCover = issues.find(i => i.cover_image_url)?.cover_image_url;

  // Aggregate contributors
  const contribMap = new Map<string, { name: string; role: string; count: number }>();
  for (const c of credits) {
    const key = c.person_name;
    const existing = contribMap.get(key);
    if (existing) { existing.count++; }
    else { contribMap.set(key, { name: c.person_name, role: c.role, count: 1 }); }
  }
  const topContribs = Array.from(contribMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Advertiser graph rows (paid placements only — editorial/menu/listing kinds excluded)
  const adRows = features.filter(f => f.feature_kind === 'ad');

  return (
    <div style={S.container}>
      <h1 style={S.header}>{seriesName}</h1>

      <div style={S.badgeBar}>
        {pubType && <span style={S.badge}>{pubType}</span>}
        {language && <span style={S.badge}>{language}</span>}
        <span style={S.badge}>{issues.length} ISSUES</span>
        {totalPages > 0 && <span style={S.badge}>{totalPages.toLocaleString()} PAGES</span>}
        {topContribs.length > 0 && <span style={S.badge}>{topContribs.length} PEOPLE</span>}
        {dates.length >= 2 && (
          <span style={S.badge}>{dates[0]?.slice(0, 4)} — {dates[dates.length - 1]?.slice(0, 4)}</span>
        )}
      </div>

      <div style={S.columns} data-pub-cols="">
        {/* LEFT COLUMN */}
        <div>
          {/* Issues */}
          <div style={S.widget}>
            <div style={S.widgetHeader}>
              <span style={S.widgetLabel}>ISSUES</span>
              <span style={S.widgetCount}>{issues.length}</span>
            </div>
            <div style={S.widgetBody}>
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  style={S.row}
                  onClick={() => navigate(`/publishing/${slug}/issue/${encodeURIComponent(issue.issue_number || issue.slug)}`)}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div>
                    <span style={{ fontFamily: '"Courier New", monospace', fontSize: '9px', fontWeight: 700 }}>
                      {issue.issue_number || issue.title}
                    </span>
                    {issue.publication_date && (
                      <span style={{ ...S.rowMono, marginLeft: '8px' }}>
                        {issue.publication_date.slice(0, 10)}
                      </span>
                    )}
                  </div>
                  {issue.page_count && (
                    <span style={S.rowMono}>{issue.page_count}p</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Contributors */}
          {topContribs.length > 0 && (
            <div style={S.widget}>
              <div style={S.widgetHeader}>
                <span style={S.widgetLabel}>TOP CONTRIBUTORS</span>
                <span style={S.widgetCount}>{topContribs.length}</span>
              </div>
              <div style={S.widgetBody}>
                {topContribs.map((c) => (
                  <div
                    key={c.name}
                    style={S.row}
                    onClick={() => navigate(`/publishing/people/${encodeURIComponent(c.name)}`)}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={S.rowLabel}>{c.name}</span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={S.badge}>{c.role}</span>
                      <span style={S.rowMono}>{c.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Advertisers (Guest Book advertiser graph) — only render when rows exist */}
          {adRows.length > 0 && (
            <div style={S.widget}>
              <div style={S.widgetHeader}>
                <span style={S.widgetLabel}>ADVERTISERS</span>
                <span style={S.widgetCount}>{adRows.length}</span>
              </div>
              <div style={S.widgetBody}>
                {adRows.map((f, i) => {
                  const linked = f.org_id ? featureOrgs[f.org_id] : undefined;
                  const clickable = !!f.org_id;
                  return (
                    <div
                      key={`${f.org_id ?? f.org_name_printed ?? 'row'}-${i}`}
                      style={{ ...S.row, cursor: clickable ? 'pointer' : 'default' }}
                      onClick={clickable ? () => navigate(`/org/${featureOrgs[f.org_id!]?.slug || f.org_id}`) : undefined}
                      onMouseEnter={clickable ? e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; } : undefined}
                      onMouseLeave={clickable ? e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; } : undefined}
                    >
                      <span style={S.rowLabel}>{linked?.name || f.org_name_printed || 'Unknown'}</span>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {f.category && <span style={S.badge}>{f.category}</span>}
                        {(f.printed_page ?? f.page) != null && (
                          <span style={S.rowMono}>p.{f.printed_page ?? f.page}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div>
          {/* Cover image */}
          {latestCover && (
            <img src={latestCover} alt={seriesName} style={S.coverImg} />
          )}

          {/* Publication info */}
          <div style={S.widget}>
            <div style={S.widgetHeader}>
              <span style={S.widgetLabel}>PUBLICATION INFO</span>
            </div>
            <div style={S.widgetBody}>
              <div style={S.keyLabel}>SERIES</div>
              <div style={S.value}>{seriesName}</div>
              {pubType && (<><div style={S.keyLabel}>TYPE</div><div style={S.value}>{pubType}</div></>)}
              {language && (<><div style={S.keyLabel}>LANGUAGE</div><div style={S.value}>{language}</div></>)}
              <div style={S.keyLabel}>TOTAL ISSUES</div>
              <div style={{ ...S.value, fontFamily: '"Courier New", monospace' }}>{issues.length}</div>
              {totalPages > 0 && (
                <><div style={S.keyLabel}>TOTAL PAGES</div>
                <div style={{ ...S.value, fontFamily: '"Courier New", monospace' }}>{totalPages.toLocaleString()}</div></>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          [data-pub-cols] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
