import React from 'react';
import type { DashboardSummary } from '../../../hooks/useVehiclesDashboard';

interface DashboardStatsBarProps {
  summary: DashboardSummary;
  totalValue?: number;
  avgConfidence?: number;
  avgInteraction?: number;
}

const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toLocaleString();
};

const formatCurrency = (num: number): string => {
  if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(0)}k`;
  return `$${num.toLocaleString()}`;
};

export const DashboardStatsBar: React.FC<DashboardStatsBarProps> = ({
  summary,
  totalValue,
  avgConfidence,
  avgInteraction
}) => {
  const totalVehicles = summary.total_my_vehicles + summary.total_client_vehicles + summary.total_business_vehicles;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
      gap: 'var(--space-2)',
      padding: 'var(--space-3)',
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      marginBottom: 'var(--space-3)'
    }}>
      <StatItem
        value={formatNumber(totalVehicles)}
        label="Vehicles"
      />
      <StatItem
        value={formatNumber(summary.total_my_vehicles)}
        label="Mine"
      />
      <StatItem
        value={formatNumber(summary.total_client_vehicles)}
        label="Client"
      />
      {summary.total_business_vehicles > 0 && (
        <StatItem
          value={formatNumber(summary.total_business_vehicles)}
          label="Fleet"
        />
      )}
      {totalValue !== undefined && totalValue > 0 && (
        <StatItem
          value={formatCurrency(totalValue)}
          label="Value"
        />
      )}
      <StatItem
        value={formatNumber(summary.recent_activity_30d)}
        label="30d Activity"
      />
      {avgConfidence !== undefined && (
        <StatItem
          value={`${avgConfidence}%`}
          label="Avg Conf"
          valueColor={avgConfidence >= 75 ? '#15803d' : avgConfidence >= 50 ? '#d97706' : '#dc2626'}
        />
      )}
      {avgInteraction !== undefined && (
        <StatItem
          value={`${avgInteraction}%`}
          label="Avg Int"
          valueColor={avgInteraction >= 75 ? '#15803d' : avgInteraction >= 50 ? '#d97706' : '#dc2626'}
        />
      )}
    </div>
  );
};

interface StatItemProps {
  value: string;
  label: string;
  valueColor?: string;
}

const StatItem: React.FC<StatItemProps> = ({ value, label, valueColor }) => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 'var(--space-2)',
    background: 'var(--surface-hover)',
    borderRadius: '2px'
  }}>
    <div style={{
      fontSize: '14pt',
      fontWeight: 700,
      color: valueColor || 'var(--text)'
    }}>
      {value}
    </div>
    <div style={{
      fontSize: '7pt',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    }}>
      {label}
    </div>
  </div>
);

export default DashboardStatsBar;
