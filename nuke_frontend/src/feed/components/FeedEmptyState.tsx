/**
 * FeedEmptyState — Zero-results message with filter reset.
 */

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
        gap: '12px',
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
        NO VEHICLES FOUND
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
                border: '1px solid var(--border)',
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
    </div>
  );
}
