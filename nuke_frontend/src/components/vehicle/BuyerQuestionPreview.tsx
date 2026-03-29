/**
 * Buyer Question Preview — "What buyers will ask about this vehicle"
 *
 * Shows top question categories for vehicles similar to this one (same make, similar price band).
 * Uses vehicle_question_preview() RPC. Self-guarding: returns null if no data.
 *
 * Placement: Vehicle profile WorkspaceContent, below Comments & Bids widget.
 */
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface QuestionRow {
  l1_category: string;
  l2_subcategory: string;
  display_name: string;
  answerable_from_db: boolean;
  question_count: number;
  pct_of_total: number;
  example_question: string;
}

const L1_COLORS: Record<string, string> = {
  mechanical: '#7d6b91', provenance: '#6b9d7d', condition: '#9d8b6b',
  functionality: '#6b8b9d', logistics: '#8b6b7d', auction_process: '#7d9d6b',
  general: '#9d6b6b', cosmetics: '#9d8b6b', features: '#6b8b9d',
  vehicle_details: '#7d6b91', vehicle_history: '#6b9d7d', valuation: '#8b6b7d',
  community: '#9d6b6b', legal_and_regulatory: '#7d9d6b',
};

export default function BuyerQuestionPreview({ vehicleId, make }: { vehicleId: string; make?: string }) {
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!make) { setLoaded(true); return; }
    (async () => {
      // Use pre-aggregated materialized view — instant, no runtime join
      const { data, error } = await supabase
        .from('mv_question_by_make')
        .select('l1_category, l2_subcategory, display_name, answerable_from_db, question_count, vehicle_count')
        .eq('make', make)
        .order('question_count', { ascending: false })
        .limit(8);

      if (!error && data && data.length > 0) {
        const total = data.reduce((s: number, r: any) => s + r.question_count, 0);
        setRows(data.map((r: any) => ({
          l1_category: r.l1_category,
          l2_subcategory: r.l2_subcategory,
          display_name: r.display_name,
          answerable_from_db: r.answerable_from_db,
          question_count: r.question_count,
          pct_of_total: Math.round(1000 * r.question_count / total) / 10,
          example_question: '',
        })));
      }
      setLoaded(true);
    })();
  }, [make]);

  if (!loaded) return <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-disabled)', padding: '4px 0' }}>Loading buyer questions...</div>;
  if (rows.length === 0) return <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-disabled)', padding: '4px 0' }}>No question data yet for this make</div>;

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
        Based on {total.toLocaleString()} questions from similar vehicles
      </div>

      {rows.map(r => (
        <div
          key={`${r.l1_category}.${r.l2_subcategory}`}
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
            opacity: r.answerable_from_db ? 1.0 : 0.4,
          }} />

          {/* Category + example */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--fs-9)',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 600,
              color: 'var(--text)',
            }}>{r.display_name || `${r.l1_category}.${r.l2_subcategory}`}</div>
            {r.example_question && (
              <div style={{
                fontSize: 'var(--fs-8)',
                fontFamily: 'Arial, sans-serif',
                color: 'var(--text-secondary)',
                marginTop: '1px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>"{r.example_question}"</div>
            )}
          </div>

          {/* Bar + pct */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '80px' }}>
            <div style={{ width: '40px', height: '8px', background: 'var(--border)' }}>
              <div style={{
                width: `${Math.min(100, r.pct_of_total * 2.5)}%`,
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
            }}>{r.pct_of_total}%</span>
          </div>
        </div>
      ))}

      <div style={{
        marginTop: '6px',
        fontSize: 'var(--fs-8)',
        color: 'var(--text-disabled)',
      }}>
        {rows.filter(r => r.answerable_from_db).length} of {rows.length} answerable from listing data
      </div>
    </div>
  );
}
