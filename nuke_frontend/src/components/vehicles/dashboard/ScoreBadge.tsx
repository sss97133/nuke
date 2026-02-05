import React from 'react';

interface ScoreBadgeProps {
  confidence: number;
  interaction: number;
  compact?: boolean;
}

const getScoreColor = (score: number): string => {
  if (score >= 75) return '#15803d'; // green
  if (score >= 50) return '#d97706'; // amber
  return '#dc2626'; // red
};

export const ScoreBadge: React.FC<ScoreBadgeProps> = ({
  confidence,
  interaction,
  compact = false
}) => {
  const confColor = getScoreColor(confidence);
  const intColor = getScoreColor(interaction);

  if (compact) {
    return (
      <span style={{
        fontSize: '8pt',
        fontFamily: 'monospace',
        whiteSpace: 'nowrap'
      }}>
        <span style={{ color: confColor }}>●{confidence}%</span>
        {' '}
        <span style={{ color: intColor }}>●{interaction}%</span>
      </span>
    );
  }

  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      fontSize: '8pt'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 6px',
        background: `${confColor}15`,
        borderRadius: '2px'
      }}>
        <span style={{ color: confColor, fontSize: '10pt' }}>●</span>
        <span style={{ color: confColor, fontWeight: 600 }}>{confidence}%</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '7pt' }}>CONF</span>
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 6px',
        background: `${intColor}15`,
        borderRadius: '2px'
      }}>
        <span style={{ color: intColor, fontSize: '10pt' }}>●</span>
        <span style={{ color: intColor, fontWeight: 600 }}>{interaction}%</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '7pt' }}>INT</span>
      </div>
    </div>
  );
};

export default ScoreBadge;
