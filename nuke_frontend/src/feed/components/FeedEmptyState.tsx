/**
 * FeedEmptyState — Zero-results message with actionable next steps.
 *
 * Zero dead ends: always offers a way forward.
 */

import { Link } from 'react-router-dom';

export interface FeedEmptyStateProps {
  hasFilters: boolean;
  onResetFilters?: () => void;
}

export function FeedEmptyState({ hasFilters, onResetFilters }: FeedEmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '300px',
        gap: '16px',
        padding: '40px 20px',
      }}
    >
      <div
        style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '12px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text-secondary)',
        }}
      >
        NO VEHICLES MATCH
      </div>

      {hasFilters && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '10px',
              color: 'var(--text-disabled)',
            }}
          >
            Try adjusting your filters or search terms.
          </div>
          {onResetFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: '9px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
                padding: '4px 12px',
                border: '2px solid var(--text)',
                background: 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              RESET ALL FILTERS
            </button>
          )}
        </div>
      )}

      {/* Always offer next actions — no dead ends */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginTop: '8px',
      }}>
        <Link
          to="/search"
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            padding: '3px 10px',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
          }}
        >
          SEARCH
        </Link>
        <Link
          to="/auctions"
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            padding: '3px 10px',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
          }}
        >
          AUCTIONS
        </Link>
      </div>
    </div>
  );
}
