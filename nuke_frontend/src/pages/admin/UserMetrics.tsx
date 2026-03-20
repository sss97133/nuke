/**
 * User Metrics Dashboard
 * Identity seed overview across all sources — BaT, ghost users, FB sellers, external identities
 */

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

// ── Types ──────────────────────────────────────────────

interface Totals {
  bat_profiles: number;
  bat_tracked_users: number;
  ghost_users: number;
  fb_sellers: number;
  external_identities: number;
  registered_users: number;
  total_identity_seeds: number;
}

interface Linkage {
  external_claimed: number;
  external_unclaimed: number;
  bat_linked: number;
  bat_unlinked: number;
  ghost_claimed: number;
  ghost_unclaimed: number;
  claim_rate_pct: number;
}

interface BatActivity {
  comment_buckets: Array<{ bucket: string; count: number }>;
  with_bids: number;
  with_wins: number;
  avg_comments: number;
  avg_bids: number;
  max_comments: number;
  max_bids: number;
}

interface GhostBreakdown {
  by_camera_make: Array<{ make: string; count: number; claimed: number }>;
  profile_buildable: number;
  avg_contributions: number;
}

interface FbStats {
  total: number;
  by_seller_type: Array<{ type: string; count: number }>;
  with_active_listings: number;
  avg_listing_price: number | null;
}

interface IdentityPlatform {
  platform: string;
  total: number;
  claimed: number;
}

interface TopBatUser {
  username: string;
  total_comments: number;
  total_bids: number;
  total_wins: number;
  expertise_score: number;
  community_trust_score: number;
  bidding_strategy: string;
  avg_bid_amount: number;
}

interface MetricsData {
  totals: Totals;
  linkage: Linkage;
  bat_activity: BatActivity;
  ghost_breakdown: GhostBreakdown;
  fb_stats: FbStats;
  identity_platforms: IdentityPlatform[];
  top_bat_users: TopBatUser[];
  generated_at: string;
}

// ── Helpers ────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtPct(n: number, total: number): string {
  if (total === 0) return '0%';
  const pct = (n / total) * 100;
  if (pct < 0.01) return '<0.01%';
  if (pct < 1) return pct.toFixed(2) + '%';
  return pct.toFixed(1) + '%';
}

// Chart colors — hardcoded hex matching design system tokens
const CHART_COLORS = ['#6AADE4', '#C8A951', '#16825d', '#FF8000', '#C8102E', '#7c5cbf'];

// ── Sub-components ─────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: 'var(--surface, #ebebeb)',
        border: '2px solid var(--border, #bdbdbd)',
        padding: '12px 16px',
      }}
    >
      <div
        style={{
          fontSize: '8px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          color: 'var(--text-secondary, #666)',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '20px',
          fontWeight: 700,
          fontFamily: "'Courier New', monospace",
          color: 'var(--text, #2a2a2a)',
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: '9px',
            color: 'var(--text-secondary, #666)',
            marginTop: '4px',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '9px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '1.5px',
        color: 'var(--text-secondary, #666)',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid var(--border, #bdbdbd)',
      }}
    >
      {children}
    </div>
  );
}

function ProgressRow({
  label,
  claimed,
  total,
}: {
  label: string;
  claimed: number;
  total: number;
}) {
  const pct = total > 0 ? (claimed / total) * 100 : 0;
  return (
    <div style={{ marginBottom: '10px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '4px',
        }}
      >
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: 'var(--text, #2a2a2a)',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: '10px',
            fontFamily: "'Courier New', monospace",
            color: 'var(--text-secondary, #666)',
          }}
        >
          {fmt(claimed)} / {fmt(total)} ({fmtPct(claimed, total)})
        </span>
      </div>
      <div
        style={{
          height: '6px',
          background: 'var(--surface-hover, #e0e0e0)',
          border: '1px solid var(--border, #bdbdbd)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.max(pct, pct > 0 ? 1 : 0)}%`,
            background: pct > 0 ? '#16825d' : 'transparent',
            transition: '0.12s ease',
          }}
        />
      </div>
    </div>
  );
}

function DataTable({
  headers,
  rows,
  mono,
}: {
  headers: string[];
  rows: (string | number)[][];
  mono?: number[];
}) {
  const monoSet = new Set(mono || []);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '10px',
        }}
      >
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: i === 0 ? 'left' : 'right',
                  fontSize: '8px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  color: 'var(--text-secondary, #666)',
                  padding: '6px 8px',
                  borderBottom: '2px solid var(--border, #bdbdbd)',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              style={{
                borderBottom: '1px solid var(--border, #bdbdbd)',
              }}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    textAlign: ci === 0 ? 'left' : 'right',
                    padding: '5px 8px',
                    fontFamily: monoSet.has(ci)
                      ? "'Courier New', monospace"
                      : 'inherit',
                    color: 'var(--text, #2a2a2a)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {typeof cell === 'number' ? fmt(cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Custom Tooltip ─────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--surface, #ebebeb)',
        border: '2px solid var(--border, #bdbdbd)',
        padding: '8px 12px',
        fontSize: '10px',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: '2px' }}>{label}</div>
      <div style={{ fontFamily: "'Courier New', monospace" }}>
        {fmt(payload[0].value)} users
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────

export default function UserMetrics() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke(
        'user-metrics-stats'
      );
      if (fnError) throw fnError;
      setData(result as MetricsData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '50vh',
          fontSize: '11px',
          color: 'var(--text-secondary, #666)',
        }}
      >
        loading user metrics...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ padding: '24px' }}>
        <div
          style={{
            border: '2px solid var(--error, #d13438)',
            padding: '16px',
            fontSize: '11px',
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { totals, linkage, bat_activity, ghost_breakdown, fb_stats, identity_platforms, top_bat_users } = data;

  // Bucket order for chart
  const bucketOrder = ['1-9', '10-99', '100-999', '1000-9999', '10000+'];
  const chartData = bucketOrder
    .map((b) => {
      const found = bat_activity.comment_buckets.find((x) => x.bucket === b);
      return found ? { bucket: b, count: found.count } : null;
    })
    .filter(Boolean) as Array<{ bucket: string; count: number }>;

  return (
    <div style={{ maxWidth: '1200px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '24px',
          borderBottom: '2px solid var(--border, #bdbdbd)',
          paddingBottom: '16px',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '2px',
              margin: 0,
            }}
          >
            USER METRICS
          </h1>
          <div
            style={{
              fontSize: '10px',
              color: 'var(--text-secondary, #666)',
              marginTop: '4px',
              fontFamily: "'Courier New', monospace",
            }}
          >
            {fmt(totals.total_identity_seeds)} identity seeds across{' '}
            {identity_platforms.length} platforms &middot;{' '}
            {linkage.claim_rate_pct}% claimed &middot;{' '}
            {totals.registered_users} registered users
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          style={{
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            padding: '6px 12px',
            border: '2px solid var(--border, #bdbdbd)',
            background: 'var(--surface, #ebebeb)',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.5 : 1,
            transition: '0.12s ease',
          }}
        >
          {loading ? 'LOADING...' : 'REFRESH'}
        </button>
      </div>

      {/* Stat Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '8px',
          marginBottom: '24px',
        }}
      >
        <StatCard
          label="BAT PROFILES"
          value={fmt(totals.bat_profiles)}
          sub={`avg ${bat_activity.avg_comments} comments`}
        />
        <StatCard
          label="BAT TRACKED"
          value={fmt(totals.bat_tracked_users)}
          sub={`${linkage.bat_linked} linked to Nuke`}
        />
        <StatCard
          label="GHOST USERS"
          value={fmt(totals.ghost_users)}
          sub={`${linkage.ghost_claimed} claimed`}
        />
        <StatCard
          label="FB SELLERS"
          value={fmt(totals.fb_sellers)}
          sub={`${fb_stats.with_active_listings} active listings`}
        />
        <StatCard
          label="EXT. IDENTITIES"
          value={fmt(totals.external_identities)}
          sub={`${linkage.external_claimed} claimed`}
        />
        <StatCard
          label="NUKE USERS"
          value={fmt(totals.registered_users)}
          sub="registered accounts"
        />
      </div>

      {/* Linkage */}
      <div
        style={{
          border: '2px solid var(--border, #bdbdbd)',
          background: 'var(--surface, #ebebeb)',
          padding: '16px',
          marginBottom: '24px',
        }}
      >
        <SectionHeader>IDENTITY LINKAGE</SectionHeader>
        <ProgressRow
          label="External Identities"
          claimed={linkage.external_claimed}
          total={totals.external_identities}
        />
        <ProgressRow
          label="BaT Users"
          claimed={linkage.bat_linked}
          total={totals.bat_tracked_users}
        />
        <ProgressRow
          label="Ghost Users"
          claimed={linkage.ghost_claimed}
          total={totals.ghost_users}
        />
      </div>

      {/* Two-column: Chart + Top Users */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        {/* Comment Distribution */}
        <div
          style={{
            border: '2px solid var(--border, #bdbdbd)',
            background: 'var(--surface, #ebebeb)',
            padding: '16px',
          }}
        >
          <SectionHeader>BAT COMMENT DISTRIBUTION</SectionHeader>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 9, fill: 'var(--text-secondary)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'var(--text-secondary)', fontFamily: "'Courier New', monospace" }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" maxBarSize={48}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div
            style={{
              marginTop: '8px',
              fontSize: '9px',
              color: 'var(--text-secondary, #666)',
              fontFamily: "'Courier New', monospace",
            }}
          >
            {fmt(bat_activity.with_bids)} with bids &middot;{' '}
            max {fmt(bat_activity.max_comments)} comments &middot;{' '}
            max {fmt(bat_activity.max_bids)} bids
          </div>
        </div>

        {/* Top BaT Users */}
        <div
          style={{
            border: '2px solid var(--border, #bdbdbd)',
            background: 'var(--surface, #ebebeb)',
            padding: '16px',
            maxHeight: '340px',
            overflowY: 'auto',
          }}
        >
          <SectionHeader>TOP BAT USERS</SectionHeader>
          <DataTable
            headers={['Username', 'Comments', 'Bids', 'Wins']}
            mono={[1, 2, 3]}
            rows={top_bat_users.map((u) => [
              u.username,
              u.total_comments,
              u.total_bids,
              u.total_wins,
            ])}
          />
        </div>
      </div>

      {/* Two-column: Ghost + FB */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        {/* Ghost Users */}
        <div
          style={{
            border: '2px solid var(--border, #bdbdbd)',
            background: 'var(--surface, #ebebeb)',
            padding: '16px',
          }}
        >
          <SectionHeader>GHOST USERS BY DEVICE</SectionHeader>
          <DataTable
            headers={['Camera Make', 'Count', 'Claimed']}
            mono={[1, 2]}
            rows={ghost_breakdown.by_camera_make.map((g) => [
              g.make,
              g.count,
              g.claimed,
            ])}
          />
          <div
            style={{
              marginTop: '12px',
              fontSize: '9px',
              color: 'var(--text-secondary, #666)',
              fontFamily: "'Courier New', monospace",
            }}
          >
            {ghost_breakdown.profile_buildable} buildable &middot;{' '}
            avg {ghost_breakdown.avg_contributions} contributions
          </div>
        </div>

        {/* FB Sellers */}
        <div
          style={{
            border: '2px solid var(--border, #bdbdbd)',
            background: 'var(--surface, #ebebeb)',
            padding: '16px',
          }}
        >
          <SectionHeader>FB MARKETPLACE SELLERS</SectionHeader>
          <DataTable
            headers={['Seller Type', 'Count']}
            mono={[1]}
            rows={fb_stats.by_seller_type.map((s) => [s.type, s.count])}
          />
          <div
            style={{
              marginTop: '12px',
              fontSize: '9px',
              color: 'var(--text-secondary, #666)',
              fontFamily: "'Courier New', monospace",
            }}
          >
            {fb_stats.with_active_listings} active listings &middot;{' '}
            avg price: {fb_stats.avg_listing_price ? `$${fmt(fb_stats.avg_listing_price)}` : '--'}
          </div>
        </div>
      </div>

      {/* External Identities by Platform */}
      <div
        style={{
          border: '2px solid var(--border, #bdbdbd)',
          background: 'var(--surface, #ebebeb)',
          padding: '16px',
          marginBottom: '24px',
        }}
      >
        <SectionHeader>EXTERNAL IDENTITIES BY PLATFORM</SectionHeader>
        <DataTable
          headers={['Platform', 'Total', 'Claimed', 'Unclaimed']}
          mono={[1, 2, 3]}
          rows={identity_platforms.map((p) => [
            p.platform,
            p.total,
            p.claimed,
            p.total - p.claimed,
          ])}
        />
      </div>

      {/* Footer */}
      <div
        style={{
          fontSize: '9px',
          color: 'var(--text-secondary, #666)',
          fontFamily: "'Courier New', monospace",
          textAlign: 'right',
        }}
      >
        generated {new Date(data.generated_at).toLocaleString()}
      </div>
    </div>
  );
}
