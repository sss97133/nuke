import React from 'react';
import type { ProfileActivity, UserContribution } from '../../types/profile';

interface ActivityOverviewProps {
  activities: ProfileActivity[];
  contributions: UserContribution[];
  year?: number;
}

const ActivityOverview: React.FC<ActivityOverviewProps> = ({ activities, contributions, year }) => {
  console.log('ActivityOverview: Received contributions:', contributions.length);
  console.log('ActivityOverview: Contributions data:', contributions);
  
  // Group contributions by type
  const contributionsByType = contributions.reduce((acc, contrib) => {
    if (!acc[contrib.contribution_type]) {
      acc[contrib.contribution_type] = 0;
    }
    acc[contrib.contribution_type] += contrib.contribution_count;
    return acc;
  }, {} as Record<string, number>);

  const total = Object.values(contributionsByType).reduce((sum, count) => sum + count, 0);
  
  console.log('ActivityOverview: Contributions by type:', contributionsByType);
  console.log('ActivityOverview: Total contributions:', total);
  
  const typeLabels: Record<string, string> = {
    'vehicle_data': 'Vehicle Data',
    'image_upload': 'Images', 
    'timeline_event': 'Timeline Events',
    'verification': 'Verifications',
    'annotation': 'Annotations'
  };

  // Use design system colors
  const typeColors: Record<string, string> = {
    'vehicle_data': 'var(--color-primary)',
    'image_upload': 'var(--color-success)',
    'timeline_event': 'var(--color-warning)',
    'verification': 'var(--color-info)',
    'annotation': 'var(--color-danger)'
  };

  // Get top contributed vehicles
  const vehicleContributions = new Map<string, number>();
  contributions.forEach(contrib => {
    if (contrib.related_vehicle_id) {
      vehicleContributions.set(
        contrib.related_vehicle_id, 
        (vehicleContributions.get(contrib.related_vehicle_id) || 0) + contrib.contribution_count
      );
    }
  });

  const topVehicles = Array.from(vehicleContributions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Calculate percentages for radial chart
  const percentages = Object.entries(contributionsByType).map(([type, count]) => ({
    type,
    count,
    percentage: (count / total) * 100
  }));

  return (
    <div className="card" style={{ marginBottom: 'var(--spacing-lg)' }}>
      <h2 className="text-md" style={{ marginBottom: 'var(--spacing-md)' }}>Activity overview</h2>

      {total > 0 ? (
        <div className="text-sm text-secondary">
          <div style={{ marginBottom: 'var(--spacing-sm)' }}>
            Contributed to <strong className="text-primary">{topVehicles.length}</strong> vehicles
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)', marginBottom: 'var(--spacing-md)' }}>
            {/* Simple SVG radial chart */}
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="40" fill="none" stroke="var(--color-border)" strokeWidth="20" />
              {(() => {
                let offset = 0;
                return percentages.map(({ type, percentage }) => {
                  const circumference = 2 * Math.PI * 40;
                  const strokeDasharray = `${(percentage / 100) * circumference} ${circumference}`;
                  const strokeDashoffset = -offset * circumference / 100;
                  offset += percentage;
                  return (
                    <circle
                      key={type}
                      cx="60"
                      cy="60"
                      r="40"
                      fill="none"
                      stroke={typeColors[type] || 'var(--color-text-secondary)'}
                      strokeWidth="20"
                      strokeDasharray={strokeDasharray}
                      strokeDashoffset={strokeDashoffset}
                      transform="rotate(-90 60 60)"
                    />
                  );
                });
              })()} 
            </svg>
            
            {/* Legend */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)' }}>
              {Object.entries(contributionsByType).map(([type, count]) => {
                const percentage = (count / total) * 100;
                return (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)', fontSize: 'var(--font-size-xs)' }}>
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: typeColors[type] || 'var(--color-text-secondary)'
                    }} />
                    <span className="text-secondary">
                      {typeLabels[type] || type}
                    </span>
                    <span className="text-primary font-semibold">
                      {percentage.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      ) : (
        <div className="text-sm text-secondary">
          No activity in {year || 'this period'}
        </div>
      )}
    </div>
  );
};

export default ActivityOverview;
