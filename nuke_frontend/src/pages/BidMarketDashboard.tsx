/**
 * BID MARKET DASHBOARD — Robinhood-style interactive bid analytics
 *
 * Route: /market/bids
 *
 * Data-driven controls: decade pills, body style chips, make filters
 * all populated from the actual bid data. Filtered trends query the
 * mv_bid_trends_faceted MV via get_bid_trends_filtered() RPC for
 * instant results. Treemap drill-down uses get_bid_treemap_models().
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Treemap, ReferenceLine,
} from 'recharts';
import { supabase } from '../lib/supabase';
import BidderProfileCard from '../components/bidder/BidderProfileCard';

// ─── Colors ─────────────────────────────────────────────────────────

const TREEMAP_COLORS = [
  '#5b7a9d', '#7d6b91', '#6b9d7d', '#9d8b6b', '#6b8b9d',
  '#8b6b7d', '#7d9d6b', '#9d6b6b', '#6b7d9d', '#9d7d6b',
  '#6b9d8b', '#8b9d6b',
];

const METRIC_COLORS: Record<string, string> = {
  total_bids: '#5b7a9d',
  avg_bid: '#9d8b6b',
  active_bidders: '#6b9d7d',
  auctions: '#7d6b91',
  median_bid: '#6b8b9d',
};

// ─── Types ──────────────────────────────────────────────────────────

type TimeRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | 'ALL';
type Metric = 'total_bids' | 'avg_bid' | 'active_bidders' | 'auctions' | 'median_bid';

const TIME_RANGES: { key: TimeRange; label: string; weeks: number; tip: string }[] = [
  { key: '1M', label: '1M', weeks: 4, tip: 'Last 4 weeks of bid activity' },
  { key: '3M', label: '3M', weeks: 13, tip: 'Last 13 weeks (~1 quarter) of bid activity' },
  { key: '6M', label: '6M', weeks: 26, tip: 'Last 26 weeks (~half year) of bid activity' },
  { key: '1Y', label: '1Y', weeks: 52, tip: 'Last 52 weeks of bid activity. Default view.' },
  { key: '2Y', label: '2Y', weeks: 104, tip: 'Last 2 years of bid activity — shows seasonal patterns' },
  { key: 'ALL', label: 'ALL', weeks: 9999, tip: 'All bid data from July 2014 to present (~11 years)' },
];

const METRICS: { key: Metric; label: string; format: (n: number) => string; aggregate: 'sum' | 'avg' | 'max'; tip: string }[] = [
  { key: 'total_bids', label: 'Bid Volume', format: (n) => n?.toLocaleString() ?? '—', aggregate: 'sum', tip: 'Total number of bids placed across all auctions in the selected time range. Each bid is one person clicking "Place Bid" on a listing.' },
  { key: 'avg_bid', label: 'Avg Bid', format: fmtPrice, aggregate: 'avg', tip: 'Average dollar amount of all bids placed. Includes every bid, not just winning bids. Rising averages signal a hotter market or more expensive inventory.' },
  { key: 'active_bidders', label: 'Active Bidders', format: (n) => n?.toLocaleString() ?? '—', aggregate: 'max', tip: 'Peak number of unique bidders active in a single week. Measures market participation — more bidders means more competition and tighter price discovery.' },
  { key: 'auctions', label: 'Auctions', format: (n) => n?.toLocaleString() ?? '—', aggregate: 'sum', tip: 'Number of unique auction listings that received at least one bid. More auctions = more supply. Compare to bid volume to gauge demand per listing.' },
  { key: 'median_bid', label: 'Median Bid', format: fmtPrice, aggregate: 'avg', tip: 'Median bid amount (50th percentile). Less sensitive to outliers than average. The gap between median and average reveals how skewed the market is toward high-end vehicles.' },
];

// ─── Formatting ─────────────────────────────────────────────────────

const fmt = (n: number) => n?.toLocaleString() ?? '—';
function fmtPrice(n: number) {
  if (!n) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}
const fmtPriceFull = (n: number) => {
  if (!n) return '—';
  return `$${Math.round(n).toLocaleString()}`;
};

// ─── HoverCard ──────────────────────────────────────────────────────

function HoverCard({ children, content }: { children: React.ReactElement; content: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const handleEnter = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 340) });
    timer.current = setTimeout(() => setShow(true), 250);
  };
  const handleLeave = () => {
    clearTimeout(timer.current);
    setShow(false);
  };

  return (
    <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={handleLeave} style={{ display: 'contents' }}>
      {children}
      {show && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
          background: 'var(--white, #fff)', border: '2px solid var(--border-medium, #bdbdbd)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 12, width: 320, maxWidth: '90vw',
        }}>
          {content}
        </div>
      )}
    </div>
  );
}

// ─── Insight helpers ────────────────────────────────────────────────

function classifyBidder(b: any, avgBidsAll: number, avgWinRateAll: number): { label: string; detail: string; color: string } {
  const bpa = b.auctions_entered > 0 ? b.total_bids / b.auctions_entered : 0;
  const isHighVolume = b.total_bids > avgBidsAll * 3;
  const isHighWinRate = b.win_rate > avgWinRateAll * 2;
  const isWhale = b.max_bid > 200000;

  if (isHighVolume && isHighWinRate) return { label: 'Power Buyer', detail: `Bids ${(b.total_bids / avgBidsAll).toFixed(0)}x more than average with ${(b.win_rate / avgWinRateAll).toFixed(1)}x the win rate. Likely a professional dealer.`, color: '#d13438' };
  if (isHighVolume && !isHighWinRate) return { label: 'Volume Bidder', detail: `Places ${(b.total_bids / avgBidsAll).toFixed(0)}x more bids than average but wins at a typical rate. Casts a wide net.`, color: '#9d8b6b' };
  if (isWhale && bpa < 2) return { label: 'Whale Sniper', detail: `Max bid of ${fmtPrice(b.max_bid)} with only ${bpa.toFixed(1)} bids per auction. Goes in once, goes in big.`, color: '#7d6b91' };
  if (isHighWinRate) return { label: 'Sharp Shooter', detail: `Win rate ${b.win_rate}% is ${(b.win_rate / avgWinRateAll).toFixed(1)}x the average. Selective but effective.`, color: '#008000' };
  if (bpa > 4) return { label: 'Bid War Fighter', detail: `Averages ${bpa.toFixed(1)} bids per auction — gets into bidding wars and pushes prices up.`, color: '#5b7a9d' };
  return { label: 'Participant', detail: `${b.total_bids} bids across ${b.auctions_entered} auctions since ${new Date(b.first_seen).getFullYear()}.`, color: 'var(--text-muted)' };
}

function describeAuction(h: any, avgBidCount: number): { headline: string; detail: string } {
  const multiplier = h.bid_count / avgBidCount;
  const name = h.year ? `${h.year} ${h.make || ''} ${h.model || ''}`.trim() : 'This vehicle';
  const appreciation = h.appreciation_pct ? Number(h.appreciation_pct) : 0;

  if (multiplier > 5 && appreciation > 500) {
    return { headline: 'Bidding frenzy', detail: `${name} attracted ${multiplier.toFixed(0)}x the average bid count. Price ran from ${fmtPrice(h.opening_bid)} to ${fmtPrice(h.final_bid)} — a ${appreciation.toFixed(0)}% appreciation driven by intense competition among ${h.unique_bidders} bidders.` };
  }
  if (multiplier > 3) {
    return { headline: 'Highly contested', detail: `${name} drew ${h.bid_count} bids (${multiplier.toFixed(0)}x average). ${h.unique_bidders} bidders competed, pushing the price ${appreciation > 0 ? `up ${appreciation.toFixed(0)}%` : 'significantly'} from ${fmtPrice(h.opening_bid)}.` };
  }
  if (appreciation > 1000) {
    return { headline: 'Massive price discovery', detail: `Opened at ${fmtPrice(h.opening_bid)}, sold for ${fmtPrice(h.final_bid)} — the market valued this ${(appreciation / 100).toFixed(0)}x higher than the starting price. ${h.unique_bidders} bidders drove the discovery.` };
  }
  return { headline: 'Top auction', detail: `${h.bid_count} bids from ${h.unique_bidders} unique bidders. Final price: ${fmtPrice(h.final_bid)}${h.bids_per_hour ? ` at ${h.bids_per_hour} bids/hr pace` : ''}.` };
}

// ─── TreemapContent ─────────────────────────────────────────────────

function TreemapContent(props: any) {
  const { x, y, width, height, name, bid_count } = props;
  if (width < 35 || height < 22) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height}
        style={{ fill: props.color || '#5b7a9d', stroke: 'var(--border-light)', strokeWidth: 1, fillOpacity: 0.9 }} />
      {width > 50 && (
        <>
          <text x={x + 4} y={y + 12} fill="#fff" fontSize={9} fontWeight={700} fontFamily="Arial, sans-serif">{name}</text>
          {height > 28 && (
            <text x={x + 4} y={y + 22} fill="rgba(255,255,255,0.6)" fontSize={8} fontFamily="Arial, sans-serif">
              {fmt(bid_count)}
            </text>
          )}
        </>
      )}
    </g>
  );
}

// ─── Custom Crosshair Cursor ────────────────────────────────────────

function ChartCrosshair({ points, height }: any) {
  if (!points?.length) return null;
  const x = points[0]?.x;
  if (x == null) return null;
  return (
    <line
      x1={x} y1={0} x2={x} y2={height}
      stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export default function BidMarketDashboard() {
  // Data
  const [rawTrends, setRawTrends] = useState<any[]>([]);
  const [treemapData, setTreemapData] = useState<any[]>([]);
  const [topBidders, setTopBidders] = useState<any[]>([]);
  const [hottestAuctions, setHottestAuctions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Multi-platform stats (C&B, etc.)
  const [platformStats, setPlatformStats] = useState<{
    cars_and_bids: { bids: number; vehicles: number; bidders: number; avg_bid: number; bids_per_hour: number; bids_per_day: number; extraction_hours: number; latest: string | null };
  } | null>(null);

  // Data-driven filter options (loaded from DB once)
  const [filterOptions, setFilterOptions] = useState<{
    decades: { decade: number; vehicles: number; total_bids: number }[];
    body_styles: { name: string; vehicles: number; total_bids: number }[];
    top_makes: { name: string; total_bids: number; vehicles: number; avg_bid: number; unique_bidders: number }[];
  } | null>(null);

  // Controls
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y');
  const [primaryMetric, setPrimaryMetric] = useState<Metric>('total_bids');
  const [secondaryMetric, setSecondaryMetric] = useState<Metric | null>('avg_bid');
  const [selectedMakes, setSelectedMakes] = useState<Set<string>>(new Set());
  const [selectedDecades, setSelectedDecades] = useState<Set<number>>(new Set());
  const [selectedBodyStyles, setSelectedBodyStyles] = useState<Set<string>>(new Set());
  const [selectedBidder, setSelectedBidder] = useState<string | null>(null);

  // Track whether any filter is active (to decide RPC vs MV)
  const hasFilters = selectedMakes.size > 0 || selectedDecades.size > 0 || selectedBodyStyles.size > 0;

  // Treemap drill-down: clicking a make loads model breakdown
  const [drillMake, setDrillMake] = useState<string | null>(null);
  const [drillModels, setDrillModels] = useState<any[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  // Interactive crosshair state
  const [hoverData, setHoverData] = useState<any>(null);
  const [isHovering, setIsHovering] = useState(false);

  // Hover-to-see-vehicles: when touching a point, load the top vehicles for that week
  const [weekVehicles, setWeekVehicles] = useState<any[]>([]);
  const [weekVehiclesLoading, setWeekVehiclesLoading] = useState(false);
  const weekVehicleCache = useRef<Map<string, any[]>>(new Map());
  const weekQueryTimer = useRef<ReturnType<typeof setTimeout>>();

  // Load static data: filter options, treemap, bidders, hottest auctions
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [trendsRes, treemapRes, biddersRes, hottestRes, filterRes, cabStatsRes] = await Promise.all([
        supabase.from('mv_bid_market_trends').select('*').order('week', { ascending: true }),
        supabase.from('mv_bid_treemap_by_make').select('*').order('bid_count', { ascending: false }).limit(30),
        supabase.from('mv_bidder_profiles').select('*').order('total_bids', { ascending: false }).limit(15),
        supabase.from('mv_bid_vehicle_summary')
          .select('vehicle_id, bid_count, unique_bidders, final_bid, opening_bid, appreciation_pct, bids_per_hour, last_bid_at')
          .order('bid_count', { ascending: false })
          .limit(10),
        supabase.rpc('get_bid_filter_options'),
        supabase.rpc('get_cab_platform_stats'),
      ]);

      if (trendsRes.data) setRawTrends(trendsRes.data);
      if (filterRes.data) setFilterOptions(filterRes.data);

      if (treemapRes.data) {
        setTreemapData(treemapRes.data.map((t: any, i: number) => ({
          name: t.make, size: t.bid_count, bid_count: t.bid_count,
          vehicles: t.vehicles, avg_bid: t.avg_bid, unique_bidders: t.unique_bidders,
          color: TREEMAP_COLORS[i % TREEMAP_COLORS.length],
        })));
      }

      if (biddersRes.data) setTopBidders(biddersRes.data);

      if (cabStatsRes.data) {
        setPlatformStats({ cars_and_bids: cabStatsRes.data });
      }

      if (hottestRes.data) {
        const vehicleIds = hottestRes.data.map((h: any) => h.vehicle_id);
        const { data: vehicles } = await supabase
          .from('vehicles').select('id, year, make, model').in('id', vehicleIds);
        const vehicleMap = new Map((vehicles || []).map((v: any) => [v.id, v]));
        setHottestAuctions(hottestRes.data.map((h: any) => {
          const v = vehicleMap.get(h.vehicle_id) || {};
          return { ...h, ...(v as any) };
        }));
      }

      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // When filters change, load filtered trends from RPC
  useEffect(() => {
    if (!hasFilters) return; // Use rawTrends from MV when no filters
    let cancelled = false;
    (async () => {
      const makes = selectedMakes.size > 0 ? Array.from(selectedMakes) : null;
      const decades = Array.from(selectedDecades);
      const decadeStart = decades.length > 0 ? Math.min(...decades) : null;
      const decadeEnd = decades.length > 0 ? Math.max(...decades) + 10 : null;
      const bodyStyles = selectedBodyStyles.size > 0 ? Array.from(selectedBodyStyles) : null;

      const { data, error: rpcErr } = await supabase.rpc('get_bid_trends_filtered', {
        p_makes: makes,
        p_decade_start: decadeStart,
        p_decade_end: decadeEnd,
        p_body_styles: bodyStyles,
      });
      if (!cancelled && data) {
        setRawTrends(data);
        weekVehicleCache.current.clear(); // invalidate cache when filters change
      }
    })();
    return () => { cancelled = true; };
  }, [hasFilters, selectedMakes, selectedDecades, selectedBodyStyles]);

  // Reload unfiltered trends when all filters cleared
  useEffect(() => {
    if (hasFilters) return;
    supabase.from('mv_bid_market_trends').select('*').order('week', { ascending: true })
      .then(({ data }) => { if (data) setRawTrends(data); });
  }, [hasFilters]);

  // ─── Drill into models when a make is clicked in treemap ──────────

  useEffect(() => {
    if (!drillMake) { setDrillModels([]); return; }
    let cancelled = false;
    (async () => {
      setDrillLoading(true);
      const { data, error: rpcErr } = await supabase.rpc('get_bid_treemap_models', {
        p_make: drillMake,
      });
      if (!cancelled && data) {
        setDrillModels(data.map((m: any, i: number) => ({
          name: m.name,
          size: Number(m.bid_count),
          bid_count: Number(m.bid_count),
          vehicles: Number(m.vehicles),
          avg_bid: Number(m.avg_bid),
          unique_bidders: Number(m.unique_bidders),
          color: TREEMAP_COLORS[i % TREEMAP_COLORS.length],
        })));
      }
      if (!cancelled) setDrillLoading(false);
    })();
    return () => { cancelled = true; };
  }, [drillMake]);

  // ─── Load top vehicles for hovered week (debounced) ───────────────

  useEffect(() => {
    clearTimeout(weekQueryTimer.current);
    if (!isHovering || !hoverData?.week) {
      setWeekVehicles([]);
      return;
    }
    const weekKey = hoverData.week;
    // Check cache first
    if (weekVehicleCache.current.has(weekKey)) {
      setWeekVehicles(weekVehicleCache.current.get(weekKey)!);
      return;
    }
    weekQueryTimer.current = setTimeout(async () => {
      setWeekVehiclesLoading(true);
      const weekStart = new Date(weekKey);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      // Get top vehicles by bid count for this week
      const { data: bids } = await supabase
        .from('bat_bids')
        .select('vehicle_id')
        .gte('bid_timestamp', weekStart.toISOString())
        .lt('bid_timestamp', weekEnd.toISOString())
        .not('vehicle_id', 'is', null)
        .limit(2000);
      if (!bids?.length) { setWeekVehiclesLoading(false); setWeekVehicles([]); return; }
      // Count bids per vehicle
      const counts = new Map<string, number>();
      for (const b of bids) {
        counts.set(b.vehicle_id, (counts.get(b.vehicle_id) || 0) + 1);
      }
      // Get top 5 vehicles
      const top5 = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      const vehicleIds = top5.map(t => t[0]);
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .in('id', vehicleIds);
      const vMap = new Map((vehicles || []).map((v: any) => [v.id, v]));
      // Also get max bid for each
      const results: any[] = [];
      for (const [vid, count] of top5) {
        const v = vMap.get(vid);
        const { data: maxBid } = await supabase
          .from('bat_bids')
          .select('bid_amount')
          .eq('vehicle_id', vid)
          .gte('bid_timestamp', weekStart.toISOString())
          .lt('bid_timestamp', weekEnd.toISOString())
          .order('bid_amount', { ascending: false })
          .limit(1);
        results.push({
          vehicle_id: vid,
          name: v ? `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim() : vid.slice(0, 8),
          bids: count,
          max_bid: maxBid?.[0]?.bid_amount || 0,
        });
      }
      weekVehicleCache.current.set(weekKey, results);
      setWeekVehicles(results);
      setWeekVehiclesLoading(false);
    }, 200);
    return () => clearTimeout(weekQueryTimer.current);
  }, [isHovering, hoverData?.week]);

  // ─── Derived: filtered trend data by time range ────────────────────

  const filteredTrends = useMemo(() => {
    if (!rawTrends.length) return [];
    // Drop the last week if it looks like a partial/incomplete week (< 20% of prior week's bids)
    let trends = [...rawTrends];
    if (trends.length >= 2) {
      const last = trends[trends.length - 1];
      const prev = trends[trends.length - 2];
      if (last.total_bids < prev.total_bids * 0.2) {
        trends = trends.slice(0, -1);
      }
    }
    const rangeConfig = TIME_RANGES.find(r => r.key === timeRange)!;
    const sliced = rangeConfig.weeks >= 9999 ? trends : trends.slice(-rangeConfig.weeks);
    return sliced.map((w: any) => ({
      ...w,
      weekLabel: new Date(w.week).toLocaleDateString('en-US', {
        month: 'short',
        ...(rangeConfig.weeks <= 52 ? { day: 'numeric' } : { year: '2-digit' }),
      }),
      weekFull: new Date(w.week).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    }));
  }, [rawTrends, timeRange]);

  // ─── Derived: hero value (current or hovered) ─────────────────────

  const metricConfig = METRICS.find(m => m.key === primaryMetric)!;
  const secondaryConfig = secondaryMetric ? METRICS.find(m => m.key === secondaryMetric) : null;

  // Aggregate a metric across the filtered range
  const aggregateMetric = useCallback((data: any[], metric: Metric, agg: 'sum' | 'avg' | 'max') => {
    if (!data.length) return 0;
    const values = data.map(w => w[metric] || 0);
    if (agg === 'sum') return values.reduce((a, b) => a + b, 0);
    if (agg === 'max') return Math.max(...values);
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }, []);

  const heroValue = useMemo(() => {
    if (isHovering && hoverData) {
      // Hovering: show that specific week's values
      return {
        primary: metricConfig.format(hoverData[primaryMetric]),
        secondary: secondaryConfig ? secondaryConfig.format(hoverData[secondaryMetric!]) : null,
        label: `Week of ${hoverData.weekFull || ''}`,
        isWeek: true,
      };
    }
    // Default: show RANGE AGGREGATE (not single week)
    if (!filteredTrends.length) return { primary: '—', secondary: null, label: '', isWeek: false };
    const primaryAgg = aggregateMetric(filteredTrends, primaryMetric, metricConfig.aggregate);
    const secondaryAgg = secondaryConfig && secondaryMetric
      ? aggregateMetric(filteredTrends, secondaryMetric, secondaryConfig.aggregate)
      : null;
    return {
      primary: metricConfig.format(primaryAgg),
      secondary: secondaryAgg !== null && secondaryConfig ? secondaryConfig.format(secondaryAgg) : null,
      label: '',
      isWeek: false,
    };
  }, [isHovering, hoverData, filteredTrends, primaryMetric, secondaryMetric, metricConfig, secondaryConfig, aggregateMetric]);

  // ─── Derived: trend delta ─────────────────────────────────────────

  const trendDelta = useMemo(() => {
    if (filteredTrends.length < 2) return null;
    const half = Math.floor(filteredTrends.length / 2);
    const recent = filteredTrends.slice(half);
    const prior = filteredTrends.slice(0, half);
    const recentAvg = recent.reduce((s, w) => s + (w[primaryMetric] || 0), 0) / recent.length;
    const priorAvg = prior.reduce((s, w) => s + (w[primaryMetric] || 0), 0) / prior.length;
    if (priorAvg === 0) return null;
    const pct = ((recentAvg - priorAvg) / priorAvg * 100);
    return { pct, positive: pct >= 0 };
  }, [filteredTrends, primaryMetric]);

  // ─── Derived: total overview stats for the selected range ─────────

  const rangeStats = useMemo(() => {
    if (!filteredTrends.length) return null;
    return {
      totalBids: filteredTrends.reduce((s, w) => s + (w.total_bids || 0), 0),
      totalAuctions: filteredTrends.reduce((s, w) => s + (w.auctions || 0), 0),
      peakBidders: Math.max(...filteredTrends.map(w => w.active_bidders || 0)),
      avgBid: Math.round(filteredTrends.reduce((s, w) => s + (w.avg_bid || 0), 0) / filteredTrends.length),
      weeks: filteredTrends.length,
    };
  }, [filteredTrends]);

  // ─── Derived: data-driven filter chips ─────────────────────────────

  const makeChips = useMemo(() => {
    if (filterOptions?.top_makes) return filterOptions.top_makes.slice(0, 15);
    return treemapData.slice(0, 15).map(t => ({ name: t.name, total_bids: t.bid_count, vehicles: t.vehicles, avg_bid: t.avg_bid }));
  }, [filterOptions, treemapData]);

  const decadeChips = useMemo(() => {
    return filterOptions?.decades || [];
  }, [filterOptions]);

  const bodyStyleChips = useMemo(() => {
    return filterOptions?.body_styles?.slice(0, 8) || [];
  }, [filterOptions]);

  // ─── Derived: filtered treemap by selected makes ──────────────────

  const filteredTreemap = useMemo(() => {
    if (selectedMakes.size === 0) return treemapData;
    return treemapData.filter(t => selectedMakes.has(t.name));
  }, [treemapData, selectedMakes]);

  // ─── Bidder averages for classification ───────────────────────────

  const avgBidsAll = topBidders.length > 0 ? topBidders.reduce((s, b) => s + b.total_bids, 0) / topBidders.length : 1;
  const avgWinRateAll = topBidders.length > 0 ? topBidders.reduce((s, b) => s + (b.win_rate || 0), 0) / topBidders.length : 1;
  const avgBidCount = hottestAuctions.length > 0 ? hottestAuctions.reduce((s, h) => s + h.bid_count, 0) / hottestAuctions.length : 1;

  // ─── Chart X-axis tick interval ───────────────────────────────────

  const tickInterval = useMemo(() => {
    const len = filteredTrends.length;
    if (len <= 8) return 0;
    if (len <= 16) return 1;
    if (len <= 30) return 3;
    if (len <= 60) return 7;
    return Math.floor(len / 10);
  }, [filteredTrends]);

  // ─── Filter toggles ─────────────────────────────────────────────

  const toggleMake = (make: string) => {
    setSelectedMakes(prev => {
      const next = new Set(prev);
      if (next.has(make)) next.delete(make); else next.add(make);
      return next;
    });
  };

  const toggleDecade = (decade: number) => {
    setSelectedDecades(prev => {
      const next = new Set(prev);
      if (next.has(decade)) next.delete(decade); else next.add(decade);
      return next;
    });
  };

  const toggleBodyStyle = (style: string) => {
    setSelectedBodyStyles(prev => {
      const next = new Set(prev);
      if (next.has(style)) next.delete(style); else next.add(style);
      return next;
    });
  };

  const clearAllFilters = () => {
    setSelectedMakes(new Set());
    setSelectedDecades(new Set());
    setSelectedBodyStyles(new Set());
    setDrillMake(null);
  };

  // ─── Chart hover: map mouse X to nearest data point ────────────────

  const chartRef = useRef<HTMLDivElement>(null);

  const handleChartWrapperMove = useCallback((e: React.MouseEvent) => {
    if (!chartRef.current || !filteredTrends.length) return;
    const rect = chartRef.current.getBoundingClientRect();
    const chartLeft = 45; // YAxis width
    const chartRight = 45; // right YAxis width
    const usableWidth = rect.width - chartLeft - chartRight - 20; // margins
    const mouseX = e.clientX - rect.left - chartLeft - 10;
    if (mouseX < 0 || mouseX > usableWidth) return;
    const ratio = mouseX / usableWidth;
    const idx = Math.round(ratio * (filteredTrends.length - 1));
    const clamped = Math.max(0, Math.min(filteredTrends.length - 1, idx));
    const point = filteredTrends[clamped];
    if (point) {
      setHoverData(point);
      setIsHovering(true);
    }
  }, [filteredTrends]);

  const handleChartWrapperLeave = useCallback(() => {
    setIsHovering(false);
    setHoverData(null);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading bid analytics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <span style={{ fontSize: '12px', color: 'var(--error)' }}>Error: {error}</span>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-4)' }}>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HERO SECTION — Robinhood-style big number + controls          */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <div style={{ marginBottom: 'var(--space-4)' }}>
        {/* Title + range stats */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Bid Market
          </span>
          {rangeStats && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {fmt(rangeStats.totalBids)} bids &middot; {fmt(rangeStats.totalAuctions)} auctions &middot; {rangeStats.weeks} weeks
            </span>
          )}
        </div>

        {/* Hero value — big number like Robinhood portfolio value */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span
              title={isHovering ? `${metricConfig.label} for this week` : `${metricConfig.aggregate === 'sum' ? 'Total' : metricConfig.aggregate === 'max' ? 'Peak' : 'Average'} ${metricConfig.label.toLowerCase()} across ${timeRange === 'ALL' ? 'all time' : `last ${TIME_RANGES.find(r => r.key === timeRange)?.weeks} weeks`}`}
              style={{
                fontSize: '37px', fontWeight: 800, color: 'var(--text)',
                fontFamily: 'var(--font-mono, monospace)', letterSpacing: '-1px',
                transition: 'opacity 0.15s',
                opacity: isHovering ? 0.9 : 1,
                cursor: 'help',
              }}
            >
              {heroValue.primary}
            </span>
            {heroValue.secondary && secondaryConfig && (
              <span
                title={`${secondaryConfig.aggregate === 'sum' ? 'Total' : secondaryConfig.aggregate === 'max' ? 'Peak' : 'Average'} ${secondaryConfig.label.toLowerCase()}`}
                style={{ fontSize: '19px', fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', cursor: 'help' }}
              >
                {heroValue.secondary}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {trendDelta && !isHovering && (
              <span
                title={`${metricConfig.label} averaged ${trendDelta.positive ? 'higher' : 'lower'} in the second half of this range vs the first half`}
                style={{
                  fontSize: '12px', fontWeight: 700, cursor: 'help',
                  color: trendDelta.positive ? '#008000' : '#d13438',
                }}
              >
                {trendDelta.positive ? '+' : ''}{trendDelta.pct.toFixed(1)}%
              </span>
            )}
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {heroValue.isWeek ? heroValue.label : (
                <>
                  {metricConfig.aggregate === 'sum' ? 'Total' : metricConfig.aggregate === 'max' ? 'Peak weekly' : 'Avg weekly'}{' '}
                  {metricConfig.label.toLowerCase()}
                  {secondaryConfig && !isHovering ? ` + ${secondaryConfig.aggregate === 'sum' ? 'total' : secondaryConfig.aggregate === 'max' ? 'peak' : 'avg'} ${secondaryConfig.label.toLowerCase()}` : ''}
                  {' '}&middot; {timeRange === 'ALL' ? 'all time' : `last ${TIME_RANGES.find(r => r.key === timeRange)?.label}`}
                  {hasFilters && (
                    <> &middot; filtered: {[
                      ...Array.from(selectedMakes),
                      ...Array.from(selectedDecades).map(d => `${d}s`),
                      ...Array.from(selectedBodyStyles),
                    ].join(', ')}</>
                  )}
                  {' '}&middot; hover chart for weekly breakdown
                </>
              )}
            </span>
          </div>
        </div>

        {/* ─── Metric Toggles ──────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
          {METRICS.map(m => (
            <button
              key={m.key}
              title={`${m.tip}\n\nClick to make primary metric. Right-click to toggle as secondary (dashed line).`}
              onClick={() => {
                if (primaryMetric === m.key) return;
                if (secondaryMetric === m.key) {
                  setSecondaryMetric(primaryMetric);
                  setPrimaryMetric(m.key);
                } else {
                  setSecondaryMetric(primaryMetric);
                  setPrimaryMetric(m.key);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSecondaryMetric(prev => prev === m.key ? null : m.key);
              }}
              style={{
                padding: '3px 10px', fontSize: '11px', cursor: 'pointer',
                border: '1px solid',
                borderColor: primaryMetric === m.key ? METRIC_COLORS[m.key] : secondaryMetric === m.key ? `${METRIC_COLORS[m.key]}60` : 'var(--border-light)',
                background: primaryMetric === m.key ? `${METRIC_COLORS[m.key]}15` : 'var(--white)',
                color: primaryMetric === m.key ? METRIC_COLORS[m.key] : secondaryMetric === m.key ? METRIC_COLORS[m.key] : 'var(--text-muted)',
                fontWeight: primaryMetric === m.key ? 700 : 400,
              }}
            >
              {m.label}
              {secondaryMetric === m.key && <span style={{ fontSize: '8px', marginLeft: 3, opacity: 0.6 }}>2nd</span>}
            </button>
          ))}
        </div>

        {/* ─── Time Range Pills ────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 2 }}>
          {TIME_RANGES.map(r => (
            <button
              key={r.key}
              title={r.tip}
              onClick={() => setTimeRange(r.key)}
              style={{
                padding: '4px 14px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                border: '1px solid var(--border-light)',
                borderRight: 'none',
                background: timeRange === r.key ? 'var(--text)' : 'var(--white)',
                color: timeRange === r.key ? 'var(--white)' : 'var(--text-muted)',
              }}
            >
              {r.label}
            </button>
          ))}
          <div style={{ borderRight: '1px solid var(--border-light)' }} />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MAIN CHART — interactive crosshair, dual metric              */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <div style={{
        background: 'var(--white)', border: '1px solid var(--border-light)',
        marginBottom: 'var(--space-4)', overflow: 'hidden',
      }}>
        <div
          ref={chartRef}
          style={{ padding: '8px 8px 4px 8px', cursor: 'crosshair' }}
          onMouseMove={handleChartWrapperMove}
          onMouseLeave={handleChartWrapperLeave}
        >
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart
                data={filteredTrends}
                margin={{ top: 10, right: 12, left: 0, bottom: 5 }}
              >
                <defs>
                  <linearGradient id="primaryGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={METRIC_COLORS[primaryMetric]} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={METRIC_COLORS[primaryMetric]} stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
                <XAxis
                  dataKey="weekLabel"
                  tick={{ fontSize: 8, fill: 'var(--text-muted)' }}
                  interval={tickInterval}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 8, fill: 'var(--text-muted)' }}
                  width={45}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => primaryMetric.includes('bid') && !primaryMetric.includes('bids') ? fmtPrice(v) : fmt(v)}
                />
                {secondaryMetric && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 8, fill: 'var(--text-muted)' }}
                    width={45}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => secondaryMetric.includes('bid') && !secondaryMetric.includes('bids') ? fmtPrice(v) : fmt(v)}
                  />
                )}
                <Tooltip
                  cursor={<ChartCrosshair />}
                  contentStyle={{ background: 'var(--white)', border: '1px solid var(--border-medium)', fontSize: '11px', padding: '6px 8px' }}
                  labelFormatter={(v: string) => ''}
                  formatter={(value: number, name: string) => {
                    const m = METRICS.find(mt => mt.key === name);
                    return [m ? m.format(value) : String(value), m?.label || name];
                  }}
                />
                {/* Primary metric as area + line */}
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey={primaryMetric}
                  stroke={METRIC_COLORS[primaryMetric]}
                  fill="url(#primaryGrad)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: METRIC_COLORS[primaryMetric], stroke: '#fff', strokeWidth: 2 }}
                />
                {/* Secondary metric as dashed line */}
                {secondaryMetric && (
                  <Line
                    yAxisId={secondaryMetric === primaryMetric ? 'left' : 'right'}
                    type="monotone"
                    dataKey={secondaryMetric}
                    stroke={METRIC_COLORS[secondaryMetric]}
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    dot={false}
                    activeDot={{ r: 3, fill: METRIC_COLORS[secondaryMetric], stroke: '#fff', strokeWidth: 1 }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ─── Live "What's Here" panel — shows vehicles when hovering ─── */}
        {isHovering && hoverData && (
          <div style={{
            borderTop: '1px solid var(--border-light)', padding: '8px 12px',
            background: 'var(--grey-50)', transition: 'opacity 0.15s', fontSize: '11px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: '12px' }}>{hoverData.weekFull}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                  {fmt(hoverData.total_bids)} bids &middot; {fmt(hoverData.auctions)} auctions &middot; {fmt(hoverData.active_bidders)} bidders &middot; avg {fmtPrice(hoverData.avg_bid)}
                </span>
              </div>
              {weekVehiclesLoading && <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>loading...</span>}
            </div>
            {weekVehicles.length > 0 && (
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
                {weekVehicles.map((v) => (
                  <a
                    key={v.vehicle_id}
                    href={`/vehicle/${v.vehicle_id}`}
                    style={{
                      flex: '0 0 auto', minWidth: 160, maxWidth: 220,
                      padding: '6px 8px', background: 'var(--white)', border: '1px solid var(--border-light)',
                      textDecoration: 'none', color: 'inherit', display: 'block',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#0066cc' }}>
                      {v.name}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                      <span style={{ color: '#5b7a9d', fontWeight: 600 }}>{v.bids} bids</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtPrice(v.max_bid)}</span>
                    </div>
                  </a>
                ))}
              </div>
            )}
            {!weekVehiclesLoading && weekVehicles.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>Hover to see which vehicles drove this week's activity</div>
            )}
          </div>
        )}

        {/* ─── Range summary bar (when NOT hovering) ─────────── */}
        {!isHovering && rangeStats && (
          <div style={{
            display: 'flex', gap: 0, borderTop: '1px solid var(--border-light)',
            fontSize: '11px', color: 'var(--text-muted)',
          }}>
            {[
              { label: 'Total Bids', value: fmt(rangeStats.totalBids) },
              { label: 'Auctions', value: fmt(rangeStats.totalAuctions) },
              { label: 'Peak Bidders/wk', value: fmt(rangeStats.peakBidders) },
              { label: 'Avg Bid', value: fmtPriceFull(rangeStats.avgBid) },
            ].map((s, i) => (
              <div key={s.label} style={{
                flex: 1, padding: '6px 10px',
                borderRight: i < 3 ? '1px solid var(--border-light)' : 'none',
              }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '9px' }}>{s.label}</div>
                <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text)', fontFamily: 'var(--font-mono, monospace)' }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* ─── Multi-platform coverage bar ───────────────────── */}
        {platformStats?.cars_and_bids && platformStats.cars_and_bids.bids > 0 && (
          <div style={{
            display: 'flex', gap: 0, borderTop: '1px solid var(--border-light)',
            fontSize: '9px', color: 'var(--text-muted)', background: 'var(--grey-50)',
          }}>
            <div style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6, borderRight: '1px solid var(--border-light)' }}>
              <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#e8590c' }}>C&B</span>
              <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'var(--text)', fontSize: '11px' }}>
                {fmt(platformStats.cars_and_bids.bids)}
              </span>
              <span>bids</span>
            </div>
            <div style={{ padding: '4px 10px', borderRight: '1px solid var(--border-light)' }}>
              <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, color: 'var(--text)' }}>{fmt(platformStats.cars_and_bids.vehicles)}</span> vehicles
            </div>
            <div style={{ padding: '4px 10px', borderRight: '1px solid var(--border-light)' }}>
              <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, color: 'var(--text)' }}>{fmt(platformStats.cars_and_bids.bidders)}</span> bidders
            </div>
            <div style={{ padding: '4px 10px', borderRight: '1px solid var(--border-light)' }}>
              avg <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, color: 'var(--text)' }}>{fmtPrice(platformStats.cars_and_bids.avg_bid)}</span>
            </div>
            <div style={{ padding: '4px 10px' }}>
              {platformStats.cars_and_bids.extraction_hours < 24 ? (
                <><span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, color: 'var(--text)' }}>
                  {fmt(platformStats.cars_and_bids.bids_per_hour)}
                </span> bids/hr rate</>
              ) : (
                <><span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, color: 'var(--text)' }}>
                  {platformStats.cars_and_bids.bids_per_day.toFixed(0)}
                </span> bids/day</>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DATA-DRIVEN FILTERS                                           */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <div style={{
        background: 'var(--white)', border: '1px solid var(--border-light)',
        padding: '10px 12px', marginBottom: 'var(--space-4)',
      }}>
        {/* Filter header with active count + clear */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
            Filters
            {hasFilters && (
              <span style={{ fontWeight: 400, marginLeft: 6 }}>
                {selectedMakes.size + selectedDecades.size + selectedBodyStyles.size} active — chart updates live
              </span>
            )}
          </span>
          {hasFilters && (
            <button
              onClick={clearAllFilters}
              style={{ fontSize: '11px', color: '#d13438', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              Clear all
            </button>
          )}
        </div>

        {/* ─── Decade pills ──────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 6, flexWrap: 'wrap' }}>
          <span title="Filter by vehicle decade. Multiple decades can be selected. This filters the chart, treemap, and all data." style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600, width: 42, flexShrink: 0, cursor: 'help' }}>ERA</span>
          {decadeChips.map(d => {
            const label = `${d.decade}s`;
            const selected = selectedDecades.has(d.decade);
            return (
              <button
                key={d.decade}
                title={`${label}: ${fmt(d.total_bids)} bids across ${fmt(d.vehicles)} vehicles. Click to filter all data to this era.`}
                onClick={() => toggleDecade(d.decade)}
                style={{
                  padding: '2px 7px', fontSize: '9px', cursor: 'pointer',
                  border: '1px solid',
                  borderColor: selected ? '#7d6b91' : 'var(--border-light)',
                  background: selected ? '#7d6b9118' : 'var(--white)',
                  color: selected ? '#7d6b91' : 'var(--text-muted)',
                  fontWeight: selected ? 700 : 400,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ─── Body style pills ──────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 6, flexWrap: 'wrap' }}>
          <span title="Filter by body style. Based on actual bid data — styles with more bids appear first." style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600, width: 42, flexShrink: 0, cursor: 'help' }}>TYPE</span>
          {bodyStyleChips.map(b => {
            const selected = selectedBodyStyles.has(b.name);
            return (
              <button
                key={b.name}
                title={`${b.name}: ${fmt(b.total_bids)} bids across ${fmt(b.vehicles)} vehicles`}
                onClick={() => toggleBodyStyle(b.name)}
                style={{
                  padding: '2px 7px', fontSize: '9px', cursor: 'pointer',
                  border: '1px solid',
                  borderColor: selected ? '#6b9d7d' : 'var(--border-light)',
                  background: selected ? '#6b9d7d18' : 'var(--white)',
                  color: selected ? '#6b9d7d' : 'var(--text-muted)',
                  fontWeight: selected ? 700 : 400,
                }}
              >
                {b.name}
              </button>
            );
          })}
        </div>

        {/* ─── Make chips ────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <span title="Filter by make. Top 15 makes by bid volume. Click to filter chart and treemap." style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600, width: 42, flexShrink: 0, cursor: 'help' }}>MAKE</span>
          {makeChips.map(m => {
            const selected = selectedMakes.has(m.name);
            return (
              <button
                key={m.name}
                title={`${m.name}: ${fmt(m.total_bids)} bids · ${fmt(m.vehicles)} vehicles · avg ${fmtPrice(m.avg_bid)}`}
                onClick={() => toggleMake(m.name)}
                style={{
                  padding: '2px 7px', fontSize: '9px', cursor: 'pointer',
                  border: '1px solid',
                  borderColor: selected ? '#5b7a9d' : 'var(--border-light)',
                  background: selected ? '#5b7a9d18' : 'var(--white)',
                  color: selected ? '#5b7a9d' : 'var(--text-muted)',
                  fontWeight: selected ? 700 : 400,
                }}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TREEMAP + TABLES                                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        {/* Treemap — click to drill into models */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--border-light)', overflow: 'hidden' }}>
          <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-light)', background: 'var(--grey-50)', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              {drillMake ? (
                <>
                  <button
                    onClick={() => setDrillMake(null)}
                    title="Back to all makes"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#0066cc', padding: 0, marginRight: 4 }}
                  >
                    Makes
                  </button>
                  <span style={{ color: 'var(--text-muted)' }}>/</span>
                  <span style={{ marginLeft: 4 }}>{drillMake} Models</span>
                </>
              ) : (
                <>
                  Volume by Make
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>click to drill into models</span>
                </>
              )}
            </div>
            {drillMake && (
              <button
                onClick={() => setDrillMake(null)}
                title="Back to all makes view"
                style={{ background: 'none', border: '1px solid var(--border-light)', cursor: 'pointer', fontSize: '11px', color: 'var(--text-muted)', padding: '1px 8px' }}
              >
                Back
              </button>
            )}
          </div>
          <div style={{ padding: 4, position: 'relative' }}>
            {drillLoading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.8)', zIndex: 2 }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loading {drillMake} models...</span>
              </div>
            )}
            <div style={{ width: '100%', height: 258 }}>
              <ResponsiveContainer>
                <Treemap
                  data={drillMake && drillModels.length > 0 ? drillModels : filteredTreemap}
                  dataKey="size"
                  aspectRatio={4 / 3}
                  content={<TreemapContent />}
                  onClick={(node: any) => {
                    if (!drillMake && node?.name) {
                      setDrillMake(node.name);
                    }
                  }}
                >
                  <Tooltip
                    content={({ payload }: any) => {
                      const d = payload?.[0]?.payload;
                      if (!d) return null;
                      return (
                        <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 10, fontSize: '11px', maxWidth: 260 }}>
                          <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: 4 }}>
                            {drillMake ? `${drillMake} ${d.name}` : d.name}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Total bids</span>
                            <span style={{ fontWeight: 600 }}>{fmt(d.bid_count)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Vehicles</span>
                            <span style={{ fontWeight: 600 }}>{fmt(d.vehicles)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Avg bid</span>
                            <span style={{ fontWeight: 600 }}>{fmtPrice(d.avg_bid)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Unique bidders</span>
                            <span style={{ fontWeight: 600 }}>{fmt(d.unique_bidders)}</span>
                          </div>
                          <div style={{ marginTop: 6, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                            {drillMake
                              ? (d.vehicles > 50 ? `One of the most popular ${drillMake} models on BaT. High activity drives competitive pricing.` :
                                 d.avg_bid > 80000 ? `Premium ${drillMake} model — fewer listings but higher average bids indicate collector demand.` :
                                 `${d.vehicles} ${drillMake} ${d.name} vehicles have attracted bidding activity.`)
                              : (d.bid_count > 300000 ? 'One of the most actively bid makes on BaT. High liquidity means faster price discovery.' :
                                 d.bid_count > 100000 ? 'Strong bidding interest. These auctions typically attract competitive final prices.' :
                                 d.avg_bid > 50000 ? 'Lower volume but higher average bids — a premium/niche segment.' :
                                 'Moderate activity. Bids tend to cluster around enthusiast price points.')}
                          </div>
                          {!drillMake && <div style={{ marginTop: 4, fontSize: '9px', color: '#0066cc' }}>Click to see model breakdown</div>}
                        </div>
                      );
                    }}
                  />
                </Treemap>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Most Competitive Auctions */}
        <div style={{ background: 'var(--white)', border: '1px solid var(--border-light)', overflow: 'hidden' }}>
          <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-light)', background: 'var(--grey-50)', fontSize: '12px', fontWeight: 700 }}>
            Most Competitive Auctions
          </div>
          <div style={{ padding: 'var(--space-4)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Vehicle</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Bids</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Final</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Appr.</th>
                </tr>
              </thead>
              <tbody>
                {hottestAuctions.map((h: any) => {
                  const insight = describeAuction(h, avgBidCount);
                  return (
                    <HoverCard key={h.vehicle_id} content={
                      <div style={{ fontSize: '11px' }}>
                        <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: 2 }}>
                          {h.year ? `${h.year} ${h.make || ''} ${h.model || ''}`.trim() : 'Unknown Vehicle'}
                        </div>
                        <div style={{ display: 'inline-block', padding: '1px 6px', background: 'var(--grey-100)', fontWeight: 700, fontSize: '11px', marginBottom: 6 }}>
                          {insight.headline}
                        </div>
                        <div style={{ color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 8 }}>{insight.detail}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Opening bid</span><span style={{ fontWeight: 600 }}>{fmtPrice(h.opening_bid)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Final bid</span><span style={{ fontWeight: 600 }}>{fmtPrice(h.final_bid)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Unique bidders</span><span style={{ fontWeight: 600 }}>{h.unique_bidders}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Bid velocity</span><span style={{ fontWeight: 600 }}>{h.bids_per_hour} bids/hr</span>
                          </div>
                        </div>
                      </div>
                    }>
                      <tr
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--grey-100)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ textAlign: 'left', padding: '3px 6px', fontSize: '11px', borderBottom: '1px solid var(--border-light)' }}>
                          <a href={`/vehicle/${h.vehicle_id}`} style={{ color: '#0066cc', textDecoration: 'none', fontSize: '11px' }}>
                            {h.year ? `${h.year} ${h.make || ''} ${h.model || ''}`.trim() : h.vehicle_id.slice(0, 8)}
                          </a>
                        </td>
                        <td style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, borderBottom: '1px solid var(--border-light)' }}>{fmt(h.bid_count)}</td>
                        <td style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-light)' }}>{fmtPrice(h.final_bid)}</td>
                        <td style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-light)' }}>
                          <span style={{ color: Number(h.appreciation_pct) > 100 ? '#008000' : 'inherit' }}>
                            {h.appreciation_pct ? `+${Number(h.appreciation_pct).toFixed(0)}%` : '—'}
                          </span>
                        </td>
                      </tr>
                    </HoverCard>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── Top Bidders ──────────────────────────────────────── */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--border-light)', overflow: 'hidden', marginBottom: 'var(--space-4)' }}>
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-light)', background: 'var(--grey-50)', fontSize: '12px', fontWeight: 700 }}>
          Top Bidders
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>hover for profile, click for detail</span>
        </div>
        <div style={{ padding: 'var(--space-4)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Username</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Bids</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Wins</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Type</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Avg Bid</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-light)' }}>Max Bid</th>
              </tr>
            </thead>
            <tbody>
              {topBidders.map((b: any) => {
                const cls = classifyBidder(b, avgBidsAll, avgWinRateAll);
                return (
                  <HoverCard key={b.bat_username} content={
                    <div style={{ fontSize: '11px' }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: 2 }}>{b.bat_username}</div>
                      <div style={{ display: 'inline-block', padding: '1px 6px', background: `${cls.color}18`, border: `1px solid ${cls.color}40`, color: cls.color, fontWeight: 700, fontSize: '11px', marginBottom: 6 }}>
                        {cls.label}
                      </div>
                      <div style={{ color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 8 }}>{cls.detail}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid var(--border-light)', paddingTop: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Total bids</span><span style={{ fontWeight: 600 }}>{fmt(b.total_bids)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Auctions entered</span><span style={{ fontWeight: 600 }}>{fmt(b.auctions_entered)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Wins</span><span style={{ fontWeight: 600 }}>{b.wins} ({b.win_rate}%)</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Avg bid</span><span style={{ fontWeight: 600 }}>{fmtPrice(b.avg_bid)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Max bid</span><span style={{ fontWeight: 600 }}>{fmtPrice(b.max_bid)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Active since</span><span style={{ fontWeight: 600 }}>{new Date(b.first_seen).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                        </div>
                      </div>
                    </div>
                  }>
                    <tr style={{ cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--grey-100)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ textAlign: 'left', padding: '3px 6px', fontSize: '11px', borderBottom: '1px solid var(--border-light)' }}>
                        <button onClick={() => setSelectedBidder(b.bat_username)}
                          style={{ color: '#0066cc', cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontSize: '11px', fontFamily: 'var(--font-family)', textAlign: 'left' }}>
                          {b.bat_username}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-light)' }}>{fmt(b.total_bids)}</td>
                      <td style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-light)' }}>{b.wins}</td>
                      <td style={{ textAlign: 'left', padding: '3px 6px', fontSize: '9px', borderBottom: '1px solid var(--border-light)' }}>
                        <span style={{ color: cls.color, fontWeight: 600 }}>{cls.label}</span>
                      </td>
                      <td style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-light)' }}>{fmtPrice(b.avg_bid)}</td>
                      <td style={{ textAlign: 'right', padding: '3px 6px', fontSize: '11px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border-light)' }}>{fmtPrice(b.max_bid)}</td>
                    </tr>
                  </HoverCard>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedBidder && (
        <BidderProfileCard username={selectedBidder} isOpen={true} onClose={() => setSelectedBidder(null)} />
      )}
    </div>
  );
}
