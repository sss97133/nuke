import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MLMap, NavigationControl, type ExpressionSpecification, type MapGeoJSONFeature, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './maplibreWorker';
import './one-map.css';
import { CARTO_LIGHT } from './constants';
import { BAND_RGBA, BANDS, BOUNDARY_TILES, band, eligible, makeLabel, outcome, platformName, readArea, readAreas, readZip, zipBounds, type AreaLayers, type LocationRow } from './oneMapService';

/**
 * The web map as the iOS map, repaired by case 14 (docs/ledger/theory/data-machine-cases.md): the unit is the
 * selected ZIP; the counts at every zoom are map_facts rows (a sum, never a scan, so nothing spins); the ZIP panel
 * shows its readings nested in county, state and country with the records that carry no ZIP counted at their grain;
 * the map says it is the seller ledger of an area, not vehicles present; every datum on the panel opens.
 */

const WINDOWS = [{ key: '30', label: 'Last 30 days', days: 30 }, { key: '90', label: 'Last 90 days', days: 90 }, { key: '365', label: 'Last year', days: 365 }];
const LAYER_WORD: Record<string, string> = { vehicle: 'vehicles', listing: 'listings', sale: 'sales', organization: 'shops' };
const fmt = (n: number) => n.toLocaleString('en-US');
const money = (n: number | null | undefined) => (n == null ? '' : `$${Math.round(n).toLocaleString('en-US')}`);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'date unknown');
const utc = (d: Date) => d.toISOString().slice(0, 10);

export default function OneMap() {
  const p = useMemo(() => new URLSearchParams(window.location.search), []);
  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const [layer, setLayer] = useState(p.get('layer') && p.get('layer')! in LAYER_WORD ? p.get('layer')! : 'vehicle');
  const [windowKey, setWindowKey] = useState(WINDOWS.some((w) => w.key === p.get('window')) ? p.get('window')! : '365');
  const [visible, setVisible] = useState<{ zips: string[]; counties: Map<string, string> }>({ zips: [], counties: new Map() });
  const [inView, setInView] = useState<{ total: number; areas: number; asOf: string | null } | null>(null);
  const [selected, setSelected] = useState<{ zip: string; county: string; state: string } | null>(null);
  const [dolls, setDolls] = useState<{ zip: AreaLayers | null; county: AreaLayers | null; state: AreaLayers | null; us: number | null; countyNoZip: number | null }>({ zip: null, county: null, state: null, us: null, countyNoZip: null });
  const [rows, setRows] = useState<LocationRow[] | null>(null);
  const [rowsBusy, setRowsBusy] = useState(false);
  const [pick, setPick] = useState<{ platform?: string; make?: string }>({});
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showLayers, setShowLayers] = useState(false);
  const [showWindows, setShowWindows] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [note, setNote] = useState('');
  const paintedRef = useRef<Set<string>>(new Set());
  const win = useMemo(() => { const d = WINDOWS.find((w) => w.key === windowKey)!.days; return { from: utc(new Date(Date.now() - d * 86_400_000)), to: utc(new Date()) }; }, [windowKey]);
  const windowLabel = WINDOWS.find((w) => w.key === windowKey)!.label;

  useEffect(() => {
    const m = mapRef.current;
    const url = new URL(window.location.href);
    url.searchParams.set('layer', layer); url.searchParams.set('window', windowKey);
    if (selected) url.searchParams.set('zip', selected.zip); else url.searchParams.delete('zip');
    if (m) { const c = m.getCenter(); url.searchParams.set('lng', c.lng.toFixed(3)); url.searchParams.set('lat', c.lat.toFixed(3)); url.searchParams.set('z', m.getZoom().toFixed(2)); }
    window.history.replaceState(null, '', url);
  }, [layer, windowKey, selected, viewKey]);

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
      map.addLayer({ id: 'county-fill', type: 'fill', source: 'bounds', 'source-layer': 'counties', paint: { 'fill-color': 'rgba(0,0,0,0)' } });
      map.addLayer({ id: 'county-line', type: 'line', source: 'bounds', 'source-layer': 'counties', paint: { 'line-color': 'rgba(60,60,67,0.45)', 'line-width': 0.8 } });
      setReady(true); setViewKey((k) => k + 1);
    });
    map.on('idle', () => setViewKey((k) => k + 1));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [p]);

  // The ZIPs and counties in view.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const zips = [...new Set(map.queryRenderedFeatures({ layers: ['zcta-fill'] }).map((f) => String(f.properties.zcta)))].sort();
    const counties = new Map<string, string>();
    for (const f of map.queryRenderedFeatures({ layers: ['county-fill'] })) counties.set(String(f.properties.fips), String(f.properties.name));
    setVisible((prev) => (prev.zips.join() === zips.join() && prev.counties.size === counties.size ? prev : { zips, counties }));
  }, [ready, viewKey]);

  // The counts: one facts read for the ZIPs in view, painted as bands. A sum, never a scan.
  const paint = useCallback((counts: Map<string, number>) => {
    const map = mapRef.current; if (!map) return;
    const src = { source: 'bounds', sourceLayer: 'zctas' };
    for (const z of paintedRef.current) if (!counts.has(z)) map.setFeatureState({ ...src, id: Number(z) }, { band: null });
    for (const [z, n] of counts) map.setFeatureState({ ...src, id: Number(z) }, { band: band(n) });
    paintedRef.current = new Set(counts.keys());
  }, []);
  useEffect(() => {
    if (!ready || !visible.zips.length) { setInView(null); return; }
    const ctl = new AbortController();
    readAreas('zcta', layer, win.from, win.to, visible.zips.slice(0, 2000), ctl.signal)
      .then((r) => { paint(new Map(r.areas.map((a) => [a.key, a.entities]))); setInView({ total: r.totals.entities, areas: r.totals.areas, asOf: r.as_of }); setNote(''); })
      .catch((e) => { if (e.name !== 'AbortError') setNote(String(e.message ?? e)); });
    return () => ctl.abort();
  }, [ready, visible, layer, win.from, win.to, paint]);

  useEffect(() => { const m = mapRef.current; if (m?.getLayer('zcta-selected')) m.setFilter('zcta-selected', ['==', ['id'], selected ? Number(selected.zip) : -1]); }, [selected, ready]);

  // The selected ZIP: its dolls from the facts, its rows from the ledger.
  useEffect(() => {
    if (!selected) { setDolls({ zip: null, county: null, state: null, us: null, countyNoZip: null }); setRows(null); return; }
    const ctl = new AbortController();
    setRowsBusy(true); setPick({}); setOpen(null);
    Promise.all([
      readArea('zcta', selected.zip, win.from, win.to, ctl.signal), readArea('county', selected.county, win.from, win.to, ctl.signal), readArea('state', selected.state, win.from, win.to, ctl.signal),
      readAreas('state', layer, win.from, win.to, undefined, ctl.signal), readAreas('zcta', layer, win.from, win.to, [selected.zip], ctl.signal),
    ]).then(([z, c, s, us]) => setDolls({ zip: z, county: c, state: s, us: us.totals.entities + us.unkeyed.entities, countyNoZip: null })).catch((e) => { if (e.name !== 'AbortError') setNote(String(e.message ?? e)); });
    readZip(selected.zip, selected.county, ctl.signal).then((r) => { setRows(r.filter(eligible)); setRowsBusy(false); }).catch((e) => { if (e.name !== 'AbortError') { setNote(String(e.message ?? e)); setRowsBusy(false); } });
    return () => ctl.abort();
  }, [selected, win.from, win.to, layer]);

  // Tap a ZIP (its county and state come from the tiles under the tap).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const onClick = (e: MapMouseEvent) => {
      const z = map.queryRenderedFeatures(e.point, { layers: ['zcta-fill'] })[0] as MapGeoJSONFeature | undefined;
      const c = map.queryRenderedFeatures(e.point, { layers: ['county-fill'] })[0] as MapGeoJSONFeature | undefined;
      if (!z || !c) { setSelected(null); return; }
      setSelected({ zip: String(z.properties.zcta), county: String(c.properties.fips), state: String(c.properties.state) });
    };
    const onMove = (e: MapMouseEvent) => { map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: ['zcta-fill'] }).length ? 'pointer' : ''; };
    map.on('click', onClick); map.on('mousemove', onMove);
    return () => { map.off('click', onClick); map.off('mousemove', onMove); };
  }, [ready]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim(); const map = mapRef.current; if (!q || !map) return;
    if (!/^\d{5}$/.test(q)) { setNote('Search takes a five-digit ZIP'); return; }
    const b = await zipBounds(q);
    if (!b) { setNote(`ZIP ${q} has no area`); return; }
    setNote(''); map.fitBounds(b, { padding: 60, duration: 600 });
    map.once('idle', () => {
      const c = map.queryRenderedFeatures(map.project([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]), { layers: ['county-fill'] })[0];
      if (c) setSelected({ zip: q, county: String(c.properties.fips), state: String(c.properties.state) });
    });
  };

  // The rows folded: vehicles once, newest first; platforms and makes as filters that are buttons.
  const vehicles = useMemo(() => {
    const m = new Map<string, LocationRow[]>();
    for (const r of rows ?? []) (m.get(r.vehicles.id) ?? m.set(r.vehicles.id, []).get(r.vehicles.id)!).push(r);
    return [...m.values()].sort((a, b) => ((a[0].observed_at ?? '') < (b[0].observed_at ?? '') ? 1 : -1));
  }, [rows]);
  const platforms = useMemo(() => { const m = new Map<string, Set<string>>(); for (const v of vehicles) for (const r of v) (m.get(platformName(r.source_platform)) ?? m.set(platformName(r.source_platform), new Set()).get(platformName(r.source_platform))!).add(v[0].vehicles.id); return [...m.entries()].map(([k, s]) => [k, s.size] as const).sort((a, b) => b[1] - a[1]); }, [vehicles]);
  const makes = useMemo(() => { const m = new Map<string, number>(); for (const v of vehicles) { const k = (v[0].vehicles.make ?? '').trim() || 'Make unrecorded'; m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [vehicles]);
  const shown = vehicles.filter((v) => (!pick.platform || v.some((r) => platformName(r.source_platform) === pick.platform)) && (!pick.make || ((v[0].vehicles.make ?? '').trim() || 'Make unrecorded') === pick.make));
  const countyName = selected ? visible.counties.get(selected.county) ?? `County ${selected.county}` : '';
  const doll = (a: AreaLayers | null, key: string) => a?.layers.find((l) => l.layer === key);

  const word = LAYER_WORD[layer];
  return (
    <div className="om" data-testid="one-map">
      <div ref={containerRef} className="om-canvas" />

      <div className="om-top">
        <div className="om-row">
          <button type="button" className="om-link" onClick={() => { setShowLayers((v) => !v); setShowWindows(false); }}>{word[0].toUpperCase() + word.slice(1)} ▾</button>
          <button type="button" className="om-link" onClick={() => { setShowWindows((v) => !v); setShowLayers(false); }}>{windowLabel} ▾</button>
          <button type="button" className="om-link" aria-label="About this map" onClick={() => setShowInfo(true)}>ⓘ</button>
        </div>
        <div className="om-count" data-testid="headline">
          {inView ? `${fmt(inView.total)} ${word} in ${fmt(inView.areas)} ZIPs in view · ${windowLabel.toLowerCase()}` : visible.zips.length ? 'Counting…' : 'Zoom in to ZIPs'}
        </div>
        <div className="om-muted">Where vehicles were sold from, not where they are now.</div>
        <div className="om-legend">
          <span className="om-legend-title">{word[0].toUpperCase() + word.slice(1)} per ZIP</span>
          {BANDS.map((b, i) => <span key={b} className="om-swatch"><i style={{ background: BAND_RGBA[i] }} />{b}</span>)}
        </div>
        {showLayers && <div className="om-menu">{Object.entries(LAYER_WORD).map(([k, w]) => <button key={k} type="button" className={k === layer ? 'on' : ''} onClick={() => { setLayer(k); setShowLayers(false); }}>{w[0].toUpperCase() + w.slice(1)}</button>)}</div>}
        {showWindows && <div className="om-menu">{WINDOWS.map((w) => <button key={w.key} type="button" className={w.key === windowKey ? 'on' : ''} onClick={() => { setWindowKey(w.key); setShowWindows(false); }}>{w.label}</button>)}</div>}
      </div>

      <div className="om-bottom">
        <div className="om-row om-between">
          <span>{selected ? `ZIP ${selected.zip} · ${countyName}` : 'Tap a ZIP to explore its activity'}</span>
          {note && <span className="om-warn">{note}</span>}
        </div>
        <form onSubmit={search}><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ZIP" aria-label="ZIP" /></form>
      </div>

      {selected && (
        <div className="om-sheet" data-testid="area-sheet">
          <div className="om-row om-between"><h2>ZIP {selected.zip}</h2><button type="button" className="om-link" onClick={() => setSelected(null)}>Done</button></div>
          <div className="om-muted">{countyName} · {windowLabel} · seller ledger: where vehicles were sold from</div>

          <h3>This ZIP inside its county, state and country</h3>
          <table className="om-dolls" data-testid="dolls">
            <thead><tr><th /><th>ZIP</th><th>{countyName}</th><th>State</th><th>US</th></tr></thead>
            <tbody>
              {(['listing', 'sale', 'vehicle', 'organization'] as const).map((k) => (
                <tr key={k} className={k === layer ? 'on' : ''}>
                  <td><button type="button" className="om-link" onClick={() => setLayer(k)}>{LAYER_WORD[k]}</button></td>
                  <td>{dolls.zip ? fmt(doll(dolls.zip, k)?.entities ?? 0) : '…'}</td>
                  <td>{dolls.county ? fmt(doll(dolls.county, k)?.entities ?? 0) : '…'}</td>
                  <td>{dolls.state ? fmt(doll(dolls.state, k)?.entities ?? 0) : '…'}</td>
                  <td>{k === layer && dolls.us != null ? fmt(dolls.us) : ''}</td>
                </tr>
              ))}
              {dolls.zip && doll(dolls.zip, 'sale')?.priced ? <tr><td>sold for, average</td><td>{money(doll(dolls.zip, 'sale')!.avg)}</td><td>{money(doll(dolls.county, 'sale')?.avg)}</td><td>{money(doll(dolls.state, 'sale')?.avg)}</td><td /></tr> : null}
            </tbody>
          </table>
          <div className="om-muted">Counts are from the fold as of {dolls.zip?.layers[0]?.as_of?.slice(11, 16) ?? '…'} UTC. Records with no ZIP count in their county and state, not here.</div>

          <h3>Platforms represented</h3>
          {platforms.map(([s, n]) => <button key={s} type="button" className={`om-line om-row om-between om-pick ${pick.platform === s ? 'on' : ''}`} onClick={() => setPick((x) => ({ ...x, platform: x.platform === s ? undefined : s }))}><span>{s}</span><span>{fmt(n)} vehicles</span></button>)}
          {rowsBusy && !platforms.length && <div className="om-muted">Reading the ZIP's records…</div>}

          <h3>Vehicle mix</h3>
          {makes.slice(0, 10).map(([m, n]) => <button key={m} type="button" className={`om-bar om-pick ${pick.make === m ? 'on' : ''}`} onClick={() => setPick((x) => ({ ...x, make: x.make === m ? undefined : m }))}><span>{m}</span><i style={{ width: `${Math.max(4, (100 * n) / makes[0][1])}%` }} /><b>{fmt(n)}</b></button>)}

          <h3>Vehicles{pick.platform || pick.make ? ` · ${[pick.make, pick.platform].filter(Boolean).join(' · ')}` : ''} ({fmt(shown.length)})</h3>
          {shown.map((v) => {
            const first = v[0]; const o = outcome(first.vehicles); const isOpen = open === first.vehicles.id;
            return (
              <div key={first.vehicles.id} className="om-vehicle-block">
                <button type="button" className="om-vehicle" onClick={() => setOpen(isOpen ? null : first.vehicles.id)}>
                  {first.vehicles.primary_image_url ? <img src={first.vehicles.primary_image_url} alt="" width={56} height={42} loading="lazy" /> : <span className="om-noimg" />}
                  <span className="om-vtext">
                    <b>{makeLabel(first)}</b>
                    <span className="om-muted">{o.word ? `${o.word}${o.price ? ' ' + money(o.price) : ''} · ` : ''}{v.length} {v.length === 1 ? 'record' : 'records'} · {platformName(first.source_platform)} · {day(first.observed_at)}</span>
                  </span>
                </button>
                {isOpen && <div className="om-records">
                  <a href={`/vehicle/${first.vehicles.id}`} className="om-link">Open the vehicle</a>
                  {v.map((r) => <div key={r.id} className="om-record"><span>{day(r.observed_at)} · {r.source_type ?? 'record'} · {platformName(r.source_platform)}{r.postal_code ? ` · ${r.postal_code}` : ''}</span>{r.source_url && <a href={r.source_url} target="_blank" rel="noreferrer" className="om-link">source</a>}</div>)}
                </div>}
              </div>
            );
          })}
          {rows && !shown.length && <div className="om-muted">No records here{pick.platform || pick.make ? ' for that pick' : ''}.</div>}
        </div>
      )}

      {showInfo && (
        <div className="om-sheet" role="dialog">
          <div className="om-row om-between"><h2>What this map shows</h2><button type="button" className="om-link" onClick={() => setShowInfo(false)}>Done</button></div>
          <p>Each ZIP is shaded by the count of the chosen kind of record in the window: vehicles (each once, at its newest observation), listings (each vehicle once, on the day first seen listed), sales (sold events), shops. The bands are fixed: 1–4, 5–19, 20–99, 100 or more.</p>
          <p>A location is where a vehicle was sold or offered from, usually the seller's place. Sold vehicles usually leave. This is the seller ledger of an area, not the vehicles present in it.</p>
          <p>Records that carry no ZIP count in their county or state and are shown there. ZIP areas are Census 2020 ZIP Code Tabulation Areas; some postal ZIPs have no area, and ZIPs cross county lines.</p>
          <p>Counts come from a fold refreshed every 10 minutes (last 3 days) and nightly (the year). Every vehicle shown is a public record and opens to its page and its sources.</p>
        </div>
      )}
    </div>
  );
}
