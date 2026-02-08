export type DealScoreLabel =
  | 'plus_3'
  | 'plus_2'
  | 'plus_1'
  | 'fair'
  | 'minus_1'
  | 'minus_2'
  | 'minus_3';

export interface DealScoreConfig {
  display: string;
  color: string;
  colorRgba: string;
  description: string;
}

export const DEAL_SCORE_CONFIG: Record<DealScoreLabel, DealScoreConfig> = {
  plus_3: {
    display: '+++',
    color: '#059669',
    colorRgba: 'rgba(5,150,105,0.92)',
    description: 'Significantly below market',
  },
  plus_2: {
    display: '++',
    color: '#10b981',
    colorRgba: 'rgba(16,185,129,0.92)',
    description: 'Well below market',
  },
  plus_1: {
    display: '+',
    color: '#34d399',
    colorRgba: 'rgba(52,211,153,0.92)',
    description: 'Below market',
  },
  fair: {
    display: 'FAIR',
    color: '#6b7280',
    colorRgba: 'rgba(107,114,128,0.92)',
    description: 'At market',
  },
  minus_1: {
    display: '\u2212',
    color: '#fb923c',
    colorRgba: 'rgba(251,146,60,0.92)',
    description: 'Above market',
  },
  minus_2: {
    display: '\u2212\u2212',
    color: '#f97316',
    colorRgba: 'rgba(249,115,22,0.92)',
    description: 'Well above market',
  },
  minus_3: {
    display: '\u2212\u2212\u2212',
    color: '#ef4444',
    colorRgba: 'rgba(239,68,68,0.92)',
    description: 'Significantly above market',
  },
};

export function deriveDealScoreLabel(dealScore: number): DealScoreLabel {
  if (dealScore >= 25) return 'plus_3';
  if (dealScore >= 15) return 'plus_2';
  if (dealScore >= 5) return 'plus_1';
  if (dealScore >= -5) return 'fair';
  if (dealScore >= -15) return 'minus_1';
  if (dealScore >= -25) return 'minus_2';
  return 'minus_3';
}
