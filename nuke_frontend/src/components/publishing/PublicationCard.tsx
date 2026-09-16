import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Publication } from '../../types/publishing';

interface PublicationCardProps {
  publication: Publication;
  issueCount?: number;
  emailVolume?: number;
  peopleCount?: number;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: '2px solid var(--border)',
    borderRadius: 0,
    boxShadow: 'none',
    padding: 'var(--space-3)',
    cursor: 'pointer',
    transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
    background: 'var(--surface)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-2)',
  },
  name: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '11px',
    fontWeight: 'bold',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    color: 'var(--text)',
    margin: 0,
  },
  badge: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '8px',
    textTransform: 'uppercase' as const,
    padding: '2px 6px',
    border: '1px solid var(--border)',
    borderRadius: 0,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1,
  },
  statsRow: {
    display: 'flex',
    gap: 'var(--space-3)',
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    color: 'var(--text)',
    marginBottom: 'var(--space-2)',
  },
  dateRange: {
    fontFamily: '"Courier New", monospace',
    fontSize: '9px',
    color: 'var(--text-secondary)',
  },
};

export default function PublicationCard({
  publication,
  issueCount,
  emailVolume,
  peopleCount,
}: PublicationCardProps) {
  const navigate = useNavigate();
  const [hovered, setHovered] = React.useState(false);

  const handleClick = () => {
    navigate(`/publishing/${publication.slug}`);
  };

  const territories = publication.territory?.length
    ? publication.territory.join(', ')
    : null;

  const cardStyle: React.CSSProperties = {
    ...styles.card,
    ...(hovered
      ? {
          transform: 'translateY(-2px)',
          borderColor: 'var(--text-secondary)',
        }
      : {}),
  };

  return (
    <div
      style={cardStyle}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div style={styles.header}>
        <h3 style={styles.name}>{publication.name}</h3>
        {publication.publication_type && (
          <span style={styles.badge}>{publication.publication_type}</span>
        )}
      </div>

      <div style={styles.statsRow}>
        {issueCount != null && <span>{issueCount} ISSUES</span>}
        {emailVolume != null && <span>{emailVolume} EMAILS</span>}
        {peopleCount != null && <span>{peopleCount} PEOPLE</span>}
      </div>

      {territories && (
        <div style={styles.dateRange}>{territories}</div>
      )}

      <div style={styles.dateRange}>
        {publication.created_at
          ? new Date(publication.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
            })
          : ''}
        {publication.created_at && publication.updated_at ? ' — ' : ''}
        {publication.updated_at
          ? new Date(publication.updated_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
            })
          : ''}
      </div>
    </div>
  );
}
