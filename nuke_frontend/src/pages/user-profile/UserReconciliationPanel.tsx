/**
 * UserReconciliationPanel — owner-only reconciliation of the user's own records.
 *
 * Substrate: get_user_reconciliation(p_user_id, p_section), computed live in the database
 * (migration 20260929050000). It returns rows only to the subject user or the service
 * role; anon has no EXECUTE. Every row carries its source and, where it has one, the time
 * that source was last written, so every number here says where it comes from.
 *
 * The three sections are fetched in parallel: on a cold cache each can take several
 * seconds (measured 8.0 s / 5.4 s / 0.9 s while the BaT loader runs), and as one call
 * they come close to the 15 s API limit. A section that fails is retried once; the
 * retry reads a warm cache.
 *
 * Self-guarding: visitors never fetch and never render (not even a heading); no rows =
 * no card.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

type Section = 'vehicles' | 'account' | 'books';

// One example record: a vehicle with a note, or (books / cars) one sold car's return inputs.
interface Example {
  vehicle_id?: string;
  vehicle?: string;
  rel?: string;
  note?: string;
  sold_usd?: number | null;
  sold_source?: string;
  hours?: number;
  purchase_usd?: number | null;
  return_per_hour?: number | null;
  blocked_on?: string | null;
}

interface ReconRow {
  section: Section;
  item: string;
  label: string;
  severity: 'error' | 'warn' | 'ok' | 'blocked' | 'unknown';
  n: number | null;
  of_n: number | null;
  source: string;
  as_of: string | null;
  note: string | null;
  examples: Example[] | null;
  ord: number;
}

interface Props {
  userId: string;
  isOwnProfile: boolean;
}

const SECTIONS: Section[] = ['vehicles', 'account', 'books'];

const fetchSection = async (userId: string, section: Section): Promise<ReconRow[]> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc('get_user_reconciliation', { p_user_id: userId, p_section: section });
    if (!error) return (data || []) as ReconRow[];
  }
  return [];
};

const fmtN = (n: number | null): string => (n == null ? 'unknown' : Number(n).toLocaleString('en-US'));
const fmtUsd = (v: unknown): string => (v == null || v === '' ? '—' : `$${Math.round(Number(v)).toLocaleString('en-US')}`);
const fmtWhen = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().slice(0, 16).replace('T', ' ')}Z`;
};

// A books step's as_of is worth showing when it says when its source was last written; skip it when the
// source line already carries that date, or when it is just the moment this page computed the row.
const showAsOf = (row: ReconRow): boolean => {
  if (row.section !== 'books' || !row.as_of) return false;
  if (row.source.includes(fmtWhen(row.as_of).slice(0, 10))) return false;
  return Date.now() - new Date(row.as_of).getTime() > 5 * 60 * 1000;
};

const LABEL: React.CSSProperties = { fontSize: '8px', letterSpacing: '0.1em', color: 'var(--up-data-dim)' };
const MONO: React.CSSProperties = { fontFamily: 'var(--up-font-mono)' };

const ExampleList: React.FC<{ examples: Example[] }> = ({ examples }) => (
  <div style={{ margin: '4px 0 6px 0' }}>
    {examples.map((e, i) => (
      <div key={`${e.vehicle_id || i}`} style={{ fontSize: '9px', marginBottom: '2px', display: 'flex', gap: '6px' }}>
        {e.vehicle_id ? (
          <Link to={`/vehicle/${e.vehicle_id}`} style={{ color: 'var(--up-ink)', flexShrink: 0 }}>
            {e.vehicle || e.vehicle_id.slice(0, 8)}
          </Link>
        ) : null}
        {e.rel ? <span style={{ color: 'var(--up-data-dim)', flexShrink: 0 }}>{e.rel}</span> : null}
        <span style={{ ...MONO, color: 'var(--up-data-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.note}</span>
      </div>
    ))}
  </div>
);

const CarTable: React.FC<{ cars: Example[] }> = ({ cars }) => (
  <div style={{ margin: '4px 0 6px 0', fontSize: '9px' }}>
    {cars.map((c) => (
      <div key={c.vehicle_id} style={{ display: 'flex', gap: '8px', marginBottom: '2px', alignItems: 'baseline' }}>
        <Link to={`/vehicle/${c.vehicle_id}`} style={{ color: 'var(--up-ink)', width: '38%', flexShrink: 0 }}>
          {c.vehicle}
        </Link>
        <span style={{ ...MONO, width: '18%' }} title={`sale from ${c.sold_source}`}>
          {String(c.sold_source || '').startsWith('http') ? (
            <a href={c.sold_source} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--up-ink)' }}>
              {fmtUsd(c.sold_usd)}
            </a>
          ) : (
            fmtUsd(c.sold_usd)
          )}
        </span>
        <span style={{ ...MONO, width: '14%' }}>{c.hours} h</span>
        <span style={{ ...MONO, color: 'var(--up-data-dim)' }}>
          {c.return_per_hour != null ? `${fmtUsd(c.return_per_hour)}/h` : c.blocked_on}
        </span>
      </div>
    ))}
    <div style={{ ...LABEL, marginTop: '4px' }}>
      SALE · DOCUMENTED HOURS (PHOTO BURSTS) · RETURN PER HOUR OR WHAT BLOCKS IT
    </div>
  </div>
);

const Row: React.FC<{ row: ReconRow; unit?: string; step?: number }> = ({ row, unit, step }) => {
  const [open, setOpen] = useState(false);
  const isCars = row.item === 'books / cars';
  const hasDetail = Boolean(row.note || (row.examples && row.examples.length));
  return (
    <div style={{ borderTop: '1px solid var(--up-ghost)', padding: '5px 0' }}>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          all: 'unset',
          cursor: hasDetail ? 'pointer' : 'default',
          display: 'flex',
          gap: '8px',
          alignItems: 'baseline',
          width: '100%',
        }}
      >
        {step != null && <span style={{ ...MONO, fontSize: '9px', width: '10px', flexShrink: 0 }}>{step}</span>}
        <span style={{ ...MONO, fontSize: '12px', fontWeight: 700, minWidth: '46px', textAlign: 'right', flexShrink: 0 }}>
          {fmtN(row.n)}
        </span>
        <span style={{ fontSize: '10px', flex: 1, minWidth: 0 }}>
          {row.label}
          {row.of_n != null && (
            <span style={{ ...MONO, color: 'var(--up-data-dim)', fontSize: '9px' }}>
              {' '}of {fmtN(row.of_n)}{unit ? ` ${unit}` : ''}
            </span>
          )}
        </span>
        <span
          style={{
            ...LABEL,
            flexShrink: 0,
            fontWeight: row.severity === 'error' || row.severity === 'blocked' ? 700 : 400,
            color: row.severity === 'error' || row.severity === 'blocked' ? 'var(--up-ink)' : 'var(--up-data-dim)',
          }}
        >
          {row.severity.toUpperCase()}
        </span>
      </button>
      <div style={{ ...LABEL, letterSpacing: '0.04em', marginLeft: step != null ? '72px' : '54px', marginTop: '1px' }}>
        {row.source}
        {showAsOf(row) ? ` · ${fmtWhen(row.as_of)}` : ''}
      </div>
      {open && (
        <div style={{ marginLeft: step != null ? '72px' : '54px' }}>
          {row.note && <div style={{ fontSize: '9px', margin: '3px 0' }}>{row.note}</div>}
          {row.examples && row.examples.length > 0 &&
            (isCars ? <CarTable cars={row.examples} /> : <ExampleList examples={row.examples} />)}
        </div>
      )}
    </div>
  );
};

const UserReconciliationPanel: React.FC<Props> = ({ userId, isOwnProfile }) => {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [computedAt, setComputedAt] = useState<string | null>(null);

  useEffect(() => {
    // Owner-only: never even fetch for visitors.
    if (!userId || !isOwnProfile) return;
    let cancelled = false;
    Promise.all(SECTIONS.map((s) => fetchSection(userId, s))).then((parts) => {
      if (cancelled) return;
      setRows(parts.flat());
      setComputedAt(new Date().toISOString());
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [userId, isOwnProfile]);

  const { breaks, clean, books } = useMemo(() => {
    const rank = (r: ReconRow) => (r.severity === 'error' ? 0 : 1);
    const b = rows
      .filter((r) => r.section !== 'books' && (r.n ?? 0) > 0)
      .sort((x, y) => rank(x) - rank(y) || x.ord - y.ord);
    const c = rows.filter((r) => r.section !== 'books' && r.n === 0);
    const k = rows.filter((r) => r.section === 'books').sort((x, y) => x.ord - y.ord);
    return { breaks: b, clean: c, books: k };
  }, [rows]);

  if (!isOwnProfile) return null;
  if (!loaded) return null;
  if (rows.length === 0) return null;

  const errors = breaks.filter((r) => r.severity === 'error').length;

  return (
    <div
      className="up-reconciliation"
      style={{
        border: '2px solid var(--up-ink)',
        padding: '12px',
        marginBottom: '8px',
        fontFamily: 'var(--up-font-sans)',
        color: 'var(--up-ink)',
        background: 'var(--up-surface)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: '6px',
          borderBottom: '1px solid var(--up-ink)',
        }}
      >
        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em' }}>RECONCILIATION</span>
        <span style={LABEL}>OWNER ONLY · COMPUTED {fmtWhen(computedAt)}</span>
      </div>

      {breaks.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ ...LABEL, marginBottom: '2px' }}>
            BREAKS · {errors} ERROR {errors === 1 ? 'CLASS' : 'CLASSES'} · {breaks.length - errors} WARNING{' '}
            {breaks.length - errors === 1 ? 'CLASS' : 'CLASSES'}
          </div>
          {breaks.map((r) => (
            <Row key={r.item} row={r} unit={r.section === 'vehicles' ? 'vehicles' : undefined} />
          ))}
          {clean.length > 0 && (
            <div style={{ ...LABEL, letterSpacing: '0.04em', borderTop: '1px solid var(--up-ghost)', paddingTop: '5px' }}>
              CLEAN: {clean.map((r) => r.label).join(' · ')}
            </div>
          )}
        </div>
      )}

      {books.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ ...LABEL, marginBottom: '2px' }}>BOOKS CHAIN · BANK FEEDS → QUICKBOOKS → NUKE → RECEIPTS → CARS</div>
          {books.map((r, i) => (
            <Row key={r.item} row={r} step={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default UserReconciliationPanel;
