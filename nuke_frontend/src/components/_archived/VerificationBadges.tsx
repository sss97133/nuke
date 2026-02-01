import React from 'react';
import '../design-system.css';

interface VerificationBadgesProps {
  badges: string[];
  trustScore: number;
  verificationCount: number;
  showDetails?: boolean;
}

const VerificationBadges: React.FC<VerificationBadgesProps> = ({
  badges,
  trustScore,
  verificationCount,
  showDetails = false
}) => {
  const getBadgeConfig = (badge: string) => {
    const configs = {
      'ai-imported': {
        label: 'AI Imported',
        color: 'bg-gray-100 text-gray-600',
        icon: 'AI',
        description: 'Data imported via AI analysis'
      },
      'owner-verified': {
        label: 'Owner Verified',
        color: 'bg-blue-100 text-blue-700',
        icon: '👤',
        description: 'Verified by vehicle owner'
      },
      'professional-verified': {
        label: 'Professional Verified',
        color: 'bg-green-100 text-green-700',
        icon: '🔧',
        description: 'Verified by automotive professional'
      },
      'multi-source-verified': {
        label: 'Multi-Source Verified',
        color: 'bg-purple-100 text-purple-700',
        icon: '👥',
        description: 'Verified by multiple sources'
      },
      'expert-verified': {
        label: 'Expert Verified',
        color: 'bg-orange-100 text-orange-700',
        icon: '🏆',
        description: 'Verified by certified expert'
      },
      'platinum-verified': {
        label: 'Platinum Verified',
        color: 'bg-gradient-to-r from-gray-400 to-gray-600 text-white',
        icon: '💎',
        description: '95%+ trust score - highest verification level'
      },
      'gold-verified': {
        label: 'Gold Verified',
        color: 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-white',
        icon: '🥇',
        description: '85%+ trust score - premium verification'
      },
      'silver-verified': {
        label: 'Silver Verified',
        color: 'bg-gradient-to-r from-gray-300 to-gray-500 text-white',
        icon: '🥈',
        description: '70%+ trust score - quality verification'
      }
    };

    return configs[badge as keyof typeof configs] || {
      label: badge,
      color: 'bg-gray-100 text-gray-600',
      icon: '✓',
      description: 'Verified'
    };
  };

  const getTrustScoreColor = (score: number) => {
    if (score >= 95) return 'text-purple-600';
    if (score >= 85) return 'text-green-600';
    if (score >= 70) return 'text-blue-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-gray-600';
  };

  return (
    <div className="verification-badges">
      {/* Trust Score Display */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`text-small font-bold ${getTrustScoreColor(trustScore)}`}>
          Trust Score: {Math.round(trustScore)}%
        </div>
        <div className="text-small text-muted">
          ({verificationCount} verification{verificationCount !== 1 ? 's' : ''})
        </div>
      </div>

      {/* Verification Badges */}
      <div className="flex flex-wrap gap-2">
        {badges.map((badge) => {
          const config = getBadgeConfig(badge);
          return (
            <div
              key={badge}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}
              title={showDetails ? config.description : undefined}
            >
              <span>{config.icon}</span>
              <span>{config.label}</span>
            </div>
          );
        })}
      </div>

      {/* Detailed Information */}
      {showDetails && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
          <h4 className="text-small font-bold mb-2">Verification Details</h4>
          <div className="space-y-1">
            {badges.map((badge) => {
              const config = getBadgeConfig(badge);
              return (
                <div key={badge} className="flex items-center gap-2 text-small">
                  <span>{config.icon}</span>
                  <span className="font-medium">{config.label}:</span>
                  <span className="text-muted">{config.description}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default VerificationBadges;
