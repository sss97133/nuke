/**
 * QI L1 Detail — Client-side filter of L1 category
 * Shows L2 subcategories with bars, all from already-loaded mv_question_intelligence rows
 */
import { useSearchParams } from 'react-router-dom';
import { TaxonomyRow, L1_COLORS, fmtK } from './constants';

interface Props {
  l1: string;
  allRows: TaxonomyRow[];
}

export default function QIL1Detail({ l1, allRows }: Props) {
  const [, setParams] = useSearchParams();
  const l2Rows = allRows
    .filter(r => r.l1_category === l1)
    .sort((a, b) => b.question_count - a.question_count);

  if (l2Rows.length === 0) return null;

  const totalQuestions = l2Rows.reduce((s, r) => s + r.question_count, 0);
  const totalVehicles = l2Rows.reduce((s, r) => s + r.vehicle_count, 0);
  const answerableCount = l2Rows.filter(r => r.answerable_from_db).reduce((s, r) => s + r.question_count, 0);
  const maxCount = l2Rows[0]?.question_count || 1;
  const color = L1_COLORS[l1] || '#6b7d9d';

  return (
    <div>
      {/* Stat row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '8px',
        marginBottom: '16px',
      }}>
        {[
          { label: 'L2 CATEGORIES', value: String(l2Rows.length) },
          { label: 'QUESTIONS', value: fmtK(totalQuestions) },
          { label: 'VEHICLES', value: fmtK(totalVehicles) },
          { label: 'ANSWERABLE', value: totalQuestions > 0 ? `${Math.round(answerableCount / totalQuestions * 100)}%` : '—' },
        ].map(s => (
          <div key={s.label} style={{ border: '2px solid var(--border)', background: 'var(--surface)', padding: '10px 12px' }}>
            <div style={{ fontSize: 'var(--fs-8)', fontFamily: 'Arial, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '2px' }}>{s.label}</div>
            <div style={{ fontSize: 'var(--fs-11)', fontFamily: "'Courier New', monospace", fontWeight: 700, color: 'var(--text)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* L2 rows */}
      <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
        {l2Rows.map(r => (
          <div
            key={r.taxonomy_id}
            onClick={() => setParams({ l2: r.l2_subcategory })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              borderBottom: '2px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            <div style={{
              width: '200px',
              fontSize: 'var(--fs-9)',
              fontFamily: 'Arial, sans-serif',
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{r.display_name}</div>

            <div style={{ flex: 1, height: '12px', background: 'var(--bg)' }}>
              <div style={{
                width: `${(r.question_count / maxCount) * 100}%`,
                height: '100%',
                background: color,
                opacity: r.answerable_from_db ? 1 : 0.4,
              }} />
            </div>

            <div style={{
              width: '50px',
              textAlign: 'right',
              fontSize: 'var(--fs-8)',
              fontFamily: "'Courier New', monospace",
              color: 'var(--text-secondary)',
            }}>{fmtK(r.question_count)}</div>

            <div style={{
              width: '30px',
              fontSize: 'var(--fs-8)',
              fontFamily: "'Courier New', monospace",
              color: r.answerable_from_db ? 'var(--success)' : 'var(--error)',
              textAlign: 'center',
              fontWeight: 600,
            }}>{r.answerable_from_db ? 'DB' : 'GAP'}</div>

            <span style={{ fontSize: 'var(--fs-10)', color: 'var(--text-disabled)' }}>→</span>
          </div>
        ))}
      </div>
    </div>
  );
}
