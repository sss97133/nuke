// Profile Stats Component - Display user statistics and metrics
import React from 'react';
import type { ProfileStats as ProfileStatsType } from '../../types/profile';

interface ProfileStatsProps {
  stats: ProfileStatsType | null;
  isOwnProfile: boolean;
}

const ProfileStats: React.FC<ProfileStatsProps> = ({ stats, isOwnProfile }) => {
  if (!stats) {
    return (
      <div className="card">
        <div className="card-body">
          <h3 className="text font-bold">Statistics</h3>
          <div style={{ textAlign: 'center', padding: '24px' }}>
            <p className="text-small text-muted">No statistics available yet</p>
          </div>
        </div>
      </div>
    );
  }

  // Calculate total documented value (parts + labor @ $150/hr)
  const totalDocumentedValue = (stats.total_timeline_events || 0) * 500; // Avg event worth ~$500
  const totalLaborValue = (stats.total_timeline_events || 0) * 150 * 2; // Avg 2hrs per event
  
  const statItems = [
    {
      label: 'Total Documented Value',
      value: `$${totalDocumentedValue.toLocaleString()}`,
      color: '#00ff00'
    },
    {
      label: 'Labor Value',
      value: `$${totalLaborValue.toLocaleString()}`,
      color: '#00ffff'
    },
    {
      label: 'Receipts/Work Orders',
      value: stats.total_timeline_events,
      color: '#ffff00'
    },
    {
      label: 'Photo Evidence',
      value: stats.total_images,
      color: '#ff00ff'
    }
  ];

  const allStats = statItems;

  return (
    <div className="card">
      <div className="card-body">
        <h3 className="text font-bold" style={{ marginBottom: 'var(--space-4)' }}>Documented Value</h3>
        
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-3)'
        }}>
          {allStats.map((stat, index) => (
            <div 
              key={index}
              style={{
                padding: 'var(--space-3)',
                borderRadius: '4px',
                background: '#000',
                border: '2px solid ' + stat.color,
                textAlign: 'center'
              }}
            >
              <div style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: stat.color,
                marginBottom: 'var(--space-1)'
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: '10px',
                color: stat.color,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontWeight: 600
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProfileStats;
