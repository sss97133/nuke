import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MLMap, NavigationControl, type ExpressionSpecification, type GeoJSONSource, type MapGeoJSONFeature, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './maplibreWorker';
import './one-map.css';
import { CARTO_DARK, MAP_FONT } from './constants';
import {
  BOUNDARY_TILES, findPlace, readAreas, readCars, readShops, window as dayWindow,
  type AreasResponse, type Car, type Level, type Shop,
} from './oneMapService';

/**
 * The one map (docs/proposals/2026-10-19-one-map.md), as a finder: what is near a place, each thing openable.
 * The cars listed in view sit on the map as dots and in the list beside it; shops are pins; areas (state, county,
 * ZIP by zoom) carry their counts as context, and a click on one zooms into it. Search takes a ZIP or a city;
 * the make box narrows the cars. Every count is a map_facts row; every item is a public row.
 */

type What = 'cars' | 'sold' | 'shops';
const WHAT_LAYER: Record<What, string> = { cars: 'listing', sold: 'sale', shops: 'organization' };
const WHAT_WORD: Record<What, string> = { cars: 'cars for sale', sold: 'sold', shops: 'shops' };
const LEVEL_BY_ZOOM = (z: number): Level => (z < 5 ? 'state' : z < 8 ? 'county' : 'zcta');
const SOURCE_LAYER: Record<Level, string> = { state: 'states', county: 'counties', zcta: 'zctas' };
const KEY_PROP: Record<Level, string> = { state: 'fips', county: 'fips', zcta: 'zcta' };
const DAY_CHOICES = [7, 30, 90, 365];

const fmt = (n: number) => n.toLocaleString('en-US');
const money = (n: number | null | undefined) => (n == null ? '' : `$${Math.round(n).toLocaleString('en-US')}`);
const ago = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? `${Math.floor(d)} days ago` : d < 365 ? `${Math.floor(d / 30)} months ago` : `${Math.floor(d / 365)} years ago`;
};
const title = (c: Car) => [c.year, c.make, c.model].filter(Boolean).join(' ') || 'Vehicle';

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const days = Number(p.get('days'));
  const what = p.get('what') as What | null;
  return {
    what: what && what in WHAT_LAYER ? what : 'cars' as What,
    days: DAY_CHOICES.includes(days) ? days : 30,
    source: p.get('source') ?? '', make: p.get('make') ?? '',
    lng: Number(p.get('lng')) || -115.15, lat: Number(p.get('lat')) || 36.15, zoom: Number(p.get('z')) || 9,
  };
}

function breaks(values: number[]): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [1, 2, 3, 4];
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return [q(0.2), q(0.4), q(0.6), q(0.8)];
}
function palette(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return { ramp: [0, 1, 2, 3, 4].map((i) => v(`--om-ramp-${i}`)), line: v('--om-line'), accent: v('--om-accent'), bg: v('--om-bg'), shop: v('--om-shop') };
}
function bounds(f: MapGeoJSONFeature): [number, number, number, number] {
  const g = f.geometry as { type: string; coordinates: number[][][] | number[][][][] };
  const rings = g.type === 'Polygon' ? (g.coordinates as number[][][]) : (g.coordinates as number[][][][]).flat();
  let w = 180, s = 90, e = -180, n = -90;
  for (const ring of rings) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

export default function OneMap() {
  const init = useMemo(readUrl, []);
  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [what, setWhat] = useState<What>(init.what);
  const [days, setDays] = useState(init.days);
  const [source, setSource] = useState(init.source);
  const [make, setMake] = useState(init.make);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(init.zoom);
  const [viewKey, setViewKey] = useState(0);
  const [areas, setAreas] = useState<AreasResponse | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const level = LEVEL_BY_ZOOM(zoom);
  const win = useMemo(() => dayWindow(days), [days]);
  const countsRef = useRef<Map<string, number>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);

  // URL state.
  useEffect(() => {
    const m = mapRef.current;
    const url = new URL(window.location.href);
    url.searchParams.set('what', what); url.searchParams.set('days', String(days));
    for (const [k, v] of [['source', source], ['make', make]] as const) { if (v) url.searchParams.set(k, v); else url.searchParams.delete(k); }
    if (m) { const c = m.getCenter(); url.searchParams.set('lng', c.lng.toFixed(3)); url.searchParams.set('lat', c.lat.toFixed(3)); url.searchParams.set('z', m.getZoom().toFixed(2)); }
    window.history.replaceState(null, '', url);
  }, [what, days, source, make, viewKey]);

  // The map: dark basemap, boundary tiles, muted area fills, car dots (clustered) and shop pins.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const pal = palette(containerRef.current);
    const map = new MLMap({ container: containerRef.current, style: CARTO_DARK, center: [init.lng, init.lat], zoom: init.zoom, minZoom: 2, maxZoom: 17, attributionControl: { compact: true } });
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.addSource('bounds', { type: 'vector', tiles: [BOUNDARY_TILES], minzoom: 0, maxzoom: 9, attribution: 'Boundaries: U.S. Census Bureau 2020' });
      map.addSource('cars', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 28, clusterMaxZoom: 13 });
      map.addSource('shops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const color = ['case', ['!=', ['feature-state', 'entities'], null],
        ['step', ['feature-state', 'entities'], pal.ramp[0], 1, pal.ramp[1], 2, pal.ramp[2], 3, pal.ramp[3], 4, pal.ramp[4]], 'transparent'] as unknown as ExpressionSpecification;
      for (const lv of ['state', 'county', 'zcta'] as Level[]) {
        map.addLayer({ id: `${lv}-fill`, type: 'fill', source: 'bounds', 'source-layer': SOURCE_LAYER[lv],
          paint: { 'fill-color': color, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.45, 0.18] }, layout: { visibility: 'none' } });
        map.addLayer({ id: `${lv}-line`, type: 'line', source: 'bounds', 'source-layer': SOURCE_LAYER[lv],
          paint: { 'line-color': pal.line, 'line-width': lv === 'state' ? 1 : 0.6, 'line-opacity': 0.35 }, layout: { visibility: 'none' } });
      }
      map.addLayer({ id: 'car-clusters', type: 'circle', source: 'cars', filter: ['has', 'point_count'],
        paint: { 'circle-color': pal.accent, 'circle-opacity': 0.85, 'circle-stroke-color': pal.bg, 'circle-stroke-width': 1.5,
          'circle-radius': ['step', ['get', 'point_count'], 12, 10, 16, 50, 20, 200, 26] } });
      map.addLayer({ id: 'car-cluster-count', type: 'symbol', source: 'cars', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11 }, paint: { 'text-color': pal.bg } });
      map.addLayer({ id: 'car-dots', type: 'circle', source: 'cars', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': pal.accent, 'circle-radius': ['case', ['boolean', ['feature-state', 'picked'], false], 9, 6], 'circle-stroke-color': pal.bg, 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'shop-pins', type: 'circle', source: 'shops',
        paint: { 'circle-color': pal.shop, 'circle-radius': 6, 'circle-stroke-color': pal.bg, 'circle-stroke-width': 1.5 } });
      setZoom(map.getZoom()); setReady(true);
    });
    map.on('moveend', () => { setZoom(map.getZoom()); setViewKey((k) => k + 1); });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [init.lat, init.lng, init.zoom]);

  // Area fills follow the zoom; counts paint as feature state.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const lv of ['state', 'county', 'zcta'] as Level[]) {
      const on = lv === level ? 'visible' : 'none';
      map.setLayoutProperty(`${lv}-fill`, 'visibility', on); map.setLayoutProperty(`${lv}-line`, 'visibility', on);
    }
  }, [ready, level]);
  const paint = useCallback((data: AreasResponse | null, lv: Level) => {
    const map = mapRef.current;
    if (!map) return;
    const src = { source: 'bounds', sourceLayer: SOURCE_LAYER[lv] };
    for (const key of countsRef.current.keys()) map.setFeatureState({ ...src, id: Number(key) }, { entities: null });
    countsRef.current = new Map();
    if (!data) return;
    const b = breaks(data.areas.map((a) => a.entities));
    for (const a of data.areas) {
      const cls = a.entities >= b[3] ? 4 : a.entities >= b[2] ? 3 : a.entities >= b[1] ? 2 : a.entities >= b[0] ? 1 : 0;
      map.setFeatureState({ ...src, id: Number(a.key) }, { entities: cls });
      countsRef.current.set(a.key, a.entities);
    }
  }, []);

  // The things in view: cars (or sold cars) and shops, plus the area counts for context.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ctl = new AbortController();
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    setBusy(true); setNote('');
    const jobs: Promise<unknown>[] = [];
    if (what === 'shops') {
      setCars([]);
      jobs.push(readShops({ bbox }, ctl.signal).then((s) => { setShops(s); (map.getSource('shops') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: s.map((x) => ({ type: 'Feature', id: x.id, properties: { id: x.id, name: x.name }, geometry: { type: 'Point', coordinates: [x.lng, x.lat] } })) }); }));
    } else {
      setShops([]); (map.getSource('shops') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
      jobs.push(readCars({ bbox, from: win.from, to: win.to, source: source || undefined, make: make || undefined }, ctl.signal).then((all) => {
        const list = what === 'sold' ? all.filter((c) => (c.status ?? '').toLowerCase() === 'sold') : all;
        setCars(list);
        (map.getSource('cars') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: list.map((c) => ({ type: 'Feature', properties: { vehicle_id: c.vehicle_id }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })) });
      }));
    }
    let keys: string[] | undefined;
    if (level === 'zcta') keys = [...new Set(map.queryRenderedFeatures({ layers: ['zcta-fill'] }).map((f) => String(f.properties?.zcta)))].slice(0, 2000);
    if (level !== 'zcta' || keys?.length) {
      jobs.push(readAreas({ level, layer: WHAT_LAYER[what], from: win.from, to: win.to, source: what === 'shops' ? undefined : source || undefined, keys }, ctl.signal)
        .then((r) => { setAreas(r); paint(r, level); }));
    } else { setAreas(null); paint(null, level); }
    Promise.all(jobs).then(() => setBusy(false)).catch((e) => { if (e.name !== 'AbortError') { setNote(String(e.message ?? e)); setBusy(false); } });
    return () => ctl.abort();
  }, [ready, viewKey, what, win.from, win.to, source, make, level, paint]);

  // Hover an area for its count; click an area to zoom into it; click a dot to pick that car; click a cluster to zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let hovered: { id: number; lv: Level } | null = null;
    const nameOf = (f: MapGeoJSONFeature, lv: Level) => (lv === 'zcta' ? `ZIP ${f.properties.zcta}` : lv === 'state' ? String(f.properties.name) : `${f.properties.name} County`);
    const onMove = (e: MapMouseEvent) => {
      const dot = map.queryRenderedFeatures(e.point, { layers: ['car-dots', 'car-clusters', 'shop-pins'] })[0];
      if (dot) { map.getCanvas().style.cursor = 'pointer'; setHover(null); return; }
      const f = map.queryRenderedFeatures(e.point, { layers: [`${level}-fill`] })[0];
      if (hovered) map.setFeatureState({ source: 'bounds', sourceLayer: SOURCE_LAYER[hovered.lv], id: hovered.id }, { hover: false });
      hovered = null;
      if (!f || f.id == null) { setHover(null); map.getCanvas().style.cursor = ''; return; }
      hovered = { id: Number(f.id), lv: level };
      map.setFeatureState({ source: 'bounds', sourceLayer: SOURCE_LAYER[level], id: Number(f.id) }, { hover: true });
      map.getCanvas().style.cursor = 'zoom-in';
      setHover({ name: nameOf(f, level), count: countsRef.current.get(String(f.properties[KEY_PROP[level]])) ?? 0 });
    };
    const onClick = (e: MapMouseEvent) => {
      const dot = map.queryRenderedFeatures(e.point, { layers: ['car-dots'] })[0];
      if (dot) { const id = String(dot.properties.vehicle_id); setPicked(id); listRef.current?.querySelector<HTMLElement>(`[data-vehicle="${id}"]`)?.scrollIntoView({ block: 'nearest' }); return; }
      const cluster = map.queryRenderedFeatures(e.point, { layers: ['car-clusters'] })[0];
      if (cluster) { map.easeTo({ center: (cluster.geometry as unknown as { coordinates: [number, number] }).coordinates, zoom: Math.min(17, map.getZoom() + 2) }); return; }
      const pin = map.queryRenderedFeatures(e.point, { layers: ['shop-pins'] })[0];
      if (pin) { setPicked(String(pin.properties.id)); return; }
      const f = map.queryRenderedFeatures(e.point, { layers: [`${level}-fill`] })[0];
      if (f) map.fitBounds(bounds(f), { padding: 40, duration: 500 });
    };
    map.on('mousemove', onMove); map.on('click', onClick);
    return () => { map.off('mousemove', onMove); map.off('click', onClick); };
  }, [ready, level]);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    const map = mapRef.current; if (!map || !query.trim()) return;
    try {
      const place = await findPlace(query);
      if (!place) { setNote(`Nothing found for "${query.trim()}"`); return; }
      setNote('');
      if (place.bounds) map.fitBounds(place.bounds, { padding: 40, duration: 600 });
      else if (place.center) map.flyTo({ center: place.center, zoom: 11, duration: 600 });
    } catch (err) { setNote(String((err as Error).message ?? err)); }
  };
  const flyTo = (lng: number, lat: number) => mapRef.current?.easeTo({ center: [lng, lat], zoom: Math.max(mapRef.current.getZoom(), 12), duration: 400 });

  const makes = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cars) if (c.make) m.set(c.make, (m.get(c.make) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [cars]);
  const count = what === 'shops' ? shops.length : cars.length;
  const windowWord = days === 7 ? 'this week' : days === 30 ? 'this month' : days === 90 ? 'in 90 days' : 'this year';
  const headline = busy && !count ? '…' : `${fmt(count)} ${WHAT_WORD[what]} here${what === 'shops' ? '' : ` ${windowWord}`}`;

  const label: React.CSSProperties = { fontFamily: MAP_FONT, fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--om-muted)' };
  const chip = (on: boolean): React.CSSProperties => ({ ...label, color: on ? 'var(--om-bg)' : 'var(--om-text-dim)', background: on ? 'var(--om-accent)' : 'transparent', border: '2px solid ' + (on ? 'var(--om-accent)' : 'var(--om-border-dim)'), padding: '4px 8px', cursor: 'pointer', marginRight: 4, marginBottom: 4 });
  const row: React.CSSProperties = { display: 'flex', gap: 10, padding: '8px 10px', borderTop: '1px solid var(--om-rule)', cursor: 'pointer', alignItems: 'center' };

  return (
    <div className="one-map" data-testid="one-map">
      <div ref={containerRef} className="one-map-canvas" />

      <form onSubmit={go} className="one-map-search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ZIP or city, e.g. 89101 or Las Vegas, NV" aria-label="Search a ZIP or city"
          style={{ ...label, textTransform: 'none', fontSize: 13, color: 'var(--om-text)', background: 'var(--om-panel)', border: '2px solid var(--om-line)', padding: '8px 10px', width: '100%' }} />
      </form>

      {hover && <div className="one-map-hover" style={{ ...label, color: 'var(--om-text)', background: 'var(--om-panel)', border: '2px solid var(--om-line)', padding: '6px 10px' }}>
        {hover.name}: <b>{fmt(hover.count)}</b> {WHAT_WORD[what]} · click to zoom in
      </div>}

      <div className="one-map-panel" ref={listRef}>
        <div style={{ padding: '10px 10px 6px' }}>
          <div style={{ fontFamily: MAP_FONT, fontSize: 20, fontWeight: 700, lineHeight: 1.1 }} data-testid="headline">{headline}</div>
          {areas && <div style={{ ...label, marginTop: 4 }}>
            {fmt(areas.totals.entities)} {WHAT_WORD[what]} across {fmt(areas.totals.areas)} {level === 'zcta' ? 'ZIPs in view' : level === 'state' ? 'states' : 'counties'}{what !== 'shops' ? ` ${windowWord}` : ''}
            {areas.unkeyed.entities ? ` · ${fmt(areas.unkeyed.entities)} with no ${level === 'zcta' ? 'ZIP' : level}` : ''}
          </div>}
          <div style={{ marginTop: 8 }}>
            {(['cars', 'sold', 'shops'] as What[]).map((w) => <button key={w} type="button" style={chip(w === what)} onClick={() => { setWhat(w); setPicked(null); }}>{w === 'cars' ? 'for sale' : w}</button>)}
            {what !== 'shops' && DAY_CHOICES.map((d) => <button key={d} type="button" style={chip(d === days)} onClick={() => setDays(d)}>{d === 7 ? 'week' : d === 30 ? 'month' : d === 90 ? '90 days' : 'year'}</button>)}
          </div>
          {what !== 'shops' && makes.length > 1 && <div style={{ marginTop: 4 }}>
            <button type="button" style={chip(!make)} onClick={() => setMake('')}>any make</button>
            {makes.map(([m, n]) => <button key={m} type="button" style={chip(m === make)} onClick={() => setMake(m === make ? '' : m)}>{m} {n}</button>)}
          </div>}
          {what !== 'shops' && areas && areas.by_source.length > 1 && <div style={{ marginTop: 4 }}>
            <button type="button" style={chip(!source)} onClick={() => setSource('')}>all sources</button>
            {areas.by_source.slice(0, 6).map((s) => <button key={s.source} type="button" style={chip(s.source === source)} onClick={() => setSource(s.source === source ? '' : s.source)}>{s.source.replace(/_/g, ' ')} {fmt(s.entities)}</button>)}
          </div>}
          {note && <div style={{ ...label, marginTop: 6, color: 'var(--om-danger)', textTransform: 'none' }}>{note}</div>}
        </div>

        {what === 'shops' ? shops.map((s) => (
          <div key={s.id} data-vehicle={s.id} style={{ ...row, background: picked === s.id ? 'var(--om-rule)' : 'transparent' }} onClick={() => { setPicked(s.id); flyTo(s.lng, s.lat); }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: MAP_FONT, fontSize: 13, fontWeight: 700 }}>{s.name}</div>
              <div style={label}>{s.kind?.replace(/_/g, ' ') ?? 'shop'}</div>
            </div>
            {s.slug && <a href={`/org/${s.slug}`} style={{ ...label, color: 'var(--om-accent)' }} onClick={(e) => e.stopPropagation()}>open</a>}
          </div>
        )) : cars.slice(0, 200).map((c) => (
          <div key={c.vehicle_id} data-vehicle={c.vehicle_id} style={{ ...row, background: picked === c.vehicle_id ? 'var(--om-rule)' : 'transparent' }} onClick={() => { setPicked(c.vehicle_id); flyTo(c.lng, c.lat); }}>
            {c.thumbnail ? <img src={c.thumbnail} alt="" width={64} height={48} loading="lazy" style={{ objectFit: 'cover', flex: 'none', background: 'var(--om-rule)' }} />
              : <div style={{ width: 64, height: 48, flex: 'none', background: 'var(--om-rule)' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: MAP_FONT, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title(c)}</div>
              <div style={label}>{c.price ? money(c.price) + ' · ' : ''}{c.source?.replace(/_/g, ' ') ?? ''} · {ago(c.observed_at)}{(c.status ?? '').toLowerCase() === 'sold' ? ' · sold' : ''}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <a href={`/vehicle/${c.vehicle_id}`} style={{ ...label, color: 'var(--om-accent)' }} onClick={(e) => e.stopPropagation()}>open</a>
              {c.source_url && <a href={c.source_url} target="_blank" rel="noreferrer" style={{ ...label, color: 'var(--om-accent)' }} onClick={(e) => e.stopPropagation()}>listing</a>}
            </div>
          </div>
        ))}
        {!busy && count === 0 && <div style={{ ...label, padding: 10, textTransform: 'none' }}>Nothing here {what === 'shops' ? '' : windowWord}. Zoom out, widen the window, or search another place.</div>}
        {cars.length > 200 && <div style={{ ...label, padding: 10 }}>first 200 of {fmt(cars.length)} · zoom in for the rest</div>}
      </div>
    </div>
  );
}
