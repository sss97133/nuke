/**
 * Market Map - Nested Treemap Visualization
 *
 * Shows vehicle market distribution by Segment, Source, or Brand.
 * Renders a nested treemap with parent containers and child tiles.
 * Uses the treemap-vehicles edge function for data.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const API = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/treemap-vehicles';
// No artificial limits — treemap layout naturally sizes small items as tiny tiles
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const fetchCache = new Map<string, { data: any; ts: number }>();

// Format helpers
const fmtMoney = (n: number) => {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n);
};
const fmtNum = (n: number) => n.toLocaleString();
const fmtMiles = (n: number) => {
  if (n >= 1000) return fmtNum(n) + ' mi';
  return n + ' mi';
};

type ViewMode = 'segment' | 'source' | 'brand';
type Metric = 'value' | 'count';

interface TreeNode {
  name: string;
  value?: number;
  count?: number;
  children?: TreeNode[];
  isVehicle?: boolean;
  id?: string;
  fullName?: string;
  _parentName?: string;
  // Rich metrics
  medianPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  soldCount?: number;
  auctionCount?: number;
  avgBids?: number;
  avgWatchers?: number;
  // Vehicle-level
  bids?: number;
  comments?: number;
  watchers?: number;
  mileage?: number;
  reserveStatus?: string;
  auctionOutcome?: string;
}

interface Filters {
  source?: string;
  segment?: string;
  make?: string;
  model?: string;
  year?: string;
  _nested?: boolean;
}

interface Stats {
  totalValue: number;
  totalCount: number;
  level: string;
  nested?: boolean;
}

function sellThrough(d: TreeNode): string | null {
  if (!d.auctionCount || d.auctionCount === 0) return null;
  return Math.round(((d.soldCount || 0) / d.auctionCount) * 100) + '%';
}

export default function MarketMap() {
  const [view, setView] = useState<ViewMode>('segment');
  const [metric, setMetric] = useState<Metric>('value');
  const [data, setData] = useState<any>(null);
  const [nestedData, setNestedData] = useState<TreeNode | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [history, setHistory] = useState<Filters[]>([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{
    visible: boolean; x: number; y: number;
    name: string; value: string; rows: { pct: string; label: string }[];
  }>({ visible: false, x: 0, y: 0, name: '', value: '', rows: [] });

  const containerRef = useRef<HTMLDivElement>(null);
  const d3Ref = useRef<any>(null);

  // Load D3 from CDN
  useEffect(() => {
    if ((window as any).d3) {
      d3Ref.current = (window as any).d3;
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://d3js.org/d3.v7.min.js';
    script.onload = () => { d3Ref.current = (window as any).d3; };
    document.head.appendChild(script);
  }, []);

  const load = useCallback(async (f: Filters = {}, useNested = false) => {
    setLoading(true);
    const p = new URLSearchParams();
    p.set('view', view);
    if (useNested) p.set('nested', 'true');
    if (f.source) p.set('source', f.source);
    if (f.segment) p.set('segment', f.segment);
    if (f.make) p.set('make', f.make);
    if (f.model) p.set('model', f.model);
    if (f.year) p.set('year', f.year);

    try {
      const cacheKey = p.toString();
      const cached = fetchCache.get(cacheKey);
      let d: any;
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        d = cached.data;
      } else {
        const r = await fetch(`${API}?${p}`);
        d = await r.json();
        if (d.error) throw new Error(d.error);
        fetchCache.set(cacheKey, { data: d, ts: Date.now() });
      }
      setData(d);
      setFilters(f);
      setNestedData(useNested ? d.hierarchy : null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [view]);

  const nav = useCallback((f: Filters, useNested = false) => {
    setHistory(h => [...h, { ...filters, _nested: !!nestedData }]);
    load(f, useNested);
  }, [filters, nestedData, load]);

  const back = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h;
      const prev = { ...h[h.length - 1] };
      const wasNested = prev._nested;
      delete prev._nested;
      load(prev, !!wasNested);
      return h.slice(0, -1);
    });
  }, [load]);

  const switchView = useCallback((v: ViewMode) => {
    setView(v);
    setHistory([]);
    setFilters({});
  }, []);

  // Re-load when view changes
  useEffect(() => {
    load({}, view === 'segment');
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Get metric value
  const metricVal = useCallback((d: TreeNode) => {
    if (metric === 'count') return d.count || 0;
    return d.value || 0;
  }, [metric]);

  const displayVal = useCallback((d: TreeNode) => {
    if (metric === 'count') return fmtNum(d.count || 0);
    return fmtMoney(d.value || 0);
  }, [metric]);

  // Build tooltip rows for aggregate nodes (non-vehicle)
  function buildTooltipRows(leafData: TreeNode, pctTotal: string, pctParent?: string, parentName?: string): { pct: string; label: string }[] {
    const rows: { pct: string; label: string }[] = [];
    rows.push({ pct: pctTotal + '%', label: 'of total' });
    if (pctParent && parentName) {
      rows.push({ pct: pctParent + '%', label: 'of ' + parentName });
    }
    rows.push({ pct: fmtNum(leafData.count || 0), label: 'vehicles' });
    if (leafData.medianPrice) {
      rows.push({ pct: fmtMoney(leafData.medianPrice), label: 'median price' });
    }
    const st = sellThrough(leafData);
    if (st) {
      rows.push({ pct: st, label: 'sell-through' });
    }
    if (leafData.avgBids && leafData.avgBids > 0) {
      rows.push({ pct: String(leafData.avgBids), label: 'avg bids' });
    }
    return rows;
  }

  // Build tooltip rows for individual vehicles
  function buildVehicleTooltipRows(d: TreeNode): { pct: string; label: string }[] {
    const rows: { pct: string; label: string }[] = [];
    rows.push({ pct: fmtMoney(d.value || 0), label: 'sale price' });
    if (d.mileage) {
      rows.push({ pct: fmtMiles(d.mileage), label: 'mileage' });
    }
    if (d.bids && d.bids > 0) {
      rows.push({ pct: String(d.bids), label: 'bids' });
    }
    if (d.reserveStatus) {
      rows.push({ pct: d.reserveStatus.replace(/_/g, ' '), label: 'reserve' });
    }
    if (d.auctionOutcome) {
      rows.push({ pct: d.auctionOutcome, label: 'outcome' });
    }
    return rows;
  }

  // Render treemap
  useEffect(() => {
    if (!data || !containerRef.current || !d3Ref.current) return;
    const d3 = d3Ref.current;
    const container = containerRef.current;
    container.innerHTML = '';

    const rect = container.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) return;
    const W = Math.floor(rect.width);
    const H = Math.floor(rect.height);

    const source = nestedData || data.hierarchy;
    if (!source?.children?.length) return;

    const isNested = !!nestedData;

    if (isNested) {
      // NESTED treemap — show ALL children, let d3 size them naturally
      const children = source.children.filter((c: TreeNode) => metricVal(c) > 0);
      const grandTotal = children.reduce((s: number, c: TreeNode) => s + metricVal(c), 0);

      const treeData = {
        name: 'root',
        children: children.map((g: TreeNode) => ({
          ...g,
          children: (g.children || []).filter((c: TreeNode) => metricVal(c) > 0)
            .sort((a: TreeNode, b: TreeNode) => metricVal(b) - metricVal(a)),
        })),
      };

      const root = d3.hierarchy(treeData)
        .sum((d: TreeNode) => d.children ? 0 : Math.sqrt(metricVal(d)))
        .sort((a: any, b: any) => b.value - a.value);

      d3.treemap()
        .tile(d3.treemapSquarify.ratio(1.2))
        .size([W, H])
        .paddingTop(18)
        .paddingInner(2)
        .paddingOuter(2)
        .round(true)(root);

      for (const group of root.children || []) {
        const gw = group.x1 - group.x0, gh = group.y1 - group.y0;
        if (gw < 2 || gh < 2) continue;

        const gDiv = document.createElement('div');
        gDiv.style.cssText = `position:absolute;left:${group.x0}px;top:${group.y0}px;width:${gw}px;height:${gh}px;overflow:hidden;border:1px solid rgba(42,42,42,0.6);border-radius:0;background:rgba(30,30,30,0.3);cursor:pointer;`;

        const label = document.createElement('div');
        label.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:3px 5px 2px;font-size:9px;font-weight:700;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2;pointer-events:none;background:rgba(30,30,30,0.7);';
        label.innerHTML = `${gw > 60 ? group.data.name : group.data.name.slice(0, Math.floor(gw / 6))}<span style="font-weight:400;font-family:monospace;font-size:8px;color:#858585;margin-left:6px;">${displayVal(group.data)}</span>`;
        gDiv.appendChild(label);

        for (const leaf of group.children || []) {
          const lx = leaf.x0 - group.x0, ly = leaf.y0 - group.y0;
          const lw = leaf.x1 - leaf.x0, lh = leaf.y1 - leaf.y0;
          if (lw < 2 || lh < 2) continue;

          const lDiv = document.createElement('div');
          lDiv.style.cssText = `position:absolute;left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;overflow:hidden;cursor:pointer;border:1px solid #2a2a2a;border-radius:0;background:#f0efe8;transition:filter 0.1s;`;

          const inner = document.createElement('div');
          inner.style.cssText = 'padding:3px 4px;height:100%;display:flex;flex-direction:column;';

          if (lw > 28 && lh > 14) {
            const nameEl = document.createElement('div');
            nameEl.style.cssText = 'font-size:8px;font-weight:600;color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            const maxC = Math.floor((lw - 6) / 5);
            nameEl.textContent = leaf.data.name.length > maxC ? leaf.data.name.slice(0, maxC) + '...' : leaf.data.name;
            inner.appendChild(nameEl);
          }
          if (lw > 35 && lh > 26) {
            const valEl = document.createElement('div');
            valEl.style.cssText = 'font-size:8px;font-family:monospace;color:#555;margin-top:1px;';
            valEl.textContent = displayVal(leaf.data);
            inner.appendChild(valEl);
          }

          lDiv.appendChild(inner);

          // Events
          const leafData = leaf.data;
          const groupDataName = group.data.name;
          const parentVal = metricVal(group.data);

          lDiv.onmouseover = (e: MouseEvent) => {
            lDiv.style.filter = 'brightness(0.92)';
            const pctTotal = grandTotal > 0 ? ((metricVal(leafData) / grandTotal) * 100).toFixed(1) : '0.0';
            const pctParent = parentVal > 0 ? ((metricVal(leafData) / parentVal) * 100).toFixed(1) : '0.0';
            let val: string;
            if (metric === 'count') val = fmtNum(leafData.count || 0) + ' vehicles';
            else val = fmtMoney(leafData.value || 0);

            setTooltip({
              visible: true,
              x: e.clientX + 12,
              y: e.clientY + 12,
              name: leafData.name,
              value: val,
              rows: buildTooltipRows(leafData, pctTotal, pctParent, groupDataName),
            });
          };
          lDiv.onmousemove = (e: MouseEvent) => {
            setTooltip(t => ({ ...t, x: e.clientX + 12, y: e.clientY + 12 }));
          };
          lDiv.onmouseout = () => { lDiv.style.filter = ''; setTooltip(t => ({ ...t, visible: false })); };
          lDiv.onclick = () => {
            if (view === 'segment') nav({ segment: groupDataName, make: leafData.name });
            else if (view === 'brand') nav({ make: groupDataName, model: leafData.name });
          };
          gDiv.appendChild(lDiv);
        }

        gDiv.onclick = (e) => {
          if (e.target === gDiv || e.target === label) {
            if (view === 'segment') nav({ segment: group.data.name });
            else if (view === 'brand') nav({ make: group.data.name });
          }
        };
        container.appendChild(gDiv);
      }
    } else {
      // FLAT treemap
      let children = source.children.filter((c: TreeNode) => metricVal(c) > 0);
      const totalVal = children.reduce((s: number, c: TreeNode) => s + metricVal(c), 0);

      children = [...children].sort((a: TreeNode, b: TreeNode) => metricVal(b) - metricVal(a));

      const root = d3.hierarchy({ name: 'root', children })
        .sum((d: TreeNode) => d.children ? 0 : Math.sqrt(metricVal(d)))
        .sort((a: any, b: any) => b.value - a.value);

      d3.treemap().tile(d3.treemapSquarify.ratio(1)).size([W, H]).paddingOuter(2).paddingInner(2).round(true)(root);

      for (const leaf of root.leaves()) {
        const w = leaf.x1 - leaf.x0, h = leaf.y1 - leaf.y0;
        if (w < 2 || h < 2) continue;

        const div = document.createElement('div');
        div.style.cssText = `position:absolute;left:${leaf.x0}px;top:${leaf.y0}px;width:${w}px;height:${h}px;overflow:hidden;cursor:pointer;border:1px solid #2a2a2a;border-radius:0;background:#f0efe8;transition:filter 0.1s;`;

        const inner = document.createElement('div');
        inner.style.cssText = 'padding:3px 4px;height:100%;display:flex;flex-direction:column;';

        if (w > 28 && h > 14) {
          const nameEl = document.createElement('div');
          nameEl.style.cssText = 'font-size:8px;font-weight:600;color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          const maxC = Math.floor((w - 6) / 5);
          nameEl.textContent = leaf.data.name.length > maxC ? leaf.data.name.slice(0, maxC) + '...' : leaf.data.name;
          inner.appendChild(nameEl);
        }
        if (w > 35 && h > 26) {
          const valEl = document.createElement('div');
          valEl.style.cssText = 'font-size:8px;font-family:monospace;color:#555;margin-top:1px;';
          valEl.textContent = displayVal(leaf.data);
          inner.appendChild(valEl);
        }
        if (w > 40 && h > 38) {
          const countEl = document.createElement('div');
          countEl.style.cssText = 'font-size:7px;color:#888;margin-top:auto;';
          countEl.textContent = leaf.data.isVehicle ? fmtMoney(leaf.data.value || 0) : fmtNum(leaf.data.count || 0) + ' vehicles';
          inner.appendChild(countEl);
        }
        div.appendChild(inner);

        const ld = leaf.data;
        div.onmouseover = (e: MouseEvent) => {
          div.style.filter = 'brightness(0.92)';
          const pct = totalVal > 0 ? ((metricVal(ld) / totalVal) * 100).toFixed(1) : '0.0';
          let val: string;
          if (metric === 'count') val = fmtNum(ld.count || 0) + ' vehicles';
          else val = fmtMoney(ld.value || 0);

          const rows = ld.isVehicle
            ? buildVehicleTooltipRows(ld)
            : buildTooltipRows(ld, pct);

          setTooltip({
            visible: true, x: e.clientX + 12, y: e.clientY + 12,
            name: ld.fullName || ld.name, value: val,
            rows,
          });
        };
        div.onmousemove = (e: MouseEvent) => setTooltip(t => ({ ...t, x: e.clientX + 12, y: e.clientY + 12 }));
        div.onmouseout = () => { div.style.filter = ''; setTooltip(t => ({ ...t, visible: false })); };
        div.onclick = () => {
          if (ld.isVehicle) { window.open('/vehicle/' + ld.id, '_blank'); return; }
          const lvl = data?.stats?.level;
          if (view === 'segment') {
            if (lvl === 'segments') nav({ segment: ld.name }, true);
            else if (lvl === 'makes') nav({ ...filters, make: ld.name });
            else if (lvl === 'models') nav({ ...filters, model: ld.name });
            else if (lvl === 'years') nav({ ...filters, year: ld.name });
          } else if (view === 'source') {
            if (lvl === 'sources') nav({ source: ld.name });
            else if (lvl === 'makes') nav({ ...filters, make: ld.name });
            else if (lvl === 'models') nav({ ...filters, model: ld.name });
            else if (lvl === 'years') nav({ ...filters, year: ld.name });
          } else if (view === 'brand') {
            if (lvl === 'brands') nav({ make: ld.name });
            else if (lvl === 'models') nav({ ...filters, model: ld.name });
            else if (lvl === 'years') nav({ ...filters, year: ld.name });
          }
        };
        container.appendChild(div);
      }
    }
  }, [data, nestedData, metric, view, filters, metricVal, displayVal, nav, resizeKey]);

  // Resize observer - use a counter to trigger re-render without cloning data
  const [resizeKey, setResizeKey] = useState(0);
  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    let raf: number;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setResizeKey(k => k + 1));
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  const stats = data?.stats;
  const viewLabels: Record<ViewMode, string> = { segment: 'All Segments', source: 'All Sources', brand: 'All Brands' };

  // Build breadcrumb
  const breadcrumbs: { label: string; onClick?: () => void }[] = [];
  breadcrumbs.push({ label: viewLabels[view], onClick: () => load({}, view === 'segment') });
  if (view === 'segment') {
    if (filters.segment) breadcrumbs.push(filters.make ? { label: filters.segment, onClick: () => nav({ segment: filters.segment! }) } : { label: filters.segment });
    if (filters.make) breadcrumbs.push(filters.model ? { label: filters.make, onClick: () => nav({ segment: filters.segment!, make: filters.make! }) } : { label: filters.make });
    if (filters.model) breadcrumbs.push(filters.year ? { label: filters.model, onClick: () => nav({ segment: filters.segment!, make: filters.make!, model: filters.model! }) } : { label: filters.model });
    if (filters.year) breadcrumbs.push({ label: filters.year });
  } else if (view === 'source') {
    if (filters.source) breadcrumbs.push(filters.make ? { label: filters.source, onClick: () => nav({ source: filters.source! }) } : { label: filters.source });
    if (filters.make) breadcrumbs.push(filters.model ? { label: filters.make, onClick: () => nav({ source: filters.source!, make: filters.make! }) } : { label: filters.make });
    if (filters.model) breadcrumbs.push(filters.year ? { label: filters.model, onClick: () => nav({ source: filters.source!, make: filters.make!, model: filters.model! }) } : { label: filters.model });
    if (filters.year) breadcrumbs.push({ label: filters.year });
  } else if (view === 'brand') {
    if (filters.make) breadcrumbs.push(filters.model ? { label: filters.make, onClick: () => nav({ make: filters.make! }) } : { label: filters.make });
    if (filters.model) breadcrumbs.push(filters.year ? { label: filters.model, onClick: () => nav({ make: filters.make!, model: filters.model! }) } : { label: filters.model });
    if (filters.year) breadcrumbs.push({ label: filters.year });
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', color: 'var(--text)', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', fontSize: '10px', padding: '12px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '8px', marginBottom: '8px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Market Map</div>
          {stats && (
            <div style={{ display: 'flex', gap: '20px', fontSize: '10px', color: 'var(--text-secondary)' }}>
              <span><b style={{ color: 'var(--text)', fontFamily: "'Courier New', monospace" }}>{fmtMoney(stats.totalValue)}</b> <small style={{ textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.4px' }}>Total</small></span>
              <span><b style={{ color: 'var(--text)', fontFamily: "'Courier New', monospace" }}>{fmtNum(stats.totalCount)}</b> <small style={{ textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.4px' }}>Vehicles</small></span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '3px' }}>
            {(['segment', 'source', 'brand'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => switchView(v)} style={{
                border: `1px solid ${view === v ? 'var(--text)' : 'var(--border)'}`, background: view === v ? 'var(--text)' : 'transparent',
                color: view === v ? 'var(--surface)' : 'var(--text-secondary)', padding: '4px 10px', fontSize: '9px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '3px', marginLeft: '12px' }}>
            {(['value', 'count'] as Metric[]).map(m => (
              <button key={m} onClick={() => setMetric(m)} style={{
                border: `1px solid ${metric === m ? 'var(--text)' : 'var(--border)'}`, background: metric === m ? 'var(--text)' : 'transparent',
                color: metric === m ? 'var(--surface)' : 'var(--text-secondary)', padding: '4px 10px', fontSize: '9px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {m === 'count' ? 'Volume' : 'Value'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', fontSize: '10px', color: 'var(--text-secondary)', flexShrink: 0 }}>
        {history.length > 0 && (
          <span onClick={back} style={{ cursor: 'pointer', marginRight: '6px', fontSize: '11px' }}>&larr;</span>
        )}
        {breadcrumbs.map((bc, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: 'var(--text-disabled)', margin: '0 6px', fontSize: '9px' }}>&rsaquo;</span>}
            {bc.onClick ? (
              <a onClick={bc.onClick} style={{ color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'none' }}
                onMouseOver={e => (e.target as HTMLElement).style.textDecoration = 'underline'}
                onMouseOut={e => (e.target as HTMLElement).style.textDecoration = 'none'}>
                {bc.label}
              </a>
            ) : (
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{bc.label}</span>
            )}
          </span>
        ))}
      </div>

      {/* Treemap container */}
      <div style={{ position: 'relative', border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--surface)', flex: 1, minHeight: 0 }}>
        <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }} />
        {loading && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: 'var(--text-disabled)', fontSize: '11px' }}>Loading...</div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip.visible && (
        <div style={{
          position: 'fixed', left: tooltip.x, top: tooltip.y,
          background: 'var(--surface)', border: '1px solid var(--border)', padding: '10px 14px', pointerEvents: 'none', zIndex: 1000,
          minWidth: '180px', maxWidth: '280px', fontSize: '10px', }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '4px', fontSize: '11px' }}>{tooltip.name}</div>
          <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: "'Courier New', monospace", color: 'var(--success)', marginBottom: '8px' }}>{tooltip.value}</div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }} />
          {tooltip.rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '3px', color: 'var(--text-disabled)' }}>
              <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--text)', fontWeight: 600, fontSize: '10px' }}>{r.pct}</span>
              <span style={{ fontSize: '9px', textAlign: 'right', marginLeft: '12px' }}>{r.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
