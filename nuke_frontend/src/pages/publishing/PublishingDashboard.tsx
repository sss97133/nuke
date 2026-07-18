import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface PublicationSeries {
  publisher_slug: string;
  title: string;
  publication_type: string | null;
  issue_count: number;
  page_total: number;
  latest_date: string | null;
  earliest_date: string | null;
  cover_image_url: string | null;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '0 12px',
    maxWidth: '960px',
    margin: '0 auto',
  },
  header: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text)',
    margin: 0,
    padding: 'var(--space-3) 0',
  },
  statsBar: {
    display: 'flex',
    gap: 'var(--space-4)',
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '9px',
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-3)',
    borderBottom: '2px solid var(--border)',
    paddingBottom: 'var(--space-2)',
    flexWrap: 'wrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 'var(--space-3)',
  },
  card: {
    border: '2px solid var(--border)',
    borderRadius: 0,
    boxShadow: 'none',
    padding: 'var(--space-3)',
    background: 'var(--surface)',
    cursor: 'pointer',
    transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
  },
  cardName: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text)',
    margin: 0,
    marginBottom: 'var(--space-1)',
  },
  badge: {
    display: 'inline-block',
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    padding: '2px 6px',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    marginBottom: 'var(--space-2)',
  },
  statsRow: {
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '9px',
    color: 'var(--text-secondary)',
    display: 'flex',
    gap: 'var(--space-3)',
  },
  dateRow: {
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '9px',
    color: 'var(--text-disabled)',
    marginTop: 'var(--space-1)',
  },
  coverThumb: {
    width: '40px',
    height: '52px',
    objectFit: 'cover',
    border: '1px solid var(--border)',
    borderRadius: 0,
    float: 'right',
    marginLeft: 'var(--space-2)',
  },
  empty: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text-secondary)',
    padding: 'var(--space-6) 0',
    textAlign: 'center',
  },
  skeleton: {
    border: '2px solid var(--border)',
    borderRadius: 0,
    padding: 'var(--space-3)',
    background: 'var(--surface)',
  },
  skeletonLine: {
    height: '10px',
    background: 'var(--border)',
    marginBottom: 'var(--space-2)',
    borderRadius: 0,
  },
};

export default function PublishingDashboard() {
  const navigate = useNavigate();
  const [series, setSeries] = useState<PublicationSeries[]>([]);
  const [totalPubs, setTotalPubs] = useState(0);
  const [creditCount, setCreditCount] = useState(0);
  const [profCount, setProfCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Fetch all publications
      const { data: pubs } = await supabase
        .from('publications')
        .select('publisher_slug, title, publication_type, issue_number, page_count, publication_date, cover_image_url')
        .order('publisher_slug')
        .order('publication_date', { ascending: false });

      // Fetch credit stats
      const { data: credits } = await supabase
        .from('nuke_production_credits')
        .select('person_name');

      if (cancelled) return;

      const rows = pubs ?? [];
      setTotalPubs(rows.length);

      // Group by publisher_slug → series
      const grouped: Record<string, PublicationSeries> = {};
      for (const p of rows) {
        const slug = p.publisher_slug || 'unknown';
        if (!grouped[slug]) {
          grouped[slug] = {
            publisher_slug: slug,
            title: (p.title || slug).replace(/#\d+.*/, '').replace(/\s+$/, ''),
            publication_type: p.publication_type,
            issue_count: 0,
            page_total: 0,
            latest_date: null,
            earliest_date: null,
            cover_image_url: null,
          };
        }
        grouped[slug].issue_count++;
        grouped[slug].page_total += p.page_count || 0;
        if (!grouped[slug].cover_image_url && p.cover_image_url) {
          grouped[slug].cover_image_url = p.cover_image_url;
        }
        if (p.publication_date) {
          if (!grouped[slug].latest_date || p.publication_date > grouped[slug].latest_date) {
            grouped[slug].latest_date = p.publication_date;
          }
          if (!grouped[slug].earliest_date || p.publication_date < grouped[slug].earliest_date) {
            grouped[slug].earliest_date = p.publication_date;
          }
        }
      }

      const seriesList = Object.values(grouped).sort((a, b) => b.issue_count - a.issue_count);
      setSeries(seriesList);

      const creds = credits ?? [];
      setCreditCount(creds.length);
      setProfCount(new Set(creds.map((c: { person_name: string }) => c.person_name)).size);

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <h1 style={styles.header}>PUBLISHING</h1>
        <div style={styles.grid}>
          {[1,2,3,4].map(i => (
            <div key={i} style={styles.skeleton}>
              <div style={{ ...styles.skeletonLine, width: '60%' }} />
              <div style={{ ...styles.skeletonLine, width: '40%' }} />
              <div style={{ ...styles.skeletonLine, width: '80%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <div style={styles.container}>
        <h1 style={styles.header}>PUBLISHING</h1>
        <p style={styles.empty}>No publications found</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>PUBLISHING</h1>

      <div style={styles.statsBar}>
        <span>{series.length} SERIES</span>
        <span>{totalPubs} ISSUES</span>
        <span>{profCount} PROFESSIONALS</span>
        <span>{creditCount} CREDITS</span>
      </div>

      <div style={styles.grid} data-publishing-grid="">
        {series.map((s) => (
          <div
            key={s.publisher_slug}
            style={styles.card}
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/publishing/${s.publisher_slug}`)}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/publishing/${s.publisher_slug}`); }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'none';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
            }}
          >
            {s.cover_image_url && (
              <img src={s.cover_image_url} alt="" style={styles.coverThumb} />
            )}
            <div style={styles.cardName}>{s.title}</div>
            {s.publication_type && (
              <span style={styles.badge}>{s.publication_type}</span>
            )}
            <div style={styles.statsRow}>
              <span>{s.issue_count} issues</span>
              {s.page_total > 0 && <span>{s.page_total.toLocaleString()} pages</span>}
            </div>
            {s.earliest_date && (
              <div style={styles.dateRow}>
                {s.earliest_date?.slice(0, 4)} — {s.latest_date?.slice(0, 4) || 'present'}
              </div>
            )}
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 640px) {
          [data-publishing-grid] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
