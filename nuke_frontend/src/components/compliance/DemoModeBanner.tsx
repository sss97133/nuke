/**
 * Demo Mode Banner
 *
 * Sticky banner that appears on all trading/investment pages when
 * the platform is in demo mode (paper trading).
 *
 * Features:
 * - Shows demo mode status message
 * - Indicates regulatory approval status
 * - Can be minimized but not dismissed
 * - Logs banner views for analytics
 */

import React, { useState, useEffect } from 'react';
import { usePlatformStatus } from '../../hooks/usePlatformStatus';

interface DemoModeBannerProps {
  /** Override the default message */
  customMessage?: string;
  /** Position of the banner */
  position?: 'top' | 'bottom';
  /** Whether to show the regulatory status */
  showRegulatoryStatus?: boolean;
  /** Additional class name */
  className?: string;
}

export function DemoModeBanner({
  customMessage,
  position = 'top',
  showRegulatoryStatus = false,
  className = '',
}: DemoModeBannerProps) {
  const { status, loading, isDemoMode, logMetric } = usePlatformStatus();
  const [minimized, setMinimized] = useState(false);

  // Log banner view
  useEffect(() => {
    if (status && isDemoMode) {
      logMetric('demo_banner_viewed', 'platform', undefined, {
        position,
        page: window.location.pathname,
      });
    }
  }, [status, isDemoMode, position, logMetric]);

  // Don't render if loading or not in demo mode
  if (loading || !isDemoMode || !status?.demo_mode.show_demo_banner) {
    return null;
  }

  const message = customMessage || status.demo_mode.message || 'Paper Trading Mode';

  const positionClasses = position === 'top'
    ? 'top-0'
    : 'bottom-0';

  if (minimized) {
    return (
      <div
        className={`fixed ${positionClasses} left-0 right-0 z-50 ${className}`}
      >
        <button
          onClick={() => setMinimized(false)}
          className="w-full bg-amber-500/90 text-black text-xs py-1 hover:bg-amber-400 transition-colors flex items-center justify-center gap-2"
        >
          <span className="font-mono">DEMO</span>
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={position === 'top' ? 'M19 9l-7 7-7-7' : 'M5 15l7-7 7 7'}
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`fixed ${positionClasses} left-0 right-0 z-50 ${className}`}
    >
      <div className="bg-amber-500 text-black">
        <div className="max-w-7xl mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Demo badge */}
              <span className="bg-black text-amber-500 px-2 py-0.5 rounded text-xs font-mono font-bold">
                DEMO
              </span>

              {/* Message */}
              <span className="text-sm font-medium">
                {message}
              </span>

              {/* Regulatory status badges */}
              {showRegulatoryStatus && status?.regulatory_status && (
                <div className="hidden md:flex items-center gap-2 ml-4 text-xs">
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      status.regulatory_status.sec_approved
                        ? 'bg-green-700 text-white'
                        : 'bg-black/20 text-black/70'
                    }`}
                  >
                    SEC {status.regulatory_status.sec_approved ? '✓' : 'Pending'}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      status.regulatory_status.finra_approved
                        ? 'bg-green-700 text-white'
                        : 'bg-black/20 text-black/70'
                    }`}
                  >
                    FINRA {status.regulatory_status.finra_approved ? '✓' : 'Pending'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Info text */}
              <span className="hidden sm:inline text-xs text-black/70">
                All trades are simulated. No real money at risk.
              </span>

              {/* Minimize button */}
              <button
                onClick={() => setMinimized(true)}
                className="p-1 hover:bg-black/10 rounded transition-colors"
                title="Minimize banner"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={position === 'top' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Demo watermark overlay for trading interfaces
 * Adds a subtle "DEMO" watermark across the page
 */
export function DemoWatermark() {
  const { isDemoMode, loading } = usePlatformStatus();

  if (loading || !isDemoMode) {
    return null;
  }

  return (
    <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform: 'rotate(-45deg)',
        }}
      >
        <div className="text-gray-500/10 text-[200px] font-bold font-mono whitespace-nowrap select-none">
          PAPER TRADING
        </div>
      </div>
    </div>
  );
}

/**
 * Trading action wrapper that logs demo metrics
 */
interface DemoTradeWrapperProps {
  children: React.ReactNode;
  onTradeAttempt?: () => void;
  actionType: 'buy' | 'sell' | 'subscribe' | 'deposit';
  entityType?: string;
  entityId?: string;
}

export function DemoTradeWrapper({
  children,
  onTradeAttempt,
  actionType,
  entityType,
  entityId,
}: DemoTradeWrapperProps) {
  const { isDemoMode, logMetric } = usePlatformStatus();

  const handleClick = () => {
    if (isDemoMode) {
      logMetric(`demo_${actionType}_attempted`, entityType, entityId, {
        timestamp: new Date().toISOString(),
      });
    }
    onTradeAttempt?.();
  };

  return (
    <div onClick={handleClick}>
      {children}
    </div>
  );
}

export default DemoModeBanner;
