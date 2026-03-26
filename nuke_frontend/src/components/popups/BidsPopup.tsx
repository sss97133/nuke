/**
 * BidsPopup — Shows bid history for a vehicle in a stacking popup.
 *
 * Extracts bids from auction_comments where bid_amount > 0.
 * Falls back to showing the source auction link if no granular bid data.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  vehicleId: string;
  bidCount?: number;
  highBid?: number | null;
  listingUrl?: string | null;
  searchQuery?: string;
}

interface BidRow {
  comment_id: string;
  author_username: string | null;
  bid_amount: number;
  observed_at: string;
  platform: string | null;
}

const MONO = "'Courier New', Courier, monospace";
const SANS = 'Arial, Helvetica, sans-serif';

function formatTimeAgo(dateString: string): string {
  try {
    const d = new Date(dateString);
    const ms = Date.now() - d.getTime();
    if (ms < 0 || !Number.isFinite(ms)) return '';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 365) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

export function BidsPopup({ vehicleId, bidCount, highBid, listingUrl, searchQuery }: Props) {
  const [bids, setBids] = useState<BidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Fetch comments that are bids (have bid_amount)
        const { data, error: err } = await supabase
          .from('vehicle_comments_unified')
          .select('comment_id, author_username, bid_amount, observed_at, platform')
          .eq('vehicle_id', vehicleId)
          .not('bid_amount', 'is', null)
          .gt('bid_amount', 0)
          .order('bid_amount', { ascending: false })
          .limit(100);

        if (err) throw err;
        if (!cancelled) setBids((data || []) as BidRow[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load bids');
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [vehicleId]);

  const sq = (searchQuery || '').toLowerCase().trim();
  const filtered = sq
    ? bids.filter(b =>
        (b.author_username || '').toLowerCase().includes(sq) ||
        String(b.bid_amount).includes(sq) ||
        `$${Number(b.bid_amount).toLocaleString()}`.toLowerCase().includes(sq))
    : bids;

  const maxBid = filtered.length > 0 ? Math.max(...filtered.map(b => Number(b.bid_amount))) : (highBid || null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Summary bar */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '2px solid #2a2a2a',
        display: 'flex',
        gap: 16,
        alignItems: 'center',
      }}>
        <div>
          <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#999' }}>
            BIDS
          </span>
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginLeft: 6 }}>
            {loading ? '...' : filtered.length > 0 ? filtered.length : (bidCount || 0)}
          </span>
        </div>
        {maxBid != null && maxBid > 0 && (
          <div>
            <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#999' }}>
              HIGH BID
            </span>
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#004225', marginLeft: 6 }}>
              ${maxBid.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* Bid list */}
      <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '20px 12px', textAlign: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
              Loading bid history...
            </span>
          </div>
        )}

        {error && (
          <div style={{ padding: '20px 12px', textAlign: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#8a0020' }}>{error}</span>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && sq && (
          <div style={{ padding: '16px 12px', textAlign: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
              No matching bids
            </span>
          </div>
        )}

        {!loading && !error && bids.length === 0 && !sq && (
          <div style={{ padding: '16px 12px' }}>
            <div style={{ fontFamily: SANS, fontSize: 10, color: '#666', marginBottom: 8 }}>
              No granular bid data extracted for this vehicle.
            </div>
            {bidCount != null && bidCount > 0 && (
              <div style={{ fontFamily: MONO, fontSize: 10, color: '#1a1a1a', marginBottom: 8 }}>
                {bidCount} bid{bidCount !== 1 ? 's' : ''} reported by the auction platform.
              </div>
            )}
            {highBid != null && highBid > 0 && (
              <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: '#004225', marginBottom: 8 }}>
                High bid: ${highBid.toLocaleString()}
              </div>
            )}
            {listingUrl && (
              <a
                href={listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: SANS, fontSize: 9, fontWeight: 800,
                  textTransform: 'uppercase' as const, letterSpacing: '0.3px',
                  padding: '4px 10px', border: '2px solid #2a2a2a',
                  background: '#2a2a2a', color: '#fff',
                  textDecoration: 'none', display: 'inline-block',
                }}
              >
                VIEW SOURCE LISTING
              </a>
            )}
          </div>
        )}

        {!loading && bids.map((b, i) => {
          const isHighest = i === 0;
          const barWidth = maxBid && maxBid > 0 ? Math.max(4, (Number(b.bid_amount) / maxBid) * 100) : 100;

          return (
            <div
              key={b.comment_id}
              style={{
                padding: '6px 12px',
                borderBottom: '1px solid #e0e0e0',
                background: isHighest ? 'rgba(0,66,37,0.03)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{
                  fontFamily: MONO, fontSize: 12, fontWeight: 700,
                  color: isHighest ? '#004225' : '#1a1a1a', flexShrink: 0,
                }}>
                  ${Number(b.bid_amount).toLocaleString()}
                </span>
                <span style={{
                  fontFamily: MONO, fontSize: 9, fontWeight: 700,
                  color: '#666', maxWidth: 120,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {b.author_username || 'Anonymous'}
                </span>
                <span style={{
                  fontFamily: MONO, fontSize: 8, color: '#999', marginLeft: 'auto', flexShrink: 0,
                }}>
                  {formatTimeAgo(b.observed_at)}
                </span>
              </div>
              {/* Visual bar */}
              <div style={{ height: 2, background: '#e0e0e0', width: '100%' }}>
                <div style={{
                  height: 2,
                  width: `${barWidth}%`,
                  background: isHighest ? '#004225' : '#2a6fa0',
                  transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
