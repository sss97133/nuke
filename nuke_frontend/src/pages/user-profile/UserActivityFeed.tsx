/**
 * UserActivityFeed — Reverse-chronological event list.
 * Each entry: date, type badge, description, optional vehicle thumbnail.
 *
 * Self-guarding: returns null if no activity events.
 */
import React, { useState, useMemo } from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { useUserProfile } from './UserProfileContext';

// ---------------------------------------------------------------------------
// Badge text mapping
// ---------------------------------------------------------------------------

const BADGE_MAP: Record<string, string> = {
  listing: 'LISTING',
  bid: 'BID',
  auction_win: 'WIN',
  comment: 'COMMENT',
};

function getBadgeText(type: string): string {
  return BADGE_MAP[type] || 'EVENT';
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function formatActivityDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_LIMIT = 50;
const LOAD_MORE_STEP = 50;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UserActivityFeed: React.FC = () => {
  const { activityEvents } = useUserProfile();
  const [displayLimit, setDisplayLimit] = useState(INITIAL_LIMIT);

  const visibleEvents = useMemo(
    () => activityEvents.slice(0, displayLimit),
    [activityEvents, displayLimit]
  );

  if (!activityEvents || activityEvents.length === 0) return null;

  const hasMore = activityEvents.length > displayLimit;

  return (
    <CollapsibleWidget variant="profile" title="Activity Feed" defaultCollapsed={true}
      badge={<span className="widget__count">{activityEvents.length}</span>}
    >
      <div>
        {visibleEvents.map(event => (
          <div key={event.id} className="up-activity-item">
            <span className="up-activity-item__date">
              {formatActivityDate(event.date)}
            </span>
            <span className="up-activity-item__badge">
              {getBadgeText(event.type)}
            </span>
            <span className="up-activity-item__text">
              {event.description}
            </span>
            {event.vehicleThumb && (
              <img
                className="up-activity-item__thumb"
                src={event.vehicleThumb}
                alt={event.vehicleName || 'Vehicle'}
                loading="lazy"
              />
            )}
          </div>
        ))}
        {hasMore && (
          <button
            type="button"
            className="up-btn"
            style={{ width: '100%', marginTop: '6px' }}
            onClick={() => setDisplayLimit(prev => prev + LOAD_MORE_STEP)}
          >
            SHOW MORE
          </button>
        )}
      </div>
    </CollapsibleWidget>
  );
};

export default UserActivityFeed;
