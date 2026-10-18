import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { squarify } from '../../lib/squarify';
import { Text } from '../../kit';
import { MakeIdentity } from '../../components/common/MakeIdentity';
import { relativeMove, textWidth, pct as signedPct, GATE_MIN, type Baseline, type Move } from './mapScale';
import { MarketCard, MarketSheet, MarketTile, money as moneyShort, type MapBasis, type MarketNode } from './MarketTile';
import type { HorizonMoveCounts } from './FamilyMovers';
import { consolidateBrandPickupFamilies, isGmTruckBrand } from '../familyFacetsAndEmblems';
import './BrandFamilyMap.css';

// The brand map with each brand's families inside it, the way finviz maps a market: every brand a frame sized by its
// confirmed-sale dollars, every family a tile inside it sized by its own, colored by its Bring a Trailer 12-month move,
// so what each brand trades and which way each family went read in one look (treemap_brand_family_map,
// 20261015223000). A tile drills the map to its family; a brand's name drills to the brand.
export type MapRow = {
  brand: string; brand_usd: number; brand_rank: number; family_key: string; family: string | null;
  usd: number | null; sold: number | null; sold_any: number | null; offered: number | null; dated: number | null;
  sold_12m: number | null; sold_prior_12m: number | null; usd_12m: number | null; usd_prior_12m: number | null; families: number;
};

let mapRead: Promise<MapRow[] | null> | null = null;
export function readBrandFamilyMap(): Promise<MapRow[] | null> {
  if (typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return Promise.resolve(null);
  if (!mapRead) {
    mapRead = Promise.resolve(supabase.rpc('treemap_brand_family_map', { p_brands: 60, p_families: 12 })).then(
      async ({ data, error }) => {
        if (error || !Array.isArray(data)) { mapRead = null; return null; }
        const rows = data as MapRow[];
        // Read every GM family before grouping: the top-12 map puts smaller truck lines in "more".
        const gm = [...new Set(rows.map((r) => r.brand).filter(isGmTruckBrand))];
        const full = await Promise.all(gm.map(async (brand) => {
          const { data: families, error: failure } = await supabase.rpc('treemap_brand_families', { p_brand: brand });
          if (failure || !Array.isArray(families) || !families.length) throw new Error('GM families unavailable');
          const frame = rows.find((r) => r.brand === brand)!;
          return families.map((f) => ({ ...frame, ...f, brand, families: families.length })) as MapRow[];
        }));
        return [...rows.filter((r) => !isGmTruckBrand(r.brand)), ...full.flat()];
      },
      () => { mapRead = null; return null; },
    ).catch(() => { mapRead = null; return null; });
  }
  return mapRead;
}

export function groupGmMapFamilies(rows: MapRow[]): MapRow[] {
  const groups = new Map<string, MapRow[]>();
  for (const r of rows) groups.set(r.brand, [...(groups.get(r.brand) ?? []), r]);
  return [...groups.values()].flatMap((brandRows) => {
    const brand = brandRows[0].brand;
    if (!isGmTruckBrand(brand)) return brandRows;
    const nodes = brandRows.map((r) => ({ ...toNode(r), value: r.usd ?? 0, models: 1 }));
    const grouped = consolidateBrandPickupFamilies(brand, nodes, true)!;
    return grouped.map((n) => ({
      ...brandRows.find((r) => r.family_key === n.familyKey)!,
      family: n.name, family_key: n.familyKey!, sold: n.count, usd: n.usd ?? null,
      sold_any: n.sold_any ?? null, offered: n.offered ?? null, dated: n.dated ?? null,
      sold_12m: n.sold_12m ?? null, sold_prior_12m: n.sold_prior_12m ?? null,
      usd_12m: n.usd_12m ?? null, usd_prior_12m: n.usd_prior_12m ?? null, families: grouped.length,
    }));
  });
}

// The move a tile is colored by: BaT sales, last 12 months against the 12 before, when BaT holds at least half the
// tile's sales and sold 10 a year earlier; otherwise none (gray), as on the brand map.
export function familyMove(r: Pick<MapRow, 'sold' | 'dated' | 'sold_12m' | 'sold_prior_12m'>): number | null {
  if (r.sold_12m == null || !r.sold_prior_12m || r.sold_prior_12m < 10) return null;
  if (!r.dated || !r.sold || r.dated < 0.5 * r.sold) return null;
  return r.sold_12m / r.sold_prior_12m - 1;
}
export function moveTint(m: number | null): string {
  if (m === null) return 'var(--heat-0)';
  if (m >= 0.2) return 'color-mix(in srgb, var(--success) 42%, var(--surface))';
  if (m >= 0.05) return 'color-mix(in srgb, var(--success) 20%, var(--surface))';
  if (m > -0.05) return 'var(--surface)';
  if (m > -0.2) return 'color-mix(in srgb, var(--error) 20%, var(--surface))';
  return 'color-mix(in srgb, var(--error) 42%, var(--surface))';
}
const money = (v: number) => v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M` : `$${Math.round(v / 1000)}K`;
const pct = (m: number) => `${m >= 0 ? '▲' : '▼'}${Math.abs(Math.round(m * 100))}%`;
const label = (r: MapRow) => r.family_key === 'more' ? 'more families' : r.family_key === 'other' ? 'other models' : r.family ?? '';

const HEAD = 16;

/** A family row as a market tile's node: its name, its sales and dollars both ways, and its BaT counts. */
function toNode(r: MapRow): MarketNode {
  return { name: label(r), count: r.sold ?? 0, usd: r.usd, sold_any: r.sold_any, offered: r.offered, dated: r.dated,
    sold_12m: r.sold_12m, sold_prior_12m: r.sold_prior_12m, usd_12m: r.usd_12m, usd_prior_12m: r.usd_prior_12m, familyKey: r.family_key };
}

/** The brand frame's header: the name and its dollars when both fit whole, the name alone when only it fits, else
 *  nothing (a header used to cut "$124M" to "$1", 2026-10-15). */
export function headerText(brand: string, dollars: string, width: number, size = 11): string {
  const room = width - 12;
  if (textWidth(`${brand} ${dollars}`) * size <= room) return `${brand} ${dollars}`;
  return textWidth(brand) * size <= room ? brand : '';
}

export default function BrandFamilyMap({ width, height, onPickBrand, onPickFamily, baseline = null, basis = 'ledger', familyMoves, gateMin = GATE_MIN, horizonShortLabel = '12 mo', windowLabel }: {
  width: number; height: number; onPickBrand: (brand: string, focusAfterPick?: boolean) => void; onPickFamily: (brand: string, familyKey: string, family: string, focusAfterPick?: boolean) => void;
  baseline?: Baseline | null; basis?: MapBasis; familyMoves?: Record<string, HorizonMoveCounts>; gateMin?: number; horizonShortLabel?: string; windowLabel?: string;
}) {
  const [rows, setRows] = useState<MapRow[] | null | undefined>(undefined);
  const [tooltip, setTooltip] = useState<{ row: MapRow; x: number; y: number } | null>(null);
  const [sheet, setSheet] = useState<MapRow | null>(null);
  const [coarse] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches);
  const tooltipId = useId();
  const pick = (r: MapRow, focus: boolean) => r.family_key === 'more' || r.family_key === 'other'
    ? onPickBrand(r.brand, focus) : onPickFamily(r.brand, r.family_key, r.family ?? '', focus);
  const moveFor = (r: MapRow): Move => r.family_key === 'more' || r.family_key === 'other'
    ? { kind: 'none' } : relativeMove(toNode(r), baseline, basis === 'ledger', gateMin);
  const inspected = (r: MapRow) => ({ ...toNode(r), name: `${r.brand} ${label(r)}` });
  useEffect(() => { setTooltip(null); setSheet(null); }, [basis, familyMoves, gateMin, windowLabel, horizonShortLabel]);
  useEffect(() => { let live = true; readBrandFamilyMap().then((r) => { if (live) setRows(r); }); return () => { live = false; }; }, []);
  const effectiveRows = useMemo(() => {
    if (!rows) return rows;
    const moved = !familyMoves ? rows : rows.map((r) => {
      if (r.family_key === 'more' || r.family_key === 'other') return r;
      const ov = familyMoves[`${r.brand}|${r.family_key}`];
      return ov
        ? { ...r, sold_12m: ov.sold_12m, sold_prior_12m: ov.sold_prior_12m, usd_12m: ov.usd_12m, usd_prior_12m: ov.usd_prior_12m }
        : { ...r, sold_12m: 0, sold_prior_12m: 0, usd_12m: 0, usd_prior_12m: 0 };
    });
    return groupGmMapFamilies(moved);
  }, [rows, familyMoves]);
  const layout = useMemo(() => {
    if (!effectiveRows?.length || width < 100 || height < 100) return null;
    // Sized as the brand map is: Bring a Trailer's 12 months by default, every venue and year in the ledger view.
    const area = (r: MapRow) => (basis === 'bat12' ? r.usd_12m ?? 0 : r.usd ?? 0);
    const brands = new Map<string, { brand: string; usd: number; rows: MapRow[] }>();
    for (const r of effectiveRows) {
      const b = brands.get(r.brand) ?? { brand: r.brand, usd: 0, rows: [] };
      if (area(r) > 0) { b.rows.push(r); b.usd += area(r); }
      brands.set(r.brand, b);
    }
    const frames = squarify([...brands.values()].filter((b) => b.usd > 0).map((b) => ({ node: b, area: b.usd })), 0, 0, width, height);
    return frames.map((f) => {
      const head = f.h > 44 && f.w > 64 ? HEAD : 0;
      const tiles = squarify(f.node.rows.map((r) => ({ node: r, area: area(r) })), f.x + 1, f.y + head + 1, Math.max(0, f.w - 2), Math.max(0, f.h - head - 2));
      return { ...f, head, tiles, text: head ? headerText(f.node.brand.toUpperCase(), moneyShort(f.node.usd), f.w) : '' };
    });
  }, [effectiveRows, width, height, basis]);

  if (rows === undefined) return <div className="brand-family-map__empty"><Text role="caption">Reading the map…</Text></div>;
  if (!layout) return <div className="brand-family-map__empty"><Text role="caption">The map with families inside could not be read.</Text></div>;
  return <div className="brand-family-map" onMouseLeave={() => setTooltip(null)}>
    {layout.map((f) => <div key={f.node.brand}>
      {f.head > 0 && <button type="button" className="brand-family-map__brand" onClick={(e) => onPickBrand(f.node.brand, e.detail === 0)}
        aria-label={`${f.node.brand}: ${money(f.node.usd)}`}
        style={{ left: f.x, top: f.y, width: f.w, height: f.head }} title={`${f.node.brand}: ${money(f.node.usd)}`}>
        {f.text && <span className="brand-family-map__head">
          <MakeIdentity make={f.node.brand} inverse compact />
          {f.text !== f.node.brand.toUpperCase() && <span className="brand-family-map__dollars">{moneyShort(f.node.usd)}</span>}
        </span>}
      </button>}
      {f.tiles.map((t) => {
        const r = t.node;
        const node = toNode(r);
        // "more families" and "other models" are not a family: never colored.
        const move = moveFor(r);
        return <div key={`${r.brand}-${r.family_key}`}
          onFocus={(e) => { const bounds = e.target.getBoundingClientRect(); setTooltip({ row: r, x: bounds.left, y: bounds.bottom }); }}
          onBlur={() => setTooltip(null)}
          onMouseLeave={() => setTooltip(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setTooltip(null); } }}
          onMouseMove={(e) => { if (!coarse) setTooltip({ row: r, x: e.clientX, y: e.clientY }); }}>
          <MarketTile node={node} move={move} basis={basis} x={t.x} y={t.y} w={t.w} h={t.h}
            ariaLabel={`${r.brand} ${label(r)}`} describedBy={tooltip?.row === r ? tooltipId : undefined}
            onClick={(e) => { setTooltip(null); if (coarse) setSheet(r); else pick(r, e.detail === 0); }}
            title={`${r.brand} ${label(r)}: ${money(r.usd ?? 0)} · ${(r.sold ?? 0).toLocaleString('en-US')} sold${move.kind === 'move' ? ` · ${horizonShortLabel}: ${signedPct(move.rel)} against the market (sales ${signedPct(move.raw)})` : ''}`} />
        </div>;
      })}
    </div>)}
    {tooltip && createPortal(<MarketCard id={tooltipId} node={inspected(tooltip.row)} move={moveFor(tooltip.row)} base={baseline}
      x={tooltip.x} y={tooltip.y} windowLabel={windowLabel} gateMin={gateMin} />, document.body)}
    {sheet && <MarketSheet node={inspected(sheet)} move={moveFor(sheet)} base={baseline} windowLabel={windowLabel} gateMin={gateMin}
      onClose={() => setSheet(null)} onOpen={() => { const r = sheet; setSheet(null); pick(r, true); }} />}
  </div>;
}

// A two-way view switch for the map's header.
export function MapViewSwitch<V extends string>({ value, options, onChange, label }: {
  value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; label: string;
}) {
  return <div className="map-view-switch" role="group" aria-label={label}>
    {options.map((o) => <button key={o.value} type="button" className="map-view-switch__option" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
      <Text role="label">{o.label}</Text>
    </button>)}
  </div>;
}
