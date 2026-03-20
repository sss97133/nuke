/**
 * VehicleBidCard — Per-vehicle bid curve + auction metrics
 *
 * Shows bid timeline (Recharts AreaChart), summary stats, and a collapsible
 * bid-by-bid detail table. Integrates with the bid-curve-analysis edge function
 * and mv_bid_vehicle_summary materialized view.
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { CollapsibleWidget } from '../ui/CollapsibleWidget';
import { supabase, getSupabaseFunctionsUrl } from '../../lib/supabase';
import BidCompareOverlay from './BidCompareOverlay';

// ─── Types ───────────────────────────────────────────────────────────

interface Bid {
  amount: number;
  timestamp: string;
  username: string;
  is_winning: boolean;
}

interface BidSummary {
  bid_count: number;
  unique_bidders: number;
  opening_bid: number;
  final_bid: number;
  bid_range: number;
  appreciation_pct: number | null;
  duration_hours: number;
  velocity_bids_per_hour: number;
  snipe_bids_last_hour: number;
  snipe_premium: number;
}

interface BidCurveResponse {
  vehicle: { id: string; year: number; make: string; model: string };
  platform?: string;
  bid_count: number;
  bids: Bid[];
  summary: BidSummary;
}

interface VehicleBidCardProps {
  vehicleId: string;
  make?: string;
  model?: string;
  onBidderClick?: (username: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const formatUsd = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n}`;
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const formatDuration = (hours: number) => {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
};

// ─── Stat Pill ───────────────────────────────────────────────────────

function StatPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 100 }}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: '17px', fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

// ─── Custom Tooltip ──────────────────────────────────────────────────

function BidTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--grey-800, #1f2937)', color: 'var(--bg)', padding: '4px 8px', fontSize: '11px', fontFamily: 'monospace', }}>
      <div style={{ fontWeight: 700 }}>{formatUsd(d.amount)}</div>
      <div style={{ opacity: 0.7 }}>{d.username} &middot; {formatTime(d.timestamp)}</div>
      {d.jump > 0 && <div style={{ color: 'var(--success)' }}>+{formatUsd(d.jump)}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export default function VehicleBidCard({ vehicleId, make, model, onBidderClick }: VehicleBidCardProps) {
  const [showTimeline, setShowTimeline] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  // Fetch bid curve data from edge function
  const { data, isLoading, error } = useQuery<BidCurveResponse>({
    queryKey: ['bid-curve', vehicleId],
    queryFn: async () => {
      const res = await fetch(`${getSupabaseFunctionsUrl()}/bid-curve-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'vehicle', vehicle_id: vehicleId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!vehicleId,
  });

  // Fetch percentile context from MV
  const { data: mvSummary } = useQuery({
    queryKey: ['bid-vehicle-summary', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mv_bid_vehicle_summary')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .single();
      if (error) return null;
      return data;
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!vehicleId,
  });

  // Chart data: add jump between consecutive bids
  const chartData = useMemo(() => {
    if (!data?.bids?.length) return [];
    return data.bids.map((b, i) => ({
      ...b,
      jump: i > 0 ? b.amount - data.bids[i - 1].amount : 0,
      index: i,
    }));
  }, [data]);

  const summary = data?.summary;
  const winner = data?.bids?.find(b => b.is_winning)?.username;

  if (isLoading) {
    return (
      <CollapsibleWidget title="Bid Activity" className="vehicle-profile-section" defaultCollapsed={false}>
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
          Loading bid data...
        </div>
      </CollapsibleWidget>
    );
  }

  if (error || !summary || summary.bid_count === 0) {
    return (
      <CollapsibleWidget title="Bid Activity" className="vehicle-profile-section" defaultCollapsed={true}>
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
          No bid data available for this vehicle.
        </div>
      </CollapsibleWidget>
    );
  }

  return (
    <>
      <CollapsibleWidget
        title="Bid Activity"
        className="vehicle-profile-section"
        defaultCollapsed={false}
        badge={
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {data?.platform && data.platform !== 'bat' && (
              <span style={{
                fontSize: '9px', background: data.platform === 'cars_and_bids' ? '#e8590c' : 'var(--text-secondary)',
                color: 'var(--bg)', padding: '1px 6px', fontWeight: 600,
              }}>
                {data.platform === 'cars_and_bids' ? 'C&B' : data.platform}
              </span>
            )}
            <span style={{
              fontSize: '11px', background: 'var(--primary, #3b82f6)', color: 'var(--bg)', padding: '1px 8px', fontWeight: 600,
            }}>
              {summary.bid_count} bids
            </span>
          </span>
        }
        action={
          <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
            <button
              className="button button-small"
              style={{ fontSize: '11px' }}
              onClick={() => setShowCompare(!showCompare)}
            >
              {showCompare ? 'Hide compare' : 'Compare to market'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ─── Bid Curve Chart ──────────────────────────── */}
          {!showCompare && chartData.length > 1 && (
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="bidGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--info)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--info)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light, #e5e7eb)" />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(v: string) => {
                      const d = new Date(v);
                      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    }}
                    tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => formatUsd(v)}
                    tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    width={55}
                  />
                  <Tooltip content={<BidTooltip />} />
                  {winner && (
                    <ReferenceLine
                      y={summary.final_bid}
                      stroke="var(--success)"
                      strokeDasharray="4 4"
                      strokeWidth={1}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="var(--info)"
                    fill="url(#bidGradient)"
                    strokeWidth={2}
                    dot={{ r: 2, fill: 'var(--info)', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: 'var(--info)', stroke: 'var(--surface-elevated)', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ─── Compare Overlay ──────────────────────────── */}
          {showCompare && make && (
            <BidCompareOverlay
              vehicleId={vehicleId}
              vehicleBids={data.bids}
              make={make}
              model={model}
            />
          )}

          {/* ─── Summary Stats ────────────────────────────── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <StatPill label="Opening Bid" value={formatUsd(summary.opening_bid)} />
            <StatPill label="Final Bid" value={formatUsd(summary.final_bid)} />
            <StatPill
              label="Appreciation"
              value={summary.appreciation_pct !== null ? `+${summary.appreciation_pct}%` : '—'}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <StatPill label="Unique Bidders" value={String(summary.unique_bidders)} />
            <StatPill label="Duration" value={formatDuration(summary.duration_hours)} />
            <StatPill label="Velocity" value={`${summary.velocity_bids_per_hour} bids/hr`} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <StatPill
              label="Snipe Bids (last hr)"
              value={String(summary.snipe_bids_last_hour)}
              sub={summary.snipe_premium > 0 ? `+${formatUsd(summary.snipe_premium)} premium` : undefined}
            />
            {winner && (
              <StatPill label="Winner" value={winner} />
            )}
          </div>

          {/* ─── Bid Timeline Toggle ──────────────────────── */}
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            style={{
              background: 'none', border: '1px solid var(--border-light, #e5e7eb)', padding: '4px 10px', fontSize: '11px', cursor: 'pointer',
              color: 'var(--text-muted)', width: '100%',
            }}
          >
            {showTimeline ? 'Hide bid timeline' : `Show all ${summary.bid_count} bids`}
          </button>

          {/* ─── Bid Timeline Table ───────────────────────── */}
          {showTimeline && (
            <div style={{ maxHeight: 300, overflowY: 'auto', fontSize: '11px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-light, #e5e7eb)', color: 'var(--text-muted)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Time</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Bidder</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>Amount</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>Jump</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((b, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom: '1px solid var(--border-light, #e5e7eb)',
                        background: b.is_winning ? 'rgba(34, 197, 94, 0.06)' : undefined,
                      }}
                    >
                      <td style={{ padding: '4px 6px', color: 'var(--text-muted)' }}>
                        {formatTime(b.timestamp)}
                      </td>
                      <td style={{ padding: '4px 6px' }}>
                        <span
                          style={{
                            cursor: onBidderClick ? 'pointer' : 'default',
                            color: onBidderClick ? 'var(--primary, #3b82f6)' : 'inherit',
                            textDecoration: onBidderClick ? 'underline' : 'none',
                          }}
                          onClick={() => onBidderClick?.(b.username)}
                        >
                          {b.username}
                        </span>
                        {b.is_winning && (
                          <span style={{
                            marginLeft: 4, fontSize: '9px', background: 'var(--success)', color: 'var(--bg)', padding: '1px 4px',
                          }}>
                            winner
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>
                        {formatUsd(b.amount)}
                      </td>
                      <td style={{
                        padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace',
                        color: b.jump > 0 ? 'var(--success)' : 'var(--text-muted)',
                      }}>
                        {b.jump > 0 ? `+${formatUsd(b.jump)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CollapsibleWidget>
    </>
  );
}
