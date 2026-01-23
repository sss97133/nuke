import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface BidExecution {
  id: string;
  scheduled_for: string;
  status: 'queued' | 'locked' | 'executing' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  result_data?: {
    success?: boolean;
    bid_amount_cents?: number;
    is_high_bidder?: boolean;
    message?: string;
  };
  error_message?: string;
}

interface BidExecutionStatusProps {
  proxyBidId: string;
  onStatusChange?: (status: string) => void;
}

export default function BidExecutionStatus({ proxyBidId, onStatusChange }: BidExecutionStatusProps) {
  const [execution, setExecution] = useState<BidExecution | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchExecution = async () => {
      const { data, error } = await supabase
        .from('bid_execution_queue')
        .select('*')
        .eq('proxy_bid_request_id', proxyBidId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        setExecution(data);
        onStatusChange?.(data.status);
      }
      setLoading(false);
    };

    fetchExecution();

    // Real-time subscription
    const subscription = supabase
      .channel(`bid_execution_${proxyBidId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bid_execution_queue',
          filter: `proxy_bid_request_id=eq.${proxyBidId}`
        },
        (payload) => {
          if (payload.new) {
            setExecution(payload.new as BidExecution);
            onStatusChange?.((payload.new as BidExecution).status);
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [proxyBidId, onStatusChange]);

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'queued':
        return {
          color: '#3b82f6',
          bg: '#eff6ff',
          icon: '⏳',
          label: 'Scheduled',
          description: 'Waiting for execution window'
        };
      case 'locked':
        return {
          color: '#f59e0b',
          bg: '#fef3c7',
          icon: '🔒',
          label: 'Preparing',
          description: 'Bid execution starting'
        };
      case 'executing':
        return {
          color: '#f59e0b',
          bg: '#fef3c7',
          icon: '⚡',
          label: 'Executing',
          description: 'Placing bid now...'
        };
      case 'completed':
        return {
          color: '#22c55e',
          bg: '#dcfce7',
          icon: '✓',
          label: 'Completed',
          description: 'Bid successfully placed'
        };
      case 'failed':
        return {
          color: '#ef4444',
          bg: '#fef2f2',
          icon: '✗',
          label: 'Failed',
          description: 'Bid execution failed'
        };
      case 'cancelled':
        return {
          color: '#6b7280',
          bg: '#f3f4f6',
          icon: '○',
          label: 'Cancelled',
          description: 'Bid was cancelled'
        };
      default:
        return {
          color: 'var(--text-muted)',
          bg: 'var(--surface-hover)',
          icon: '?',
          label: status,
          description: ''
        };
    }
  };

  const formatScheduledTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff < 0) {
      return 'Now';
    } else if (diff < 60000) {
      return `In ${Math.floor(diff / 1000)}s`;
    } else if (diff < 3600000) {
      return `In ${Math.floor(diff / 60000)}m`;
    } else {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

  if (loading) {
    return (
      <div style={{
        padding: '12px',
        background: 'var(--surface-hover)',
        borderRadius: '4px',
        fontSize: '8pt',
        color: 'var(--text-muted)'
      }}>
        Loading execution status...
      </div>
    );
  }

  if (!execution) {
    return null;
  }

  const statusInfo = getStatusInfo(execution.status);

  return (
    <div style={{
      border: `2px solid ${statusInfo.color}`,
      borderRadius: '6px',
      overflow: 'hidden'
    }}>
      {/* Status header */}
      <div style={{
        background: statusInfo.bg,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <span style={{ fontSize: '14pt' }}>{statusInfo.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: '9pt',
            fontWeight: 700,
            color: statusInfo.color
          }}>
            {statusInfo.label}
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
            {statusInfo.description}
          </div>
        </div>

        {execution.status === 'queued' && (
          <div style={{
            fontSize: '9pt',
            fontWeight: 600,
            color: statusInfo.color
          }}>
            {formatScheduledTime(execution.scheduled_for)}
          </div>
        )}
      </div>

      {/* Details */}
      <div style={{ padding: '10px 12px', background: 'var(--surface)' }}>
        {/* Progress for executing status */}
        {(execution.status === 'locked' || execution.status === 'executing') && (
          <div style={{ marginBottom: '10px' }}>
            <div style={{
              height: '4px',
              background: 'var(--border)',
              borderRadius: '2px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                background: statusInfo.color,
                width: execution.status === 'executing' ? '75%' : '25%',
                transition: 'width 0.5s ease'
              }} />
            </div>
          </div>
        )}

        {/* Result for completed */}
        {execution.status === 'completed' && execution.result_data && (
          <div style={{ fontSize: '8pt' }}>
            {execution.result_data.bid_amount_cents && (
              <div style={{ marginBottom: '4px' }}>
                Bid placed: <strong>${(execution.result_data.bid_amount_cents / 100).toLocaleString()}</strong>
              </div>
            )}
            {execution.result_data.is_high_bidder !== undefined && (
              <div style={{
                color: execution.result_data.is_high_bidder ? '#22c55e' : '#f59e0b'
              }}>
                {execution.result_data.is_high_bidder ? '✓ You are the high bidder' : '⚠ Outbid'}
              </div>
            )}
          </div>
        )}

        {/* Error for failed */}
        {execution.status === 'failed' && execution.error_message && (
          <div style={{
            fontSize: '8pt',
            color: '#ef4444'
          }}>
            {execution.error_message}
          </div>
        )}

        {/* Retry info */}
        {execution.attempts > 0 && execution.status !== 'completed' && (
          <div style={{
            fontSize: '7pt',
            color: 'var(--text-muted)',
            marginTop: '6px'
          }}>
            Attempt {execution.attempts} of {execution.max_attempts}
          </div>
        )}
      </div>
    </div>
  );
}
