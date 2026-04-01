/**
 * QUESTION INTELLIGENCE DASHBOARD
 *
 * "What Do Buyers Actually Want To Know?"
 *
 * Visualizes 1.65M classified auction comment questions across a 2-level
 * taxonomy (7 L1 categories, 48 L2 subcategories). Data from:
 * - mv_question_intelligence (materialized view)
 * - question_taxonomy (reference table)
 * - auction_comments (live classification progress)
 *
 * Powered by recharts. Follows InventoryAnalytics.tsx pattern.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import QIBreadcrumb from './qi/QIBreadcrumb';
import QIL1Detail from './qi/QIL1Detail';
import QICategoryDetail from './qi/QICategoryDetail';
import QIFieldDetail from './qi/QIFieldDetail';
import QIAuthorDetail from './qi/QIAuthorDetail';
import QIMakeFilter from './qi/QIMakeFilter';

// ─── Chart Colors (design system chart palette) ─────────────────────────
// Mapped to L1 categories for consistency across all charts
const L1_COLORS: Record<string, string> = {
  mechanical:      '#7d6b91', // --chart-purple
  provenance:      '#6b9d7d', // --chart-green
  condition:       '#9d8b6b', // --chart-gold
  functionality:   '#6b8b9d', // --chart-teal
  logistics:       '#8b6b7d', // --chart-mauve
  auction_process: '#7d9d6b', // --chart-lime
  general:         '#9d6b6b', // --chart-rose
};

const INTENT_COLORS: Record<string, string> = {
  information_request: '#6b8b9d',
  evidence_request:    '#7d6b91',
  clarification:       '#9d8b6b',
  challenge:           '#9d6b6b',
  logistics:           '#8b6b7d',
  negotiation:         '#7d9d6b',
};

// ─── Types ──────────────────────────────────────────────────────────────

interface TaxonomyRow {
  taxonomy_id: string;
  l1_category: string;
  l2_subcategory: string;
  display_name: string;
  answerable_from_db: boolean;
  data_fields: string[] | null;
  question_count: number;
  vehicle_count: number;
  avg_sale_price: number;
  median_sale_price: number;
  pct_of_all_questions: number;
  seller_response_pct: number;
  regex_classified: number;
  llm_classified: number;
}

interface ProgressData {
  total_questions: number;
  classified: number;
  has_l1: number;
  pct_done: number;
}

// ─── Formatting ─────────────────────────────────────────────────────────

const fmt = (n: number) => n?.toLocaleString() ?? '—';
const fmtK = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
};
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ─── Stat Card ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      border: '2px solid var(--border)',
      background: 'var(--surface)',
      padding: '12px',
    }}>
      <div style={{
        fontSize: 'var(--fs-8)',
        fontFamily: 'Arial, sans-serif',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--text-secondary)',
        marginBottom: '4px',
      }}>{label}</div>
      <div style={{
        fontSize: 'var(--fs-11)',
        fontFamily: "'Courier New', monospace",
        fontWeight: 700,
        color: 'var(--text)',
      }}>{value}</div>
      {sub && <div style={{
        fontSize: 'var(--fs-8)',
        fontFamily: "'Courier New', monospace",
        color: 'var(--text-secondary)',
        marginTop: '2px',
      }}>{sub}</div>}
    </div>
  );
}

// ─── Section Header ─────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginTop: '24px', marginBottom: '12px' }}>
      <div style={{
        fontSize: 'var(--fs-11)',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 700,
        color: 'var(--text)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>{title}</div>
      {sub && <div style={{
        fontSize: 'var(--fs-9)',
        color: 'var(--text-secondary)',
        marginTop: '2px',
      }}>{sub}</div>}
    </div>
  );
}

// ─── CSS Treemap ────────────────────────────────────────────────────────

function CSSTreemap({ rows, onTileClick }: { rows: TaxonomyRow[]; onTileClick?: (l2: string) => void }) {
  const total = rows.reduce((s, r) => s + r.question_count, 0);
  if (total === 0) return null;

  // Group by L1, sort by total desc
  const byL1 = new Map<string, TaxonomyRow[]>();
  for (const r of rows) {
    const arr = byL1.get(r.l1_category) || [];
    arr.push(r);
    byL1.set(r.l1_category, arr);
  }
  const l1Sorted = [...byL1.entries()]
    .map(([l1, items]) => ({ l1, items: items.sort((a, b) => b.question_count - a.question_count), total: items.reduce((s, r) => s + r.question_count, 0) }))
    .sort((a, b) => b.total - a.total);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', minHeight: '280px' }}>
      {l1Sorted.map(({ l1, items, total: l1Total }) => {
        const l1Pct = (l1Total / total) * 100;
        const color = L1_COLORS[l1] || '#6b7d9d';
        return (
          <div key={l1} style={{ flex: `${l1Pct} 0 0`, minWidth: '50px', display: 'flex', flexWrap: 'wrap', gap: '1px', alignContent: 'flex-start' }}>
            {items.map(r => {
              const itemPct = (r.question_count / l1Total) * 100;
              return (
                <div
                  key={r.taxonomy_id}
                  title={`${r.display_name}\n${fmt(r.question_count)} questions (${r.pct_of_all_questions}%)\n${r.answerable_from_db ? 'Answerable from DB' : 'DATA GAP — not in DB'}`}
                  onClick={() => onTileClick?.(r.l2_subcategory)}
                  style={{
                    flex: `${itemPct} 0 0`,
                    minWidth: '36px',
                    minHeight: `${Math.max(26, Math.min(70, itemPct * 1.2))}px`,
                    background: color,
                    opacity: r.answerable_from_db ? 1.0 : 0.4,
                    padding: '3px 5px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 'var(--fs-8)', fontFamily: 'Arial, sans-serif', fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '1.2' }}>
                    {r.display_name}
                  </div>
                  <div style={{ fontSize: 'var(--fs-8)', fontFamily: "'Courier New', monospace", color: 'rgba(255,255,255,0.8)' }}>
                    {fmtK(r.question_count)}{!r.answerable_from_db && ' GAP'}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Gap Analysis Bar ───────────────────────────────────────────────────

function GapBar({ row, onClick }: { row: TaxonomyRow; onClick?: () => void }) {
  const maxWidth = 200;
  const barWidth = Math.max(2, (row.pct_of_all_questions / 30) * maxWidth);

  return (
    <div onClick={onClick} style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 0',
      borderBottom: '2px solid var(--border)',
      cursor: onClick ? 'pointer' : 'default',
    }}>
      <div style={{
        width: '180px',
        fontSize: 'var(--fs-9)',
        fontFamily: 'Arial, sans-serif',
        color: 'var(--text)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{row.display_name}</div>
      <div style={{ width: `${maxWidth}px`, position: 'relative', height: '14px' }}>
        <div style={{
          width: `${barWidth}px`,
          height: '100%',
          background: row.answerable_from_db ? L1_COLORS[row.l1_category] || '#6b8b9d' : '#9d6b6b',
          opacity: row.answerable_from_db ? 1.0 : 0.5,
        }} />
      </div>
      <div style={{
        width: '50px',
        fontSize: 'var(--fs-8)',
        fontFamily: "'Courier New', monospace",
        color: 'var(--text-secondary)',
        textAlign: 'right',
      }}>{fmtK(row.question_count)}</div>
      <div style={{
        width: '45px',
        fontSize: 'var(--fs-8)',
        fontFamily: "'Courier New', monospace",
        color: row.answerable_from_db ? 'var(--success)' : 'var(--error)',
        textAlign: 'center',
      }}>{row.answerable_from_db ? 'DB' : 'GAP'}</div>
      <div style={{
        width: '50px',
        fontSize: 'var(--fs-8)',
        fontFamily: "'Courier New', monospace",
        color: 'var(--text-secondary)',
        textAlign: 'right',
      }}>{fmtK(row.vehicle_count)} veh</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function QuestionIntelligence() {
  const [params, setParams] = useSearchParams();
  const drillL1 = params.get('l1');
  const drillL2 = params.get('l2');
  const drillField = params.get('field');
  const drillAuthor = params.get('author');
  const filterMake = params.get('make');
  const isDrilled = !!(drillL1 || drillL2 || drillField || drillAuthor);

  const [rows, setRows] = useState<TaxonomyRow[]>([]);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      let qiData: any[] | null = null;
      let qiErr: any = null;

      if (filterMake) {
        // Per-make data from pre-aggregated materialized view
        const res = await supabase.rpc('question_profile_fast', { p_make: filterMake, p_limit: 100 });
        qiErr = res.error;
        // Map to TaxonomyRow shape
        qiData = (res.data || []).map((r: any) => ({
          taxonomy_id: `${r.l1_category}.${r.l2_subcategory}`,
          l1_category: r.l1_category,
          l2_subcategory: r.l2_subcategory,
          display_name: r.display_name || `${r.l1_category}.${r.l2_subcategory}`,
          answerable_from_db: r.answerable_from_db,
          data_fields: null,
          question_count: Number(r.question_count),
          vehicle_count: Number(r.vehicle_count),
          avg_sale_price: 0,
          median_sale_price: 0,
          pct_of_all_questions: Number(r.pct_of_filtered),
          seller_response_pct: 0,
          regex_classified: 0,
          llm_classified: 0,
        }));
      } else {
        // Global data from materialized view
        const res = await supabase
          .from('mv_question_intelligence')
          .select('*')
          .order('question_count', { ascending: false });
        qiErr = res.error;
        qiData = res.data;
      }

      if (qiErr) throw new Error(qiErr.message);
      setRows(qiData || []);

      // Load progress (how far through classification)
      const { data: progressData } = await supabase.rpc('execute_sql', {
        query: `SELECT
          (SELECT count(*) FROM auction_comments WHERE question_classified_at IS NOT NULL) as classified,
          (SELECT count(*) FROM auction_comments WHERE question_primary_l1 IS NOT NULL) as has_l1`
      });

      if (progressData?.[0]) {
        const classified = Number(progressData[0].classified);
        const has_l1 = Number(progressData[0].has_l1);
        setProgress({
          total_questions: 1653943, // Known from initial count
          classified,
          has_l1,
          pct_done: Math.round(classified / 1653943 * 1000) / 10,
        });
      }

      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterMake]);

  useEffect(() => {
    setLoading(true);
    loadData();
    // Only auto-refresh on overview — not when drilled into detail views
    if (!isDrilled) {
      const interval = setInterval(loadData, 30000);
      return () => clearInterval(interval);
    }
  }, [loadData, isDrilled]);

  if (loading) {
    return <div style={{ padding: '24px 12px', color: 'var(--text-secondary)', fontSize: 'var(--fs-10)' }}>Loading question intelligence...</div>;
  }

  // ─── Derived data ──────────────────────────────────────────────────

  // L1 aggregation for pie chart
  const l1Agg = Object.entries(
    rows.reduce<Record<string, { count: number; answerable: number; vehicles: number }>>((acc, r) => {
      if (!acc[r.l1_category]) acc[r.l1_category] = { count: 0, answerable: 0, vehicles: 0 };
      acc[r.l1_category].count += r.question_count;
      if (r.answerable_from_db) acc[r.l1_category].answerable += r.question_count;
      acc[r.l1_category].vehicles += r.vehicle_count;
      return acc;
    }, {})
  ).map(([name, d]) => ({
    name: name.replace(/_/g, ' '),
    value: d.count,
    answerable: d.answerable,
    vehicles: d.vehicles,
    key: name,
  })).sort((a, b) => b.value - a.value);

  // Answerable vs not
  const totalQuestions = rows.reduce((s, r) => s + r.question_count, 0);
  const answerableQuestions = rows.filter(r => r.answerable_from_db).reduce((s, r) => s + r.question_count, 0);
  const gapQuestions = totalQuestions - answerableQuestions;

  // Top gaps (high count, not answerable)
  const topGaps = rows
    .filter(r => !r.answerable_from_db)
    .sort((a, b) => b.question_count - a.question_count)
    .slice(0, 10);

  // Top answerable (high count, answerable — these are extraction priorities)
  const topAnswerable = rows
    .filter(r => r.answerable_from_db)
    .sort((a, b) => b.question_count - a.question_count)
    .slice(0, 15);

  return (
    <div style={{ padding: '0 12px', maxWidth: '1200px' }}>
      {/* Header */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          fontSize: 'var(--fs-11)',
          fontFamily: 'Arial, sans-serif',
          fontWeight: 700,
          color: 'var(--text)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}>Question Intelligence</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
          <span style={{
            fontSize: 'var(--fs-9)',
            color: 'var(--text-secondary)',
          }}>{filterMake
              ? `${filterMake} buyers — ${rows.length} categories, ${fmtK(rows.reduce((s, r) => s + r.question_count, 0))} questions`
              : `What do buyers actually want to know? — ${rows.length} categories from 1.65M questions`
            }</span>
          <QIMakeFilter />
        </div>
      </div>

      {error && (
        <div style={{
          border: '2px solid var(--error)',
          padding: '8px 12px',
          marginBottom: '12px',
          fontSize: 'var(--fs-9)',
          color: 'var(--error)',
        }}>{error}</div>
      )}

      {/* Progress bar */}
      {progress && progress.pct_done < 100 && (
        <div style={{
          border: '2px solid var(--border)',
          padding: '8px 12px',
          marginBottom: '16px',
          background: 'var(--surface)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: 'var(--fs-8)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Classification Progress
            </span>
            <span style={{ fontSize: 'var(--fs-8)', fontFamily: "'Courier New', monospace", color: 'var(--text)' }}>
              {fmtK(progress.classified)} / {fmtK(progress.total_questions)} ({fmtPct(progress.pct_done)})
            </span>
          </div>
          <div style={{ height: '4px', background: 'var(--border)', width: '100%' }}>
            <div style={{
              height: '100%',
              width: `${progress.pct_done}%`,
              background: 'var(--text)',
              transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            }} />
          </div>
        </div>
      )}

      {/* Breadcrumb — shown when drilled in */}
      {isDrilled && <QIBreadcrumb />}

      {/* ─── Drill-Down Views ─── */}
      {drillAuthor && (
        <QIAuthorDetail author={drillAuthor} />
      )}
      {drillField && !drillAuthor && (
        <QIFieldDetail field={drillField} allRows={rows} />
      )}
      {drillL2 && !drillField && !drillAuthor && (
        <QICategoryDetail
          l2={drillL2}
          taxonomyRow={rows.find(r => r.l2_subcategory === drillL2) || null}
        />
      )}
      {drillL1 && !drillL2 && !drillField && !drillAuthor && (
        <QIL1Detail l1={drillL1} allRows={rows} />
      )}

      {/* ─── Overview (hidden when drilled in) ─── */}
      {!isDrilled && <>

      {/* Stat cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '8px',
        marginBottom: '16px',
      }}>
        <StatCard label="Total Classified" value={fmtK(totalQuestions)} sub={`${rows.length} categories`} />
        <StatCard label="Answerable" value={fmtPct(totalQuestions > 0 ? answerableQuestions / totalQuestions * 100 : 0)} sub={`${fmtK(answerableQuestions)} questions`} />
        <StatCard label="Data Gaps" value={fmtK(gapQuestions)} sub="not answerable from DB" />
        <StatCard label="L1 Categories" value={l1Agg.length} sub={`${rows.length} L2 subcategories`} />
        <StatCard
          label="Top Category"
          value={l1Agg[0]?.name || '—'}
          sub={l1Agg[0] ? `${fmtK(l1Agg[0].value)} questions` : undefined}
        />
      </div>

      {/* Treemap */}
      {rows.length > 0 && (
        <>
          <SectionHeader title="Question Taxonomy" sub="Size = frequency. Solid = answerable from DB. Faded = data gap." />
          <div style={{
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            padding: '8px',
          }}>
            <CSSTreemap rows={rows} onTileClick={(l2) => setParams({ l2 })} />
            {/* Legend */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              marginTop: '8px',
              padding: '4px 0',
            }}>
              {Object.entries(L1_COLORS).map(([key, color]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ width: '10px', height: '10px', background: color }} />
                  <span style={{
                    fontSize: 'var(--fs-8)',
                    fontFamily: 'Arial, sans-serif',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                  }}>{key.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* L1 Distribution */}
      {l1Agg.length > 0 && (
        <>
          <SectionHeader title="By Category" sub="L1 distribution — what broad areas do buyers ask about?" />
          <div style={{
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            padding: '8px',
          }}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={l1Agg} layout="vertical" margin={{ left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tickFormatter={fmtK} style={{ fontSize: '8px', fontFamily: "'Courier New'" }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  style={{ fontSize: '9px', fontFamily: 'Arial' }}
                  width={95}
                />
                <Tooltip
                  formatter={(v: number) => [fmt(v), 'questions']}
                  contentStyle={{ background: 'var(--surface)', border: '2px solid var(--border)', fontSize: '9px' }}
                />
                <Bar dataKey="value" name="Questions" cursor="pointer" onClick={(_data: any, index: number) => { const entry = l1Agg[index]; if (entry) setParams({ l1: entry.key }); }}>
                  {l1Agg.map(entry => (
                    <Cell key={entry.name} fill={L1_COLORS[entry.key] || '#6b7d9d'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Two-column: Top Answerable + Top Gaps */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        marginTop: '4px',
      }}>
        {/* Extraction Priorities */}
        <div>
          <SectionHeader title="Extraction Priorities" sub="Most asked — answerable from DB. Fill these fields first." />
          <div style={{
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            padding: '8px',
          }}>
            {topAnswerable.map(r => <GapBar key={r.taxonomy_id} row={r} onClick={() => setParams({ l2: r.l2_subcategory })} />)}
          </div>
        </div>

        {/* Data Gaps */}
        <div>
          <SectionHeader title="Data Gaps" sub="Most asked — NOT answerable from DB. Research or new data needed." />
          <div style={{
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            padding: '8px',
          }}>
            {topGaps.length > 0
              ? topGaps.map(r => <GapBar key={r.taxonomy_id} row={r} onClick={() => setParams({ l2: r.l2_subcategory })} />)
              : <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-disabled)', padding: '8px' }}>No gap categories yet</div>
            }
          </div>
        </div>
      </div>

      {/* Full table */}
      <SectionHeader title="All Categories" sub="Complete taxonomy with counts and answerability" />
      <div style={{
        border: '2px solid var(--border)',
        background: 'var(--surface)',
        overflowX: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-9)' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              {['Category', 'Questions', 'Vehicles', '% of Total', 'Avg Price', 'Answerable', 'Method'].map(h => (
                <th key={h} style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  fontSize: 'var(--fs-8)',
                  fontFamily: 'Arial, sans-serif',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.taxonomy_id} onClick={() => setParams({ l2: r.l2_subcategory })} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                <td style={{ padding: '4px 8px' }}>
                  <span style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    background: L1_COLORS[r.l1_category] || '#6b7d9d',
                    marginRight: '6px',
                    verticalAlign: 'middle',
                  }} />
                  {r.display_name}
                </td>
                <td style={{ padding: '4px 8px', fontFamily: "'Courier New', monospace" }}>{fmt(r.question_count)}</td>
                <td style={{ padding: '4px 8px', fontFamily: "'Courier New', monospace" }}>{fmt(r.vehicle_count)}</td>
                <td style={{ padding: '4px 8px', fontFamily: "'Courier New', monospace" }}>{fmtPct(r.pct_of_all_questions)}</td>
                <td style={{ padding: '4px 8px', fontFamily: "'Courier New', monospace" }}>
                  {r.avg_sale_price ? `$${fmtK(r.avg_sale_price)}` : '—'}
                </td>
                <td style={{
                  padding: '4px 8px',
                  color: r.answerable_from_db ? 'var(--success)' : 'var(--error)',
                  fontWeight: 600,
                }}>{r.answerable_from_db ? 'YES' : 'GAP'}</td>
                <td style={{ padding: '4px 8px', fontFamily: "'Courier New', monospace", fontSize: 'var(--fs-8)' }}>
                  {r.regex_classified > 0 && `regex:${fmtK(r.regex_classified)}`}
                  {r.regex_classified > 0 && r.llm_classified > 0 && ' + '}
                  {r.llm_classified > 0 && `llm:${fmtK(r.llm_classified)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: '16px',
        marginBottom: '24px',
        fontSize: 'var(--fs-8)',
        color: 'var(--text-disabled)',
        fontFamily: "'Courier New', monospace",
      }}>
        Data: mv_question_intelligence • Refresh: SELECT refresh_question_intelligence()
      </div>
      </>}{/* end overview conditional */}
    </div>
  );
}
