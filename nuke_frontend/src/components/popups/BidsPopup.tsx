/**
 * BidsPopup — Shows a bounded window of recorded bid reports for a vehicle.
 *
 * Uses the existing unified reader's explicit bid role; an amount alone is not a bid.
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
  vehicle_id: string;
  comment_type: string;
  author_username: string | null;
  bid_amount: number;
  observed_at: string | null;
  platform: string | null;
  comment_url: string | null;
}

const MONO = "'Courier New', Courier, monospace";
const SANS = 'Arial, Helvetica, sans-serif';

function formatTimeAgo(dateString: string | null): string {
  if (!dateString) return 'time unrecorded';
  try {
    const d = new Date(dateString);
    const ms = Date.now() - d.getTime();
    if (!Number.isFinite(ms)) return 'time unrecorded';
    if (ms < 0) return 'recorded time is in the future';
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 365) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return 'time unrecorded';
  }
}

function sourceUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value || '');
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function BidsPopup({ vehicleId, bidCount, highBid, listingUrl, searchQuery }: Props) {
  const [loadedBids, setBids] = useState<BidRow[]>([]);
  const [reading, setLoading] = useState(true);
  const [readError, setError] = useState<string | null>(null);
  const [parentAccessible, setAccessible] = useState(false);
  const [readVehicleId, setReadVehicleId] = useState(vehicleId);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10_000);

    async function load() {
      setLoading(true);
      setReadVehicleId(vehicleId);
      setError(null);
      setBids([]);
      setAccessible(false);
      try {
        const parent = await supabase.from('vehicles').select('id').eq('id', vehicleId).limit(1).abortSignal(controller.signal);
        if (parent.error || parent.data?.length !== 1 || parent.data[0].id !== vehicleId) throw new Error('parent unavailable');
        if (cancelled) return;
        setAccessible(true);
        const { data, error: err } = await supabase
          .from('vehicle_comments_unified')
          .select('comment_id, vehicle_id, comment_type, author_username, bid_amount, observed_at, platform, comment_url')
          .eq('vehicle_id', vehicleId)
          .eq('comment_type', 'bid')
          .gt('bid_amount', 0)
          .order('observed_at', { ascending: false, nullsFirst: false })
          .order('comment_id', { ascending: true })
          .limit(100)
          .abortSignal(controller.signal);

        if (err || !Array.isArray(data) || data.length > 100 || new Set(data.map(row => row.comment_id)).size !== data.length || data.some(row => typeof row.comment_id !== 'string' || !row.comment_id || row.vehicle_id !== vehicleId || row.comment_type !== 'bid' || !Number.isFinite(Number(row.bid_amount)) || Number(row.bid_amount) <= 0)) throw new Error('bid reports unavailable');
        if (!cancelled) setBids(data as BidRow[]);
      } catch {
        if (!cancelled) setError('Bid reports are unavailable for this vehicle.');
      }
      clearTimeout(deadline);
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; controller.abort(); clearTimeout(deadline); };
  }, [vehicleId]);

  const currentScope = readVehicleId === vehicleId;
  const bids = currentScope ? loadedBids : [];
  const loading = !currentScope || reading;
  const error = currentScope ? readError : null;
  const accessible = currentScope && parentAccessible;
  const sq = (searchQuery || '').toLowerCase().trim();
  const filtered = sq
    ? bids.filter(b =>
        (b.author_username || '').toLowerCase().includes(sq) ||
        String(b.bid_amount).includes(sq) ||
        `$${Number(b.bid_amount).toLocaleString()}`.toLowerCase().includes(sq))
    : bids;

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
            REPORTS SHOWN
          </span>
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginLeft: 6 }}>
            {loading ? '...' : error ? 'unavailable' : filtered.length}
          </span>
        </div>
      </div>

      {accessible && <div style={{ padding: '6px 12px', fontFamily: SANS, fontSize: 10, color: '#666' }}>
        Up to 100 newest readable entries marked as bids with positive amounts, across this vehicle's recorded auction episodes. This is a read window, not the full bid count. Currency is unrecorded by this reader; times may be source postings or observation times.
        {bidCount != null && <div style={{ marginTop: 4 }}>Reported count supplied by the vehicle summary: {bidCount.toLocaleString()}.</div>}
      </div>}

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
            <span role="status" style={{ fontFamily: MONO, fontSize: 9, color: '#8a0020' }}>{error}</span>
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
              No positive bid reports in this read. Other retained interactions may carry amounts without being bids.
            </div>
            {highBid != null && highBid > 0 && (
              <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: '#004225', marginBottom: 8 }}>
                Bid number supplied by the vehicle summary: {highBid.toLocaleString()}
              </div>
            )}
            {sourceUrl(listingUrl) && (
              <a
                href={sourceUrl(listingUrl)!}
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

        {!loading && filtered.map(b => {
          return (
            <div
              key={b.comment_id}
              style={{
                padding: '6px 12px',
                borderBottom: '1px solid #e0e0e0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{
                  fontFamily: MONO, fontSize: 12, fontWeight: 700,
                  color: '#1a1a1a', flexShrink: 0,
                }}>
                  {Number(b.bid_amount).toLocaleString()}
                </span>
                <span style={{
                  fontFamily: MONO, fontSize: 9, fontWeight: 700,
                  color: '#666', maxWidth: 120,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {b.author_username || 'author unrecorded'}{b.platform ? ` · ${b.platform}` : ''}
                </span>
                <span style={{
                  fontFamily: MONO, fontSize: 8, color: '#999', marginLeft: 'auto', flexShrink: 0,
                }}>
                  Recorded {formatTimeAgo(b.observed_at)}
                </span>
              </div>
              {sourceUrl(b.comment_url) ? <a href={sourceUrl(b.comment_url)!} target="_blank" rel="noopener noreferrer" style={{ fontFamily: SANS, fontSize: 9 }}>Source ↗</a> : <span style={{ fontFamily: SANS, fontSize: 9, color: '#666' }}>Source link unrecorded</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
