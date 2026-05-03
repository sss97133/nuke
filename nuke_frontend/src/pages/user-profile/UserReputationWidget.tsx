import React from 'react';
import { useUserProfile } from './UserProfileContext';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';

interface ScoreConfig {
  label: string;
  key: string;
  getValue: (profile: any, stats: any) => number | null;
  maxValue: number;
}

const SCORES: ScoreConfig[] = [
  {
    label: 'Reputation',
    key: 'reputation',
    getValue: (p) => p?.reputation_score ?? null,
    maxValue: 100,
  },
  {
    label: 'Contributions',
    key: 'contributions',
    getValue: (_p, s) => {
      const c = (s?.total_comments || 0) + (s?.total_listings || 0) + (s?.total_bids || 0);
      return c > 0 ? Math.min(100, c) : null;
    },
    maxValue: 100,
  },
  {
    label: 'Verification',
    key: 'verification',
    getValue: (p) => {
      const v = p?.verification_status;
      if (!v) return null;
      if (v === 'verified') return 100;
      if (v === 'pending') return 50;
      return 10;
    },
    maxValue: 100,
  },
  {
    label: 'Auction Success',
    key: 'auction-success',
    getValue: (_p, s) => {
      const wins = s?.total_auction_wins || 0;
      const bids = s?.total_bids || 0;
      if (bids === 0) return null;
      return Math.round((wins / bids) * 100);
    },
    maxValue: 100,
  },
  {
    label: 'Comment Quality',
    key: 'comment-quality',
    getValue: (p) => p?.comment_quality_score ?? null,
    maxValue: 100,
  },
];

const UserReputationWidget: React.FC = () => {
  const { profile, stats } = useUserProfile();

  const hasAnyScore = SCORES.some((s) => s.getValue(profile, stats) != null);
  if (!hasAnyScore) return null;

  return (
    <div
      className="up-reputation"
      data-reputation-score={profile?.reputation_score ?? undefined}
      data-verification-level={profile?.verification_status ?? undefined}
      data-auction-success-rate={
        stats && stats.total_bids > 0
          ? Math.round(((stats.total_auction_wins || 0) / stats.total_bids) * 100)
          : undefined
      }
    >
      <CollapsibleWidget variant="profile" title="Reputation Scores">
        {SCORES.map((score) => {
          const val = score.getValue(profile, stats);
          const pct = val != null ? (val / score.maxValue) * 100 : 0;
          return (
            <div className="score-row" key={score.key}>
              <div className="score-row__label">{score.label}</div>
              <div className="score-row__bar">
                <div
                  className="score-row__bar-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div
                className={`score-row__value${val == null ? ' score-row__value--null' : ''}`}
              >
                {val != null ? val : '--'}
              </div>
            </div>
          );
        })}
      </CollapsibleWidget>
    </div>
  );
};

export default UserReputationWidget;
