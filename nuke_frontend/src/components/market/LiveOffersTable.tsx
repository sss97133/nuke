/**
 * LiveOffersTable — ranked live offers from public.get_ranked_offers.
 *
 * The one shared read (MULTI_SURFACE_BRIEF_2026-07-27): web, iOS and API all
 * consume the same RPC, so the ranking cannot disagree between surfaces.
 *
 * Rank = desire prior (market_segments.priority) decayed by age. AGE IS A
 * COLUMN, not a hidden sort key — the owner's complaint on 2026-07-27 was
 * literally "not sure on the ages of these", and being first to a fresh
 * listing is the whole game.
 *
 * Design per .claude/rules/frontend.md: 2px borders, zero radius, zero
 * shadows, ALL CAPS 8-9px labels, Courier New for numbers.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';

interface RankedOffer {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  segment_slug: string | null;
  priority: number | null;
  match_kind: 'specific' | 'year-band' | null;
  price: number | null;
  price_source: 'listing' | 'event' | 'bat' | null;
  location: string | null;
  source: string | null;
  listing_url: string | null;
  hours_old: number | null;
  rank_score: number | null;
}

const th: CSSProperties = {
  textAlign: 'left',
  fontSize: '8px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontWeight: 600,
  padding: '4px 8px',
  borderBottom: '2px solid var(--border-light)',
  whiteSpace: 'nowrap',
};

const td: CSSProperties = {
  fontSize: '11px',
  padding: '5px 8px',
  borderBottom: '1px solid var(--border-light)',
  whiteSpace: 'nowrap',
};

const mono: CSSProperties = { ...td, fontFamily: "'Courier New', monospace" };

/** Hours -> a age string a human reads at a glance. */
function ageLabel(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Fresh things earn emphasis; a week-old listing should look week-old. */
function ageColor(hours: number | null): string {
  if (hours == null) return 'var(--text-muted)';
  if (hours <= 6) return 'var(--error)';
  if (hours <= 24) return 'var(--info)';
  return 'var(--text-muted)';
}

export function LiveOffersTable() {
  const [rows, setRows] = useState<RankedOffer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // NEWEST first, not score first. Score-ordering made the AGE column
      // non-monotonic (6m, 12h, 16h, 6m, 36m...), which reads as broken to
      // anyone scanning for what just landed — and landing first is the point.
      // The desire prior still earns its keep: it labels the era and marks
      // specific segments, it just no longer scrambles the chronology.
      const { data, error } = await supabase.rpc('get_ranked_offers', {
        p_limit: 40,
        p_max_hours: 72,
        p_order: 'newest',
        // Scoped to the top three era bands, and SAID so in the header rather
        // than filtered silently. Unscoped, "newest" is mostly modern volume
        // (a 2007 Ducati, a 2008 Vantage) — true, and not what this board is
        // for. The RPC still serves every era; this surface picks a view.
        p_max_priority: 3,
      });
      if (cancelled) return;
      if (!error && data) setRows(data as RankedOffer[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // No empty shells (.claude/rules/frontend.md).
  if (!loading && rows.length === 0) return null;

  return (
    <div style={{ marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>Live Offers</div>
        <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
          NEWEST FIRST · 1963-1991 · LAST 72H · ◆ = TRACKED SEGMENT
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>Loading…</div>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 'var(--space-2)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Age</th>
                <th style={th}>Vehicle</th>
                <th style={{ ...th, textAlign: 'right' }}>Ask</th>
                <th style={th}>Era</th>
                <th style={th}>Where</th>
                <th style={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const title = [r.year, r.make, r.model].filter(Boolean).join(' ') || 'Unknown';
                return (
                  <tr key={r.vehicle_id}>
                    <td style={{ ...mono, color: ageColor(r.hours_old), fontWeight: 600 }}>
                      {ageLabel(r.hours_old)}
                    </td>
                    <td style={td}>
                      {r.listing_url ? (
                        <a href={r.listing_url} target="_blank" rel="noopener noreferrer"
                           style={{ color: 'var(--text)', textDecoration: 'underline' }}>
                          {title}
                        </a>
                      ) : title}
                    </td>
                    <td style={{ ...mono, textAlign: 'right' }}>
                      {r.price != null
                        ? '$' + Math.round(r.price).toLocaleString()
                        : <span style={{ color: 'var(--text-muted)' }}>not priced yet</span>}
                    </td>
                    <td style={{ ...td, fontSize: '9px', color: 'var(--text-muted)' }}>
                      {r.segment_slug?.replace(/^era-/, '') || '—'}
                      {r.match_kind === 'specific' && (
                        <span style={{ marginLeft: 4, color: 'var(--info)' }}>◆</span>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: '9px', color: 'var(--text-muted)' }}>
                      {r.location || '—'}
                    </td>
                    <td style={{ ...td, fontSize: '9px', color: 'var(--text-muted)' }}>
                      {r.source || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default LiveOffersTable;
