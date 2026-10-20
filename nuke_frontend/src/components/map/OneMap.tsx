import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MLMap, NavigationControl, type ExpressionSpecification, type MapGeoJSONFeature, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './maplibreWorker';
import './one-map.css';
import { CARTO_LIGHT } from './constants';
import { BAND_RGBA, BANDS, BOUNDARY_TILES, band, foldByZip, makeLabel, platformName, readCounty, zipBounds, type LocationRow, type ZipGroup } from './oneMapService';

/**
 * The web map as the iOS map (MarketMapView.swift, CountyZIPDrill), which the owner is pleased with: a standard light
 * map, ZIP areas shaded by distinct vehicles with ZIP evidence in fixed bands, the counties in view read in full and
 * folded per ZIP in the client, "All makes · All time" on top, "N vehicles in visible ZIPs · captured history", tap a
 * ZIP for its activity (platforms, vehicle mix, every vehicle with its observations, each opening its page), search a
 * ZIP. Boundaries are the static tiles in storage; the reads are the iOS reads.
 */

const WINDOWS: { key: string; label: string; days: number | null }[] = [
  { key: 'all', label: 'All time', days: null }, { key: '30', label: 'Last 30 days', days: 30 }, { key: '90', label: 'Last 90 days', days: 90 }, { key: '365', label: 'Last year', days: 365 },
];
const fmt = (n: number) => n.toLocaleString('en-US');
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'date unknown');

export default function OneMap() {
  const p = useMemo(() => new URLSearchParams(window.location.search), []);
  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const [make, setMake] = useState(p.get('make') ?? '');
  const [windowKey, setWindowKey] = useState(WINDOWS.some((w) => w.key === p.get('window')) ? p.get('window')! : 'all');
  const [rowsByCounty, setRowsByCounty] = useState<Map<string, LocationRow[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [visibleZips, setVisibleZips] = useState<Set<string>>(new Set());
  const [countiesInView, setCountiesInView] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(p.get('zip'));
  const [query, setQuery] = useState('');
  const [showMakes, setShowMakes] = useState(false);
  const [showWindows, setShowWindows] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [note, setNote] = useState('');
  const cacheRef = useRef<Map<string, LocationRow[]>>(new Map());
  const paintedRef = useRef<Set<string>>(new Set());

  // URL state.
  useEffect(() => {
    const m = mapRef.current;
    const url = new URL(window.location.href);
    for (const [k, v] of [['make', make], ['window', windowKey === 'all' ? '' : windowKey], ['zip', selected ?? '']] as const) { if (v) url.searchParams.set(k, v); else url.searchParams.delete(k); }
    if (m) { const c = m.getCenter(); url.searchParams.set('lng', c.lng.toFixed(3)); url.searchParams.set('lat', c.lat.toFixed(3)); url.searchParams.set('z', m.getZoom().toFixed(2)); }
    window.history.replaceState(null, '', url);
  }, [make, windowKey, selected, viewKey]);

  // The map: a standard light basemap, county context lines, ZIP fills in the iOS bands.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MLMap({ container: containerRef.current, style: CARTO_LIGHT, center: [Number(p.get('lng')) || -115.1, Number(p.get('lat')) || 36.1], zoom: Number(p.get('z')) || 9.3, minZoom: 4, maxZoom: 16, attributionControl: { compact: true } });
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.addSource('bounds', { type: 'vector', tiles: [BOUNDARY_TILES], minzoom: 0, maxzoom: 9, attribution: 'ZIP areas: U.S. Census Bureau 2020' });
      const fill = ['case', ['!=', ['feature-state', 'band'], null], ['step', ['feature-state', 'band'], BAND_RGBA[0], 1, BAND_RGBA[1], 2, BAND_RGBA[2], 3, BAND_RGBA[3]], 'rgba(0,0,0,0)'] as unknown as ExpressionSpecification;
      map.addLayer({ id: 'zcta-fill', type: 'fill', source: 'bounds', 'source-layer': 'zctas', paint: { 'fill-color': fill, 'fill-opacity': 1 } });
      map.addLayer({ id: 'zcta-line', type: 'line', source: 'bounds', 'source-layer': 'zctas', paint: { 'line-color': 'rgba(0,122,255,0.20)', 'line-width': 0.5 } });
      map.addLayer({ id: 'zcta-selected', type: 'line', source: 'bounds', 'source-layer': 'zctas', paint: { 'line-color': 'rgb(0,122,255)', 'line-width': 1.6 }, filter: ['==', ['id'], -1] });
      map.addLayer({ id: 'county-line', type: 'line', source: 'bounds', 'source-layer': 'counties', paint: { 'line-color': 'rgba(60,60,67,0.45)', 'line-width': 0.8 } });
      setReady(true); setViewKey((k) => k + 1);
    });
    map.on('idle', () => setViewKey((k) => k + 1));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [p]);

  // What is in view: counties (to read) and ZIPs (to count).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const counties = [...new Set(map.queryRenderedFeatures({ layers: ['county-line'] }).map((f) => String(f.properties.fips)))].sort();
    const zips = new Set(map.queryRenderedFeatures({ layers: ['zcta-fill'] }).map((f) => String(f.properties.zcta)));
    setCountiesInView((prev) => (prev.join() === counties.join() ? prev : counties));
    setVisibleZips((prev) => (prev.size === zips.size && [...zips].every((z) => prev.has(z)) ? prev : zips));
  }, [ready, viewKey]);

  // Read every county in view, in full, two at a time; keep what is already read this session.
  useEffect(() => {
    if (!countiesInView.length) return;
    const ctl = new AbortController();
    const want = countiesInView.filter((c) => !cacheRef.current.has(c) && !loading.has(c));
    if (!want.length) return;
    setLoading((s) => new Set([...s, ...want]));
    let i = 0;
    const worker = async () => {
      while (i < want.length && !ctl.signal.aborted) {
        const fips = want[i++];
        try {
          const rows = await readCounty(fips, ctl.signal, (page) => setRowsByCounty((m) => new Map(m).set(fips, [...(m.get(fips) ?? []), ...page])));
          cacheRef.current.set(fips, rows);
          setRowsByCounty((m) => new Map(m).set(fips, rows));
          setFailed((s) => { const n = new Set(s); n.delete(fips); return n; });
        } catch (e) {
          if ((e as Error).name !== 'AbortError') setFailed((s) => new Set([...s, fips]));
        } finally {
          setLoading((s) => { const n = new Set(s); n.delete(fips); return n; });
        }
      }
    };
    Promise.all([worker(), worker()]);
    return () => ctl.abort();
  }, [countiesInView]); // eslint-disable-line react-hooks/exhaustive-deps

  // The fold: every row of every county in view → ZIP groups, by make and window.
  const from = useMemo(() => { const w = WINDOWS.find((x) => x.key === windowKey); return w?.days ? new Date(Date.now() - w.days * 86_400_000) : null; }, [windowKey]);
  const rows = useMemo(() => countiesInView.flatMap((c) => rowsByCounty.get(c) ?? []), [countiesInView, rowsByCounty]);
  const fold = useMemo(() => foldByZip(rows, { make: make || undefined, from }), [rows, make, from]);
  const makes = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) { const k = (r.vehicles.make ?? '').trim(); if (k) (m.get(k) ?? m.set(k, new Set()).get(k)!).add(r.vehicles.id); }
    return [...m.entries()].map(([k, v]) => [k, v.size] as const).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const visibleVehicles = useMemo(() => { const s = new Set<string>(); for (const z of visibleZips) for (const id of fold.groups.get(z)?.vehicles.keys() ?? []) s.add(id); return s.size; }, [fold, visibleZips]);
  const complete = countiesInView.length > 0 && countiesInView.every((c) => cacheRef.current.has(c));

  // Paint the bands.
  const paint = useCallback(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = { source: 'bounds', sourceLayer: 'zctas' };
    for (const z of paintedRef.current) map.setFeatureState({ ...src, id: Number(z) }, { band: null });
    paintedRef.current = new Set();
    for (const g of fold.groups.values()) { map.setFeatureState({ ...src, id: Number(g.zip) }, { band: band(g.vehicles.size) }); paintedRef.current.add(g.zip); }
  }, [fold, ready]);
  useEffect(() => { paint(); }, [paint, viewKey]);
  useEffect(() => { const m = mapRef.current; if (m?.getLayer('zcta-selected')) m.setFilter('zcta-selected', ['==', ['id'], selected ? Number(selected) : -1]); }, [selected, ready]);

  // Tap a ZIP.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const onClick = (e: MapMouseEvent) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ['zcta-fill'] })[0] as MapGeoJSONFeature | undefined;
      setSelected(f ? String(f.properties.zcta) : null);
    };
    const onMove = (e: MapMouseEvent) => { map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: ['zcta-fill'] }).length ? 'pointer' : ''; };
    map.on('click', onClick); map.on('mousemove', onMove);
    return () => { map.off('click', onClick); map.off('mousemove', onMove); };
  }, [ready]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim(); const map = mapRef.current; if (!q || !map) return;
    if (/^\d{5}$/.test(q)) {
      const b = await zipBounds(q);
      if (!b) { setNote(`ZIP ${q} has no area`); return; }
      setNote(''); map.fitBounds(b, { padding: 60, duration: 600 }); setSelected(q); return;
    }
    const hit = rows.find((r) => makeLabel(r).toLowerCase().includes(q.toLowerCase()) || r.vehicles.id === q);
    if (!hit) { setNote(`No vehicle matching "${q}" in the loaded area`); return; }
    setNote(''); window.location.href = `/vehicle/${hit.vehicles.id}`;
  };

  const group: ZipGroup | null = selected ? fold.groups.get(selected) ?? { zip: selected, vehicles: new Map() } : null;
  const sheet = useMemo(() => {
    if (!group) return null;
    const sources = new Map<string, Set<string>>(); const mix = new Map<string, Set<string>>();
    for (const [vid, obs] of group.vehicles) {
      for (const r of obs) (sources.get(platformName(r.source_platform)) ?? sources.set(platformName(r.source_platform), new Set()).get(platformName(r.source_platform))!).add(vid);
      const mk = (obs[0].vehicles.make ?? '').trim() || 'Make unrecorded';
      (mix.get(mk) ?? mix.set(mk, new Set()).get(mk)!).add(vid);
    }
    const list = (m: Map<string, Set<string>>) => [...m.entries()].map(([k, v]) => [k, v.size] as const).sort((a, b) => b[1] - a[1]);
    const vehicles = [...group.vehicles.entries()].sort((a, b) => ((a[1][0].observed_at ?? '') < (b[1][0].observed_at ?? '') ? 1 : -1));
    return { sources: list(sources), mix: list(mix), vehicles };
  }, [group]);
  const windowLabel = WINDOWS.find((w) => w.key === windowKey)!.label;

  return (
    <div className="om" data-testid="one-map">
      <div ref={containerRef} className="om-canvas" />

      <div className="om-top">
        <div className="om-row">
          <button type="button" className="om-link" onClick={() => { setShowMakes((v) => !v); setShowWindows(false); }}>{make || 'All makes'} ▾</button>
          <button type="button" className="om-link" onClick={() => { setShowWindows((v) => !v); setShowMakes(false); }}>{windowLabel} ▾</button>
          <button type="button" className="om-link" aria-label="About this map" onClick={() => setShowInfo(true)}>ⓘ</button>
        </div>
        <div className="om-count" data-testid="headline">
          {loading.size && !complete ? <span className="om-spin" /> : null}
          {complete || rows.length ? `${fmt(visibleVehicles)} vehicles in visible ZIPs · ${windowKey === 'all' ? 'captured history' : windowLabel.toLowerCase()}` : countiesInView.length ? 'Loading records…' : 'Move the map over the US'}
        </div>
        <div className="om-legend">
          <span className="om-legend-title">Vehicles per ZIP</span>
          {BANDS.map((b, i) => <span key={b} className="om-swatch"><i style={{ background: BAND_RGBA[i] }} />{b}</span>)}
        </div>
        {showMakes && <div className="om-menu">
          <button type="button" className={make ? '' : 'on'} onClick={() => { setMake(''); setShowMakes(false); }}>All makes</button>
          {makes.slice(0, 40).map(([m, n]) => <button key={m} type="button" className={m === make ? 'on' : ''} onClick={() => { setMake(m); setShowMakes(false); }}>{m} <span>{fmt(n)}</span></button>)}
        </div>}
        {showWindows && <div className="om-menu">
          {WINDOWS.map((w) => <button key={w.key} type="button" className={w.key === windowKey ? 'on' : ''} onClick={() => { setWindowKey(w.key); setShowWindows(false); }}>{w.label}</button>)}
        </div>}
      </div>

      <div className="om-bottom">
        <div className="om-row om-between">
          <span>{selected ? `ZIP ${selected}` : 'Tap a ZIP to explore its activity'}</span>
          {failed.size ? <span className="om-warn">Some records did not load · <button type="button" className="om-link" onClick={() => { setFailed(new Set()); setCountiesInView((c) => [...c]); }}>Retry</button></span> : null}
          {fold.noZip ? <span className="om-muted">{fmt(fold.noZip)} records without a ZIP</span> : null}
        </div>
        <form onSubmit={search}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ZIP, or vehicle" aria-label="ZIP, or vehicle" /></form>
        {note && <div className="om-warn">{note}</div>}
      </div>

      {group && sheet && (
        <div className="om-sheet" data-testid="area-sheet">
          <div className="om-row om-between">
            <h2>ZIP {group.zip}</h2>
            <button type="button" className="om-link" onClick={() => setSelected(null)}>Done</button>
          </div>
          <div className="om-muted">{make || 'All makes'} · {windowLabel}{complete ? '' : ' · still loading, counts are provisional'}</div>
          <div className="om-metrics">
            <div><b>{fmt(group.vehicles.size)}</b><span>Vehicles</span></div>
            <div><b>{fmt(sheet.sources.length)}</b><span>Platforms</span></div>
            <div><b>{fmt(sheet.mix.length)}</b><span>Makes</span></div>
          </div>
          <h3>Platforms represented</h3>
          {sheet.sources.map(([s, n]) => <div key={s} className="om-row om-between om-line"><span>{s}</span><span>{fmt(n)} vehicles</span></div>)}
          <h3>Vehicle mix</h3>
          {sheet.mix.slice(0, 8).map(([m, n]) => <div key={m} className="om-bar"><span>{m}</span><i style={{ width: `${Math.max(4, (100 * n) / sheet.mix[0][1])}%` }} /><b>{fmt(n)}</b></div>)}
          <h3>Vehicles</h3>
          {sheet.vehicles.map(([vid, obs]) => (
            <a key={vid} href={`/vehicle/${vid}`} className="om-vehicle">
              {obs[0].vehicles.primary_image_url ? <img src={obs[0].vehicles.primary_image_url} alt="" width={56} height={42} loading="lazy" /> : <span className="om-noimg" />}
              <span className="om-vtext">
                <b>{makeLabel(obs[0])}</b>
                <span className="om-muted">{obs.length} {obs.length === 1 ? 'record' : 'records'} · {platformName(obs[0].source_platform)} · {day(obs[0].observed_at)}</span>
              </span>
            </a>
          ))}
          {!group.vehicles.size && <div className="om-muted">No vehicles with ZIP evidence here{make ? ` for ${make}` : ''}{windowKey !== 'all' ? ` in ${windowLabel.toLowerCase()}` : ''}.</div>}
        </div>
      )}

      {showInfo && (
        <div className="om-sheet" role="dialog">
          <div className="om-row om-between"><h2>Sources and coverage</h2><button type="button" className="om-link" onClick={() => setShowInfo(false)}>Done</button></div>
          <p>Color shows distinct vehicles with source ZIP evidence in fixed bands: 1–4, 5–19, 20–99 and 100 or more. Unshaded areas have no matching mapped evidence in this loaded region; that does not establish an inactive market. These are not completed sales, current availability or bid counts.</p>
          <p>ZIP areas are Census 2020 ZIP Code Tabulation Areas. Some postal ZIPs have no area, and ZIPs can cross county boundaries. Records without a source ZIP are counted at the bottom of the map.</p>
          <p>The date window uses the record's observation date. Every vehicle shown is a public record and opens to its page.</p>
        </div>
      )}
    </div>
  );
}
