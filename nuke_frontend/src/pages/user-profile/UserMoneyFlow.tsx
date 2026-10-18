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

export interface PaymentEventRow {
  id: string;
  direction: 'in' | 'out' | string;
  amount_usd: number | string | null;
  paid_at: string | null;
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

const fmtDate = (iso: string | null): string => {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const paymentAmount = (value: PaymentEventRow['amount_usd']): number | null => {
  if (value == null || String(value).trim() === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

// Unknown directions/amounts cannot become income or zero. Undated valid
// payments still belong in captured totals; they do not establish a year.
export const computeMoneyFlow = (rows: PaymentEventRow[]) => {
  let inTotal = 0; let outTotal = 0; let excluded = 0; let undated = 0;
  const byYear = new Map<number, YearFlow>();
  for (const row of rows) {
    const amount = paymentAmount(row.amount_usd);
    if (amount == null || !['in', 'out'].includes(row.direction)) { excluded++; continue; }
    if (row.direction === 'in') inTotal += amount; else outTotal += amount;
    const year = row.paid_at ? new Date(row.paid_at).getUTCFullYear() : NaN;
    if (!Number.isFinite(year)) { undated++; continue; }
    const flow = byYear.get(year) || { year, inTotal: 0, outTotal: 0 };
    if (row.direction === 'in') flow.inTotal += amount; else flow.outTotal += amount;
    byYear.set(year, flow);
  }
  return { inTotal, outTotal, excluded, undated, years: [...byYear.values()].sort((a, b) => a.year - b.year), lastFive: rows.slice(0, 5) };
};

const UserMoneyFlow: React.FC<UserMoneyFlowProps> = ({ userId, isOwnProfile }) => {
  const [rows, setRows] = useState<PaymentEventRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Owner-only: never even fetch for visitors.
    if (!userId || !isOwnProfile) return;
    let cancelled = false;
    setRows([]); setLoaded(false); setFailed(false); setRowCount(null);

    (async () => {
      const { data, error, count } = await supabase
        .from('payment_events')
        .select('id, direction, amount_usd, paid_at, counterparty_name', { count: 'exact' })
        .eq('user_id', userId)
        .not('is_superseded', 'is', true) // IS NOT TRUE — keeps false AND null
        .order('paid_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(1000);

      if (cancelled) return;
      if (error) {
        setRows([]);
        setFailed(true);
      } else {
        setRows((data || []) as PaymentEventRow[]);
      }
      setRowCount(count);
      setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [userId, isOwnProfile]);

  const { inTotal, outTotal, years, lastFive, excluded, undated } = useMemo(() => computeMoneyFlow(rows), [rows]);

  const maxYearFlow = useMemo(
    () => Math.max(1, ...years.map((y) => Math.max(y.inTotal, y.outTotal))),
    [years],
  );

  // Self-guards: visitors never see this card; no rows = no shell.
  if (!isOwnProfile) return null;
  if (!loaded) return null;
  if (failed) return <p role="status">Captured payment records could not load. Totals are unknown.</p>;
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
          CAPTURED CASH FLOW
        </span>
        <span style={{ fontSize: '8px', color: MUTED, letterSpacing: '0.06em' }}>
          OWNER ONLY
        </span>
      </div>

      <p style={{ fontSize: '9px', color: MUTED }}>
        {rows.length} of {rowCount ?? 'unknown'} current payment records.
        {' '}Cash flow is not verified income or profit.
        {rowCount == null || rowCount > rows.length ? ' Totals cover only the displayed records.' : ''}
        {excluded > 0 ? ` ${excluded} records excluded for unknown direction or invalid amount.` : ''}
        {undated > 0 ? ` ${undated} valid payments have no known year; included in totals.` : ''}
      </p>

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
            CAPTURED NET
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
            BY RECORDED YEAR (UTC)
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
                {r.direction === 'out' ? '→' : r.direction === 'in' ? '←' : '?'}
              </span>
              <span
                style={{
                  fontFamily: '"Courier New", monospace',
                  fontWeight: 700,
                  flexShrink: 0,
                  color: r.direction === 'out' ? MUTED : INK,
                }}
              >
                {paymentAmount(r.amount_usd) == null ? 'unknown amount' : fmtUsd(paymentAmount(r.amount_usd)!)}
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
