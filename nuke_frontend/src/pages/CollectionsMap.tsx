import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import * as topojson from 'topojson-client';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';

// ── Types ────────────────────────────────────────────────────────────────────

interface Collection {
  id: string;
  slug: string;
  name: string;
  instagram: string | null;
  country: string;
  city: string;
  state: string | null;
  lat: number;
  lng: number;
  total_inventory: number;
  logo_url: string | null;
}

type DrillLevel = 'world' | 'country' | 'state' | 'county' | 'markers';

interface DrillState {
  level: DrillLevel;
  country?: string;
  stateId?: string;
  stateName?: string;
  countyId?: string;
  countyName?: string;
  city?: string;
}

interface Agg { count: number; inventory: number; }

interface SidebarItem {
  key: string;
  label: string;
  count: number;
  inventory: number;
  onClick: () => void;
  active?: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const OUR_TO_TOPO: Record<string, string> = {
  'USA': 'United States of America', 'UK': 'United Kingdom', 'UAE': 'United Arab Emirates',
};
const TOPO_TO_OURS: Record<string, string> = {};
Object.entries(OUR_TO_TOPO).forEach(([k, v]) => { TOPO_TO_OURS[v] = k; });
const toOurName = (n: string) => TOPO_TO_OURS[n] || n;
const toTopoName = (n: string) => OUR_TO_TOPO[n] || n;

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'USA': [39.8283, -98.5795], 'UK': [55.3781, -3.436], 'Italy': [41.8719, 12.5674],
  'Germany': [51.1657, 10.4515], 'France': [46.2276, 2.2137], 'Monaco': [43.7384, 7.4246],
  'Switzerland': [46.8182, 8.2275], 'Japan': [36.2048, 138.2529], 'UAE': [23.4241, 53.8478],
  'Qatar': [25.3548, 51.1839], 'South Korea': [35.9078, 127.7669], 'Taiwan': [23.6978, 120.9605],
  'Australia': [-25.2744, 133.7751], 'Canada': [56.1304, -106.3468], 'Singapore': [1.3521, 103.8198],
  'Belgium': [50.5039, 4.4699], 'Poland': [51.9194, 19.1451], 'Denmark': [56.2639, 9.5018],
  'Chile': [-35.6751, -71.543], 'Turkey': [38.9637, 35.2433], 'Austria': [47.5162, 14.5501],
  'Norway': [60.472, 8.4689], 'Netherlands': [52.1326, 5.2913], 'New Zealand': [-40.9006, 174.886],
  'Czechia': [49.8175, 15.473], 'Morocco': [31.7917, -7.0926], 'China': [35.8617, 104.1954],
  'Brazil': [-14.235, -51.9253], 'Thailand': [15.87, 100.9925], 'Mexico': [23.6345, -102.5528],
  'India': [20.5937, 78.9629], 'Hong Kong': [22.3193, 114.1694], 'Israel': [31.0461, 34.8516],
  'Portugal': [39.3999, -8.2245], 'Malaysia': [4.2105, 101.9758], 'Saudi Arabia': [23.8859, 45.0792],
  'Oman': [21.4735, 55.9754], 'Lebanon': [33.8547, 35.8623], 'Slovakia': [48.669, 19.699],
  'Dominican Republic': [18.7357, -70.1627], 'Kazakhstan': [48.0196, 66.9237],
};

// ── Color scale ──────────────────────────────────────────────────────────────

const COLOR_STOPS = [
  [0, 15, 23, 42],      // bg (invisible)
  [0.01, 30, 58, 138],  // dark blue
  [0.25, 37, 99, 235],  // blue-600
  [0.5, 56, 189, 248],  // sky-400
  [0.75, 45, 212, 191], // teal-400
  [1.0, 52, 211, 153],  // emerald-400
] as const;

function choroplethColor(value: number, maxValue: number): string {
  if (!value || !maxValue) return 'rgba(15, 23, 42, 0.12)';
  const t = Math.pow(Math.min(value / maxValue, 1), 0.6); // power curve for spread
  // Find stops
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    if (t <= COLOR_STOPS[i][0]) {
      const prev = COLOR_STOPS[i - 1], next = COLOR_STOPS[i];
      const f = (t - prev[0]) / (next[0] - prev[0]);
      return `rgb(${Math.round(prev[1] + f * (next[1] - prev[1]))},${Math.round(prev[2] + f * (next[2] - prev[2]))},${Math.round(prev[3] + f * (next[3] - prev[3]))})`;
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  return `rgb(${last[1]},${last[2]},${last[3]})`;
}

function choroplethGradientCSS(): string {
  return COLOR_STOPS.slice(1).map(s => `rgb(${s[1]},${s[2]},${s[3]}) ${Math.round(s[0] * 100)}%`).join(', ');
}

const MARKER_ICON = L.divIcon({
  className: '',
  html: `<div style="background:#38bdf8;width:16px;height:16px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px rgba(56,189,248,0.6),0 2px 4px rgba(0,0,0,.4);animation:pulse 2s infinite"></div>`,
  iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8],
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function aggregateBy(collections: Collection[], keyFn: (c: Collection) => string | undefined): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const c of collections) {
    const key = keyFn(c);
    if (!key) continue;
    const prev = m.get(key) || { count: 0, inventory: 0 };
    prev.count++;
    prev.inventory += c.total_inventory;
    m.set(key, prev);
  }
  return m;
}

function maxAgg(agg: Map<string, Agg>, metric: 'count' | 'inventory'): number {
  let mx = 0;
  for (const v of agg.values()) mx = Math.max(mx, v[metric]);
  return mx;
}

function assignPIP(collections: Collection[], geo: FeatureCollection, filterFn?: (f: Feature) => boolean): Map<string, string> {
  const m = new Map<string, string>();
  const feats = filterFn ? geo.features.filter(filterFn) : geo.features;
  for (const c of collections) {
    const pt = point([c.lng, c.lat]);
    for (const f of feats) {
      try { if (booleanPointInPolygon(pt, f as any)) { m.set(c.id, f.id as string); break; } } catch {}
    }
  }
  return m;
}

function nameMap(geo: FeatureCollection | null): Map<string, string> {
  const m = new Map<string, string>();
  geo?.features.forEach(f => m.set(f.id as string, f.properties?.name || ''));
  return m;
}

function drillToParams(d: DrillState): Record<string, string> {
  const p: Record<string, string> = { level: d.level };
  if (d.country) p.country = d.country;
  if (d.stateId) p.stateId = d.stateId;
  if (d.stateName) p.stateName = d.stateName;
  if (d.countyId) p.countyId = d.countyId;
  if (d.countyName) p.countyName = d.countyName;
  if (d.city) p.city = d.city;
  return p;
}

function paramsToDrill(p: URLSearchParams): DrillState {
  const level = (p.get('level') || 'world') as DrillLevel;
  return {
    level,
    country: p.get('country') || undefined,
    stateId: p.get('stateId') || undefined,
    stateName: p.get('stateName') || undefined,
    countyId: p.get('countyId') || undefined,
    countyName: p.get('countyName') || undefined,
    city: p.get('city') || undefined,
  };
}

// ── MapLayers ────────────────────────────────────────────────────────────────

function MapLayers({
  collections, drill, setDrill, metric, searchTerm,
  worldGeo, statesGeo, countiesGeo, stateAssign, countyAssign,
}: {
  collections: Collection[];
  drill: DrillState;
  setDrill: (d: DrillState) => void;
  metric: 'count' | 'inventory';
  searchTerm: string;
  worldGeo: FeatureCollection | null;
  statesGeo: FeatureCollection | null;
  countiesGeo: FeatureCollection | null;
  stateAssign: Map<string, string>;
  countyAssign: Map<string, string>;
}) {
  const map = useMap();

  const filtered = useMemo(() => {
    if (!searchTerm) return collections;
    const t = searchTerm.toLowerCase();
    return collections.filter(c =>
      c.name.toLowerCase().includes(t) || c.slug.toLowerCase().includes(t) ||
      c.city.toLowerCase().includes(t) || (c.instagram?.toLowerCase().includes(t))
    );
  }, [collections, searchTerm]);

  // ── Fly-to ──
  useEffect(() => {
    switch (drill.level) {
      case 'world': map.flyTo([20, 0], 2, { duration: 0.8 }); break;
      case 'country': {
        const c = COUNTRY_COORDS[drill.country!];
        if (c) map.flyTo(c, drill.country === 'USA' ? 4 : 5, { duration: 0.8 });
        break;
      }
      case 'state':
        if (statesGeo && drill.stateId) {
          const f = statesGeo.features.find(ft => ft.id === drill.stateId);
          if (f) map.fitBounds(L.geoJSON(f as any).getBounds(), { padding: [30, 30], animate: true });
        }
        break;
      case 'county':
        if (countiesGeo && drill.countyId) {
          const f = countiesGeo.features.find(ft => ft.id === drill.countyId);
          if (f) map.fitBounds(L.geoJSON(f as any).getBounds(), { padding: [40, 40], animate: true });
        }
        break;
      case 'markers': {
        const mc = drill.city
          ? filtered.filter(c => c.city === drill.city && c.country === drill.country)
          : drill.countyId ? filtered.filter(c => countyAssign.get(c.id) === drill.countyId) : [];
        if (mc.length) map.fitBounds(L.latLngBounds(mc.map(c => [c.lat, c.lng] as L.LatLngTuple)).pad(0.5), { animate: true });
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill]);

  // ── Aggregations ──
  const countryAgg = useMemo(() => aggregateBy(filtered, c => toTopoName(c.country)), [filtered]);
  const stateAgg = useMemo(() => aggregateBy(filtered.filter(c => c.country === 'USA'), c => stateAssign.get(c.id)), [filtered, stateAssign]);
  const countyAgg = useMemo(() => {
    if (!drill.stateId) return new Map<string, Agg>();
    return aggregateBy(filtered.filter(c => stateAssign.get(c.id) === drill.stateId), c => countyAssign.get(c.id));
  }, [filtered, drill.stateId, stateAssign, countyAssign]);

  const stateCountiesGeo = useMemo<FeatureCollection | null>(() => {
    if (!countiesGeo || !drill.stateId) return null;
    return { type: 'FeatureCollection', features: countiesGeo.features.filter(f => (f.id as string).startsWith(drill.stateId!)) };
  }, [countiesGeo, drill.stateId]);

  // City groups
  const cityGroups = useMemo(() => {
    let scope: Collection[];
    if (drill.level === 'country' && drill.country && drill.country !== 'USA')
      scope = filtered.filter(c => c.country === drill.country);
    else if (drill.level === 'county' && drill.countyId)
      scope = filtered.filter(c => countyAssign.get(c.id) === drill.countyId);
    else return [];
    const g = new Map<string, { lat: number; lng: number; count: number; inventory: number; items: Collection[] }>();
    for (const c of scope) {
      const k = c.city || 'Unknown';
      const v = g.get(k) || { lat: 0, lng: 0, count: 0, inventory: 0, items: [] };
      v.items.push(c); v.count++; v.inventory += c.total_inventory; v.lat += c.lat; v.lng += c.lng;
      g.set(k, v);
    }
    for (const v of g.values()) { v.lat /= v.count; v.lng /= v.count; }
    return Array.from(g.entries()).map(([city, v]) => ({ city, ...v }));
  }, [filtered, drill, countyAssign]);

  const markerCollections = useMemo(() => {
    if (drill.level === 'county') return filtered.filter(c => countyAssign.get(c.id) === drill.countyId);
    if (drill.level === 'markers') {
      if (drill.city) return filtered.filter(c => c.city === drill.city && c.country === drill.country);
      if (drill.countyId) return filtered.filter(c => countyAssign.get(c.id) === drill.countyId);
    }
    return [];
  }, [filtered, drill, countyAssign]);

  // ── Feature handlers ──
  const makeOnEach = useCallback((agg: Map<string, Agg>, idKey: 'name' | 'id', onClick: (id: string, name: string) => void) => {
    return (feature: Feature<Geometry>, layer: L.Layer) => {
      const id = idKey === 'id' ? (feature.id as string) : (feature.properties?.name || '');
      const name = feature.properties?.name || id;
      const d = agg.get(id) || { count: 0, inventory: 0 };
      (layer as L.Path).bindTooltip(
        `<div style="min-width:120px"><strong style="font-size:13px">${name}</strong><div style="margin-top:3px;display:flex;gap:12px"><span>${d.count} <span style="opacity:.7">collections</span></span><span>${d.inventory} <span style="opacity:.7">vehicles</span></span></div>${d.count > 0 ? '<div style="margin-top:4px;font-size:10px;opacity:.6">Click to explore</div>' : ''}</div>`,
        { sticky: true, direction: 'top', className: 'map-tooltip' }
      );
      (layer as L.Path).on({
        mouseover: (e) => {
          e.target.setStyle({ weight: 2, fillOpacity: 0.85, color: '#38bdf8' });
          e.target.bringToFront();
        },
        mouseout: (e) => {
          e.target.setStyle({ weight: 0.5, fillOpacity: 0.55, color: '#334155' });
        },
        click: () => onClick(id, name),
      });
    };
  }, []);

  const renderMarkers = (colls: Collection[]) => (
    <>
      {colls.map(c => (
        <Marker key={c.id} position={[c.lat, c.lng]} icon={MARKER_ICON}>
          <Popup maxWidth={280}>
            <div className="min-w-[240px]">
              <div className="flex items-start gap-3">
                {c.logo_url && <img src={c.logo_url} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />}
                <div>
                  <h3 className="font-bold text-base leading-tight">{c.name}</h3>
                  <p className="text-gray-500 text-sm">{c.city}, {c.country}</p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-sm">
                {c.total_inventory > 0 && <span className="text-blue-600 font-semibold">{c.total_inventory} vehicles</span>}
                {c.instagram && (
                  <a href={`https://instagram.com/${c.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                    className="text-pink-500 hover:text-pink-600">@{c.instagram}</a>
                )}
              </div>
              <Link to={`/org/${c.slug}`}
                className="mt-2 block text-center px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors">
                View Collection
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );

  // ── Render layers ──

  if (drill.level === 'world' && worldGeo) {
    const mx = maxAgg(countryAgg, metric);
    return <GeoJSON key={`w-${metric}-${searchTerm}`} data={worldGeo}
      style={f => ({ fillColor: choroplethColor((countryAgg.get(f?.properties?.name || '') || { count: 0, inventory: 0 })[metric], mx), fillOpacity: 0.55, color: '#334155', weight: 0.5 })}
      onEachFeature={makeOnEach(countryAgg, 'name', n => setDrill({ level: 'country', country: toOurName(n) }))} />;
  }

  if (drill.level === 'country' && drill.country === 'USA' && statesGeo) {
    const mx = maxAgg(stateAgg, metric);
    return <GeoJSON key={`s-${metric}-${searchTerm}`} data={statesGeo}
      style={f => ({ fillColor: choroplethColor((stateAgg.get(f?.id as string) || { count: 0, inventory: 0 })[metric], mx), fillOpacity: 0.55, color: '#334155', weight: 0.5 })}
      onEachFeature={makeOnEach(stateAgg, 'id', (id, name) => setDrill({ level: 'state', country: 'USA', stateId: id, stateName: name }))} />;
  }

  if (drill.level === 'country' && drill.country !== 'USA' && cityGroups.length > 0) {
    const mx = Math.max(...cityGroups.map(g => g[metric === 'count' ? 'count' : 'inventory']), 1);
    return <>
      {cityGroups.map(g => (
        <CircleMarker key={g.city} center={[g.lat, g.lng]}
          radius={Math.max(10, Math.min(35, 10 + Math.sqrt(g.count) * 10))}
          pathOptions={{ color: '#38bdf8', fillColor: choroplethColor(g[metric === 'count' ? 'count' : 'inventory'], mx), fillOpacity: 0.75, weight: 2 }}
          eventHandlers={{ click: () => setDrill({ level: 'markers', country: drill.country, city: g.city }) }}>
          <Tooltip direction="top" className="map-tooltip">
            <strong>{g.city}</strong><br />{g.count} collections / {g.inventory} vehicles
          </Tooltip>
        </CircleMarker>
      ))}
    </>;
  }

  if (drill.level === 'state' && stateCountiesGeo) {
    const mx = maxAgg(countyAgg, metric);
    return <GeoJSON key={`c-${drill.stateId}-${metric}-${searchTerm}`} data={stateCountiesGeo}
      style={f => ({ fillColor: choroplethColor((countyAgg.get(f?.id as string) || { count: 0, inventory: 0 })[metric], mx), fillOpacity: 0.55, color: '#334155', weight: 0.5 })}
      onEachFeature={makeOnEach(countyAgg, 'id', (id, name) => setDrill({ level: 'county', country: 'USA', stateId: drill.stateId, stateName: drill.stateName, countyId: id, countyName: name }))} />;
  }

  if ((drill.level === 'county' || drill.level === 'markers') && markerCollections.length > 0)
    return renderMarkers(markerCollections);

  return null;
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const MAP_STYLES = `
  .map-tooltip { background: #0f172a !important; color: #e2e8f0 !important; border: 1px solid #1e3a5f !important; border-radius: 8px !important; padding: 8px 12px !important; font-size: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,.5) !important; backdrop-filter: blur(8px); }
  .map-tooltip::before { border-top-color: #1e3a5f !important; }
  .leaflet-popup-content-wrapper { border-radius: 12px !important; }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 8px rgba(56,189,248,0.6),0 2px 4px rgba(0,0,0,.4); } 50% { box-shadow: 0 0 16px rgba(56,189,248,0.9),0 2px 8px rgba(0,0,0,.4); } }
`;

// ── Main Component ───────────────────────────────────────────────────────────

export default function CollectionsMap() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<'count' | 'inventory'>('count');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'inventory' | 'city'>('name');
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // URL-synced drill state
  const drill = useMemo(() => paramsToDrill(searchParams), [searchParams]);
  const setDrill = useCallback((d: DrillState) => {
    setSearchParams(drillToParams(d), { replace: false });
  }, [setSearchParams]);

  // ── Data loading ──

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('id, business_name, slug, latitude, longitude, city, state, country, social_links, total_inventory, logo_url')
          .eq('business_type', 'collection')
          .not('latitude', 'is', null).not('longitude', 'is', null);
        if (error) throw error;
        setCollections((data || []).map((b: any) => ({
          id: b.id, slug: b.slug || b.id, name: b.business_name,
          instagram: b.social_links?.instagram || null,
          country: b.country || 'Unknown', city: b.city || '', state: b.state || null,
          lat: Number(b.latitude), lng: Number(b.longitude),
          total_inventory: b.total_inventory || 0, logo_url: b.logo_url || null,
        })));
      } catch { setCollections(SAMPLE); }
      finally { setLoading(false); }
    })();
  }, []);

  // ── TopoJSON loading (lifted to main) ──

  const [worldTopo, setWorldTopo] = useState<Topology | null>(null);
  const [statesTopo, setStatesTopo] = useState<Topology | null>(null);
  const [countiesTopo, setCountiesTopo] = useState<Topology | null>(null);

  useEffect(() => { fetch('/data/world-110m.json').then(r => r.json()).then(setWorldTopo); }, []);
  useEffect(() => { if (drill.country === 'USA' && !statesTopo) fetch('/data/us-states-10m.json').then(r => r.json()).then(setStatesTopo); }, [drill.country, statesTopo]);
  useEffect(() => { if (drill.level === 'state' && !countiesTopo) fetch('/data/us-counties-10m.json').then(r => r.json()).then(setCountiesTopo); }, [drill.level, countiesTopo]);

  const worldGeo = useMemo<FeatureCollection | null>(() => worldTopo ? topojson.feature(worldTopo, worldTopo.objects.countries) as any : null, [worldTopo]);
  const statesGeo = useMemo<FeatureCollection | null>(() => statesTopo ? topojson.feature(statesTopo, statesTopo.objects.states) as any : null, [statesTopo]);
  const countiesGeo = useMemo<FeatureCollection | null>(() => countiesTopo ? topojson.feature(countiesTopo, countiesTopo.objects.counties) as any : null, [countiesTopo]);

  // ── Point-in-polygon assignments ──

  const stateAssign = useMemo(() => {
    if (!statesGeo) return new Map<string, string>();
    return assignPIP(collections.filter(c => c.country === 'USA'), statesGeo);
  }, [collections, statesGeo]);

  const countyAssign = useMemo(() => {
    if (!countiesGeo || !stateAssign.size) return new Map<string, string>();
    const usColls = collections.filter(c => c.country === 'USA');
    const m = new Map<string, string>();
    for (const c of usColls) {
      const sid = stateAssign.get(c.id);
      if (!sid) continue;
      const pt = point([c.lng, c.lat]);
      for (const f of countiesGeo.features) {
        if (!(f.id as string).startsWith(sid)) continue;
        try { if (booleanPointInPolygon(pt, f as any)) { m.set(c.id, f.id as string); break; } } catch {}
      }
    }
    return m;
  }, [collections, countiesGeo, stateAssign]);

  const stateNames = useMemo(() => nameMap(statesGeo), [statesGeo]);
  const countyNames = useMemo(() => nameMap(countiesGeo), [countiesGeo]);

  // ── Scoped collections ──

  const scopedCollections = useMemo(() => {
    let r = collections;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      r = r.filter(c => c.name.toLowerCase().includes(t) || c.city.toLowerCase().includes(t) || c.slug.toLowerCase().includes(t) || c.instagram?.toLowerCase().includes(t));
    }
    switch (drill.level) {
      case 'country': r = r.filter(c => c.country === drill.country); break;
      case 'state': r = r.filter(c => stateAssign.get(c.id) === drill.stateId); break;
      case 'county': case 'markers':
        if (drill.countyId) r = r.filter(c => countyAssign.get(c.id) === drill.countyId);
        else if (drill.city) r = r.filter(c => c.city === drill.city && c.country === drill.country);
        break;
    }
    return r;
  }, [collections, searchTerm, drill, stateAssign, countyAssign]);

  // ── Sorted collections for right panel ──
  const sortedCollections = useMemo(() => {
    const arr = [...scopedCollections];
    switch (sortBy) {
      case 'name': arr.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'inventory': arr.sort((a, b) => b.total_inventory - a.total_inventory); break;
      case 'city': arr.sort((a, b) => a.city.localeCompare(b.city)); break;
    }
    return arr;
  }, [scopedCollections, sortBy]);

  // ── Sidebar items (now has access to state/county assignments!) ──

  const sidebarItems = useMemo((): SidebarItem[] => {
    if (drill.level === 'world') {
      const agg = aggregateBy(scopedCollections, c => c.country);
      return Array.from(agg.entries()).sort((a, b) => b[1].count - a[1].count)
        .map(([k, v]) => ({ key: k, label: k, ...v, onClick: () => setDrill({ level: 'country', country: k }) }));
    }
    if (drill.level === 'country' && drill.country === 'USA') {
      const usColls = scopedCollections.filter(c => c.country === 'USA');
      const agg = aggregateBy(usColls, c => stateAssign.get(c.id));
      return Array.from(agg.entries()).sort((a, b) => b[1].count - a[1].count)
        .map(([id, v]) => ({
          key: id, label: stateNames.get(id) || id, ...v,
          onClick: () => setDrill({ level: 'state', country: 'USA', stateId: id, stateName: stateNames.get(id) || id }),
        }));
    }
    if (drill.level === 'country') {
      const agg = aggregateBy(scopedCollections, c => c.city || 'Unknown');
      return Array.from(agg.entries()).sort((a, b) => b[1].count - a[1].count)
        .map(([k, v]) => ({ key: k, label: k, ...v, onClick: () => setDrill({ level: 'markers', country: drill.country, city: k }) }));
    }
    if (drill.level === 'state') {
      const stateColls = scopedCollections.filter(c => stateAssign.get(c.id) === drill.stateId);
      const agg = aggregateBy(stateColls, c => countyAssign.get(c.id));
      return Array.from(agg.entries()).sort((a, b) => b[1].count - a[1].count)
        .map(([id, v]) => ({
          key: id, label: countyNames.get(id) || id, ...v,
          onClick: () => setDrill({ level: 'county', country: 'USA', stateId: drill.stateId, stateName: drill.stateName, countyId: id, countyName: countyNames.get(id) || id }),
        }));
    }
    return [];
  }, [drill, scopedCollections, stateAssign, countyAssign, stateNames, countyNames, setDrill]);

  // ── Summary stats ──
  const stats = useMemo(() => {
    const total = scopedCollections.length;
    const vehicles = scopedCollections.reduce((s, c) => s + c.total_inventory, 0);
    const cities = new Set(scopedCollections.map(c => c.city)).size;
    const countries = new Set(scopedCollections.map(c => c.country)).size;
    return { total, vehicles, cities, countries };
  }, [scopedCollections]);

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    const p: { label: string; onClick: () => void }[] = [{ label: 'World', onClick: () => setDrill({ level: 'world' }) }];
    if (drill.country) p.push({ label: drill.country, onClick: () => setDrill({ level: 'country', country: drill.country }) });
    if (drill.stateName) p.push({ label: drill.stateName, onClick: () => setDrill({ level: 'state', country: 'USA', stateId: drill.stateId, stateName: drill.stateName }) });
    if (drill.countyName) p.push({ label: drill.countyName, onClick: () => setDrill({ level: 'county', country: 'USA', stateId: drill.stateId, stateName: drill.stateName, countyId: drill.countyId, countyName: drill.countyName }) });
    if (drill.city) p.push({ label: drill.city, onClick: () => {} });
    return p;
  }, [drill, setDrill]);

  const sidebarTitle = drill.level === 'world' ? 'Countries' : drill.level === 'country' && drill.country === 'USA' ? 'States' : drill.level === 'country' ? 'Cities' : drill.level === 'state' ? 'Counties' : 'Collections';
  const levelLabel = drill.level === 'world' ? 'country' : drill.level === 'country' && drill.country === 'USA' ? 'state' : drill.level === 'country' ? 'city' : drill.level === 'state' ? 'county' : 'collection';

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else mapContainerRef.current?.requestFullscreen();
  };

  return (
    <div ref={mapContainerRef} className="fullscreen-content h-screen flex flex-col bg-gray-950">
      <style>{MAP_STYLES}</style>

      {/* Header */}
      <div className="bg-gray-900/80 backdrop-blur border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Collections Map</h1>
              <p className="text-gray-500 text-xs">{stats.total} collections / {stats.vehicles.toLocaleString()} vehicles / {stats.countries} countries</p>
            </div>
            {/* Breadcrumbs inline */}
            {drill.level !== 'world' && (
              <div className="flex items-center gap-1 text-sm ml-4 px-3 py-1 rounded-full bg-gray-800/60 border border-gray-700/50">
                {breadcrumbs.map((bc, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-600">/</span>}
                    <button onClick={bc.onClick} className={i === breadcrumbs.length - 1 ? 'text-sky-400 font-medium' : 'text-gray-400 hover:text-gray-200'}>{bc.label}</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 w-52" />
              <svg className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
            <div className="flex rounded-md overflow-hidden border border-gray-700">
              {(['count', 'inventory'] as const).map(m => (
                <button key={m} onClick={() => setMetric(m)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${metric === m ? 'bg-sky-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                  {m === 'count' ? 'Count' : 'Vehicles'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <div className="w-60 bg-gray-900/50 border-r border-gray-800 flex flex-col min-h-0">
          <div className="px-3 pt-3 pb-2">
            <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">{sidebarTitle}</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {sidebarItems.map(item => (
              <button key={item.key} onClick={item.onClick}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-gray-300 hover:bg-gray-800/80 hover:text-white transition-colors group">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: choroplethColor(item[metric === 'count' ? 'count' : 'inventory'], Math.max(...sidebarItems.map(i => i[metric === 'count' ? 'count' : 'inventory']), 1)) }} />
                  <span className="truncate">{item.label}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
                  <span className="text-[10px] text-gray-500">{item.count}c</span>
                  <span className="text-[10px] text-gray-600">{item.inventory}v</span>
                </div>
              </button>
            ))}
            {sidebarItems.length === 0 && drill.level !== 'county' && drill.level !== 'markers' && (
              <div className="px-2 py-8 text-center">
                <div className="text-gray-600 text-xs">Loading {sidebarTitle.toLowerCase()}...</div>
              </div>
            )}
            {(drill.level === 'county' || drill.level === 'markers') && (
              <div className="px-2 py-4 space-y-1">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Collections here</div>
                {scopedCollections.slice(0, 20).map(c => (
                  <Link key={c.id} to={`/org/${c.slug}`} className="block px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-800/60 truncate">
                    {c.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Map area */}
        <div className="flex-1 relative min-h-0 min-w-0">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
                <div className="text-gray-500 text-sm">Loading collections...</div>
              </div>
            </div>
          ) : (
            <MapContainer center={[20, 0]} zoom={2} className="absolute inset-0" style={{ background: '#0a0f1a' }}
              zoomControl={false} attributionControl={false}>
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
              <MapLayers collections={collections} drill={drill} setDrill={setDrill} metric={metric} searchTerm={searchTerm}
                worldGeo={worldGeo} statesGeo={statesGeo} countiesGeo={countiesGeo} stateAssign={stateAssign} countyAssign={countyAssign} />
            </MapContainer>
          )}

          {/* Map controls */}
          <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
            <button onClick={() => setDrill({ level: 'world' })} title="Reset view"
              className="w-8 h-8 rounded-lg bg-gray-900/80 backdrop-blur border border-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center text-sm transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
            <button onClick={toggleFullscreen} title="Fullscreen"
              className="w-8 h-8 rounded-lg bg-gray-900/80 backdrop-blur border border-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center text-sm transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
            </button>
          </div>

          {/* Color legend */}
          <div className="absolute bottom-14 right-3 z-[1000] bg-gray-900/80 backdrop-blur rounded-lg p-2.5 border border-gray-800/50">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5">{metric === 'count' ? 'Collections' : 'Vehicles'} per {levelLabel}</div>
            <div className="w-32 h-2 rounded-full" style={{ background: `linear-gradient(to right, ${choroplethGradientCSS()})` }} />
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-gray-600">0</span>
              <span className="text-[9px] text-gray-600">max</span>
            </div>
          </div>

          {/* Summary stats */}
          <div className="absolute bottom-3 left-3 z-[1000] bg-gray-900/80 backdrop-blur rounded-lg px-3 py-2 border border-gray-800/50 flex items-center gap-4">
            <div><div className="text-white text-sm font-bold">{stats.total}</div><div className="text-[9px] text-gray-500">Collections</div></div>
            <div className="w-px h-6 bg-gray-700" />
            <div><div className="text-sky-400 text-sm font-bold">{stats.vehicles.toLocaleString()}</div><div className="text-[9px] text-gray-500">Vehicles</div></div>
            <div className="w-px h-6 bg-gray-700" />
            <div><div className="text-emerald-400 text-sm font-bold">{stats.cities}</div><div className="text-[9px] text-gray-500">Cities</div></div>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-72 bg-gray-900/50 border-l border-gray-800 flex flex-col min-h-0">
          <div className="px-3 pt-3 pb-2 border-b border-gray-800/50 flex items-center justify-between">
            <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Collections ({scopedCollections.length})</h2>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
              className="text-[10px] bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-400 focus:outline-none">
              <option value="name">Name</option>
              <option value="inventory">Vehicles</option>
              <option value="city">City</option>
            </select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sortedCollections.slice(0, 80).map(c => (
              <Link key={c.id} to={`/org/${c.slug}`} className="block px-3 py-2.5 border-b border-gray-800/30 hover:bg-gray-800/40 transition-colors group">
                <div className="flex items-start gap-2.5">
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" className="w-8 h-8 rounded-md object-cover flex-shrink-0 bg-gray-800" />
                  ) : (
                    <div className="w-8 h-8 rounded-md bg-gradient-to-br from-sky-900/40 to-blue-900/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-sky-400 text-[10px] font-bold">{c.name.charAt(0)}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white text-xs font-medium truncate group-hover:text-sky-400 transition-colors">{c.name}</h3>
                    <p className="text-gray-500 text-[10px] truncate">{c.city}{c.city && c.country ? ', ' : ''}{c.country}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {c.total_inventory > 0 && <span className="text-sky-400/80 text-[10px] font-medium">{c.total_inventory} vehicles</span>}
                      {c.instagram && <span className="text-pink-400/60 text-[10px] truncate">@{c.instagram}</span>}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            {sortedCollections.length === 0 && (
              <div className="px-3 py-8 text-center text-gray-600 text-xs">No collections found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const SAMPLE: Collection[] = [
  { id: 's1', slug: 'jay-lenos-car-collection', name: "Jay Leno's Car Collection", instagram: 'jaylenosgarage', country: 'USA', city: 'Burbank, CA', state: 'California', lat: 34.1808, lng: -118.309, total_inventory: 0, logo_url: null },
  { id: 's2', slug: 'ferrari-museum-maranello', name: 'Ferrari Museum Maranello', instagram: null, country: 'Italy', city: 'Maranello', state: null, lat: 44.5294, lng: 10.8656, total_inventory: 0, logo_url: null },
];
