/**
 * UserMoneyFlow — owner-only money flow card.
 *
 * Substrate: payment_events (non-superseded) for this user. This is the
 * provenance-carrying payments ledger — every row has source DNA
 * (source_observation_id / source_url / method). Receipts are a different
 * substrate and are deliberately NOT joined here.
 *
 * Renders: IN/OUT totals (Courier New), per-year paired flat 2px bars,
 * last-5 events list. Footer states the source table + row count.
 *
 * Self-guarding: returns null for visitors (even with data) and when the
 * user has zero payment events.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface PaymentEventRow {
  id: string;
  direction: 'in' | 'out' | string;
  amount_usd: number | string;
  paid_at: string;
  counterparty_name: string | null;
}

interface YearFlow {
  year: number;
  inTotal: number;
  outTotal: number;
}

interface UserMoneyFlowProps {
  userId: string;
  isOwnProfile: boolean;
}

const INK = '#1a1a1a';
const MUTED = '#666';

const fmtUsd = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtUsdWhole = (n: number): string =>
  `$${Math.round(n).toLocaleString('en-US')}`;

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const UserMoneyFlow: React.FC<UserMoneyFlowProps> = ({ userId, isOwnProfile }) => {
  const [rows, setRows] = useState<PaymentEventRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Owner-only: never even fetch for visitors.
    if (!userId || !isOwnProfile) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('payment_events')
        .select('id, direction, amount_usd, paid_at, counterparty_name')
        .eq('user_id', userId)
        .not('is_superseded', 'is', true) // IS NOT TRUE — keeps false AND null
        .order('paid_at', { ascending: false })
        .limit(1000);

      if (cancelled) return;
      if (error) {
        setRows([]);
      } else {
        setRows((data || []) as PaymentEventRow[]);
      }
      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [userId, isOwnProfile]);

  const { inTotal, outTotal, years, lastFive } = useMemo(() => {
    let inSum = 0;
    let outSum = 0;
    const byYear = new Map<number, YearFlow>();

    for (const r of rows) {
      const amt = Number(r.amount_usd) || 0;
      const year = new Date(r.paid_at).getFullYear();
      if (!Number.isFinite(year)) continue;
      const yf = byYear.get(year) || { year, inTotal: 0, outTotal: 0 };
      if (r.direction === 'out') {
        outSum += amt;
        yf.outTotal += amt;
      } else {
        inSum += amt;
        yf.inTotal += amt;
      }
      byYear.set(year, yf);
    }

    // Continuous year range from first to last year with events
    const present = Array.from(byYear.keys()).sort((a, b) => a - b);
    const yearRows: YearFlow[] = [];
    if (present.length > 0) {
      for (let y = present[0]; y <= present[present.length - 1]; y++) {
        yearRows.push(byYear.get(y) || { year: y, inTotal: 0, outTotal: 0 });
      }
    }

    return {
      inTotal: inSum,
      outTotal: outSum,
      years: yearRows,
      lastFive: rows.slice(0, 5), // already ordered paid_at desc
    };
  }, [rows]);

  const maxYearFlow = useMemo(
    () => Math.max(1, ...years.map((y) => Math.max(y.inTotal, y.outTotal))),
    [years],
  );

  // Self-guards: visitors never see this card; no rows = no shell.
  if (!isOwnProfile) return null;
  if (!loaded) return null;
  if (rows.length === 0) return null;

  return (
    <div
      className="up-money-flow"
      style={{
        border: `2px solid ${INK}`,
        padding: '12px',
        marginBottom: '8px',
        fontFamily: 'Arial, sans-serif',
        color: INK,
      }}
      data-user-id={userId}
      data-event-count={rows.length}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '10px',
          paddingBottom: '6px',
          borderBottom: `1px solid ${INK}`,
        }}
      >
        <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em' }}>
          MONEY FLOW
        </span>
        <span style={{ fontSize: '8px', color: MUTED, letterSpacing: '0.06em' }}>
          OWNER ONLY
        </span>
      </div>

      {/* IN / OUT totals */}
      <div style={{ display: 'flex', gap: '24px', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '8px', color: MUTED, letterSpacing: '0.1em', marginBottom: '2px' }}>
            ← IN
          </div>
          <div style={{ fontFamily: '"Courier New", monospace', fontSize: '15px', fontWeight: 700 }}>
            {fmtUsd(inTotal)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '8px', color: MUTED, letterSpacing: '0.1em', marginBottom: '2px' }}>
            → OUT
          </div>
          <div style={{ fontFamily: '"Courier New", monospace', fontSize: '15px', fontWeight: 700, color: MUTED }}>
            {fmtUsd(outTotal)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '8px', color: MUTED, letterSpacing: '0.1em', marginBottom: '2px' }}>
            NET
          </div>
          <div style={{ fontFamily: '"Courier New", monospace', fontSize: '15px', fontWeight: 700 }}>
            {inTotal - outTotal >= 0 ? '+' : '−'}{fmtUsd(Math.abs(inTotal - outTotal))}
          </div>
        </div>
      </div>

      {/* Per-year paired flat 2px bars */}
      {years.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '8px', color: MUTED, letterSpacing: '0.1em', marginBottom: '4px' }}>
            BY YEAR
          </div>
          {years.map((y) => (
            <div
              key={y.year}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}
            >
              <span
                style={{
                  fontFamily: '"Courier New", monospace',
                  fontSize: '9px',
                  width: '32px',
                  flexShrink: 0,
                }}
              >
                {y.year}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* IN bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <div
                    style={{
                      height: '2px',
                      width: `${Math.max(y.inTotal > 0 ? 1 : 0, (y.inTotal / maxYearFlow) * 100)}%`,
                      background: INK,
                    }}
                  />
                  {y.inTotal > 0 && (
                    <span style={{ fontFamily: '"Courier New", monospace', fontSize: '8px', whiteSpace: 'nowrap' }}>
                      {fmtUsdWhole(y.inTotal)}
                    </span>
                  )}
                </div>
                {/* OUT bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div
                    style={{
                      height: '2px',
                      width: `${Math.max(y.outTotal > 0 ? 1 : 0, (y.outTotal / maxYearFlow) * 100)}%`,
                      background: '#999',
                    }}
                  />
                  {y.outTotal > 0 && (
                    <span style={{ fontFamily: '"Courier New", monospace', fontSize: '8px', color: MUTED, whiteSpace: 'nowrap' }}>
                      {fmtUsdWhole(y.outTotal)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Last 5 events */}
      {lastFive.length > 0 && (
        <div>
          <div style={{ fontSize: '8px', color: MUTED, letterSpacing: '0.1em', marginBottom: '4px' }}>
            RECENT
          </div>
          {lastFive.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '8px',
                fontSize: '9px',
                marginBottom: '3px',
              }}
            >
              <span style={{ fontFamily: '"Courier New", monospace', flexShrink: 0 }}>
                {fmtDate(r.paid_at)}
              </span>
              <span
                style={{
                  fontFamily: '"Courier New", monospace',
                  flexShrink: 0,
                  color: r.direction === 'out' ? MUTED : INK,
                }}
              >
                {r.direction === 'out' ? '→' : '←'}
              </span>
              <span
                style={{
                  fontFamily: '"Courier New", monospace',
                  fontWeight: 700,
                  flexShrink: 0,
                  color: r.direction === 'out' ? MUTED : INK,
                }}
              >
                {fmtUsd(Number(r.amount_usd) || 0)}
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontSize: '8px',
                  color: '#444',
                }}
              >
                {r.counterparty_name || '—'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Source DNA footer */}
      <div
        style={{
          marginTop: '10px',
          paddingTop: '6px',
          borderTop: `1px solid #ccc`,
          fontSize: '8px',
          color: MUTED,
          letterSpacing: '0.08em',
        }}
      >
        SOURCE: PAYMENT_EVENTS · {rows.length} ROWS
      </div>
    </div>
  );
};

export default UserMoneyFlow;
