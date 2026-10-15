import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { squarify } from '../../lib/squarify';
import { Text } from '../../kit';
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
      ({ data, error }) => { if (error || !Array.isArray(data)) { mapRead = null; return null; } return data as MapRow[]; },
      () => { mapRead = null; return null; },
    );
  }
  return mapRead;
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

export default function BrandFamilyMap({ width, height, onPickBrand, onPickFamily }: {
  width: number; height: number; onPickBrand: (brand: string) => void; onPickFamily: (brand: string, familyKey: string, family: string) => void;
}) {
  const [rows, setRows] = useState<MapRow[] | null | undefined>(undefined);
  useEffect(() => { let live = true; readBrandFamilyMap().then((r) => { if (live) setRows(r); }); return () => { live = false; }; }, []);
  const layout = useMemo(() => {
    if (!rows?.length || width < 100 || height < 100) return null;
    const brands = new Map<string, { brand: string; usd: number; rows: MapRow[] }>();
    for (const r of rows) {
      const b = brands.get(r.brand) ?? { brand: r.brand, usd: r.brand_usd, rows: [] };
      if ((r.usd ?? 0) > 0) b.rows.push(r);
      brands.set(r.brand, b);
    }
    const frames = squarify([...brands.values()].filter((b) => b.usd > 0).map((b) => ({ node: b, area: b.usd })), 0, 0, width, height);
    return frames.map((f) => {
      const head = f.h > 44 && f.w > 64 ? HEAD : 0;
      const tiles = squarify(f.node.rows.map((r) => ({ node: r, area: r.usd ?? 0 })), f.x + 1, f.y + head + 1, Math.max(0, f.w - 2), Math.max(0, f.h - head - 2));
      return { ...f, head, tiles };
    });
  }, [rows, width, height]);

  if (rows === undefined) return <div className="brand-family-map__empty"><Text role="caption">Reading the map…</Text></div>;
  if (!layout) return <div className="brand-family-map__empty"><Text role="caption">The map with families inside could not be read.</Text></div>;
  return <div className="brand-family-map">
    {layout.map((f) => <div key={f.node.brand}>
      {f.head > 0 && <button type="button" className="brand-family-map__brand" onClick={() => onPickBrand(f.node.brand)}
        style={{ left: f.x, top: f.y, width: f.w, height: f.head }} title={`${f.node.brand}: ${money(f.node.usd)} from confirmed sales`}>
        <Text role="label">{f.node.brand}</Text><Text role="caption">{money(f.node.usd)}</Text>
      </button>}
      {f.tiles.map((t) => {
        const r = t.node; const m = familyMove(r);
        const big = t.w > 54 && t.h > 26;
        return <button key={`${r.brand}-${r.family_key}`} type="button" className="brand-family-map__tile"
          style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: moveTint(m) }}
          onClick={() => (r.family_key === 'more' || r.family_key === 'other' ? onPickBrand(r.brand) : onPickFamily(r.brand, r.family_key, r.family ?? ''))}
          title={`${r.brand} ${label(r)}: ${money(r.usd ?? 0)} · ${(r.sold ?? 0).toLocaleString('en-US')} sold${m !== null ? ` · BaT 12 mo: sales ${pct(m)}` : ''}`}>
          {big && <Text role="label" as="span" className="brand-family-map__name">{label(r)}</Text>}
          {big && t.h > 40 && <Text role="caption" as="span">{m !== null ? pct(m) : money(r.usd ?? 0)}</Text>}
        </button>;
      })}
    </div>)}
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
