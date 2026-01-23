import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';

interface AuctionCountdownProps {
  externalListingId: string;
  initialEndTime?: string;
  onEnded?: () => void;
  onExtension?: (newEndTime: string) => void;
  showSyncStatus?: boolean;
  size?: 'small' | 'medium' | 'large';
}

interface AuctionState {
  auction_end_time: string;
  current_bid_cents: number;
  bid_count: number;
  high_bidder_username: string | null;
  server_time_offset_ms: number | null;
  is_soft_close_active: boolean;
  extension_count: number;
  last_synced_at: string;
}

export default function AuctionCountdown({
  externalListingId,
  initialEndTime,
  onEnded,
  onExtension,
  showSyncStatus = false,
  size = 'medium'
}: AuctionCountdownProps) {
  const [state, setState] = useState<AuctionState | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [lastSyncAge, setLastSyncAge] = useState<number | null>(null);
  const previousEndTime = useRef<string | null>(null);

  // Fetch auction state
  useEffect(() => {
    const fetchState = async () => {
      const { data, error } = await supabase
        .from('auction_state_cache')
        .select('*')
        .eq('external_listing_id', externalListingId)
        .single();

      if (!error && data) {
        // Check for extension
        if (previousEndTime.current &&
            data.auction_end_time !== previousEndTime.current &&
            new Date(data.auction_end_time) > new Date(previousEndTime.current)) {
          onExtension?.(data.auction_end_time);
        }
        previousEndTime.current = data.auction_end_time;

        setState(data);
        if (data.server_time_offset_ms !== null) {
          setServerOffset(data.server_time_offset_ms);
        }
      }
    };

    fetchState();

    // Real-time subscription
    const subscription = supabase
      .channel(`auction_state_${externalListingId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auction_state_cache',
          filter: `external_listing_id=eq.${externalListingId}`
        },
        (payload) => {
          if (payload.new) {
            const newState = payload.new as AuctionState;

            // Check for extension
            if (state?.auction_end_time &&
                newState.auction_end_time !== state.auction_end_time &&
                new Date(newState.auction_end_time) > new Date(state.auction_end_time)) {
              onExtension?.(newState.auction_end_time);
            }

            setState(newState);
            if (newState.server_time_offset_ms !== null) {
              setServerOffset(newState.server_time_offset_ms);
            }
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [externalListingId]);

  // Countdown timer
  useEffect(() => {
    const endTime = state?.auction_end_time || initialEndTime;
    if (!endTime) return;

    const updateTime = () => {
      // Adjust for server time offset
      const now = Date.now() + serverOffset;
      const end = new Date(endTime).getTime();
      const remaining = Math.max(0, end - now);

      setTimeRemaining(remaining);

      if (remaining === 0) {
        onEnded?.();
      }

      // Update sync age
      if (state?.last_synced_at) {
        const syncAge = Math.floor((Date.now() - new Date(state.last_synced_at).getTime()) / 1000);
        setLastSyncAge(syncAge);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 100); // Update every 100ms for smooth countdown
    return () => clearInterval(interval);
  }, [state?.auction_end_time, initialEndTime, serverOffset, onEnded, state?.last_synced_at]);

  const formatTime = (ms: number | null) => {
    if (ms === null) return '--:--:--';
    if (ms === 0) return 'ENDED';

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  };

  const getUrgencyLevel = (ms: number | null) => {
    if (ms === null || ms === 0) return 'ended';
    if (ms <= 120000) return 'critical';  // < 2 min (soft-close)
    if (ms <= 600000) return 'urgent';    // < 10 min
    if (ms <= 3600000) return 'soon';     // < 1 hour
    return 'normal';
  };

  const getUrgencyStyle = (level: string) => {
    switch (level) {
      case 'critical':
        return { color: '#ef4444', bg: '#fef2f2', border: '#fecaca' };
      case 'urgent':
        return { color: '#f59e0b', bg: '#fef3c7', border: '#fcd34d' };
      case 'soon':
        return { color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' };
      case 'ended':
        return { color: '#6b7280', bg: '#f3f4f6', border: '#d1d5db' };
      default:
        return { color: 'var(--text)', bg: 'var(--surface-hover)', border: 'var(--border)' };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return { fontSize: '11pt', padding: '6px 10px' };
      case 'large':
        return { fontSize: '20pt', padding: '14px 20px' };
      default:
        return { fontSize: '14pt', padding: '10px 14px' };
    }
  };

  const urgency = getUrgencyLevel(timeRemaining);
  const urgencyStyle = getUrgencyStyle(urgency);
  const sizeStyle = getSizeStyles();

  return (
    <div>
      {/* Main countdown */}
      <div style={{
        background: urgencyStyle.bg,
        border: `2px solid ${urgencyStyle.border}`,
        borderRadius: '6px',
        padding: sizeStyle.padding,
        textAlign: 'center'
      }}>
        {/* Soft-close indicator */}
        {state?.is_soft_close_active && timeRemaining !== null && timeRemaining > 0 && (
          <div style={{
            fontSize: '7pt',
            color: '#ef4444',
            fontWeight: 600,
            marginBottom: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            animation: 'pulse 2s infinite'
          }}>
            ⚡ SOFT CLOSE ACTIVE
          </div>
        )}

        {/* Time display */}
        <div style={{
          fontSize: sizeStyle.fontSize,
          fontWeight: 700,
          fontFamily: 'monospace',
          color: urgencyStyle.color,
          letterSpacing: '1px'
        }}>
          {formatTime(timeRemaining)}
        </div>

        {/* Extension count */}
        {state?.extension_count && state.extension_count > 0 && (
          <div style={{
            fontSize: '7pt',
            color: 'var(--text-muted)',
            marginTop: '4px'
          }}>
            Extended {state.extension_count}×
          </div>
        )}
      </div>

      {/* Sync status */}
      {showSyncStatus && state && (
        <div style={{
          fontSize: '7pt',
          color: 'var(--text-muted)',
          marginTop: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>
            {lastSyncAge !== null && (
              <>
                Synced {lastSyncAge < 60 ? `${lastSyncAge}s` : `${Math.floor(lastSyncAge / 60)}m`} ago
              </>
            )}
          </span>
          {serverOffset !== 0 && (
            <span style={{
              color: Math.abs(serverOffset) > 5000 ? '#f59e0b' : 'var(--text-muted)'
            }}>
              Δ{serverOffset > 0 ? '+' : ''}{Math.round(serverOffset / 1000)}s
            </span>
          )}
        </div>
      )}

      {/* Current bid */}
      {state && state.current_bid_cents !== null && (
        <div style={{
          marginTop: '8px',
          padding: '8px 10px',
          background: 'var(--surface-hover)',
          borderRadius: '4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Current bid
          </span>
          <span style={{ fontSize: '10pt', fontWeight: 700 }}>
            ${(state.current_bid_cents / 100).toLocaleString()}
          </span>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
