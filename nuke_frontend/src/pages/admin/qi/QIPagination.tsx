/**
 * QI Pagination — PREV / NEXT with count display
 */
import { useSearchParams } from 'react-router-dom';

interface Props {
  total: number;
  pageSize?: number;
}

export default function QIPagination({ total, pageSize = 50 }: Props) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(0, Number(params.get('page') || 0));
  const totalPages = Math.ceil(total / pageSize);
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  const go = (p: number) => {
    const next = new URLSearchParams(params);
    if (p === 0) next.delete('page');
    else next.set('page', String(p));
    setParams(next, { replace: true });
  };

  if (total === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 0',
      fontSize: 'var(--fs-8)',
      fontFamily: "'Courier New', monospace",
      color: 'var(--text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      <span>Showing {from}–{to} of {total.toLocaleString()}</span>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => go(page - 1)}
          disabled={page === 0}
          style={{
            all: 'unset',
            cursor: page === 0 ? 'default' : 'pointer',
            padding: '2px 8px',
            border: '2px solid var(--border)',
            color: page === 0 ? 'var(--text-disabled)' : 'var(--text)',
            fontSize: 'var(--fs-8)',
            fontFamily: "'Courier New', monospace",
            textTransform: 'uppercase',
          }}
        >Prev</button>
        <button
          onClick={() => go(page + 1)}
          disabled={page >= totalPages - 1}
          style={{
            all: 'unset',
            cursor: page >= totalPages - 1 ? 'default' : 'pointer',
            padding: '2px 8px',
            border: '2px solid var(--border)',
            color: page >= totalPages - 1 ? 'var(--text-disabled)' : 'var(--text)',
            fontSize: 'var(--fs-8)',
            fontFamily: "'Courier New', monospace",
            textTransform: 'uppercase',
          }}
        >Next</button>
      </div>
    </div>
  );
}
