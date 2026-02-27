/**
 * BidderProfileCard — Popup/card showing bidder intelligence
 *
 * Displays bidder stats, style badge, preferred makes, and activity sparkline.
 * Uses bid-curve-analysis edge function (bidder_profile mode) + mv_bidder_profiles MV.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, getSupabaseFunctionsUrl } from '../../lib/supabase';
import { MiniLineChart, type DataSeries } from '../charts/MiniLineChart';

interface BidderProfileCardProps {
  username: string;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Bidding Style Classification ────────────────────────────────────

type BiddingStyle = 'Early Bird' | 'Late Sniper' | 'Steady Climber' | 'One-Shot' | 'Unknown';

const STYLE_META: Record<BiddingStyle, { color: string; description: string }> = {
  'Early Bird':     { color: '#f59e0b', description: 'Most bids placed in first 25% of auction' },
  'Late Sniper':    { color: '#ef4444', description: 'Most bids in last 10% of auction' },
  'Steady Climber': { color: '#3b82f6', description: 'Bids evenly distributed through auction' },
  'One-Shot':       { color: '#8b5cf6', description: 'Typically places one bid per auction' },
  'Unknown':        { color: '#6b7280', description: '' },
};

// ─── Helpers ─────────────────────────────────────────────────────────

const formatUsd = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n}`;
};

const formatDate = (iso: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
};

// ─── Stat Row ────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: '12px' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export default function BidderProfileCard({ username, isOpen, onClose }: BidderProfileCardProps) {
  // Fetch bidder profile from edge function
  const { data: profileData, isLoading } = useQuery({
    queryKey: ['bidder-profile', username],
    queryFn: async () => {
      const res = await fetch(`${getSupabaseFunctionsUrl()}/bid-curve-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'bidder_profile', bidder_username: username }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json;
    },
    staleTime: 5 * 60 * 1000,
    enabled: isOpen && !!username,
  });

  // Fetch MV profile for percentile data
  const { data: mvProfile } = useQuery({
    queryKey: ['mv-bidder-profile', username],
    queryFn: async () => {
      const { data } = await supabase
        .from('mv_bidder_profiles')
        .select('*')
        .eq('bat_username', username)
        .single();
      return data;
    },
    staleTime: 10 * 60 * 1000,
    enabled: isOpen && !!username,
  });

  // Determine bidding style from recent activity timing patterns
  const biddingStyle: BiddingStyle = useMemo(() => {
    if (!profileData?.profile) return 'Unknown';
    const profile = profileData.profile;

    // Use bidder_style from the enhanced edge function if available
    if (profile.bidder_style) return profile.bidder_style as BiddingStyle;

    // Fallback: rough heuristic from available stats
    const totalBids = profile.total_bids || 0;
    const auctionsParticipated = profile.auctions_participated || 1;
    const bidsPerAuction = totalBids / auctionsParticipated;

    if (bidsPerAuction <= 1.2) return 'One-Shot';
    return 'Steady Climber'; // default fallback
  }, [profileData]);

  // Build sparkline data from recent activity
  const sparklineSeries: DataSeries[] = useMemo(() => {
    if (!profileData?.recent_activity?.length) return [];
    const points = profileData.recent_activity
      .filter((a: any) => a.highest_bid > 0 && a.last_bid_at)
      .map((a: any) => ({
        date: new Date(a.last_bid_at).toISOString().split('T')[0],
        value: Number(a.highest_bid),
      }))
      .reverse();

    if (points.length < 2) return [];
    return [{
      id: 'bids',
      label: 'Bid amounts',
      data: points,
      color: '#3b82f6',
      showArea: true,
    }];
  }, [profileData]);

  const profile = profileData?.profile ?? {};
  const preferredMakes = profileData?.preferred_makes ?? [];
  const styleMeta = STYLE_META[biddingStyle];

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />

      {/* Card */}
      <div
        style={{
          position: 'relative', zIndex: 1,
          background: 'var(--bg, #fff)', border: '1px solid var(--border-light, #e5e7eb)',
          borderRadius: 0, padding: 20, width: 400, maxWidth: '90vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 12, background: 'none', border: 'none',
            cursor: 'pointer', fontSize: '19px', color: 'var(--text-muted)', lineHeight: 1,
          }}
        >
          &times;
        </button>

        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            Loading bidder profile...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* ─── Header ──────────────────────────────── */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '19px', fontWeight: 700 }}>{username}</span>
                {mvProfile && (
                  <span style={{
                    fontSize: '9px', background: 'var(--primary, #3b82f6)', color: '#fff',
                    borderRadius: 10, padding: '1px 8px', fontWeight: 600,
                  }}>
                    {mvProfile.total_bids} bids
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>
                Since {formatDate(profile.first_bid_date)} &middot; {profile.auctions_participated ?? '—'} auctions &middot; {profile.auctions_won ?? 0} wins
              </div>
            </div>

            {/* ─── Style Badge ─────────────────────────── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 0,
              background: `${styleMeta.color}10`, border: `1px solid ${styleMeta.color}30`,
            }}>
              <span style={{ fontWeight: 700, color: styleMeta.color, fontSize: '13px' }}>
                {biddingStyle}
              </span>
              {styleMeta.description && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {styleMeta.description}
                </span>
              )}
            </div>

            {/* ─── Stats ───────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <StatRow label="Win Rate" value={`${profile.win_rate_pct ?? 0}%`} />
              <StatRow label="Avg Bid" value={profile.avg_bid_amount ? formatUsd(profile.avg_bid_amount) : '—'} />
              <StatRow label="Max Bid" value={profile.max_bid ? formatUsd(profile.max_bid) : '—'} />
              <StatRow label="Total Bids" value={profile.total_bids ?? '—'} />
            </div>

            {/* ─── Preferred Makes ─────────────────────── */}
            {preferredMakes.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>
                  Preferred Makes
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {preferredMakes.slice(0, 6).map((m: any) => (
                    <span
                      key={m.make}
                      style={{
                        fontSize: '11px', padding: '2px 8px', borderRadius: 12,
                        background: 'var(--grey-100, #f3f4f6)', color: 'var(--text)',
                        border: '1px solid var(--border-light, #e5e7eb)',
                      }}
                    >
                      {m.make} ({m.auction_count})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Activity Sparkline ──────────────────── */}
            {sparklineSeries.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>
                  Recent Activity
                </div>
                <MiniLineChart
                  series={sparklineSeries}
                  width={352}
                  height={60}
                  showTrendArrow={true}
                />
              </div>
            )}

            {/* ─── Recent Auctions ─────────────────────── */}
            {profileData?.recent_activity?.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase' }}>
                  Recent Auctions
                </div>
                <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: '11px' }}>
                  {profileData.recent_activity.slice(0, 5).map((a: any, i: number) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex', justifyContent: 'space-between', padding: '3px 0',
                        borderBottom: '1px solid var(--border-light, #e5e7eb)',
                      }}
                    >
                      <span>{a.year} {a.make} {a.model}</span>
                      <span style={{ fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {formatUsd(a.highest_bid)}
                        {a.won && (
                          <span style={{ color: '#22c55e', fontSize: '9px', fontWeight: 700 }}>WON</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
