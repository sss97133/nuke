import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { ProductionCredit } from '../../types/publishing';

/* ------------------------------------------------------------------ */
/*  Sortable directory of all publishing professionals                */
/* ------------------------------------------------------------------ */

interface PersonRow {
  name: string;
  primaryRole: string;
  publicationsCount: number;
  credits: number;
  avgConfidence: number;
}

type SortKey = 'name' | 'primaryRole' | 'publicationsCount' | 'credits' | 'avgConfidence';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;
const ANIMATION = '180ms cubic-bezier(0.16, 1, 0.3, 1)';

/* ---- inline styles ---- */

const s: Record<string, React.CSSProperties> = {
  container: { padding: '0 12px', maxWidth: '960px', margin: '0 auto' },
  header: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--text)',
    margin: '0 0 12px',
  },
  filterBar: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  input: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    border: '1px solid var(--border)',
    borderRadius: 0,
    padding: '4px 8px',
    background: 'var(--surface, #fff)',
    color: 'var(--text)',
    outline: 'none',
    minWidth: '160px',
  },
  select: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    border: '1px solid var(--border)',
    borderRadius: 0,
    padding: '4px 8px',
    background: 'var(--surface, #fff)',
    color: 'var(--text)',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontFamily: 'Arial, sans-serif',
  },
  th: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    textAlign: 'left' as const,
    padding: '6px 8px',
    borderBottom: '2px solid var(--border)',
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },
  td: {
    fontSize: '9px',
    padding: '5px 8px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
  },
  tdMono: {
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    padding: '5px 8px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text)',
  },
  nameLink: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    color: 'var(--text)',
    textDecoration: 'none',
  },
  roleBadge: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border)',
    padding: '1px 4px',
    borderRadius: 0,
    display: 'inline-block',
  },
  showMore: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 0,
    padding: '6px 16px',
    cursor: 'pointer',
    display: 'block',
    margin: '12px auto',
    transition: `background ${ANIMATION}`,
  },
  empty: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text-secondary)',
    textAlign: 'center' as const,
    padding: '24px 0',
  },
  skeleton: {
    height: '10px',
    background: 'var(--border)',
    marginBottom: '6px',
    borderRadius: 0,
  },
  arrow: {
    fontFamily: '"Courier New", monospace',
    fontSize: '8px',
    marginLeft: '3px',
  },
};

/* ================================================================== */

export default function PeopleDirectory() {
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    loadCredits();
  }, []);

  async function loadCredits() {
    setLoading(true);
    try {
      const { data: credits, error } = await supabase
        .from('nuke_production_credits')
        .select('person_name, role, publication_id, confidence')
        .order('person_name');

      if (error) throw error;
      if (!credits || credits.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Group by person
      const people = new Map<string, { roles: Map<string, number>; pubs: Set<string>; totalConf: number; count: number }>();
      credits.forEach((c: Pick<ProductionCredit, 'person_name' | 'role' | 'publication_id' | 'confidence'>) => {
        if (!people.has(c.person_name)) {
          people.set(c.person_name, { roles: new Map(), pubs: new Set(), totalConf: 0, count: 0 });
        }
        const p = people.get(c.person_name)!;
        p.roles.set(c.role, (p.roles.get(c.role) || 0) + 1);
        if (c.publication_id) p.pubs.add(c.publication_id);
        p.totalConf += c.confidence;
        p.count += 1;
      });

      const result: PersonRow[] = [];
      people.forEach((v, name) => {
        let primaryRole = '';
        let maxCount = 0;
        v.roles.forEach((count, role) => {
          if (count > maxCount) { maxCount = count; primaryRole = role; }
        });
        result.push({
          name,
          primaryRole,
          publicationsCount: v.pubs.size,
          credits: v.count,
          avgConfidence: v.count > 0 ? v.totalConf / v.count : 0,
        });
      });

      setRows(result);
    } catch (err) {
      console.error('PeopleDirectory: load failed', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  /* ---- derived data ---- */

  const allRoles = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.primaryRole));
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (roleFilter) {
      result = result.filter((r) => r.primaryRole === roleFilter);
    }
    return result;
  }, [rows, search, roleFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'primaryRole':
          cmp = a.primaryRole.localeCompare(b.primaryRole);
          break;
        case 'publicationsCount':
          cmp = a.publicationsCount - b.publicationsCount;
          break;
        case 'credits':
          cmp = a.credits - b.credits;
          break;
        case 'avgConfidence':
          cmp = a.avgConfidence - b.avgConfidence;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
    },
    [sortKey],
  );

  function SortArrow({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return <span style={s.arrow}>{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>;
  }

  /* ---------- render ---------- */

  if (loading) {
    return (
      <div style={s.container}>
        <div style={{ ...s.skeleton, width: '30%' }} />
        <div style={{ ...s.skeleton, width: '100%' }} />
        <div style={{ ...s.skeleton, width: '100%' }} />
        <div style={{ ...s.skeleton, width: '100%' }} />
      </div>
    );
  }

  if (rows.length === 0) return null;

  return (
    <div style={s.container}>
      <h1 style={s.header}>PEOPLE DIRECTORY</h1>

      {/* Filter bar */}
      <div style={s.filterBar}>
        <input
          type="text"
          placeholder="SEARCH NAME"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
          style={s.input}
        />
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}
          style={s.select}
        >
          <option value="">ALL ROLES</option>
          {allRoles.map((r) => (
            <option key={r} value={r}>
              {r.toUpperCase()}
            </option>
          ))}
        </select>
        <span
          style={{
            fontFamily: '"Courier New", monospace',
            fontSize: '9px',
            color: 'var(--text-secondary)',
            alignSelf: 'center',
          }}
        >
          {sorted.length} RESULT{sorted.length !== 1 ? 'S' : ''}
        </span>
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div style={s.empty}>NO MATCHING PEOPLE</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th} onClick={() => handleSort('name')}>
                NAME
                <SortArrow column="name" />
              </th>
              <th style={s.th} onClick={() => handleSort('primaryRole')}>
                ROLE
                <SortArrow column="primaryRole" />
              </th>
              {!isMobile && (
                <th style={s.th} onClick={() => handleSort('publicationsCount')}>
                  PUBLICATIONS
                  <SortArrow column="publicationsCount" />
                </th>
              )}
              <th style={s.th} onClick={() => handleSort('credits')}>
                CREDITS
                <SortArrow column="credits" />
              </th>
              {!isMobile && (
                <th style={s.th} onClick={() => handleSort('avgConfidence')}>
                  CONFIDENCE
                  <SortArrow column="avgConfidence" />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.name}
                onMouseEnter={() => setHoveredRow(row.name)}
                onMouseLeave={() => setHoveredRow(null)}
                style={{
                  background: hoveredRow === row.name ? 'var(--surface-hover, rgba(0,0,0,0.03))' : 'transparent',
                  transition: `background ${ANIMATION}`,
                  cursor: 'pointer',
                }}
              >
                <td style={s.td}>
                  <Link
                    to={`/publishing/people/${encodeURIComponent(row.name)}`}
                    style={s.nameLink}
                  >
                    {row.name}
                  </Link>
                </td>
                <td style={s.td}>
                  <span style={s.roleBadge}>{row.primaryRole}</span>
                </td>
                {!isMobile && <td style={s.tdMono}>{row.publicationsCount}</td>}
                <td style={s.tdMono}>{row.credits}</td>
                {!isMobile && <td style={s.tdMono}>{(row.avgConfidence * 100).toFixed(0)}%</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Show more */}
      {hasMore && (
        <button
          style={s.showMore}
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
        >
          SHOW MORE ({sorted.length - visibleCount} REMAINING)
        </button>
      )}
    </div>
  );
}
