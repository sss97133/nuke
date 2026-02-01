import React from 'react';

interface EngagementData {
  views_24h?: number;
  views_7d?: number;
  favorites?: number;
  comments?: number;
  contributors?: number;
  last_activity_ago?: string;
}

interface VehicleEngagementMetricsProps {
  data: EngagementData;
}

const VehicleEngagementMetrics: React.FC<VehicleEngagementMetricsProps> = ({ data }) => {
  const formatNumber = (num?: number) => {
    if (!num) return 0;
    if (num > 1000) return (num / 1000).toFixed(1) + 'k';
    return num;
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        fontSize: '11px',
        padding: '8px',
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        borderRadius: '4px',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '#0ea5e9';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
      }}
    >
      {/* Views */}
      <div
        style={{
          padding: '8px',
          background: 'var(--bg)',
          borderRadius: '2px',
          textAlign: 'center',
          transition: 'all 0.15s ease',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = '#3b82f622';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg)';
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#3b82f6' }}>👁️</div>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text)', marginTop: '2px' }}>
          {formatNumber(data.views_24h || 0)}
        </div>
        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>today</div>
      </div>

      {/* Favorites (Like pump.fun's volume) */}
      <div
        style={{
          padding: '8px',
          background: 'var(--bg)',
          borderRadius: '2px',
          textAlign: 'center',
          transition: 'all 0.15s ease',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = '#ec489922';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg)';
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#ec4899' }}>❤️</div>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text)', marginTop: '2px' }}>
          {formatNumber(data.favorites || 0)}
        </div>
        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>favorites</div>
      </div>

      {/* Comments (Like pump.fun's holders) */}
      <div
        style={{
          padding: '8px',
          background: 'var(--bg)',
          borderRadius: '2px',
          textAlign: 'center',
          transition: 'all 0.15s ease',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = '#10b98122';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = 'var(--bg)';
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#10b981' }}>💬</div>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text)', marginTop: '2px' }}>
          {formatNumber(data.comments || 0)}
        </div>
        <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>comments</div>
      </div>

      {/* Contributors Row - spans 2 cols */}
      <div
        style={{
          gridColumn: '1 / 3',
          padding: '8px',
          background: 'var(--bg)',
          borderRadius: '2px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
          {data.contributors || 0} contributors
        </span>
        <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
          {data.last_activity_ago ? `Active ${data.last_activity_ago}` : ''}
        </span>
      </div>
    </div>
  );
};

export default VehicleEngagementMetrics;
