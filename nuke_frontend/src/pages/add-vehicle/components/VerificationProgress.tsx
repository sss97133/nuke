import React, { memo } from 'react';
import type { VerificationProgress as ProgressType } from '../types';
import { getTierInfo } from '../utils/verificationProgress';

interface VerificationProgressProps {
  progress: ProgressType;
  className?: string;
}

const VerificationProgress: React.FC<VerificationProgressProps> = memo(({
  progress,
  className = ''
}) => {
  const tierInfo = getTierInfo(progress.tier);
  const progressPercentage = Math.min(progress.completionPercentage, 100);

  return (
    <div className={`verification-progress-compact ${className}`}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        fontSize: '8pt',
        height: '16px',
        color: 'var(--text-muted)'
      }}>
        {/* Percentage first */}
        <div style={{ fontWeight: 'bold', minWidth: '35px' }}>
          {progressPercentage}%
        </div>

        {/* Progress Bar - inline */}
        <div style={{
          flex: 1,
          maxWidth: '250px',
          height: '6px',
          backgroundColor: 'var(--border-light)',
          borderRadius: '3px',
          overflow: 'hidden',
          position: 'relative'
        }}>
          <div style={{
            width: `${progressPercentage}%`,
            height: '100%',
            backgroundColor: getTierColor(progress.tier),
            transition: 'width 0.3s ease'
          }} />
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '12px', whiteSpace: 'nowrap' }}>
          <span><strong>{progress.points}</strong> pts</span>
          <span>{progress.fieldsCompleted}/{progress.totalFields} fields</span>
        </div>

        {/* Next Milestone - compact with ellipsis */}
        {progress.tier < 5 && (
          <div style={{ 
            fontSize: '7pt', 
            opacity: 0.7,
            maxWidth: '180px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            Next: {progress.nextMilestone}
          </div>
        )}
      </div>
    </div>
  );
});

// Helper function to get tier color
function getTierColor(tier: number): string {
  switch (tier) {
    case 1: return 'var(--muted, #6b7280)';
    case 2: return 'var(--info, #3b82f6)';
    case 3: return 'var(--success, #10b981)';
    case 4: return 'var(--warning, #f59e0b)';
    case 5: return 'var(--purple, #8b5cf6)';
    default: return 'var(--primary, #3b82f6)';
  }
}

// Helper function to get tier benefits
function getTierBenefits(tier: number): string[] {
  switch (tier) {
    case 1:
      return [
        'Basic vehicle listing',
        'Public profile visibility',
        'Image upload capability'
      ];
    case 2:
      return [
        'Enhanced search visibility',
        'Detailed specification display',
        'Value estimation access'
      ];
    case 3:
      return [
        'Premium listing features',
        'Advanced analytics',
        'Expert verification badge'
      ];
    case 4:
      return [
        'Professional documentation',
        'Priority customer support',
        'Advanced marketplace features'
      ];
    case 5:
      return [
        'Expert certification badge',
        'Maximum credibility',
        'Premium collector status',
        'VIP customer support'
      ];
    default:
      return [];
  }
}

VerificationProgress.displayName = 'VerificationProgress';

export default VerificationProgress;