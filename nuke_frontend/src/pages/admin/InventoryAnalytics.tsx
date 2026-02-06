/**
 * INVENTORY ANALYTICS DASHBOARD
 * 
 * Real analyst-grade visualization of the entire vehicle database.
 * Powered by recharts + the inventory-analytics edge function.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Treemap,
  AreaChart, Area,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  Legend,
} from 'recharts';
import { supabase } from '../../lib/supabase';

// ─── Color Palettes ─────────────────────────────────────────────────────
const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48',
];

const ERA_COLORS: Record<string, string> = {
  'pre-war': '#92400e',
  'post-war': '#b45309',
  'classic': '#d97706',
  'malaise': '#ca8a04',
  'modern-classic': '#65a30d',
  'modern': '#0891b2',
  'contemporary': '#7c3aed',
  'unknown': '#6b7280',
};

// ─── Types ──────────────────────────────────────────────────────────────
interface AnalyticsData {
  overview: {
    total_vehicles: number;
    active: number;
    sold: number;
    with_price: number;
    with_image: number;
    with_vin: number;
    distinct_makes: number;
    avg_price: number;
    median_price: number;
  };
  byEra: Array<{ name: string; value: number; priced: number; avg_price: number }>;
  byMake: Array<{ name: string; value: number; priced: number; avg_price: number; with_image: number }>;
  bySegment: Array<{ name: string; value: number }>;
  byBodyStyle: Array<{ name: string; value: number }>;
  bySource: Array<{ name: string; value: number }>;
  byDecade: Array<{ name: string; value: number; avg_price: number }>;
  priceDist: Array<{ name: string; value: number }>;
  dataQuality: Record<string, number>;
  recentActivity: Array<{ date: string; value: number }>;
  importQueue: Array<{ name: string; value: number }>;
  generatedAt: string;
}

// ─── Formatting helpers ─────────────────────────────────────────────────
const fmt = (n: number) => n?.toLocaleString() ?? '—';
const fmtK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
const fmtPrice = (n: number) => {
  if (!n) return '—';
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
};

// ─── Stat Card ──────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = 'blue' }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'from-blue-500/10 to-blue-600/5 border-blue-500/20',
    green: 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/20',
    amber: 'from-amber-500/10 to-amber-600/5 border-amber-500/20',
    purple: 'from-purple-500/10 to-purple-600/5 border-purple-500/20',
    red: 'from-red-500/10 to-red-600/5 border-red-500/20',
    cyan: 'from-cyan-500/10 to-cyan-600/5 border-cyan-500/20',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color] || colors.blue} border rounded-xl p-4`}>
      <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold text-zinc-100 mt-1">{typeof value === 'number' ? fmt(value) : value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

// ─── Section wrapper ────────────────────────────────────────────────────
function Section({ title, children, cols = 1 }: { title: string; children: React.ReactNode; cols?: number }) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-zinc-200 mb-4 border-b border-zinc-800 pb-2">{title}</h2>
      <div className={cols > 1 ? `grid grid-cols-1 lg:grid-cols-${cols} gap-6` : ''}>{children}</div>
    </div>
  );
}

// ─── Chart Card ─────────────────────────────────────────────────────────
function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-zinc-300 mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ─── Data Quality Gauge ─────────────────────────────────────────────────
function QualityBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  const bg = pct > 80 ? 'bg-emerald-500' : pct > 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="text-xs text-zinc-400 w-24 text-right">{label}</span>
      <div className="flex-1 h-4 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${bg} rounded-full transition-all duration-500`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`text-xs font-mono w-12 text-right ${pct > 80 ? 'text-emerald-400' : pct > 50 ? 'text-amber-400' : 'text-red-400'}`}>
        {pct}%
      </span>
    </div>
  );
}

// ─── Custom Tooltip ─────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 shadow-xl">
      <p className="text-sm font-semibold text-zinc-200 mb-1">{label || payload[0]?.name}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs text-zinc-400">
          <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: p.color || p.fill }} />
          {p.name || p.dataKey}: <span className="text-zinc-200 font-medium">{typeof p.value === 'number' ? fmt(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export default function InventoryAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
      const res = await fetch(`${supabaseUrl}/functions/v1/inventory-analytics`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="text-zinc-400 animate-pulse text-lg">Loading analytics...</div>
    </div>
  );

  if (error) return (
    <div className="p-8">
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6">
        <h2 className="text-red-400 font-semibold mb-2">Analytics Error</h2>
        <p className="text-red-300 text-sm font-mono">{error}</p>
        <button onClick={loadData} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-500">Retry</button>
      </div>
    </div>
  );

  if (!data) return null;

  const { overview: o, dataQuality: dq } = data;

  // Data quality items for radar chart
  const qualityItems = [
    { field: 'Year', pct: dq.year_pct },
    { field: 'Make', pct: dq.make_pct },
    { field: 'Model', pct: dq.model_pct },
    { field: 'VIN', pct: dq.vin_pct },
    { field: 'Price', pct: dq.price_pct },
    { field: 'Image', pct: dq.image_pct },
    { field: 'Body', pct: dq.body_style_pct },
    { field: 'Segment', pct: dq.segment_pct },
    { field: 'Mileage', pct: dq.mileage_pct },
    { field: 'Trans.', pct: dq.transmission_pct },
    { field: 'Color', pct: dq.color_pct },
  ];

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Inventory Analytics</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Last updated: {new Date(data.generatedAt).toLocaleTimeString()} · Auto-refreshes every 60s
          </p>
        </div>
        <button onClick={loadData} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm border border-zinc-700">
          Refresh
        </button>
      </div>

      {/* ─── KPI Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Total Vehicles" value={o.total_vehicles} color="blue" />
        <StatCard label="Active" value={o.active} sub={`${((o.active / o.total_vehicles) * 100).toFixed(0)}% of total`} color="green" />
        <StatCard label="With Price" value={o.with_price} sub={`${((o.with_price / o.total_vehicles) * 100).toFixed(0)}%`} color="amber" />
        <StatCard label="Avg Price" value={fmtPrice(o.avg_price)} sub={`Median: ${fmtPrice(o.median_price)}`} color="purple" />
        <StatCard label="With Image" value={o.with_image} sub={`${((o.with_image / o.total_vehicles) * 100).toFixed(0)}%`} color="cyan" />
        <StatCard label="With VIN" value={o.with_vin} sub={`${((o.with_vin / o.total_vehicles) * 100).toFixed(0)}%`} color="red" />
      </div>

      {/* ─── Row 1: Era + Decade + Sources ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <ChartCard title="By Era">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.byEra} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 11 }} tickFormatter={fmtK} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11 }} width={100} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Vehicles" radius={[0, 4, 4, 0]}>
                {data.byEra.map((entry, i) => (
                  <Cell key={i} fill={ERA_COLORS[entry.name] || COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="By Decade (with Avg Price)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.byDecade}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 10 }} angle={-45} textAnchor="end" height={50} />
              <YAxis yAxisId="left" tick={{ fill: '#a1a1aa', fontSize: 11 }} tickFormatter={fmtK} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#a1a1aa', fontSize: 11 }} tickFormatter={fmtPrice} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
              <Bar yAxisId="left" dataKey="value" name="Count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="avg_price" name="Avg $" fill="#f59e0b" radius={[4, 4, 0, 0]} opacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="By Source">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={data.bySource} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={{ stroke: '#52525b' }}
                fontSize={10} fill="#3b82f6">
                {data.bySource.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ─── Row 2: Makes + Price Distribution ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Top 25 Makes">
          <ResponsiveContainer width="100%" height={500}>
            <BarChart data={data.byMake} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 11 }} tickFormatter={fmtK} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11 }} width={110} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Vehicles" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="space-y-6">
          <ChartCard title="Price Distribution">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.priceDist}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 10 }} angle={-25} textAnchor="end" height={50} />
                <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} tickFormatter={fmtK} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Vehicles" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Segments">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.bySegment.filter(s => s.name !== 'Unclassified')} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 11 }} tickFormatter={fmtK} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11 }} width={140} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Vehicles" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {/* ─── Row 3: Data Quality + Activity + Queue ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <ChartCard title="Data Quality Radar">
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={qualityItems}>
              <PolarGrid stroke="#3f3f46" />
              <PolarAngleAxis dataKey="field" tick={{ fill: '#a1a1aa', fontSize: 10 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={{ fill: '#52525b', fontSize: 9 }} />
              <Radar name="Coverage %" dataKey="pct" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
            </RadarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Data Completeness">
          <div className="space-y-1">
            {qualityItems.sort((a, b) => b.pct - a.pct).map(item => (
              <QualityBar key={item.field} label={item.field} pct={item.pct} color="" />
            ))}
          </div>
        </ChartCard>

        <div className="space-y-6">
          <ChartCard title="Vehicles Added (14 Days)">
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={data.recentActivity}>
                <defs>
                  <linearGradient id="activityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: '#52525b', fontSize: 9 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fill: '#52525b', fontSize: 9 }} tickFormatter={fmtK} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="url(#activityGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Import Queue">
            <div className="grid grid-cols-2 gap-2">
              {data.importQueue.map((item, i) => (
                <div key={i} className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-zinc-200">{fmt(item.value)}</div>
                  <div className="text-xs text-zinc-500 capitalize">{item.name}</div>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
