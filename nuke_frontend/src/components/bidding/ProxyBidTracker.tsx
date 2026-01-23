import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

export interface ProxyBid {
  id: string;
  external_listing_id: string;
  vehicle_id: string;
  platform: string;
  external_auction_url: string;
  max_bid_cents: number;
  bid_strategy: string;
  deposit_status: string;
  status: 'pending' | 'active' | 'outbid' | 'winning' | 'won' | 'lost' | 'cancelled' | 'expired';
  current_bid_cents: number | null;
  final_bid_cents: number | null;
  won_at: string | null;
  created_at: string;
  updated_at: string;
  vehicle?: {
    year: number;
    make: string;
    model: string;
    primary_image_url?: string;
  };
  external_listing?: {
    end_date: string;
    current_bid: number;
    listing_status: string;
  };
}

// Hook to track all proxy bids for the current user
export function useProxyBids() {
  const { user } = useAuth();
  const [bids, setBids] = useState<ProxyBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBidsCount, setActiveBidsCount] = useState(0);

  const fetchBids = useCallback(async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('proxy_bid_requests')
      .select(`
        *,
        vehicle:vehicles(year, make, model, primary_image_url),
        external_listing:external_listings(end_date, current_bid, listing_status)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setBids(data as ProxyBid[]);
      setActiveBidsCount(
        data.filter((b) => ['pending', 'active', 'outbid', 'winning'].includes(b.status)).length
      );
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchBids();

    if (!user) return;

    // Real-time subscription for proxy_bid_requests
    const channel = supabase
      .channel('proxy_bids_tracker')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'proxy_bid_requests',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            fetchBids(); // Refetch to get related data
          } else if (payload.eventType === 'UPDATE') {
            setBids((prev) =>
              prev.map((bid) =>
                bid.id === payload.new.id ? { ...bid, ...payload.new } : bid
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setBids((prev) => prev.filter((bid) => bid.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchBids]);

  return { bids, loading, activeBidsCount, refetch: fetchBids };
}

// Hook to listen for bid status changes and trigger notifications
export function useBidNotifications(onNotification?: (notification: BidNotification) => void) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<BidNotification[]>([]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('bid_notifications')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'proxy_bid_requests',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          const oldStatus = payload.old?.status;
          const newStatus = payload.new?.status;

          // Only notify on significant status changes
          if (oldStatus === newStatus) return;

          // Get vehicle info for the notification
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('year, make, model')
            .eq('id', payload.new.vehicle_id)
            .single();

          const vehicleName = vehicle
            ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
            : 'your bid';

          let notification: BidNotification | null = null;

          switch (newStatus) {
            case 'winning':
              notification = {
                id: `${payload.new.id}-winning`,
                type: 'winning',
                title: 'You are the high bidder!',
                message: `You are currently winning ${vehicleName}`,
                bidId: payload.new.id,
                vehicleName,
                timestamp: new Date().toISOString(),
              };
              break;

            case 'outbid':
              notification = {
                id: `${payload.new.id}-outbid`,
                type: 'outbid',
                title: 'You have been outbid',
                message: `Someone placed a higher bid on ${vehicleName}`,
                bidId: payload.new.id,
                vehicleName,
                timestamp: new Date().toISOString(),
              };
              break;

            case 'won':
              notification = {
                id: `${payload.new.id}-won`,
                type: 'won',
                title: 'Congratulations!',
                message: `You won the auction for ${vehicleName}!`,
                bidId: payload.new.id,
                vehicleName,
                amount: payload.new.final_bid_cents,
                timestamp: new Date().toISOString(),
              };
              break;

            case 'lost':
              notification = {
                id: `${payload.new.id}-lost`,
                type: 'lost',
                title: 'Auction ended',
                message: `You did not win ${vehicleName}`,
                bidId: payload.new.id,
                vehicleName,
                timestamp: new Date().toISOString(),
              };
              break;
          }

          if (notification) {
            setNotifications((prev) => [notification!, ...prev.slice(0, 9)]);
            onNotification?.(notification);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, onNotification]);

  const clearNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return { notifications, clearNotification, clearAll };
}

export interface BidNotification {
  id: string;
  type: 'winning' | 'outbid' | 'won' | 'lost' | 'error';
  title: string;
  message: string;
  bidId: string;
  vehicleName: string;
  amount?: number;
  timestamp: string;
}

// Toast notification component for bid events
interface BidToastProps {
  notification: BidNotification;
  onClose: () => void;
}

export function BidToast({ notification, onClose }: BidToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 8000);

    return () => clearTimeout(timer);
  }, [onClose]);

  const getStyles = () => {
    switch (notification.type) {
      case 'winning':
        return { bg: '#dcfce7', border: '#22c55e', icon: '🎉', color: '#166534' };
      case 'outbid':
        return { bg: '#fef3c7', border: '#f59e0b', icon: '⚠️', color: '#92400e' };
      case 'won':
        return { bg: '#dbeafe', border: '#3b82f6', icon: '🏆', color: '#1e40af' };
      case 'lost':
        return { bg: '#f3f4f6', border: '#9ca3af', icon: '😔', color: '#4b5563' };
      case 'error':
        return { bg: '#fef2f2', border: '#ef4444', icon: '❌', color: '#991b1b' };
      default:
        return { bg: 'var(--surface)', border: 'var(--border)', icon: '📢', color: 'var(--text)' };
    }
  };

  const styles = getStyles();

  return (
    <div
      style={{
        background: styles.bg,
        border: `2px solid ${styles.border}`,
        borderRadius: '8px',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        maxWidth: '360px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        animation: 'slideIn 0.3s ease',
      }}
    >
      <span style={{ fontSize: '20pt' }}>{styles.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '10pt', color: styles.color }}>
          {notification.title}
        </div>
        <div style={{ fontSize: '9pt', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {notification.message}
        </div>
        {notification.amount && (
          <div style={{ fontSize: '9pt', fontWeight: 600, marginTop: '4px' }}>
            ${(notification.amount / 100).toLocaleString()}
          </div>
        )}
      </div>
      <button
        onClick={onClose}
        style={{
          background: 'none',
          border: 'none',
          fontSize: '14pt',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          padding: 0,
        }}
      >
        ×
      </button>
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

// Container for displaying multiple toasts
export function BidToastContainer() {
  const { notifications, clearNotification } = useBidNotifications();

  if (notifications.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '80px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {notifications.map((notification) => (
        <BidToast
          key={notification.id}
          notification={notification}
          onClose={() => clearNotification(notification.id)}
        />
      ))}
    </div>
  );
}

// Active bids indicator for header/nav
interface ActiveBidsIndicatorProps {
  onClick?: () => void;
}

export function ActiveBidsIndicator({ onClick }: ActiveBidsIndicatorProps) {
  const { activeBidsCount } = useProxyBids();

  if (activeBidsCount === 0) return null;

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        background: '#dbeafe',
        border: '1px solid #3b82f6',
        borderRadius: '20px',
        cursor: 'pointer',
        fontSize: '8pt',
        fontWeight: 600,
        color: '#1e40af',
      }}
      title="View active bids"
    >
      <span>🎯</span>
      <span>{activeBidsCount} Active Bid{activeBidsCount !== 1 ? 's' : ''}</span>
    </button>
  );
}
