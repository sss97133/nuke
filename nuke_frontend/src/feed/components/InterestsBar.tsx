/**
 * InterestsBar — "YOUR INTERESTS" chip bar + welcome-back banner.
 *
 * Shown above the feed when the user has recorded interests (from treemap
 * clicks, feed filter usage, etc.) and no active filters are set.
 *
 * Design: 2px borders, Courier New for data, 8-9px UPPERCASE labels, zero radius.
 */

import { useState, useMemo, type CSSProperties } from 'react';
import type { InterestEntry } from '../../hooks/useInterests';
import type { FeedVehicle } from '../types/feed';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InterestsBarProps {
  topMakes: InterestEntry[];
  topModels: InterestEntry[];
  hasInterests: boolean;
  /** Whether user currently has active filters set */
  hasActiveFilters: boolean;
  /** Vehicles in the current feed (for welcome-back counting) */
  vehicles: FeedVehicle[];
  /** The user's previous lastVisit timestamp */
  previousVisit: number;
  /** Called when user clicks a make chip */
  onMakeClick: (make: string) => void;
  /** Called when user clicks a model chip */
  onModelClick: (model: string) => void;
  /** Called to clear interests */
  onClearInterests: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const chipBase: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  padding: '3px 8px',
  border: '2px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InterestsBar({
  topMakes,
  topModels,
  hasInterests,
  hasActiveFilters,
  vehicles,
  previousVisit,
  onMakeClick,
  onModelClick,
  onClearInterests,
}: InterestsBarProps) {
  const [dismissed, setDismissed] = useState(false);

  // Count new vehicles matching top make since last visit
  const welcomeBack = useMemo(() => {
    if (!hasInterests || topMakes.length === 0) return null;
    const topMake = topMakes[0].name;
    const sinceTimestamp = new Date(previousVisit).toISOString();
    const newCount = vehicles.filter(
      (v) =>
        v.make?.toUpperCase() === topMake &&
        v.created_at > sinceTimestamp,
    ).length;
    return { make: topMake, count: newCount };
  }, [hasInterests, topMakes, previousVisit, vehicles]);

  // Don't render if no interests, or user has active filters, or dismissed
  if (!hasInterests || hasActiveFilters || dismissed) return null;

  // Combine makes and models, cap at 8 chips
  const allChips = [
    ...topMakes.slice(0, 5).map((e) => ({ ...e, type: 'make' as const })),
    ...topModels.slice(0, 5).map((e) => ({ ...e, type: 'model' as const })),
  ]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const showWelcome = welcomeBack && welcomeBack.count > 0;

  return (
    <div
      style={{
        borderBottom: '2px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {/* Welcome-back banner */}
      {showWelcome && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            style={{
              fontFamily: "'Courier New', monospace",
              fontSize: '9px',
              fontWeight: 700,
              color: 'var(--text)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            WELCOME BACK — {welcomeBack.count} NEW {welcomeBack.make}
            {welcomeBack.count !== 1 ? 'S' : ''} SINCE YOUR LAST VISIT
          </span>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              fontFamily: 'Arial, sans-serif',
              fontSize: '8px',
              fontWeight: 700,
              color: 'var(--text-disabled)',
              cursor: 'pointer',
              padding: '2px 4px',
              textTransform: 'uppercase',
            }}
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Interest chips */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          overflowX: 'auto',
        }}
      >
        <span
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '8px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: 'var(--text-disabled)',
            flexShrink: 0,
          }}
        >
          YOUR INTERESTS
        </span>

        {allChips.map((chip) => (
          <button
            key={`${chip.type}-${chip.name}`}
            type="button"
            onClick={() =>
              chip.type === 'make'
                ? onMakeClick(chip.name)
                : onModelClick(chip.name)
            }
            style={chipBase}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--text)';
              e.currentTarget.style.color = 'var(--text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            {chip.name}
            <span
              style={{
                fontFamily: "'Courier New', monospace",
                fontSize: '8px',
                color: 'var(--text-disabled)',
              }}
            >
              ({chip.count})
            </span>
          </button>
        ))}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Clear interests */}
        <button
          type="button"
          onClick={onClearInterests}
          style={{
            ...chipBase,
            fontSize: '7px',
            padding: '2px 6px',
            color: 'var(--text-disabled)',
            borderColor: 'transparent',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--error)';
            e.currentTarget.style.borderColor = 'var(--error)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-disabled)';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          CLEAR
        </button>
      </div>
    </div>
  );
}
