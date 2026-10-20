/**
 * Buyer Question Preview — recorded question categories for the selected make.
 *
 * The existing materialized view groups by make/category, not vehicle evidence or price peers.
 * Shares use only the up-to-eight returned categories; refresh time is unavailable.
 *
 * Placement: Vehicle profile WorkspaceContent, below Comments & Bids widget.
 */
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { MakeIdentity } from '../common/MakeIdentity';

interface QuestionRow {
  l1_category: string;
  l2_subcategory: string | null;
  display_name: string | null;
  question_count: number;
  pct_of_selected: number;
}

function questionRows(value: unknown, make: string): QuestionRow[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const rows: Omit<QuestionRow, 'pct_of_selected'>[] = [], seen = new Set<string>();
  let total = 0;
  for (const r of value) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || r.make !== make ||
      typeof r.l1_category !== 'string' || !r.l1_category.trim() ||
      !(r.l2_subcategory === null || typeof r.l2_subcategory === 'string' && r.l2_subcategory.trim()) ||
      !(r.display_name === null || typeof r.display_name === 'string') ||
      !Number.isSafeInteger(r.question_count) || r.question_count <= 0) return null;
    const key = JSON.stringify([r.l1_category, r.l2_subcategory]);
    if (seen.has(key)) return null;
    seen.add(key); total += r.question_count;
    if (!Number.isSafeInteger(total)) return null;
    rows.push({ l1_category: r.l1_category, l2_subcategory: r.l2_subcategory, display_name: r.display_name, question_count: r.question_count });
  }
  return rows.map(r => ({ ...r, pct_of_selected: Math.round(1000 * r.question_count / total) / 10 }));
}

const L1_COLORS: Record<string, string> = {
  mechanical: '#7d6b91', provenance: '#6b9d7d', condition: '#9d8b6b',
  functionality: '#6b8b9d', logistics: '#8b6b7d', auction_process: '#7d9d6b',
  general: '#9d6b6b', cosmetics: '#9d8b6b', features: '#6b8b9d',
  vehicle_details: '#7d6b91', vehicle_history: '#6b9d7d', valuation: '#8b6b7d',
  community: '#9d6b6b', legal_and_regulatory: '#7d9d6b',
};

export default function BuyerQuestionPreview({ vehicleId, make }: { vehicleId: string; make?: string | null }) {
  const requestedMake = typeof make === 'string' ? make.trim() : '';
  const [result, setResult] = useState<{ vehicleId: string; make: string; rows: QuestionRow[]; failed: boolean } | null>(null);

  useEffect(() => {
    if (!requestedMake) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('mv_question_by_make')
          .select('make, l1_category, l2_subcategory, display_name, question_count')
          .eq('make', requestedMake)
          .order('question_count', { ascending: false })
          .limit(8);
        if (cancelled) return;
        const rows = error ? null : questionRows(data, requestedMake);
        setResult({ vehicleId, make: requestedMake, rows: rows ?? [], failed: rows === null });
      } catch {
        if (!cancelled) setResult({ vehicleId, make: requestedMake, rows: [], failed: true });
      }
    })();
    return () => { cancelled = true; };
  }, [vehicleId, requestedMake]);

  if (!requestedMake || !result || result.vehicleId !== vehicleId || result.make !== requestedMake) return null;
  if (result.failed) return <p role="status">Buyer question context unavailable.</p>;
  const rows = result.rows;
  if (rows.length === 0) return null;

  const total = rows.reduce((s, r) => s + r.question_count, 0);

  return (
    <div>
      <div style={{
        fontSize: 'var(--fs-8)',
        color: 'var(--text-secondary)',
        marginBottom: '8px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        Top {rows.length} recorded question categories for <MakeIdentity make={requestedMake} />
      </div>

      {rows.map(r => (
        <div
          key={JSON.stringify([r.l1_category, r.l2_subcategory])}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '4px 0',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {/* Color dot */}
          <div style={{
            width: '8px',
            height: '8px',
            minWidth: '8px',
            marginTop: '3px',
            background: L1_COLORS[r.l1_category] || '#6b7d9d',
          }} />

          {/* Category + count */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--fs-9)',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 600,
              color: 'var(--text)',
            }}>{r.display_name || [r.l1_category, r.l2_subcategory].filter(Boolean).join('.')}</div>
            <div style={{
              fontSize: 'var(--fs-8)',
              fontFamily: 'Arial, sans-serif',
              color: 'var(--text-secondary)',
              marginTop: '1px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{r.question_count.toLocaleString()} {r.question_count === 1 ? 'question' : 'questions'}</div>
          </div>

          {/* Bar + pct */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '80px' }}>
            <div style={{ width: '40px', height: '8px', background: 'var(--border)' }}>
              <div style={{
                width: `${r.pct_of_selected}%`,
                height: '100%',
                background: L1_COLORS[r.l1_category] || '#6b7d9d',
              }} />
            </div>
            <span style={{
              fontSize: 'var(--fs-8)',
              fontFamily: "'Courier New', monospace",
              color: 'var(--text-secondary)',
              minWidth: '30px',
              textAlign: 'right',
            }}>{r.pct_of_selected}%</span>
          </div>
        </div>
      ))}

      <div style={{
        marginTop: '6px',
        fontSize: 'var(--fs-8)',
        color: 'var(--text-disabled)',
      }}>
        {total.toLocaleString()} classified questions in the categories shown; percentages use this subtotal. Other categories are excluded.
        {' '}Make-level context; model and price similarity and this listing's answers are unassessed. Refresh time unknown.
      </div>
    </div>
  );
}
