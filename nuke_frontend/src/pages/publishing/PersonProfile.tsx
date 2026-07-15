import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type {
  ProductionCredit,
  RoleSpectrum,
  ReliabilityFactors,
  GhostStatus,
} from '../../types/publishing';

/* ------------------------------------------------------------------ */
/*  Aggregated view of a single person across all production credits  */
/* ------------------------------------------------------------------ */

interface PersonData {
  name: string;
  credits: ProductionCredit[];
  publicationNames: Map<string, string>;
  primaryRole: string;
  publicationsCount: number;
  totalCredits: number;
  avgConfidence: number;
  roleSpectrum: RoleSpectrum | null;
  reliability: ReliabilityFactors | null;
  ghostStatus: GhostStatus | null;
  firstSeen: string | null;
  lastSeen: string | null;
  activeMonths: number | null;
  totalSent: number | null;
  totalReceived: number | null;
  imessageVolume: number | null;
}

const ANIMATION = '180ms cubic-bezier(0.16, 1, 0.3, 1)';

const CHART_COLORS = [
  'var(--chart-green, #4caf50)',
  'var(--chart-purple, #9c27b0)',
  'var(--chart-gold, #ff9800)',
  'var(--chart-teal, #009688)',
  'var(--chart-blue, #2196f3)',
  'var(--chart-red, #f44336)',
  'var(--chart-pink, #e91e63)',
  'var(--chart-indigo, #3f51b5)',
];

const GHOST_COLOR: Record<GhostStatus, string> = {
  active: 'var(--success, #4caf50)',
  cooling: 'var(--warning, #ff9800)',
  dormant: 'var(--text-disabled, #9e9e9e)',
  ghosted: 'var(--error, #f44336)',
  low_volume: 'var(--text-disabled, #9e9e9e)',
};

/* ---- inline styles ---- */

const s: Record<string, React.CSSProperties> = {
  container: { padding: '0 12px', maxWidth: '960px', margin: '0 auto' },
  backLink: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    textDecoration: 'none',
    display: 'inline-block',
    marginBottom: '8px',
  },
  headerName: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    fontWeight: 'bold',
    margin: 0,
    color: 'var(--text)',
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '6px',
    marginBottom: '16px',
  },
  badge: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    padding: '2px 6px',
    borderRadius: 0,
  },
  columns: { display: 'flex', gap: '16px' },
  left: { flex: '0 0 55%', minWidth: 0 },
  right: { flex: '0 0 45%', minWidth: 0 },

  /* widget shell */
  widget: {
    border: '2px solid var(--border)',
    borderRadius: 0,
    marginBottom: '12px',
  },
  widgetHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 8px',
    borderBottom: '1px solid var(--border)',
  },
  widgetLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    margin: 0,
  },
  widgetCount: {
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    color: 'var(--text-secondary)',
  },
  widgetBody: { padding: '8px' },
  sectionTitle: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    margin: '8px 0 4px',
  },

  /* bar chart rows */
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '3px',
  },
  barLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    width: '90px',
    flexShrink: 0,
  },
  barTrack: {
    flex: 1,
    height: '8px',
    background: 'var(--surface, #f5f5f5)',
    position: 'relative' as const,
    overflow: 'hidden',
    borderRadius: 0,
  },
  barValue: {
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    color: 'var(--text-secondary)',
    width: '36px',
    textAlign: 'right' as const,
    flexShrink: 0,
  },

  /* credit row */
  creditRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: '3px 0',
    borderBottom: '1px solid var(--border)',
  },
  creditLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    color: 'var(--text)',
  },
  creditMeta: {
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    color: 'var(--text-secondary)',
  },

  /* data line */
  dataLine: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 0',
  },
  dataLabel: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
  },
  dataValue: {
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    color: 'var(--text)',
  },

  reliabilityBig: {
    fontFamily: '"Courier New", monospace',
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'var(--text)',
    textAlign: 'center' as const,
    padding: '8px 0',
  },
  ghostBadge: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    padding: '2px 6px',
    display: 'inline-block',
    marginTop: '4px',
    borderRadius: 0,
  },
  localMsg: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-disabled, #9e9e9e)',
    textAlign: 'center' as const,
    padding: '12px 0',
  },

  /* loading skeleton */
  skeleton: {
    height: '10px',
    background: 'var(--border)',
    marginBottom: '6px',
    borderRadius: 0,
  },

  /* mobile */
  mobileStack: {},
};

/* ================================================================== */

export default function PersonProfile() {
  const { personId } = useParams<{ personId: string }>();
  const [data, setData] = useState<PersonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (personId) loadPerson(decodeURIComponent(personId));
  }, [personId]);

  async function loadPerson(name: string) {
    setLoading(true);
    try {
      // Fetch production credits for this person
      const { data: credits, error } = await supabase
        .from('nuke_production_credits')
        .select('*')
        .eq('person_name', name)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!credits || credits.length === 0) {
        setData(null);
        setLoading(false);
        return;
      }

      // Collect unique publication IDs and fetch names
      const pubIds = [...new Set(credits.map((c: ProductionCredit) => c.publication_id).filter(Boolean))] as string[];
      const pubNames = new Map<string, string>();
      if (pubIds.length > 0) {
        const { data: pubs } = await supabase
          .from('nuke_publications')
          .select('id, name')
          .in('id', pubIds);
        if (pubs) pubs.forEach((p: { id: string; name: string }) => pubNames.set(p.id, p.name));
      }

      // Try to load person-level data from nuke_publishing_people (may not exist yet)
      let roleSpectrum: RoleSpectrum | null = null;
      let reliability: ReliabilityFactors | null = null;
      let ghostStatus: GhostStatus | null = null;
      let firstSeen: string | null = null;
      let lastSeen: string | null = null;
      let activeMonths: number | null = null;
      let totalSent: number | null = null;
      let totalReceived: number | null = null;
      let imessageVolume: number | null = null;

      try {
        const { data: person } = await supabase
          .from('nuke_publishing_people')
          .select('*')
          .eq('name', name)
          .maybeSingle();
        if (person) {
          roleSpectrum = person.role_spectrum ?? null;
          reliability = person.reliability_factors ?? null;
          ghostStatus = person.ghost_status ?? null;
          firstSeen = person.first_seen ?? null;
          lastSeen = person.last_seen ?? null;
          activeMonths = person.active_months ?? null;
          totalSent = person.total_sent ?? null;
          totalReceived = person.total_received ?? null;
          imessageVolume = person.imessage_volume ?? null;
        }
      } catch {
        // Table may not exist yet
      }

      // Derive primary role (most frequent)
      const roleCounts = new Map<string, number>();
      credits.forEach((c: ProductionCredit) => {
        roleCounts.set(c.role, (roleCounts.get(c.role) || 0) + 1);
      });
      let primaryRole = '';
      let maxCount = 0;
      roleCounts.forEach((count, role) => {
        if (count > maxCount) { maxCount = count; primaryRole = role; }
      });

      const uniquePubs = new Set(credits.map((c: ProductionCredit) => c.publication_id).filter(Boolean));
      const totalConf = credits.reduce((sum: number, c: ProductionCredit) => sum + c.confidence, 0);

      setData({
        name,
        credits,
        publicationNames: pubNames,
        primaryRole,
        publicationsCount: uniquePubs.size,
        totalCredits: credits.length,
        avgConfidence: credits.length > 0 ? totalConf / credits.length : 0,
        roleSpectrum,
        reliability,
        ghostStatus,
        firstSeen,
        lastSeen,
        activeMonths,
        totalSent,
        totalReceived,
        imessageVolume,
      });
    } catch (err) {
      console.error('PersonProfile: load failed', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  /* ---------- render helpers ---------- */

  function Widget({
    label,
    count,
    children,
  }: {
    label: string;
    count?: number | string;
    children: React.ReactNode;
  }) {
    return (
      <div style={s.widget}>
        <div style={s.widgetHeader}>
          <span style={s.widgetLabel}>{label}</span>
          {count !== undefined && <span style={s.widgetCount}>{count}</span>}
        </div>
        <div style={s.widgetBody}>{children}</div>
      </div>
    );
  }

  function Bar({
    label,
    value,
    max,
    color,
    suffix,
  }: {
    label: string;
    value: number;
    max: number;
    color: string;
    suffix?: string;
  }) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
      <div style={s.barRow}>
        <span style={s.barLabel}>{label}</span>
        <div style={s.barTrack}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              background: color,
              transition: `width ${ANIMATION}`,
              borderRadius: 0,
            }}
          />
        </div>
        <span style={s.barValue}>
          {suffix ? `${value.toFixed(1)}${suffix}` : value.toFixed(1)}
        </span>
      </div>
    );
  }

  function LocalDataMessage() {
    return <div style={s.localMsg}>DATA AVAILABLE LOCALLY</div>;
  }

  /* ---------- role spectrum widget ---------- */

  function RoleSpectrumWidget() {
    const spectrum = data?.roleSpectrum;
    const hasCited = spectrum?.cited && spectrum.cited.length > 0;
    const hasObserved = spectrum?.observed && spectrum.observed.length > 0;
    const hasPlatform = spectrum?.platform && spectrum.platform.length > 0;
    const hasAny = hasCited || hasObserved || hasPlatform;

    return (
      <Widget label="ROLE SPECTRUM">
        {/* Cited roles */}
        <div style={s.sectionTitle}>CITED ROLES</div>
        {hasCited ? (
          spectrum!.cited.map((c, i) => (
            <div key={i} style={s.creditRow}>
              <span style={s.creditLabel}>{c.title}</span>
              <span style={s.creditMeta}>
                {c.source}
                {c.publication ? ` / ${c.publication}` : ''}
              </span>
            </div>
          ))
        ) : (
          <LocalDataMessage />
        )}

        {/* Observed roles */}
        <div style={{ ...s.sectionTitle, marginTop: '12px' }}>OBSERVED ROLES</div>
        {hasObserved ? (
          (() => {
            const maxW = Math.max(...spectrum!.observed.map((o) => o.weight));
            return spectrum!.observed.map((o, i) => (
              <Bar
                key={i}
                label={o.role}
                value={o.weight}
                max={maxW}
                color={CHART_COLORS[i % CHART_COLORS.length]}
                suffix="%"
              />
            ));
          })()
        ) : (
          <LocalDataMessage />
        )}

        {/* Platform roles */}
        <div style={{ ...s.sectionTitle, marginTop: '12px' }}>PLATFORM ROLES</div>
        {hasPlatform ? (
          spectrum!.platform.map((p, i) => (
            <div key={i} style={s.creditRow}>
              <span style={s.creditLabel}>{p.title}</span>
              <span style={s.creditMeta}>{p.context}</span>
            </div>
          ))
        ) : (
          <LocalDataMessage />
        )}
      </Widget>
    );
  }

  /* ---------- production credits widget ---------- */

  function ProductionCreditsWidget() {
    if (!data || data.credits.length === 0) return null;

    // Group by publication
    const grouped = new Map<string, ProductionCredit[]>();
    data.credits.forEach((c) => {
      const key = c.publication_id || '_none';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    });

    return (
      <Widget label="PRODUCTION CREDITS" count={data.credits.length}>
        {[...grouped.entries()].map(([pubId, credits]) => {
          const pubName = pubId === '_none' ? 'Unknown' : data.publicationNames.get(pubId) || pubId;
          return (
            <div key={pubId} style={{ marginBottom: '8px' }}>
              <div style={s.sectionTitle}>{pubName}</div>
              {credits.map((c) => {
                const dateRange = [c.start_date, c.end_date].filter(Boolean).join(' - ');
                return (
                  <div key={c.id} style={s.creditRow}>
                    <span style={s.creditLabel}>{c.role}</span>
                    <span style={s.creditMeta}>
                      {dateRange && `${dateRange} `}
                      {(c.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </Widget>
    );
  }

  /* ---------- reliability widget ---------- */

  function ReliabilityWidget() {
    const r = data?.reliability;
    if (!r) {
      return (
        <Widget label="RELIABILITY">
          <LocalDataMessage />
        </Widget>
      );
    }

    const factors: { label: string; value: number }[] = [
      { label: 'Responsiveness', value: r.responsiveness.score },
      { label: 'Consistency', value: r.consistency.score },
      { label: 'Follow-through', value: r.follow_through.score },
      { label: 'Ghost risk', value: 1 - r.ghost_risk.score },
      { label: 'Cross-channel', value: r.cross_channel.score },
      { label: 'Reciprocity', value: r.reciprocity.score },
    ];

    return (
      <Widget label="RELIABILITY">
        <div style={s.reliabilityBig}>{r.overall_reliability.toFixed(2)}</div>

        {factors.map((f, i) => (
          <Bar
            key={i}
            label={f.label}
            value={f.value}
            max={1}
            color={CHART_COLORS[i % CHART_COLORS.length]}
          />
        ))}

        {data?.ghostStatus && (
          <div style={{ textAlign: 'center', marginTop: '8px' }}>
            <span
              style={{
                ...s.ghostBadge,
                color: GHOST_COLOR[data.ghostStatus],
                border: `1px solid ${GHOST_COLOR[data.ghostStatus]}`,
              }}
            >
              {data.ghostStatus}
            </span>
          </div>
        )}
      </Widget>
    );
  }

  /* ---------- activity widget ---------- */

  function ActivityWidget() {
    const hasActivity =
      data?.firstSeen || data?.lastSeen || data?.activeMonths || data?.totalSent || data?.totalReceived;

    if (!hasActivity) {
      return (
        <Widget label="ACTIVITY">
          <LocalDataMessage />
        </Widget>
      );
    }

    return (
      <Widget label="ACTIVITY">
        {data!.firstSeen && (
          <div style={s.dataLine}>
            <span style={s.dataLabel}>FIRST SEEN</span>
            <span style={s.dataValue}>{data!.firstSeen}</span>
          </div>
        )}
        {data!.lastSeen && (
          <div style={s.dataLine}>
            <span style={s.dataLabel}>LAST SEEN</span>
            <span style={s.dataValue}>{data!.lastSeen}</span>
          </div>
        )}
        {data!.activeMonths != null && (
          <div style={s.dataLine}>
            <span style={s.dataLabel}>ACTIVE MONTHS</span>
            <span style={s.dataValue}>{data!.activeMonths}</span>
          </div>
        )}
        {(data!.totalSent != null || data!.totalReceived != null) && (
          <div style={s.dataLine}>
            <span style={s.dataLabel}>EMAIL VOLUME</span>
            <span style={s.dataValue}>
              {data!.totalSent ?? 0} sent / {data!.totalReceived ?? 0} received
            </span>
          </div>
        )}
        {data!.imessageVolume != null && (
          <div style={s.dataLine}>
            <span style={s.dataLabel}>IMESSAGE VOLUME</span>
            <span style={s.dataValue}>{data!.imessageVolume}</span>
          </div>
        )}
      </Widget>
    );
  }

  /* ---------- main render ---------- */

  if (loading) {
    return (
      <div style={s.container}>
        <div style={{ ...s.skeleton, width: '30%' }} />
        <div style={{ ...s.skeleton, width: '60%' }} />
        <div style={{ ...s.skeleton, width: '45%' }} />
      </div>
    );
  }

  if (!data) return null;

  const leftCol = (
    <div style={isMobile ? {} : s.left}>
      <RoleSpectrumWidget />
      <ProductionCreditsWidget />
    </div>
  );

  const rightCol = (
    <div style={isMobile ? {} : s.right}>
      <ReliabilityWidget />
      <ActivityWidget />
    </div>
  );

  return (
    <div style={s.container}>
      <Link to="/publishing/people" style={s.backLink}>
        BACK TO DIRECTORY
      </Link>

      {/* Header */}
      <h1 style={s.headerName}>{data.name}</h1>

      {/* Sub-header badges */}
      <div style={s.badgeRow}>
        <span style={s.badge}>{data.primaryRole || 'UNKNOWN ROLE'}</span>
        <span style={s.badge}>{data.publicationsCount} PUBLICATION{data.publicationsCount !== 1 ? 'S' : ''}</span>
        <span style={s.badge}>
          <span style={{ fontFamily: '"Courier New", monospace' }}>{data.totalCredits}</span> CREDITS
        </span>
        <span style={s.badge}>
          CONF{' '}
          <span style={{ fontFamily: '"Courier New", monospace' }}>
            {(data.avgConfidence * 100).toFixed(0)}%
          </span>
        </span>
        {data.reliability && (
          <span style={s.badge}>
            REL{' '}
            <span style={{ fontFamily: '"Courier New", monospace' }}>
              {data.reliability.overall_reliability.toFixed(2)}
            </span>
          </span>
        )}
        {data.ghostStatus && (
          <span
            style={{
              ...s.badge,
              color: GHOST_COLOR[data.ghostStatus],
              borderColor: GHOST_COLOR[data.ghostStatus],
            }}
          >
            {data.ghostStatus.toUpperCase()}
          </span>
        )}
      </div>

      {/* Two-column layout */}
      {isMobile ? (
        <>
          {leftCol}
          {rightCol}
        </>
      ) : (
        <div style={s.columns}>
          {leftCol}
          {rightCol}
        </div>
      )}
    </div>
  );
}
