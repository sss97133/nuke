/**
 * QI Breadcrumb — URL-driven navigation path
 * Reads search params, renders: OVERVIEW > L1 > L2
 */
import { useSearchParams } from 'react-router-dom';

export default function QIBreadcrumb() {
  const [params, setParams] = useSearchParams();
  const l1 = params.get('l1');
  const l2 = params.get('l2');
  const field = params.get('field');
  const author = params.get('author');

  const go = (keep: Record<string, string>) => {
    setParams(keep, { replace: false });
  };

  const crumbs: { label: string; key: string; onClick?: () => void }[] = [
    { label: 'OVERVIEW', key: 'overview', onClick: () => go({}) },
  ];

  if (l1) {
    crumbs.push({
      label: l1.replace(/_/g, ' ').toUpperCase(),
      key: `l1-${l1}`,
      onClick: l2 ? () => go({ l1 }) : undefined,
    });
  }

  if (l2) {
    crumbs.push({ label: l2.replace(/_/g, ' ').toUpperCase(), key: `l2-${l2}` });
  }

  if (field) {
    crumbs.push({ label: `FIELD: ${field.replace(/_/g, ' ').toUpperCase()}`, key: `field-${field}` });
  }

  if (author) {
    crumbs.push({ label: `AUTHOR: ${author.toUpperCase()}`, key: `author-${author}` });
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 0',
      marginBottom: '12px',
      fontSize: 'var(--fs-8)',
      fontFamily: 'Arial, sans-serif',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-secondary)',
    }}>
      {crumbs.map((c, i) => (
        <span key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {i > 0 && <span style={{ color: 'var(--text-disabled)' }}>{'>'}</span>}
          {c.onClick ? (
            <span
              onClick={c.onClick}
              style={{ cursor: 'pointer', color: 'var(--text-secondary)', textDecoration: 'underline', textUnderlineOffset: '2px' }}
            >{c.label}</span>
          ) : (
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{c.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
