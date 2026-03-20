import React from 'react';
import { useVehicleProfile } from './VehicleProfileContext';

/** Quick Stats line shown below hero image — reads from context */
const QuickStatsBar: React.FC = () => {
  const { vehicleImages, timelineEvents, totalCommentCount, observationCount, vehicle } = useVehicleProfile();
  const updatedAt = vehicle?.updated_at;

  const timeAgo = React.useMemo(() => {
    if (!updatedAt) return null;
    try {
      const d = new Date(updatedAt);
      const ms = Date.now() - d.getTime();
      if (ms < 0 || !Number.isFinite(ms)) return null;
      const mins = Math.floor(ms / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days < 30) return `${days}d ago`;
      return d.toLocaleDateString();
    } catch {
      return null;
    }
  }, [updatedAt]);

  const parts: string[] = [];
  if (vehicleImages.length > 0) parts.push(`${vehicleImages.length} image${vehicleImages.length === 1 ? '' : 's'}`);
  if (observationCount > 0) parts.push(`${observationCount} observation${observationCount === 1 ? '' : 's'}`);
  if (timelineEvents.length > 0) parts.push(`${timelineEvents.length} event${timelineEvents.length === 1 ? '' : 's'}`);
  if (totalCommentCount > 0) parts.push(`${totalCommentCount} comment${totalCommentCount === 1 ? '' : 's'}`);
  if (timeAgo) parts.push(`Updated ${timeAgo}`);

  if (parts.length === 0) return null;

  return (
    <div style={{ padding: '8px 16px', maxWidth: '1600px', margin: '0 auto', background: 'transparent' }}>
      <div style={{
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: '8px',
        fontWeight: 400,
        color: 'var(--text-disabled)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        alignItems: 'center',
      }}>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ opacity: 0.4 }}>&middot;</span>}
            <span>{p}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default QuickStatsBar;
