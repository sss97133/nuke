/**
 * QI Category Detail — the primary L2 drill-down view
 * Shows actual comments, vehicle breakdown, field chips
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { TaxonomyRow, L1_COLORS, fmtK } from './constants';
import QICommentRow, { QIComment } from './QICommentRow';
import QIPagination from './QIPagination';

interface VehicleBreakdown {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  q_count: number;
}

interface Props {
  l2: string;
  taxonomyRow: TaxonomyRow | null;
}

export default function QICategoryDetail({ l2, taxonomyRow }: Props) {
  const [params, setParams] = useSearchParams();
  const vehicleFilter = params.get('v');
  const page = Math.max(0, Number(params.get('page') || 0));
  const pageSize = 50;

  const [comments, setComments] = useState<QIComment[]>([]);
  const [totalComments, setTotalComments] = useState(0);
  const [vehicles, setVehicles] = useState<VehicleBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  // Sanitize l2 for SQL — only alphanumeric + underscore allowed
  const l2Safe = l2.replace(/[^a-zA-Z0-9_]/g, '');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      // Fetch comments via PostgREST (parameterized, no SQL injection risk)
      let query = supabase
        .from('auction_comments')
        .select('id, comment_text, author_username, posted_at, vehicle_id, question_classify_method, sentiment', { count: 'exact' })
        .eq('question_primary_l2', l2)
        .eq('has_question', true)
        .not('question_primary_l1', 'is', null)
        .order('posted_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (vehicleFilter) {
        query = query.eq('vehicle_id', vehicleFilter);
      }

      const { data: commentData, count, error: commentErr } = await query;

      if (commentErr) {
        console.error('QI comment fetch error:', commentErr);
      }

      if (!cancelled) {
        setComments(commentData || []);
        setTotalComments(count || 0);
      }

      // Fetch vehicle breakdown (only on first page without vehicle filter)
      if (page === 0 && !vehicleFilter) {
        const { data: vehData } = await supabase.rpc('execute_sql', {
          query: `SELECT ac.vehicle_id, v.year, v.make, v.model, count(*)::int as q_count
            FROM auction_comments ac
            JOIN vehicles v ON v.id = ac.vehicle_id
            WHERE ac.question_primary_l2 = '${l2Safe}' AND ac.has_question = true AND ac.question_primary_l1 IS NOT NULL
            GROUP BY ac.vehicle_id, v.year, v.make, v.model
            ORDER BY q_count DESC LIMIT 20`
        });

        if (!cancelled && vehData) {
          setVehicles(vehData);
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [l2, l2Safe, vehicleFilter, page]);

  const color = taxonomyRow ? L1_COLORS[taxonomyRow.l1_category] || '#6b7d9d' : '#6b7d9d';

  return (
    <div>
      {/* Header */}
      {taxonomyRow && (
        <div style={{
          border: '2px solid var(--border)',
          background: 'var(--surface)',
          padding: '12px',
          marginBottom: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div style={{ width: '10px', height: '10px', background: color }} />
            <span style={{
              fontSize: 'var(--fs-11)',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 700,
              color: 'var(--text)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>{taxonomyRow.display_name}</span>
            <span style={{
              fontSize: 'var(--fs-8)',
              fontFamily: "'Courier New', monospace",
              padding: '1px 6px',
              border: '2px solid var(--border)',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
            }}>{taxonomyRow.l1_category.replace(/_/g, ' ')}</span>
            <span style={{
              fontSize: 'var(--fs-8)',
              fontFamily: "'Courier New', monospace",
              padding: '1px 6px',
              border: `2px solid ${taxonomyRow.answerable_from_db ? 'var(--success)' : 'var(--error)'}`,
              color: taxonomyRow.answerable_from_db ? 'var(--success)' : 'var(--error)',
              textTransform: 'uppercase',
            }}>{taxonomyRow.answerable_from_db ? 'ANSWERABLE' : 'DATA GAP'}</span>
          </div>

          {/* Stats */}
          <div style={{
            display: 'flex',
            gap: '16px',
            fontSize: 'var(--fs-8)',
            fontFamily: "'Courier New', monospace",
            color: 'var(--text-secondary)',
            marginBottom: '8px',
          }}>
            <span>{fmtK(taxonomyRow.question_count)} questions</span>
            <span>{fmtK(taxonomyRow.vehicle_count)} vehicles</span>
            <span>{taxonomyRow.pct_of_all_questions}% of all</span>
          </div>

          {/* Data field chips */}
          {taxonomyRow.data_fields && taxonomyRow.data_fields.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {taxonomyRow.data_fields.map(f => (
                <span
                  key={f}
                  onClick={() => setParams({ field: f })}
                  style={{
                    fontSize: 'var(--fs-8)',
                    fontFamily: "'Courier New', monospace",
                    padding: '2px 6px',
                    border: '2px solid var(--border)',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                  }}
                  title={`Drill into field: ${f}`}
                >{f.replace(/_/g, ' ')}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Vehicle filter indicator */}
      {vehicleFilter && (
        <div style={{
          fontSize: 'var(--fs-8)',
          fontFamily: "'Courier New', monospace",
          color: 'var(--text-secondary)',
          padding: '4px 0',
          marginBottom: '8px',
        }}>
          Filtered to vehicle: {vehicleFilter.slice(0, 8)}…
          <span
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('v');
              next.delete('page');
              setParams(next);
            }}
            style={{ cursor: 'pointer', marginLeft: '8px', textDecoration: 'underline' }}
          >[clear]</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: vehicles.length > 0 ? '1fr 280px' : '1fr', gap: '12px' }}>
        {/* Comments */}
        <div>
          <div style={{
            fontSize: 'var(--fs-8)',
            fontFamily: 'Arial, sans-serif',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-secondary)',
            marginBottom: '8px',
          }}>
            Comments {loading && '(loading…)'}
          </div>
          <div style={{
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            padding: '0 12px',
          }}>
            {comments.length === 0 && !loading && (
              <div style={{ padding: '16px 0', fontSize: 'var(--fs-9)', color: 'var(--text-disabled)' }}>No comments found</div>
            )}
            {comments.map(c => <QICommentRow key={c.id} comment={c} />)}
            <QIPagination total={totalComments} pageSize={pageSize} />
          </div>
        </div>

        {/* Vehicle breakdown sidebar */}
        {vehicles.length > 0 && !vehicleFilter && (
          <div>
            <div style={{
              fontSize: 'var(--fs-8)',
              fontFamily: 'Arial, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-secondary)',
              marginBottom: '8px',
            }}>Top Vehicles</div>
            <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
              {vehicles.map(v => (
                <div
                  key={v.vehicle_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 12px',
                    borderBottom: '2px solid var(--border)',
                    fontSize: 'var(--fs-8)',
                    fontFamily: "'Courier New', monospace",
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set('v', v.vehicle_id);
                    next.delete('page');
                    setParams(next);
                  }}
                  title="Filter to this vehicle"
                >
                  <span style={{ color: 'var(--text)' }}>
                    {v.year && v.make ? `${v.year} ${v.make} ${v.model || ''}`.trim() : v.vehicle_id.slice(0, 8)}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{v.q_count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
