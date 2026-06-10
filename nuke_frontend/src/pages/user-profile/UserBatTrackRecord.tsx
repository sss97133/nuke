/**
 * UserBatTrackRecord — BaT sales history + auction comments for a user profile.
 *
 * Data sources (read directly; no vehicle_events dependency):
 *   - bat_listings WHERE seller_username = username
 *                     OR seller_external_identity_id IN identityIds
 *   - auction_comments WHERE author_external_identity_id IN identityIds
 *                        AND bid_amount IS NULL (comments, not bids)
 *
 * Self-guarding: returns null while loading and when 0 listings AND 0 comments.
 * Design rules: Arial labels (ALL-CAPS 8px), Courier New for data, 2px solid
 * borders, zero radius/shadows/gradients.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BatListingRow {
  id: string;
  vehicle_id: string | null;
  bat_listing_title: string | null;
  bat_listing_url: string | null;
  listing_status: string | null;
  sale_price: number | null;
  final_bid: number | null;
  sale_date: string | null;
  auction_end_date: string | null;
}

interface BatCommentRow {
  id: string;
  comment_text: string | null;
  posted_at: string | null;
  vehicle_id: string | null;
}

interface UserBatTrackRecordProps {
  userId: string;
  /** BaT seller handle for the seller_username match (e.g. 'skylarwilliams'). */
  username: string | null;
  /** Claimed external_identities ids for this profile. */
  identityIds: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONO = "var(--up-font-mono, 'Courier New', Courier, monospace)";
const SANS = 'var(--up-font-sans, Arial, Helvetica, sans-serif)';
const INK = 'var(--up-ink, #1a1a1a)';
const GHOST = 'var(--up-ghost, #dddddd)';
const NO_SALE_COLOR = '#999';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} ${d.getUTCFullYear()}`;
}

function formatPrice(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toLocaleString('en-US')}`;
}

/**
 * Vehicle display name: listing title, or derived from the BaT URL slug
 * when the title is missing (e.g. /listing/1997-lexus-lx450-166 → 1997 LEXUS LX450).
 */
function listingDisplayName(row: BatListingRow): string {
  const title = (row.bat_listing_title || '').trim();
  if (title) return title;
  if (row.bat_listing_url) {
    const slug = row.bat_listing_url.replace(/\/+$/, '').split('/').pop() || '';
    const cleaned = slug.replace(/-\d+$/, '').replace(/-/g, ' ').trim();
    if (cleaned) return cleaned.toUpperCase();
  }
  return 'BAT LISTING';
}

function listingDate(row: BatListingRow): string | null {
  return row.sale_date || row.auction_end_date;
}

function resultLabel(status: string | null): string {
  if (status === 'sold') return 'SOLD';
  if (status === 'no_sale') return 'NO SALE';
  return (status || 'UNKNOWN').replace(/_/g, ' ').toUpperCase();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UserBatTrackRecord: React.FC<UserBatTrackRecordProps> = ({ userId, username, identityIds }) => {
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<BatListingRow[]>([]);
  const [comments, setComments] = useState<BatCommentRow[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const identityKey = identityIds.join(',');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const cleanUsername = (username || '').trim().replace(/"/g, '');
        const sellerFilters: string[] = [];
        if (cleanUsername) sellerFilters.push(`seller_username.eq."${cleanUsername}"`);
        if (identityIds.length > 0) {
          sellerFilters.push(`seller_external_identity_id.in.(${identityIds.join(',')})`);
        }

        const listingsPromise = sellerFilters.length > 0
          ? supabase
              .from('bat_listings')
              .select('id, vehicle_id, bat_listing_title, bat_listing_url, listing_status, sale_price, final_bid, sale_date, auction_end_date')
              .or(sellerFilters.join(','))
              .limit(100)
          : Promise.resolve({ data: [] as BatListingRow[], error: null, count: null });

        // Same identity-resolution pattern as profileStatsService.getUserProfileData:
        // auction_comments filtered on the indexed author_external_identity_id,
        // bids excluded via bid_amount IS NULL.
        const commentsPromise = identityIds.length > 0
          ? supabase
              .from('auction_comments')
              .select('id, comment_text, posted_at, vehicle_id', { count: 'exact' })
              .in('author_external_identity_id', identityIds)
              .is('bid_amount', null)
              .order('posted_at', { ascending: false })
              .limit(10)
          : Promise.resolve({ data: [] as BatCommentRow[], error: null, count: 0 });

        const [listingsRes, commentsRes] = await Promise.all([listingsPromise, commentsPromise]);
        if (cancelled) return;

        if (listingsRes.error) {
          console.warn('[UserBatTrackRecord] bat_listings query failed:', listingsRes.error.message);
        }
        if (commentsRes.error) {
          console.warn('[UserBatTrackRecord] auction_comments query failed:', commentsRes.error.message);
        }

        const rows = ((listingsRes.data as BatListingRow[] | null) || []).slice();
        rows.sort((a, b) => {
          const ta = listingDate(a) ? new Date(listingDate(a)!).getTime() : 0;
          const tb = listingDate(b) ? new Date(listingDate(b)!).getTime() : 0;
          return tb - ta;
        });

        setListings(rows);
        setComments((commentsRes.data as BatCommentRow[] | null) || []);
        setCommentCount(commentsRes.count ?? ((commentsRes.data as unknown[] | null)?.length || 0));
      } catch (err) {
        if (!cancelled) {
          console.warn('[UserBatTrackRecord] load failed:', err);
          setListings([]);
          setComments([]);
          setCommentCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, username, identityKey]);

  const { soldCount, gmv } = useMemo(() => {
    let sold = 0;
    let total = 0;
    for (const row of listings) {
      if (row.listing_status === 'sold') {
        sold += 1;
        total += row.sale_price ?? row.final_bid ?? 0;
      }
    }
    return { soldCount: sold, gmv: total };
  }, [listings]);

  // No Empty Shells: nothing while loading, null when no substrate at all.
  if (loading) return null;
  if (listings.length === 0 && commentCount === 0) return null;

  const headerLine = `${listings.length} LISTING${listings.length === 1 ? '' : 'S'} · ${soldCount} SOLD · ${formatPrice(gmv)} GMV`;

  const labelStyle: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: '8px',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: INK,
  };

  const gridTemplate = '88px 1fr 56px 84px';

  return (
    <div
      className="up-bat-track-record"
      style={{
        border: `2px solid ${INK}`,
        background: 'var(--up-surface, #ffffff)',
        marginBottom: '8px',
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '8px 10px',
          borderBottom: `2px solid ${INK}`,
        }}
      >
        <span style={labelStyle}>BAT TRACK RECORD</span>
        <span style={{ fontFamily: MONO, fontSize: '9px', fontWeight: 700, color: INK, whiteSpace: 'nowrap' }}>
          {headerLine}
        </span>
      </div>

      {/* Sales table */}
      {listings.length > 0 && (
        <div style={{ padding: '8px 10px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              gap: '0 8px',
              paddingBottom: '4px',
              borderBottom: `1px solid ${GHOST}`,
            }}
          >
            <span style={{ ...labelStyle, color: 'var(--up-pencil, #888888)' }}>DATE</span>
            <span style={{ ...labelStyle, color: 'var(--up-pencil, #888888)' }}>VEHICLE</span>
            <span style={{ ...labelStyle, color: 'var(--up-pencil, #888888)' }}>RESULT</span>
            <span style={{ ...labelStyle, color: 'var(--up-pencil, #888888)', textAlign: 'right' }}>PRICE</span>
          </div>

          {listings.map(row => {
            const sold = row.listing_status === 'sold';
            const rowColor = sold ? INK : NO_SALE_COLOR;
            const rowWeight = sold ? 700 : 400;
            const name = listingDisplayName(row);
            const price = sold
              ? formatPrice(row.sale_price ?? row.final_bid)
              : row.final_bid != null
                ? `${formatPrice(row.final_bid)} BID`
                : '—';

            return (
              <div
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: gridTemplate,
                  gap: '0 8px',
                  alignItems: 'baseline',
                  padding: '5px 0',
                  borderBottom: `1px solid ${GHOST}`,
                  color: rowColor,
                  fontWeight: rowWeight,
                }}
              >
                <span style={{ fontFamily: MONO, fontSize: '9px', whiteSpace: 'nowrap' }}>
                  {formatDate(listingDate(row))}
                </span>
                <span style={{ fontFamily: SANS, fontSize: '10px', lineHeight: 1.3 }}>
                  {row.vehicle_id ? (
                    <Link
                      to={`/vehicle/${row.vehicle_id}`}
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      {name}
                    </Link>
                  ) : row.bat_listing_url ? (
                    <a
                      href={row.bat_listing_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      {name}
                    </a>
                  ) : (
                    name
                  )}
                </span>
                <span style={{ fontFamily: MONO, fontSize: '8px', whiteSpace: 'nowrap' }}>
                  {resultLabel(row.listing_status)}
                </span>
                <span style={{ fontFamily: MONO, fontSize: '9px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {price}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Comments chip + expandable list */}
      {commentCount > 0 && (
        <div style={{ padding: '0 10px 8px', marginTop: listings.length === 0 ? '8px' : 0 }}>
          <button
            type="button"
            onClick={() => setCommentsOpen(prev => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 8px',
              fontFamily: MONO,
              fontSize: '8px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              border: `1px solid ${INK}`,
              background: commentsOpen ? INK : 'transparent',
              color: commentsOpen ? 'var(--up-surface, #ffffff)' : INK,
              cursor: 'pointer',
            }}
          >
            COMMENTS ({commentCount}) {commentsOpen ? '▾' : '▸'}
          </button>

          {commentsOpen && comments.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              {comments.map(c => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    padding: '5px 0',
                    borderBottom: `1px solid ${GHOST}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: '8px',
                      color: 'var(--up-pencil, #888888)',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      minWidth: '78px',
                    }}
                  >
                    {formatDate(c.posted_at)}
                  </span>
                  <span style={{ fontFamily: SANS, fontSize: '9px', lineHeight: 1.4, color: INK }}>
                    {truncate((c.comment_text || '').trim(), 160)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserBatTrackRecord;
