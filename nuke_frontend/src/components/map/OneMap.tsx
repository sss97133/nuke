import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MLMap, NavigationControl, type ExpressionSpecification, type GeoJSONSource, type MapGeoJSONFeature, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './one-map.css';
import './maplibreWorker';
import { CARTO_DARK, MAP_FONT } from './constants';
import {
  BOUNDARY_TILES, readArea, readAreas, readLayers, readPoints, window as dayWindow,
  type AreaResponse, type AreasResponse, type Level, type MapLayerDef,
} from './oneMapService';

/**
 * The one map (docs/proposals/2026-10-19-one-map.md): one surface for every map-oriented number. Zoom sets the level
 * (state, county, ZIP, then points); a layer picker says what is counted; the window and source filter it; an area
 * click shows that place's activity across every layer. Boundaries are static tiles from storage; every count is a
 * map_facts row read through map-vehicles, never counted here.
 */

const LEVEL_BY_ZOOM = (z: number): Level | 'point' => (z < 5 ? 'state' : z < 8 ? 'county' : z < 11 ? 'zcta' : 'point');
const SOURCE_LAYER: Record<Level, string> = { state: 'states', county: 'counties', zcta: 'zctas' };
const KEY_PROP: Record<Level, string> = { state: 'fips', county: 'fips', zcta: 'zcta' };
const LEVEL_WORD: Record<Level | 'point', string> = { state: 'STATE', county: 'COUNTY', zcta: 'ZIP', point: 'POINT' };
const NO_KEY_WORD: Record<Level, string> = { state: 'no state', county: 'no county', zcta: 'no ZIP' };
const DAY_CHOICES = [1, 7, 30, 90, 365];
/** The palette lives in one-map.css; MapLibre paint needs the resolved values. */
function palette(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return { ramp: [0, 1, 2, 3, 4].map((i) => v(`--om-ramp-${i}`)), line: v('--om-line'), accent: v('--om-accent'), bg: v('--om-bg') };
}

const fmt = (n: number) => n.toLocaleString('en-US');
const money = (n: number | null | undefined) => (n == null ? '' : `$${Math.round(n).toLocaleString('en-US')}`);

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const days = Number(p.get('days'));
  return {
    layer: p.get('layer') ?? 'listing',
    days: DAY_CHOICES.includes(days) ? days : 30,
    source: p.get('source') ?? '',
    lng: Number(p.get('lng')) || -98, lat: Number(p.get('lat')) || 39, zoom: Number(p.get('z')) || 4.2,
  };
}

function breaks(values: number[]): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [1, 2, 3, 4];
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return [q(0.2), q(0.4), q(0.6), q(0.8)];
}

export default function OneMap() {
  const init = useMemo(readUrl, []);
  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<MapLayerDef[]>([]);
  const [layer, setLayer] = useState(init.layer);
  const [days, setDays] = useState(init.days);
  const [source, setSource] = useState(init.source);
  const [zoom, setZoom] = useState(init.zoom);
  const [ready, setReady] = useState(false);
  const [areas, setAreas] = useState<AreasResponse | null>(null);
  const [hover, setHover] = useState<{ key: string; name: string } | null>(null);
  const [picked, setPicked] = useState<{ key: string; name: string; level: Level } | null>(null);
  const [pickedData, setPickedData] = useState<AreaResponse | null>(null);
  const [pointPanel, setPointPanel] = useState<Record<string, unknown> | null>(null);
  const [pointCount, setPointCount] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const level = LEVEL_BY_ZOOM(zoom);
  const win = useMemo(() => dayWindow(days), [days]);
  const countsRef = useRef<Map<string, number>>(new Map());

  // URL state: layer, window, source, view.
  useEffect(() => {
    const m = mapRef.current;
    const url = new URL(window.location.href);
    url.searchParams.set('layer', layer); url.searchParams.set('days', String(days));
    if (source) url.searchParams.set('source', source); else url.searchParams.delete('source');
    if (m) { const c = m.getCenter(); url.searchParams.set('lng', c.lng.toFixed(3)); url.searchParams.set('lat', c.lat.toFixed(3)); url.searchParams.set('z', m.getZoom().toFixed(2)); }
    window.history.replaceState(null, '', url);
  }, [layer, days, source, zoom]);

  useEffect(() => { readLayers().then(setLayers).catch((e) => setError(String(e.message ?? e))); }, []);

  // The map: a dark basemap, our boundary tiles, one fill per level, outlines, and a point layer.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const pal = palette(containerRef.current);
    const map = new MLMap({
      container: containerRef.current, style: CARTO_DARK, center: [init.lng, init.lat], zoom: init.zoom,
      minZoom: 2, maxZoom: 16, attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.addSource('bounds', { type: 'vector', tiles: [BOUNDARY_TILES], minzoom: 0, maxzoom: 9,
        attribution: 'Boundaries: U.S. Census Bureau 2020' });
      map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const color = ['case', ['!=', ['feature-state', 'entities'], null],
        ['step', ['feature-state', 'entities'], pal.ramp[0], 1, pal.ramp[1], 2, pal.ramp[2], 3, pal.ramp[3], 4, pal.ramp[4]], 'transparent'] as unknown as ExpressionSpecification;
      for (const lv of ['state', 'county', 'zcta'] as Level[]) {
        map.addLayer({ id: `${lv}-fill`, type: 'fill', source: 'bounds', 'source-layer': SOURCE_LAYER[lv],
          paint: { 'fill-color': color, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0.55] }, layout: { visibility: 'none' } });
        map.addLayer({ id: `${lv}-line`, type: 'line', source: 'bounds', 'source-layer': SOURCE_LAYER[lv],
          paint: { 'line-color': pal.line, 'line-width': lv === 'state' ? 1 : 0.5, 'line-opacity': 0.5 }, layout: { visibility: 'none' } });
      }
      map.addLayer({ id: 'points-circle', type: 'circle', source: 'points',
        paint: { 'circle-radius': ['case', ['has', 'count'], ['min', 24, ['+', 6, ['*', 2, ['sqrt', ['get', 'count']]]]], 5],
          'circle-color': pal.accent, 'circle-stroke-color': pal.bg, 'circle-stroke-width': 1, 'circle-opacity': 0.9 } });
      setZoom(map.getZoom());
      setReady(true);
    });
    map.on('moveend', () => setZoom(map.getZoom()));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [init.lat, init.lng, init.zoom]);

  // Paint the current level's counts as feature state with quantile steps.
  const paint = useCallback((data: AreasResponse | null, lv: Level) => {
    const map = mapRef.current;
    if (!map || !map.getSource('bounds')) return;
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

  // Which level is drawn follows the zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getLayer('state-fill')) return;
    for (const lv of ['state', 'county', 'zcta'] as Level[]) {
      const on = lv === level ? 'visible' : 'none';
      map.setLayoutProperty(`${lv}-fill`, 'visibility', on);
      map.setLayoutProperty(`${lv}-line`, 'visibility', on);
    }
    map.setLayoutProperty('points-circle', 'visibility', level === 'point' ? 'visible' : 'none');
  }, [ready, level, zoom]);

  // The numbers for the level in view.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ctl = new AbortController();
    if (level === 'point') {
      const b = map.getBounds();
      setStatus('POINTS…');
      readPoints({ bbox: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`, zoom: Math.round(zoom), from: win.from, to: win.to, source: source || undefined }, ctl.signal)
        .then((fc) => { (map.getSource('points') as GeoJSONSource | undefined)?.setData(fc as never); setPointCount(fc.features.length); setStatus(''); })
        .catch((e) => { if (e.name !== 'AbortError') setError(String(e.message ?? e)); });
      return () => ctl.abort();
    }
    let keys: string[] | undefined;
    if (level === 'zcta') {
      if (!map.getLayer('zcta-fill')) return;
      keys = [...new Set(map.queryRenderedFeatures({ layers: ['zcta-fill'] }).map((f) => String(f.properties?.zcta)))].slice(0, 2000);
      if (!keys.length) { setAreas(null); paint(null, level); return; }
    }
    setStatus('COUNTING…');
    readAreas({ level, layer, from: win.from, to: win.to, source: source || undefined, keys }, ctl.signal)
      .then((r) => { setAreas(r); paint(r, level); setStatus(''); setError(''); })
      .catch((e) => { if (e.name !== 'AbortError') { setError(String(e.message ?? e)); setStatus(''); } });
    return () => ctl.abort();
  }, [ready, level, layer, win.from, win.to, source, zoom, paint]);

  // Hover and click on areas and points.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let hovered: { id: number; lv: Level } | null = null;
    const nameOf = (f: MapGeoJSONFeature, lv: Level) => (lv === 'zcta' ? `ZIP ${f.properties.zcta}` : lv === 'state' ? String(f.properties.name) : `${f.properties.name} County`);
    const onMove = (e: MapMouseEvent) => {
      if (level === 'point') return;
      const f = map.queryRenderedFeatures(e.point, { layers: [`${level}-fill`] })[0];
      if (hovered) map.setFeatureState({ source: 'bounds', sourceLayer: SOURCE_LAYER[hovered.lv], id: hovered.id }, { hover: false });
      hovered = null;
      if (!f || f.id == null) { setHover(null); map.getCanvas().style.cursor = ''; return; }
      hovered = { id: Number(f.id), lv: level };
      map.setFeatureState({ source: 'bounds', sourceLayer: SOURCE_LAYER[level], id: Number(f.id) }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
      setHover({ key: String(f.properties[KEY_PROP[level]]), name: nameOf(f, level) });
    };
    const onClick = (e: MapMouseEvent) => {
      if (level === 'point') {
        const p = map.queryRenderedFeatures(e.point, { layers: ['points-circle'] })[0];
        setPointPanel(p ? (p.properties as Record<string, unknown>) : null);
        return;
      }
      const f = map.queryRenderedFeatures(e.point, { layers: [`${level}-fill`] })[0];
      if (!f) { setPicked(null); setPickedData(null); return; }
      setPicked({ key: String(f.properties[KEY_PROP[level]]), name: nameOf(f, level), level });
    };
    map.on('mousemove', onMove); map.on('click', onClick);
    return () => { map.off('mousemove', onMove); map.off('click', onClick); };
  }, [ready, level]);

  useEffect(() => {
    if (!picked) return;
    const ctl = new AbortController();
    readArea({ level: picked.level, key: picked.key, from: win.from, to: win.to }, ctl.signal).then(setPickedData).catch((e) => { if (e.name !== 'AbortError') setError(String(e.message ?? e)); });
    return () => ctl.abort();
  }, [picked, win.from, win.to]);

  const def = layers.find((l) => l.layer === layer);
  const hoverCount = hover ? countsRef.current.get(hover.key) : undefined;
  const noun = def ? (def.entity === 'image' ? 'photos' : def.entity === 'organization' ? 'organizations' : `${layer}s`) : layer;
  const headline = areas
    ? `${fmt(areas.totals.entities)} ${noun.toUpperCase()}${layer === 'organization' ? ' TODAY' : ` IN ${days === 1 ? '24 HOURS' : `${days} DAYS`}`}`
    : level === 'point' ? `${pointCount == null ? '' : fmt(pointCount) + ' '}POINTS IN VIEW` : '';

  const label: React.CSSProperties = { fontFamily: MAP_FONT, fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--om-muted)' };
  const panel: React.CSSProperties = { position: 'absolute', zIndex: 5, background: 'var(--om-panel)', border: '2px solid var(--om-line)', color: 'var(--om-text)', fontFamily: MAP_FONT, padding: 10 };
  const btn = (on: boolean): React.CSSProperties => ({ ...label, color: on ? 'var(--om-bg)' : 'var(--om-text-dim)', background: on ? 'var(--om-accent)' : 'transparent', border: '2px solid ' + (on ? 'var(--om-accent)' : 'var(--om-border-dim)'), padding: '3px 6px', cursor: 'pointer', marginRight: 4, marginBottom: 4 });

  return (
    <div className="one-map" style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--om-bg)' }} data-testid="one-map">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      <div style={{ ...panel, top: 12, left: 12, width: 300 }}>
        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, minHeight: 26 }} data-testid="headline">{headline || (error ? 'NO ANSWER' : status || '…')}</div>
        <div style={{ ...label, marginTop: 4 }}>
          {['state', 'county', 'zcta', 'point'].map((lv) => (
            <span key={lv} style={{ marginRight: 8, color: lv === level ? 'var(--om-accent)' : 'var(--om-quiet)', fontWeight: lv === level ? 700 : 400 }}>{LEVEL_WORD[lv as Level | 'point']}</span>
          ))}
          <span style={{ color: 'var(--om-quiet)' }}>· zoom sets the level</span>
        </div>
        {areas && (
          <div style={{ ...label, marginTop: 6, color: 'var(--om-text-dim)' }}>
            {fmt(areas.totals.areas)} {level === 'zcta' ? 'ZIPS IN VIEW' : level === 'state' ? 'STATES' : 'COUNTIES'} ·{' '}
            {fmt(areas.unkeyed.entities)} {NO_KEY_WORD[level as Level]}{areas.undated.entities ? ` · ${fmt(areas.undated.entities)} undated` : ''}
            {areas.totals.value > 0 && def?.value_basis ? ` · ${money(areas.totals.value)} ${def.value_basis}` : ''}
            {areas.as_of ? ` · as of ${new Date(areas.as_of).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <div style={label}>LAYER</div>
          {layers.map((l) => (
            <button key={l.layer} type="button" style={btn(l.layer === layer)} title={l.rule} onClick={() => { setLayer(l.layer); setPicked(null); setPickedData(null); }}>{l.layer}</button>
          ))}
        </div>
        {layer !== 'organization' && (
          <div style={{ marginTop: 6 }}>
            <div style={label}>WINDOW</div>
            {DAY_CHOICES.map((d) => <button key={d} type="button" style={btn(d === days)} onClick={() => setDays(d)}>{d === 1 ? '24H' : `${d}D`}</button>)}
          </div>
        )}
        {areas && areas.by_source.length > 1 && (
          <div style={{ marginTop: 6 }}>
            <div style={label}>SOURCE</div>
            <button type="button" style={btn(!source)} onClick={() => setSource('')}>all</button>
            {areas.by_source.slice(0, 8).map((s) => <button key={s.source} type="button" style={btn(s.source === source)} onClick={() => setSource(s.source)}>{s.source} {fmt(s.entities)}</button>)}
          </div>
        )}
        {def && <div style={{ ...label, marginTop: 8, color: 'var(--om-faint)', textTransform: 'none', letterSpacing: 0, fontSize: 9 }} title={def.rule}>
          One {def.entity} counts once, on its {def.clock.split(',')[0]}.{def.value_basis ? ` Value: ${def.value_basis}.` : ''}
        </div>}
        {error && <div style={{ ...label, marginTop: 6, color: 'var(--om-danger)', textTransform: 'none' }}>{error}</div>}
      </div>

      {hover && level !== 'point' && (
        <div style={{ ...panel, top: 12, right: 12, padding: '6px 10px', pointerEvents: 'none' }} data-testid="hover">
          <div style={{ ...label, color: 'var(--om-text)' }}>{hover.name}</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{hoverCount == null ? '0' : fmt(hoverCount)} <span style={{ fontSize: 9 }}>{noun.toUpperCase()}</span></div>
        </div>
      )}

      {picked && (
        <div style={{ ...panel, bottom: 12, left: 12, width: 300 }} data-testid="area-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{picked.name}</div>
            <button type="button" style={btn(false)} onClick={() => { setPicked(null); setPickedData(null); }}>close</button>
          </div>
          <div style={{ ...label, marginBottom: 6 }}>{LEVEL_WORD[picked.level]} {picked.key} · last {days} days</div>
          {pickedData ? pickedData.layers.map((r) => (
            <div key={r.layer} style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--om-rule)', padding: '3px 0' }}>
              <span style={{ ...label, color: 'var(--om-text-dim)' }}>{r.layer}</span>
              <span style={{ fontSize: 12 }}>{fmt(r.entities)}{r.avg != null ? <span style={{ color: 'var(--om-muted)' }}> · avg {money(r.avg)}</span> : null}</span>
            </div>
          )) : <div style={label}>…</div>}
        </div>
      )}

      {pointPanel && level === 'point' && (
        <div style={{ ...panel, bottom: 12, left: 12, width: 300 }} data-testid="point-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {'count' in pointPanel ? `${fmt(Number(pointPanel.count))} vehicles here` : [pointPanel.year, pointPanel.make, pointPanel.model].filter(Boolean).join(' ') || 'vehicle'}
            </div>
            <button type="button" style={btn(false)} onClick={() => setPointPanel(null)}>close</button>
          </div>
          {!('count' in pointPanel) && (
            <div style={{ ...label, color: 'var(--om-text-dim)', marginTop: 4 }}>
              {String(pointPanel.event_label ?? pointPanel.event_type ?? '')} · {String(pointPanel.source ?? '')} · {String(pointPanel.observed_at ?? '').slice(0, 10)}
              {pointPanel.price ? ` · ${money(Number(pointPanel.price))}` : ''}
              {pointPanel.vehicle_id ? <> · <a href={`/vehicle/${pointPanel.vehicle_id}`} style={{ color: 'var(--om-accent)' }}>open</a></> : null}
              {pointPanel.source_url ? <> · <a href={String(pointPanel.source_url)} target="_blank" rel="noreferrer" style={{ color: 'var(--om-accent)' }}>listing</a></> : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
