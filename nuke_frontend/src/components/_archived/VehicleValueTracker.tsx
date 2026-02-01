import React from 'react';

interface VehicleValueTrackerProps {
  currentValue: number;
  purchasePrice?: number;
  salePrice?: number;
}

const VehicleValueTracker: React.FC<VehicleValueTrackerProps> = ({
  currentValue = 0,
  purchasePrice = 0,
  salePrice = 0,
}) => {
  // Calculate appreciation/depreciation
  const valueChange = purchasePrice ? currentValue - purchasePrice : 0;
  const percentChange = purchasePrice ? ((valueChange / purchasePrice) * 100).toFixed(1) : '0';
  const isAppreciating = valueChange >= 0;

  return (
    <div
      style={{
        fontSize: '11px',
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        borderRadius: '4px',
        padding: '12px',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = '#0ea5e9';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 3px #0ea5e922';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      {/* Header: Current Value */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '8px',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Current Value</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
            ${currentValue.toLocaleString()}
          </span>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              color: isAppreciating ? '#10b981' : '#ef4444',
              background: isAppreciating ? '#d1fae522' : '#fee22e22',
              padding: '2px 6px',
              borderRadius: '2px',
            }}
          >
            {isAppreciating ? '↑' : '↓'} {percentChange}%
          </span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
        {/* Purchase Price */}
        <div style={{ padding: '6px', background: 'var(--bg)', borderRadius: '2px' }}>
          <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Purchase</div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
            ${purchasePrice.toLocaleString()}
          </div>
        </div>

        {/* Sale Price (if exists) */}
        {salePrice > 0 && (
          <div style={{ padding: '6px', background: 'var(--bg)', borderRadius: '2px' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Listed</div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef4444' }}>
              ${salePrice.toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Mini Trend Chart */}
      <div
        style={{
          padding: '6px',
          background: 'var(--bg)',
          borderRadius: '2px',
          display: 'flex',
          gap: '2px',
          alignItems: 'flex-end',
          height: '32px',
        }}
      >
        {[70, 75, 80, 85, 90, 95, 100].map((pct, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${pct}%`,
              background: pct >= 95 ? '#10b981' : pct >= 85 ? '#3b82f6' : '#ef4444',
              borderRadius: '2px',
              transition: 'all 0.15s ease',
            }}
            title={`${pct}%`}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.opacity = '0.8';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.opacity = '1';
            }}
          />
        ))}
      </div>

      {/* Status Badge */}
      <div style={{ marginTop: '8px', fontSize: '9px', color: 'var(--text-secondary)' }}>
        {isAppreciating ? (
          <span>✓ Vehicle appreciating in value</span>
        ) : (
          <span>• Standard depreciation</span>
        )}
      </div>
    </div>
  );
};

export default VehicleValueTracker;
