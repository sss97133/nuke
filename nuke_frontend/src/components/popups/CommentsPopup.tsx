/**
 * CommentsPopup — Shows auction comments for a vehicle in a stacking popup.
 *
 * Fetches from vehicle_comments_unified view.
 * Scrollable list: username, timestamp, text. Most recent first.
 * Bid comments highlighted. Seller comments flagged.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  vehicleId: string;
  expectedCount?: number;
}

interface CommentRow {
  comment_id: string;
  comment_text: string;
  observed_at: string;
  author_username: string | null;
  comment_type: string | null;
  bid_amount: number | null;
  is_seller: boolean | null;
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
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

export function CommentsPopup({ vehicleId, expectedCount }: Props) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase
          .from('vehicle_comments_unified')
          .select('comment_id, comment_text, observed_at, author_username, comment_type, bid_amount, is_seller, platform')
          .eq('vehicle_id', vehicleId)
          .order('observed_at', { ascending: false })
          .limit(200);

        if (err) throw err;
        if (!cancelled) setComments((data || []) as CommentRow[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load comments');
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [vehicleId]);

  const bidComments = comments.filter(c => c.bid_amount != null && Number(c.bid_amount) > 0);
  const sellerComments = comments.filter(c => c.is_seller);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Summary bar */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '2px solid #2a2a2a',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <div>
          <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#999' }}>
            TOTAL
          </span>
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginLeft: 6 }}>
            {loading ? '...' : comments.length}
          </span>
          {expectedCount != null && expectedCount !== comments.length && !loading && (
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#999', marginLeft: 4 }}>
              / {expectedCount} expected
            </span>
          )}
        </div>
        {bidComments.length > 0 && (
          <div>
            <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#999' }}>
              BIDS
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: '#2a6fa0', marginLeft: 4 }}>
              {bidComments.length}
            </span>
          </div>
        )}
        {sellerComments.length > 0 && (
          <div>
            <span style={{ fontFamily: SANS, fontSize: 7, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#999' }}>
              SELLER
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: '#8a0020', marginLeft: 4 }}>
              {sellerComments.length}
            </span>
          </div>
        )}
      </div>

      {/* Comment list */}
      <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '20px 12px', textAlign: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
              Loading comments...
            </span>
          </div>
        )}

        {error && (
          <div style={{ padding: '20px 12px', textAlign: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#8a0020' }}>
              {error}
            </span>
          </div>
        )}

        {!loading && !error && comments.length === 0 && (
          <div style={{ padding: '20px 12px', textAlign: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
              No comments extracted yet
            </span>
          </div>
        )}

        {!loading && comments.map((c) => {
          const isBid = c.bid_amount != null && Number(c.bid_amount) > 0;
          const isSeller = Boolean(c.is_seller);

          return (
            <div
              key={c.comment_id}
              style={{
                padding: '6px 12px',
                borderBottom: '1px solid #e0e0e0',
                borderLeft: isBid ? '3px solid #2a6fa0' : isSeller ? '3px solid #8a0020' : '3px solid transparent',
              }}
            >
              {/* Header row: username + time + badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{
                  fontFamily: MONO, fontSize: 9, fontWeight: 700,
                  color: isSeller ? '#8a0020' : '#1a1a1a',
                  maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {c.author_username || 'Anonymous'}
                </span>

                {isSeller && (
                  <span style={{
                    fontFamily: SANS, fontSize: 7, fontWeight: 800,
                    textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                    color: '#8a0020', background: 'rgba(200,16,46,0.06)',
                    padding: '1px 4px', border: '1px solid rgba(200,16,46,0.2)',
                  }}>
                    SELLER
                  </span>
                )}

                {isBid && (
                  <span style={{
                    fontFamily: MONO, fontSize: 8, fontWeight: 700,
                    color: '#2a6fa0', background: 'rgba(106,173,228,0.08)',
                    padding: '1px 4px', border: '1px solid rgba(106,173,228,0.3)',
                  }}>
                    ${Number(c.bid_amount).toLocaleString()}
                  </span>
                )}

                {c.platform && (
                  <span style={{
                    fontFamily: SANS, fontSize: 7, fontWeight: 700,
                    textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                    color: '#999',
                  }}>
                    {c.platform}
                  </span>
                )}

                <span style={{
                  fontFamily: MONO, fontSize: 8, color: '#999', marginLeft: 'auto', flexShrink: 0,
                }}>
                  {formatTimeAgo(c.observed_at)}
                </span>
              </div>

              {/* Comment text */}
              <div style={{
                fontFamily: SANS, fontSize: 10, lineHeight: 1.4,
                color: '#333', wordBreak: 'break-word',
                maxHeight: 60, overflow: 'hidden',
              }}>
                {c.comment_text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
