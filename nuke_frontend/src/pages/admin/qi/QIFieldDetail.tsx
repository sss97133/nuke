/**
 * QI Field Detail — drill into a single data_fields entry
 * Shows fill rate, categories referencing it, top vehicles missing it
 */
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { TaxonomyRow, L1_COLORS, fmtK, isValidFieldColumn } from './constants';

interface VehicleMissing {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  q_count: number;
}

interface Props {
  field: string;
  allRows: TaxonomyRow[];
}

export default function QIFieldDetail({ field, allRows }: Props) {
  const [, setParams] = useSearchParams();
  const [fillRate, setFillRate] = useState<{ filled: number; total: number } | null>(null);
  const [topMissing, setTopMissing] = useState<VehicleMissing[]>([]);
  const [loading, setLoading] = useState(true);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // Categories that reference this field — memoized to use as effect dependency
  const referencingCategories = useMemo(() =>
    allRows.filter(r => r.data_fields && r.data_fields.includes(field))
      .sort((a, b) => b.question_count - a.question_count),
    [allRows, field]
  );

  // Validate field against whitelist to prevent SQL injection
  const fieldValid = isValidFieldColumn(field);

  useEffect(() => {
    if (!fieldValid) {
      setSqlError(`Unknown field: ${field}`);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setSqlError(null);

      // Get fill rate for this field (field is whitelist-validated above)
      const { data: fillData, error: fillErr } = await supabase.rpc('execute_sql', {
        query: `SELECT count(*)::int as total, count(${field})::int as filled FROM vehicles`
      });

      if (fillErr) setSqlError(fillErr.message);
      if (!cancelled && fillData?.[0]) {
        setFillRate({ filled: fillData[0].filled, total: fillData[0].total });
      }

      // Get top vehicles missing this field but most asked about in related categories
      const l2Values = referencingCategories.map(r => r.l2_subcategory.replace(/'/g, "''"));
      if (l2Values.length > 0) {
        const l2List = l2Values.map(v => `'${v}'`).join(',');
        const { data: missingData } = await supabase.rpc('execute_sql', {
          query: `SELECT v.id as vehicle_id, v.year, v.make, v.model, count(*)::int as q_count
            FROM auction_comments ac
            JOIN vehicles v ON v.id = ac.vehicle_id
            WHERE ac.question_primary_l2 IN (${l2List})
              AND ac.has_question = true AND ac.question_primary_l1 IS NOT NULL
              AND v.${field} IS NULL
            GROUP BY v.id, v.year, v.make, v.model
            ORDER BY q_count DESC LIMIT 15`
        });

        if (!cancelled && missingData) {
          setTopMissing(missingData);
        }
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [field, fieldValid, referencingCategories]);

  const fillPct = fillRate ? Math.round(fillRate.filled / fillRate.total * 100) : null;

  if (!fieldValid) {
    return (
      <div style={{ padding: '16px', fontSize: 'var(--fs-9)', color: 'var(--error)' }}>
        Unknown field column: {field}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        border: '2px solid var(--border)',
        background: 'var(--surface)',
        padding: '12px',
        marginBottom: '12px',
      }}>
        <div style={{
          fontSize: 'var(--fs-11)',
          fontFamily: "'Courier New', monospace",
          fontWeight: 700,
          color: 'var(--text)',
          textTransform: 'uppercase',
          marginBottom: '8px',
        }}>{field.replace(/_/g, ' ')}</div>

        {sqlError && (
          <div style={{ fontSize: 'var(--fs-8)', color: 'var(--error)', marginBottom: '4px' }}>{sqlError}</div>
        )}

        {/* Fill rate bar */}
        {fillRate && (
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--fs-8)',
              fontFamily: "'Courier New', monospace",
              color: 'var(--text-secondary)',
              marginBottom: '4px',
            }}>
              <span>Fill Rate</span>
              <span>{fmtK(fillRate.filled)} / {fmtK(fillRate.total)} ({fillPct}%)</span>
            </div>
            <div style={{ height: '8px', background: 'var(--border)', width: '100%' }}>
              <div style={{
                height: '100%',
                width: `${fillPct}%`,
                background: fillPct! > 70 ? 'var(--success)' : fillPct! > 30 ? 'var(--text-secondary)' : 'var(--error)',
              }} />
            </div>
          </div>
        )}

        {loading && (
          <div style={{ fontSize: 'var(--fs-8)', color: 'var(--text-disabled)', marginTop: '4px' }}>Loading…</div>
        )}
      </div>

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          {/* Categories referencing this field */}
          <div>
            <div style={{
              fontSize: 'var(--fs-8)',
              fontFamily: 'Arial, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-secondary)',
              marginBottom: '8px',
            }}>Categories Referencing This Field ({referencingCategories.length})</div>
            <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
              {referencingCategories.map(r => (
                <div
                  key={r.taxonomy_id}
                  onClick={() => setParams({ l2: r.l2_subcategory })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 12px',
                    borderBottom: '2px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: 'var(--fs-9)',
                    fontFamily: 'Arial, sans-serif',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '8px', height: '8px', background: L1_COLORS[r.l1_category] || '#6b7d9d' }} />
                    <span style={{ color: 'var(--text)' }}>{r.display_name}</span>
                  </div>
                  <span style={{ fontSize: 'var(--fs-8)', fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)' }}>
                    {fmtK(r.question_count)}
                  </span>
                </div>
              ))}
              {referencingCategories.length === 0 && (
                <div style={{ padding: '12px', fontSize: 'var(--fs-9)', color: 'var(--text-disabled)' }}>No categories reference this field</div>
              )}
            </div>
          </div>

          {/* Vehicles missing this field */}
          {topMissing.length > 0 && (
            <div>
              <div style={{
                fontSize: 'var(--fs-8)',
                fontFamily: 'Arial, sans-serif',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-secondary)',
                marginBottom: '8px',
              }}>Most Asked — Missing This Field</div>
              <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
                {topMissing.map(v => (
                  <a
                    key={v.vehicle_id}
                    href={`/vehicle/${v.vehicle_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 12px',
                      borderBottom: '2px solid var(--border)',
                      fontSize: 'var(--fs-8)',
                      fontFamily: "'Courier New', monospace",
                      color: 'var(--text)',
                      textDecoration: 'none',
                    }}
                  >
                    <span>{v.year && v.make ? `${v.year} ${v.make} ${v.model || ''}`.trim() : v.vehicle_id.slice(0, 8)}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{v.q_count} qs</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
