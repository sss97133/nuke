import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import toast from 'react-hot-toast';

interface FollowAuctionCardProps {
  vehicleId: string;
  listingUrl?: string | null;
  platform?: string | null;
  auctionDate?: string | null;
  onClose: () => void;
}

export const FollowAuctionCard: React.FC<FollowAuctionCardProps> = ({
  vehicleId,
  listingUrl,
  platform,
  auctionDate,
  onClose
}) => {
  const { user } = useAuth();
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingFollow, setCheckingFollow] = useState(true);

  useEffect(() => {
    checkFollowStatus();
  }, [vehicleId, user?.id]);

  const checkFollowStatus = async () => {
    if (!user?.id) {
      setCheckingFollow(false);
      return;
    }

    try {
      // Check user_subscriptions for vehicle_status_change type
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('subscription_type', 'vehicle_status_change')
        .eq('target_id', vehicleId)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking follow status:', error);
      } else {
        setIsFollowing(!!data);
      }
    } catch (error) {
      console.error('Error checking follow status:', error);
    } finally {
      setCheckingFollow(false);
    }
  };

  const handleFollow = async () => {
    if (!user) {
      toast.error('Please sign in to follow this auction');
      return;
    }

    setLoading(true);
    try {
      if (isFollowing) {
        // Unfollow
        const { error } = await supabase
          .from('user_subscriptions')
          .delete()
          .eq('user_id', user.id)
          .eq('subscription_type', 'vehicle_status_change')
          .eq('target_id', vehicleId);

        if (error && error.code !== 'PGRST116') {
          throw error;
        }
        setIsFollowing(false);
        toast.success('Unfollowed auction');
      } else {
        // Follow
        const { error } = await supabase
          .from('user_subscriptions')
          .insert({
            user_id: user.id,
            subscription_type: 'vehicle_status_change',
            target_id: vehicleId,
            is_active: true,
            filters: {
              auction_updates: true,
              auction_ending_soon: true
            }
          });

        if (error) throw error;
        setIsFollowing(true);
        toast.success('Following auction - you\'ll get updates');
      }
    } catch (error: any) {
      console.error('Error toggling follow:', error);
      toast.error(error.message || 'Failed to update follow status');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      if (!Number.isFinite(date.getTime())) return null;
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }).format(date);
    } catch {
      return null;
    }
  };

  const formatPlatformName = (platformName: string | null | undefined) => {
    if (!platformName) return 'Auction';
    const name = String(platformName).toLowerCase();
    if (name === 'bat') return 'Bring a Trailer';
    if (name === 'cars_and_bids') return 'Cars & Bids';
    if (name === 'ebay_motors') return 'eBay Motors';
    if (name === 'mecum') return 'Mecum';
    return platformName.charAt(0).toUpperCase() + platformName.slice(1);
  };

  const formattedDate = formatDate(auctionDate);
  const platformName = formatPlatformName(platform);

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        borderRadius: '0px',
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.15)',
        padding: '16px',
        fontSize: '9pt',
        color: 'var(--text)',
        width: '320px'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ fontWeight: 700, fontSize: '10pt' }}>
          {platformName} Auction
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            color: 'var(--text-secondary)',
            padding: 0,
            lineHeight: 1
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      {formattedDate && (
        <div style={{ marginBottom: '12px', color: 'var(--text-secondary)', fontSize: '8pt' }}>
          Auction Date: <strong>{formattedDate}</strong>
        </div>
      )}

      <div style={{ marginBottom: '16px', fontSize: '8pt', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Follow this auction to get notified when:
      </div>

      <ul style={{ 
        margin: 0, 
        paddingLeft: '20px', 
        marginBottom: '16px',
        fontSize: '8pt',
        color: 'var(--text-secondary)',
        lineHeight: 1.6
      }}>
        <li>The auction goes live</li>
        <li>New bids are placed</li>
        <li>The auction is ending soon</li>
        <li>The auction ends</li>
      </ul>

      {listingUrl && (
        <div style={{ marginBottom: '16px' }}>
          <a
            href={listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              fontSize: '8pt',
              color: 'var(--link-color)',
              textDecoration: 'underline',
              cursor: 'pointer'
            }}
          >
            View auction listing →
          </a>
        </div>
      )}

      <button
        onClick={handleFollow}
        disabled={loading || checkingFollow}
        style={{
          width: '100%',
          padding: '10px 16px',
          border: '2px solid var(--border)',
          background: isFollowing ? 'var(--surface)' : 'var(--button-bg, #000)',
          color: isFollowing ? 'var(--text)' : 'var(--button-text, #fff)',
          fontSize: '9pt',
          fontWeight: 700,
          cursor: loading || checkingFollow ? 'not-allowed' : 'pointer',
          borderRadius: '0px',
          opacity: loading || checkingFollow ? 0.6 : 1,
          transition: 'all 0.12s ease'
        }}
        onMouseEnter={(e) => {
          if (!loading && !checkingFollow) {
            e.currentTarget.style.borderColor = 'var(--text)';
          }
        }}
        onMouseLeave={(e) => {
          if (!loading && !checkingFollow) {
            e.currentTarget.style.borderColor = 'var(--border)';
          }
        }}
      >
        {checkingFollow ? 'Loading...' : loading ? 'Updating...' : isFollowing ? 'Following' : 'Follow Auction'}
      </button>

      {!user && (
        <div style={{ marginTop: '12px', fontSize: '7pt', color: 'var(--text-secondary)', textAlign: 'center' }}>
          <a href="/login" style={{ color: 'var(--link-color)', textDecoration: 'underline' }}>
            Sign in to follow auctions
          </a>
        </div>
      )}
    </div>
  );
};

