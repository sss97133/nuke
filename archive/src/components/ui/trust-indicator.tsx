import React from 'react';
import { cn } from '@/lib/utils';
import { tokens } from '@/styles/design-tokens';

export interface TrustIndicatorProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  showPercentage?: boolean;
  className?: string;
  showDetails?: boolean;
}

/**
 * Trust Indicator Component
 * 
 * This component visually represents the trust level of vehicle data,
 * supporting the core Nuke concept of trust mechanisms and data verification.
 * The trust score indicates confidence in the vehicle's digital identity.
 */
export function TrustIndicator({
  score,
  size = 'md',
  label = 'Trust',
  showPercentage = true,
  className,
  showDetails = false,
}: TrustIndicatorProps) {
  // Normalize score to 0-100 range
  const normalizedScore = Math.max(0, Math.min(100, score));
  
  // Determine color based on score
  const getColor = () => {
    if (normalizedScore >= 80) return 'bg-status-verified';
    if (normalizedScore >= 60) return 'bg-status-info';
    if (normalizedScore >= 40) return 'bg-status-warning';
    return 'bg-status-error';
  };
  
  // Size classes
  const sizeClasses = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3',
  };
  
  // Text size classes
  const textSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };
  
  return (
    <div className={cn('w-full', className)}>
      {/* Label and percentage */}
      {(label || showPercentage) && (
        <div className="mb-1 flex items-center justify-between">
          {label && (
            <span className={cn(
              'font-medium text-neutral-700 dark:text-neutral-300',
              textSizeClasses[size]
            )}>
              {label}
            </span>
          )}
          {showPercentage && (
            <span className={cn(
              'font-mono font-medium text-neutral-600 dark:text-neutral-400',
              textSizeClasses[size]
            )}>
              {normalizedScore.toFixed(0)}%
            </span>
          )}
        </div>
      )}
      
      {/* Progress bar */}
      <div className={cn(
        'w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700',
        sizeClasses[size]
      )}>
        <div
          className={cn(
            'transition-all duration-500 ease-out',
            getColor()
          )}
          style={{ width: `${normalizedScore}%` }}
        />
      </div>
      
      {/* Optional detailed breakdown */}
      {showDetails && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 p-2">
            <div className="text-neutral-500 dark:text-neutral-400">Data Sources</div>
            <div className="mt-1 font-medium">
              {getSourceCount(normalizedScore)}
            </div>
          </div>
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 p-2">
            <div className="text-neutral-500 dark:text-neutral-400">Verification</div>
            <div className="mt-1 font-medium">
              {getVerificationLabel(normalizedScore)}
            </div>
          </div>
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 p-2">
            <div className="text-neutral-500 dark:text-neutral-400">History Length</div>
            <div className="mt-1 font-medium">
              {getHistoryLength(normalizedScore)}
            </div>
          </div>
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 p-2">
            <div className="text-neutral-500 dark:text-neutral-400">Blockchain</div>
            <div className="mt-1 font-medium">
              {normalizedScore > 75 ? 'Yes' : 'No'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function to determine source count based on score
function getSourceCount(score: number): string {
  if (score >= 90) return '5+ Sources';
  if (score >= 70) return '3-4 Sources';
  if (score >= 50) return '2 Sources';
  return '1 Source';
}

// Helper function to determine verification label based on score
function getVerificationLabel(score: number): string {
  if (score >= 90) return 'PTZ Verified';
  if (score >= 80) return 'Professional';
  if (score >= 60) return 'Multi-Source';
  if (score >= 40) return 'Basic';
  return 'Unverified';
}

// Helper function to determine history length based on score
function getHistoryLength(score: number): string {
  if (score >= 80) return 'Complete';
  if (score >= 60) return 'Substantial';
  if (score >= 40) return 'Partial';
  return 'Limited';
}
