import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';
import { useVehiclesDashboard } from '../hooks/useVehiclesDashboard';
import { OnboardingSlideshow } from '../components/onboarding/OnboardingSlideshow';

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

interface TreemapNode {
  name: string;
  count: number;
  value: number;
  median_price?: number;
  min_price?: number;
  max_price?: number;
  sold_count?: number;
  auction_count?: number;
  avg_bids?: number;
  avg_watchers?: number;
}

interface TreemapRect {
  node: TreemapNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DrillLevel {
  label: string;
  make?: string;
  model?: string;
}

// ────────────────────────────────────────────────────────────
// SQUARIFIED TREEMAP ALGORITHM (Bruls, Huizing, van Wijk 2000)
// ────────────────────────────────────────────────────────────

function worstAspectRatio(row: number[], w: number): number {
  // w = length of the shorter side of the remaining rectangle
  // row = array of areas
  const s = row.reduce((a, b) => a + b, 0);
  const rMax = Math.max(...row);
  const rMin = Math.min(...row);
  // worst = max(w^2 * rMax / s^2, s^2 / (w^2 * rMin))
  const w2 = w * w;
  const s2 = s * s;
  return Math.max((w2 * rMax) / s2, s2 / (w2 * rMin));
}

function squarify(
  items: { node: TreemapNode; area: number }[],
  x: number,
  y: number,
  w: number,
  h: number
): TreemapRect[] {
  if (items.length === 0) return [];
  if (w <= 0 || h <= 0) return [];

  // Sort descending by area
  const sorted = [...items].sort((a, b) => b.area - a.area);
  const totalArea = sorted.reduce((s, i) => s + i.area, 0);
  if (totalArea <= 0) return [];

  // Scale areas to fill the rectangle
  const scale = (w * h) / totalArea;
  const scaled = sorted.map(i => ({ ...i, scaledArea: i.area * scale }));

  const result: TreemapRect[] = [];
  layoutRow(scaled, x, y, w, h, result);
  return result;
}

function layoutRow(
  items: { node: TreemapNode; area: number; scaledArea: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
  result: TreemapRect[]
): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    result.push({ node: items[0].node, x, y, w, h });
    return;
  }

  // Determine the shorter side
  const shorter = Math.min(w, h);
  const horizontal = w >= h; // layout row along the shorter dimension

  let row: typeof items = [items[0]];
  let remaining = items.slice(1);
  let currentWorst = worstAspectRatio(
    row.map(i => i.scaledArea),
    shorter
  );

  // Greedily add items to the row while aspect ratio improves
  for (let k = 0; k < remaining.length; k++) {
    const candidate = [...row, remaining[k]];
    const candidateWorst = worstAspectRatio(
      candidate.map(i => i.scaledArea),
      shorter
    );
    if (candidateWorst <= currentWorst) {
      row = candidate;
      currentWorst = candidateWorst;
    } else {
      break;
    }
  }

  remaining = items.slice(row.length);

  // Lay out the row
  const rowArea = row.reduce((s, i) => s + i.scaledArea, 0);

  if (horizontal) {
    // Row fills along the left side (fixed width = rowArea / h)
    const rowW = rowArea / h;
    let yOff = y;
    for (const item of row) {
      const itemH = item.scaledArea / rowW;
      result.push({ node: item.node, x, y: yOff, w: rowW, h: itemH });
      yOff += itemH;
    }
    // Recurse on the remaining rectangle
    layoutRow(remaining, x + rowW, y, w - rowW, h, result);
  } else {
    // Row fills along the top (fixed height = rowArea / w)
    const rowH = rowArea / w;
    let xOff = x;
    for (const item of row) {
      const itemW = item.scaledArea / rowH;
      result.push({ node: item.node, x: xOff, y, w: itemW, h: rowH });
      xOff += itemW;
    }
    // Recurse on the remaining rectangle
    layoutRow(remaining, x, y + rowH, w, h - rowH, result);
  }
}

// ────────────────────────────────────────────────────────────
// DATA HOOKS
// ────────────────────────────────────────────────────────────

function useTreemapBrands() {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc('treemap_by_brand').then(({ data: result, error }) => {
      if (!cancelled && result && !error) {
        setData(result as TreemapNode[]);
      }
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  return { data, loading };
}

function useTreemapModels(make: string | null) {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!make) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    supabase.rpc('treemap_models_by_brand', { p_make: make }).then(({ data: result, error }) => {
      if (!cancelled && result && !error) {
        setData(result as TreemapNode[]);
      }
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [make]);
  return { data, loading };
}

function useTreemapYears(make: string | null, model: string | null) {
  const [data, setData] = useState<TreemapNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!make || !model) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    supabase.rpc('treemap_years', { p_source: null, p_make: make, p_model: model }).then(({ data: result, error }) => {
      if (!cancelled && result && !error) {
        setData(result as TreemapNode[]);
      }
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [make, model]);
  return { data, loading };
}

// ────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ────────────────────────────────────────────────────────────

const fmtNum = (n: number) => n?.toLocaleString() ?? '--';
const fmtMoney = (n: number) => {
  if (!n) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}K`;
  return `$${n.toLocaleString()}`;
};

// ────────────────────────────────────────────────────────────
// COLOR SCALE — median price maps to a green-to-amber heatmap
// inspired by Finviz: low price = muted, high price = saturated
// ────────────────────────────────────────────────────────────

function priceToColor(medianPrice: number | undefined, count: number): string {
  if (!medianPrice || medianPrice <= 0) {
    // fallback: use count to create subtle variation
    const t = Math.min(count / 500, 1);
    const lightness = 92 - t * 12;
    return `hsl(0, 0%, ${lightness}%)`;
  }
  // Map log(price) to a hue scale:
  // $5K = cool green (140), $50K = teal (170), $200K = blue (210), $1M+ = indigo (250)
  const logP = Math.log10(Math.max(medianPrice, 1000));
  // logP range: ~3.0 ($1K) to ~6.7 ($5M+)
  const t = Math.max(0, Math.min(1, (logP - 3.5) / 3.2)); // 0..1 across price range
  // Hue: green(140) -> teal(180) -> blue(210) -> indigo(250)
  const hue = 140 + t * 110;
  // Saturation: higher for more data
  const countFactor = Math.min(count / 100, 1);
  const saturation = 20 + countFactor * 30;
  // Lightness: bright for low price, darker for high
  const lightness = 88 - t * 20;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// ────────────────────────────────────────────────────────────
// TREEMAP CELL COMPONENT
// ────────────────────────────────────────────────────────────

interface CellProps {
  rect: TreemapRect;
  onClick: () => void;
  totalCount: number;
  showValue?: boolean;
  isYear?: boolean;
}

function TreemapCell({ rect, onClick, totalCount, showValue, isYear }: CellProps) {
  const { node, x, y, w, h } = rect;
  const [hovered, setHovered] = useState(false);

  const pct = totalCount > 0 ? ((node.count / totalCount) * 100) : 0;
  const bg = priceToColor(node.median_price, node.count);

  // Decide what text fits
  const canShowName = w > 28 && h > 16;
  const canShowCount = w > 40 && h > 30;
  const canShowPrice = w > 60 && h > 44;
  const canShowPct = w > 50 && h > 56;
  const isLarge = w > 120 && h > 80;

  // Font size scales with cell area
  const area = w * h;
  const nameFontSize = area > 40000 ? 13 : area > 15000 ? 11 : area > 5000 ? 10 : 9;
  const dataFontSize = area > 40000 ? 11 : area > 15000 ? 10 : 9;

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        boxSizing: 'border-box',
        border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
        background: hovered ? `color-mix(in srgb, ${bg} 85%, var(--text) 15%)` : bg,
        cursor: 'pointer',
        overflow: 'hidden',
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'border-color 120ms ease-out, background 120ms ease-out',
        userSelect: 'none',
      }}
    >
      {canShowName && (
        <div
          style={{
            fontSize: nameFontSize,
            fontWeight: 700,
            letterSpacing: isLarge ? '-0.02em' : '0.04em',
            textTransform: 'uppercase' as const,
            color: 'var(--text)',
            lineHeight: 1.15,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: isLarge ? 'normal' : 'nowrap',
            fontFamily: 'Arial, sans-serif',
            wordBreak: isLarge ? 'break-word' : undefined,
          }}
        >
          {node.name}
        </div>
      )}

      <div style={{ marginTop: 'auto' }}>
        {canShowCount && (
          <div
            style={{
              fontSize: dataFontSize,
              fontFamily: "'Courier New', monospace",
              color: 'var(--text-secondary)',
              lineHeight: 1.3,
            }}
          >
            {fmtNum(node.count)} {isYear ? '' : 'vehicles'}
          </div>
        )}
        {canShowPrice && node.median_price && (
          <div
            style={{
              fontSize: dataFontSize,
              fontFamily: "'Courier New', monospace",
              fontWeight: 700,
              color: 'var(--text)',
              lineHeight: 1.3,
            }}
          >
            {fmtMoney(node.median_price)} med
          </div>
        )}
        {canShowPct && pct >= 0.1 && (
          <div
            style={{
              fontSize: 8,
              fontFamily: "'Courier New', monospace",
              color: 'var(--text-secondary)',
              lineHeight: 1.3,
            }}
          >
            {pct.toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// TOOLTIP COMPONENT
// ────────────────────────────────────────────────────────────

interface TooltipData {
  node: TreemapNode;
  x: number;
  y: number;
  totalCount: number;
  level: string;
}

function TreemapTooltip({ node, x, y, totalCount, level }: TooltipData) {
  const pct = totalCount > 0 ? ((node.count / totalCount) * 100).toFixed(1) : '0.0';
  const sellThrough = node.auction_count && node.auction_count > 0
    ? Math.round(((node.sold_count || 0) / node.auction_count) * 100) + '%'
    : null;

  // Keep tooltip on screen
  const adjustedX = typeof window !== 'undefined' && x > window.innerWidth - 240 ? x - 220 : x + 12;
  const adjustedY = typeof window !== 'undefined' && y > window.innerHeight - 200 ? y - 160 : y + 12;

  return (
    <div
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        background: 'var(--surface-elevated, #fff)',
        border: '2px solid var(--text)',
        padding: '10px 14px',
        pointerEvents: 'none',
        zIndex: 10000,
        minWidth: 180,
        maxWidth: 260,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        {node.name}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Courier New', monospace", color: 'var(--text)', marginBottom: 6 }}>
        {fmtNum(node.count)} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-secondary)' }}>{level === 'years' ? 'listings' : 'vehicles'}</span>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Row label="of total" value={pct + '%'} />
        <Row label="total value" value={fmtMoney(node.value)} />
        {node.median_price ? <Row label="median" value={fmtMoney(node.median_price)} /> : null}
        {node.min_price && node.max_price ? <Row label="range" value={`${fmtMoney(node.min_price)} - ${fmtMoney(node.max_price)}`} /> : null}
        {sellThrough ? <Row label="sell-through" value={sellThrough} /> : null}
        {node.avg_bids ? <Row label="avg bids" value={String(node.avg_bids)} /> : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 10, color: 'var(--text-secondary)' }}>
      <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--text)', fontWeight: 600 }}>{value}</span>
      <span style={{ marginLeft: 12, textAlign: 'right', fontSize: 9 }}>{label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// SEARCH BAR (reused from original)
// ────────────────────────────────────────────────────────────

interface SearchPreviewResult {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  asking_price: number | null;
}

function useSearchPreview(query: string) {
  const [results, setResults] = useState<SearchPreviewResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setNoResults(false);
      return;
    }

    setLoading(true);
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        const words = q.split(/\s+/).filter(w => w.length > 0);
        let builder = supabase
          .from('vehicles')
          .select('id, year, make, model, sale_price, asking_price');

        for (const word of words) {
          builder = builder.or(`make.ilike.%${word}%,model.ilike.%${word}%,vin.ilike.%${word}%`);
        }

        const yearMatch = q.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
          builder = builder.eq('year', parseInt(yearMatch[0]));
        }

        const { data, error } = await builder.limit(5);
        if (error) throw error;
        setResults(data || []);
        setNoResults((data || []).length === 0);
      } catch {
        setResults([]);
        setNoResults(false);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  return { results, loading, noResults };
}

// ────────────────────────────────────────────────────────────
// MAIN TREEMAP HOMEPAGE
// ────────────────────────────────────────────────────────────

function TreemapHomePage({ onBrowse }: { onBrowse: () => void }) {
  const navigate = useNavigate();
  usePageTitle('Nuke — Vehicle Intelligence');

  // Drill-down state
  const [drillStack, setDrillStack] = useState<DrillLevel[]>([{ label: 'ALL MAKES' }]);
  const currentLevel = drillStack[drillStack.length - 1];

  // Data hooks
  const { data: brandsData, loading: brandsLoading } = useTreemapBrands();
  const { data: modelsData, loading: modelsLoading } = useTreemapModels(currentLevel.make && !currentLevel.model ? currentLevel.make : null);
  const { data: yearsData, loading: yearsLoading } = useTreemapYears(
    currentLevel.model ? currentLevel.make ?? null : null,
    currentLevel.model ?? null
  );

  // Determine active data and level type
  const activeData = useMemo(() => {
    if (currentLevel.model && yearsData) return yearsData;
    if (currentLevel.make && modelsData) return modelsData;
    if (brandsData) return brandsData;
    return null;
  }, [currentLevel, brandsData, modelsData, yearsData]);

  const levelType = currentLevel.model ? 'years' : currentLevel.make ? 'models' : 'brands';
  const isLoading = brandsLoading || modelsLoading || yearsLoading;

  // Container sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setDims({ w: Math.floor(r.width), h: Math.floor(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute treemap layout
  const rects = useMemo(() => {
    if (!activeData || dims.w < 10 || dims.h < 10) return [];
    const PAD = 2; // border space
    const items = activeData
      .filter(n => n.count > 0)
      .map(node => ({ node, area: node.count }));
    return squarify(items, PAD, PAD, dims.w - PAD * 2, dims.h - PAD * 2);
  }, [activeData, dims]);

  const totalCount = useMemo(
    () => (activeData || []).reduce((s, n) => s + n.count, 0),
    [activeData]
  );

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // Drill down
  const drillInto = useCallback((node: TreemapNode) => {
    if (levelType === 'brands') {
      setDrillStack(prev => [...prev, { label: node.name, make: node.name }]);
    } else if (levelType === 'models') {
      setDrillStack(prev => [...prev, { label: node.name, make: currentLevel.make, model: node.name }]);
    } else if (levelType === 'years') {
      // At deepest level, navigate to search results
      const params = new URLSearchParams();
      if (currentLevel.make) params.set('make', currentLevel.make);
      if (currentLevel.model) params.set('model', currentLevel.model);
      params.set('year', node.name);
      navigate(`/search?${params.toString()}`);
    }
  }, [levelType, currentLevel, navigate]);

  // Navigate back
  const goBack = useCallback((toIndex: number) => {
    setDrillStack(prev => prev.slice(0, toIndex + 1));
  }, []);

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const { results: searchResults, noResults } = useSearchPreview(searchInput);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    else navigate('/search');
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showDropdown = searchFocused && searchInput.trim().length >= 2 && (searchResults.length > 0 || noResults);

  const formatPrice = (v: { sale_price?: number | null; asking_price?: number | null }) => {
    const p = v.sale_price || v.asking_price;
    if (!p) return null;
    if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(1)}M`;
    if (p >= 1_000) return `$${Math.round(p / 1_000)}K`;
    return `$${p.toLocaleString()}`;
  };

  // Transition animation state
  const [transitioning, setTransitioning] = useState(false);
  const prevLevelRef = useRef(levelType);
  useEffect(() => {
    if (prevLevelRef.current !== levelType) {
      setTransitioning(true);
      const t = setTimeout(() => setTransitioning(false), 200);
      prevLevelRef.current = levelType;
      return () => clearTimeout(t);
    }
  }, [levelType]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* ─── HEADER BAR ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          height: 44,
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        {/* Logo / Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div
            style={{
              width: 7,
              height: 7,
              background: 'var(--success)',
              animation: 'livePulse 2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
            onClick={() => setDrillStack([{ label: 'ALL MAKES' }])}
          >
            NUKE
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-disabled)', letterSpacing: '0.06em', fontWeight: 600 }}>
            PROVENANCE ENGINE
          </span>
        </div>

        {/* Search bar */}
        <div ref={searchContainerRef} style={{ position: 'relative', flex: 1, maxWidth: 480 }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', border: '2px solid var(--border)' }}>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              placeholder="Search: 1967 Porsche 911, VIN, make, model..."
              aria-label="Search vehicles"
              style={{
                flex: 1,
                padding: '6px 12px',
                fontSize: 11,
                fontFamily: 'Arial, sans-serif',
                border: 'none',
                background: 'var(--bg)',
                color: 'var(--text)',
                outline: 'none',
                minWidth: 0,
              }}
            />
            <button
              type="submit"
              style={{
                padding: '6px 16px',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontFamily: 'Arial, sans-serif',
                border: 'none',
                borderLeft: '2px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              SEARCH
            </button>
          </form>
          {showDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface-elevated, #fff)', border: '2px solid var(--border)', borderTop: 'none', zIndex: 10000 }}>
              {searchResults.map((v) => (
                <button
                  key={v.id}
                  onClick={() => { setSearchFocused(false); navigate(`/vehicle/${v.id}`); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', padding: '8px 12px', border: 'none',
                    borderBottom: '1px solid var(--surface)', background: 'transparent',
                    color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
                    fontSize: 11, fontFamily: 'Arial, sans-serif',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span>{[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown Vehicle'}</span>
                  {formatPrice(v) && (
                    <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)', fontSize: 10 }}>
                      {formatPrice(v)}
                    </span>
                  )}
                </button>
              ))}
              {noResults && (
                <div style={{ padding: '8px 12px', color: 'var(--text-disabled)', fontSize: 11 }}>
                  No vehicles found for "{searchInput.trim()}"
                </div>
              )}
            </div>
          )}
        </div>

        {/* Browse button */}
        <button
          onClick={onBrowse}
          style={{
            padding: '6px 16px',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            border: '2px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          FEED
        </button>
      </div>

      {/* ─── BREADCRUMB / NAVIGATION BAR ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          height: 32,
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
          gap: 4,
          overflow: 'hidden',
        }}
      >
        {drillStack.map((level, i) => {
          const isLast = i === drillStack.length - 1;
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <span style={{ fontSize: 9, color: 'var(--text-disabled)', margin: '0 2px' }}>/</span>
              )}
              <button
                onClick={() => !isLast && goBack(i)}
                style={{
                  fontSize: 9,
                  fontWeight: isLast ? 700 : 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: isLast ? 'var(--text)' : 'var(--text-secondary)',
                  background: 'transparent',
                  border: 'none',
                  cursor: isLast ? 'default' : 'pointer',
                  padding: '4px 6px',
                  fontFamily: 'Arial, sans-serif',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (!isLast) e.currentTarget.style.color = 'var(--text)';
                }}
                onMouseLeave={(e) => {
                  if (!isLast) e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                {level.label}
              </button>
            </React.Fragment>
          );
        })}

        {/* Level indicator */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {activeData && (
            <span style={{ fontSize: 9, fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)' }}>
              {fmtNum(totalCount)} vehicles / {fmtMoney((activeData || []).reduce((s, n) => s + n.value, 0))} total value
            </span>
          )}
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-disabled)' }}>
            {levelType === 'brands' ? 'MAKES' : levelType === 'models' ? 'MODELS' : 'YEARS'}
          </span>
        </div>
      </div>

      {/* ─── TREEMAP VIEWPORT ─── */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--bg)',
          minHeight: 0,
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        {isLoading && !activeData && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'var(--text-disabled)', fontFamily: "'Courier New', monospace",
            letterSpacing: '0.08em',
          }}>
            LOADING...
          </div>
        )}

        {/* Loading overlay for transitions */}
        {isLoading && activeData && (
          <div style={{
            position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--bg) 60%, transparent)',
            zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: 'var(--text-disabled)', fontFamily: "'Courier New', monospace",
          }}>
            LOADING...
          </div>
        )}

        <div
          style={{
            opacity: transitioning ? 0.3 : 1,
            transition: 'opacity 150ms ease-out',
            width: '100%',
            height: '100%',
            position: 'relative',
          }}
        >
          {rects.map((rect, i) => (
            <div
              key={rect.node.name + '-' + i}
              onMouseMove={(e) => {
                setTooltip({
                  node: rect.node,
                  x: e.clientX,
                  y: e.clientY,
                  totalCount,
                  level: levelType,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <TreemapCell
                rect={rect}
                onClick={() => drillInto(rect.node)}
                totalCount={totalCount}
                isYear={levelType === 'years'}
              />
            </div>
          ))}
        </div>

        {/* Empty state */}
        {!isLoading && activeData && activeData.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-disabled)', fontFamily: "'Courier New', monospace" }}>
              NO DATA
            </div>
            <button
              onClick={() => goBack(drillStack.length - 2)}
              style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', border: '2px solid var(--border)',
                background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
                padding: '6px 16px', fontFamily: 'Arial, sans-serif',
              }}
            >
              GO BACK
            </button>
          </div>
        )}
      </div>

      {/* ─── TOOLTIP ─── */}
      {tooltip && <TreemapTooltip {...tooltip} />}

      {/* ─── FOOTER ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          height: 24,
          borderTop: '2px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 8, fontFamily: "'Courier New', monospace", color: 'var(--text-disabled)' }}>
          AREA = VEHICLE COUNT / COLOR = MEDIAN PRICE
        </span>
        <a
          href="https://nuke.ag"
          style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-disabled)', textDecoration: 'none' }}
        >
          nuke.ag
        </a>
      </div>

      {/* ─── GLOBAL STYLES ─── */}
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// TABS (garage, feed, map) — kept from original
// ────────────────────────────────────────────────────────────

const FeedPage = lazy(() => import('../feed/components/FeedPage'));
const GarageTab = lazy(() => import('../components/garage/GarageTab'));
const UnifiedMap = lazy(() => import('../components/map/NukeMap'));

type TabId = 'garage' | 'feed' | 'map';

const TABS: { id: TabId; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'garage', label: 'Garage' },
  { id: 'map', label: 'Map' },
];

const LS_KEY = 'nuke_hub_tab';

function TabSkeleton() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'Arial, sans-serif' }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ height: 80, background: 'var(--surface)', border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      ))}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}

export default function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [showFeed, setShowFeed] = useState(false);
  const defaultTab = useMemo(() => {
    const fromUrl = searchParams.get('tab') as TabId | null;
    if (fromUrl && TABS.some((t) => t.id === fromUrl)) return fromUrl;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (fromStorage && TABS.some((t) => t.id === fromStorage)) return fromStorage;
    return 'feed';
  }, []);

  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  const garage = useVehiclesDashboard(user?.id);

  useEffect(() => {
    if (authLoading) return;
    const fromUrl = searchParams.get('tab') as TabId | null;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (!fromUrl && !fromStorage) {
      setActiveTab('feed');
    }
    if (!user && fromUrl) {
      setShowFeed(true);
    }
  }, [authLoading, user]);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    localStorage.setItem(LS_KEY, tab);
    setSearchParams(tab === 'garage' && user ? {} : { tab }, { replace: true });
  };

  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!authLoading && user && !localStorage.getItem('nuke_onboarding_seen')) {
      setShowOnboarding(true);
    }
  }, [authLoading, user]);

  const handleOnboardingClose = () => {
    setShowOnboarding(false);
    localStorage.setItem('nuke_onboarding_seen', '1');
  };

  // Logged-out users see the treemap landing page
  if (!authLoading && !user && !showFeed) {
    return <TreemapHomePage onBrowse={() => setShowFeed(true)} />;
  }

  return (
    <div>
      {showOnboarding && (
        <OnboardingSlideshow isOpen={showOnboarding} onClose={handleOnboardingClose} />
      )}
      {activeTab !== 'feed' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--surface)',
            flexShrink: 0,
            borderBottom: '2px solid var(--border)',
            height: 30,
          }}
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                aria-selected={active}
                style={{
                  padding: '0 16px',
                  height: 30,
                  fontSize: 9,
                  fontFamily: 'Arial, sans-serif',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--text)' : '2px solid transparent',
                  background: active ? 'var(--bg)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-disabled)',
                  cursor: 'pointer',
                  transition: 'color 180ms cubic-bezier(0.16, 1, 0.3, 1), background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-disabled)'; }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {activeTab === 'map' ? (
        <div style={{ height: 'calc(100vh - var(--header-height, 40px) - 30px)', overflow: 'hidden', position: 'relative' }}>
          <Suspense fallback={<TabSkeleton />}>
            <UnifiedMap />
          </Suspense>
        </div>
      ) : (
        <Suspense fallback={<TabSkeleton />}>
          {activeTab === 'garage' && <GarageTab dashboard={garage} />}
          {activeTab === 'feed' && <FeedPage />}
        </Suspense>
      )}
    </div>
  );
}
