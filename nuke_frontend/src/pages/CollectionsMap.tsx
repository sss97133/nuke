import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Marker, Popup, Tooltip, Polyline, useMap } from 'react-leaflet';
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

const DRILL_ORDER: DrillLevel[] = ['world', 'country', 'state', 'county', 'markers'];

const MAP_TILES: Record<string, { url: string; attr: string }> = {
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr: 'CartoDB' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Esri' },
  light: { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attr: 'CartoDB' },
};

const COUNTRY_FLAGS: Record<string, string> = {
  'USA': '🇺🇸', 'UK': '🇬🇧', 'Italy': '🇮🇹', 'Germany': '🇩🇪', 'France': '🇫🇷',
  'Monaco': '🇲🇨', 'Switzerland': '🇨🇭', 'Japan': '🇯🇵', 'UAE': '🇦🇪', 'Qatar': '🇶🇦',
  'South Korea': '🇰🇷', 'Taiwan': '🇹🇼', 'Australia': '🇦🇺', 'Canada': '🇨🇦', 'Singapore': '🇸🇬',
  'Belgium': '🇧🇪', 'Poland': '🇵🇱', 'Denmark': '🇩🇰', 'Chile': '🇨🇱', 'Turkey': '🇹🇷',
  'Austria': '🇦🇹', 'Norway': '🇳🇴', 'Netherlands': '🇳🇱', 'New Zealand': '🇳🇿', 'Czechia': '🇨🇿',
  'Morocco': '🇲🇦', 'China': '🇨🇳', 'Brazil': '🇧🇷', 'Thailand': '🇹🇭', 'Mexico': '🇲🇽',
  'India': '🇮🇳', 'Hong Kong': '🇭🇰', 'Israel': '🇮🇱', 'Portugal': '🇵🇹', 'Malaysia': '🇲🇾',
  'Saudi Arabia': '🇸🇦', 'Oman': '🇴🇲', 'Lebanon': '🇱🇧', 'Slovakia': '🇸🇰',
  'Dominican Republic': '🇩🇴', 'Kazakhstan': '🇰🇿', 'Spain': '🇪🇸', 'Sweden': '🇸🇪',
  'Ireland': '🇮🇪', 'Greece': '🇬🇷', 'Argentina': '🇦🇷', 'Indonesia': '🇮🇩',
};

// ── Color scale ──────────────────────────────────────────────────────────────

const COLOR_STOPS = [
  [0, 15, 23, 42],
  [0.01, 30, 58, 138],
  [0.25, 37, 99, 235],
  [0.5, 56, 189, 248],
  [0.75, 45, 212, 191],
  [1.0, 52, 211, 153],
] as const;

function choroplethColor(value: number, maxValue: number): string {
  if (!value || !maxValue) return 'rgba(15, 23, 42, 0.12)';
  const t = Math.pow(Math.min(value / maxValue, 1), 0.6);
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

// ── Hooks ────────────────────────────────────────────────────────────────────

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

function useFavorites(): [Set<string>, (id: string) => void] {
  const [favs, setFavs] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('nuke_map_favorites');
      return stored ? new Set(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const toggle = useCallback((id: string) => {
    setFavs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('nuke_map_favorites', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);
  return [favs, toggle];
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-sky-400 font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

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

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── MapLayers ────────────────────────────────────────────────────────────────

function MapLayers({
  collections, drill, setDrill, metric, searchTerm,
  worldGeo, statesGeo, countiesGeo, stateAssign, countyAssign, highlightedId,
  favorites, toggleFavorite, showHeatmap,
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
  highlightedId: string | null;
  favorites: Set<string>;
  toggleFavorite: (id: string) => void;
  showHeatmap: boolean;
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

  const makeOnEach = useCallback((agg: Map<string, Agg>, idKey: 'name' | 'id', onClick: (id: string, name: string) => void) => {
    return (feature: Feature<Geometry>, layer: L.Layer) => {
      const id = idKey === 'id' ? (feature.id as string) : (feature.properties?.name || '');
      const name = feature.properties?.name || id;
      const d = agg.get(id) || { count: 0, inventory: 0 };
      (layer as L.Path).bindTooltip(
        `<div style="min-width:140px"><strong style="font-size:13px;letter-spacing:0.01em">${name}</strong><div style="margin-top:4px;display:flex;gap:14px"><span style="font-weight:600;color:#38bdf8">${d.count}</span><span style="opacity:.5">collections</span></div><div style="display:flex;gap:14px"><span style="font-weight:600;color:#34d399">${d.inventory.toLocaleString()}</span><span style="opacity:.5">vehicles</span></div>${d.count > 0 ? '<div style="margin-top:6px;font-size:10px;opacity:.5;border-top:1px solid rgba(255,255,255,.1);padding-top:4px">Click to explore</div>' : ''}</div>`,
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

  // Route lines connecting nearby collections
  const routeLines = useMemo(() => {
    if (markerCollections.length < 2 || markerCollections.length > 50) return [];
    const lines: Array<{ from: Collection; to: Collection; dist: number }> = [];
    const threshold = 0.3; // ~30km at mid latitudes
    for (let i = 0; i < markerCollections.length; i++) {
      for (let j = i + 1; j < markerCollections.length; j++) {
        const a = markerCollections[i], b = markerCollections[j];
        const d = Math.sqrt(Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2));
        if (d < threshold) lines.push({ from: a, to: b, dist: d });
      }
    }
    return lines;
  }, [markerCollections]);

  const renderMarkers = (colls: Collection[]) => (
    <>
      {/* Route lines between nearby collections */}
      {routeLines.map(line => (
        <Polyline key={`route-${line.from.id}-${line.to.id}`}
          positions={[[line.from.lat, line.from.lng], [line.to.lat, line.to.lng]]}
          pathOptions={{ color: '#38bdf8', weight: 1, opacity: 0.2, dashArray: '4 6' }} />
      ))}
      {colls.map(c => {
        const isHighlighted = highlightedId === c.id;
        const size = isHighlighted ? 36 : 28;
        const halfSize = size / 2;
        const isFav = favorites.has(c.id);
        const starBadge = isFav ? `<div style="position:absolute;top:-3px;right:-3px;width:12px;height:12px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:7px;line-height:1;border:1.5px solid #0f172a;z-index:2">★</div>` : '';
        const glowClass = isHighlighted ? ' glow-ring' : '';
        const icon = c.logo_url
          ? L.divIcon({
              className: '',
              html: `<div class="${glowClass}" style="position:relative;width:${size}px;height:${size}px;border-radius:50%;border:${isHighlighted ? '3px solid #38bdf8' : isFav ? '2px solid #f59e0b' : '2px solid #fff'};box-shadow:${isHighlighted ? '0 0 20px rgba(56,189,248,0.8),0 0 40px rgba(56,189,248,0.3)' : '0 0 8px rgba(56,189,248,0.5),0 2px 6px rgba(0,0,0,.5)'};overflow:visible;background:#1e293b;transition:all 200ms ease">${starBadge}<div style="width:100%;height:100%;border-radius:50%;overflow:hidden"><img src="${c.logo_url}" style="width:100%;height:100%;object-fit:cover" /></div></div>`,
              iconSize: [size, size], iconAnchor: [halfSize, halfSize], popupAnchor: [0, -halfSize],
            })
          : isHighlighted
            ? L.divIcon({
                className: '',
                html: `<div style="background:#38bdf8;width:24px;height:24px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 20px rgba(56,189,248,0.9),0 0 40px rgba(56,189,248,0.4),0 2px 8px rgba(0,0,0,.4);animation:pulse 1s infinite"></div>`,
                iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12],
              })
            : MARKER_ICON;
        return (
          <Marker key={c.id} position={[c.lat, c.lng]} icon={icon} zIndexOffset={isHighlighted ? 1000 : 0}>
            {/* Name label below marker */}
            <Tooltip permanent direction="bottom" offset={[0, 8]} className="marker-name-label">
              <span style={{ fontSize: 9, fontWeight: 600, color: '#e2e8f0', textShadow: '0 1px 3px rgba(0,0,0,.9),0 0 6px rgba(0,0,0,.6)' }}>{c.name.length > 20 ? c.name.slice(0, 18) + '…' : c.name}</span>
            </Tooltip>
            <Popup maxWidth={300}>
              <div className="min-w-[260px] p-3">
                <div className="flex items-start gap-3">
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0 ring-1 ring-gray-200 shadow-sm" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-50 to-sky-100 flex items-center justify-center flex-shrink-0 shadow-sm">
                      <span className="text-blue-600 text-xl font-bold">{c.name.charAt(0)}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-base leading-tight text-gray-900">{c.name}</h3>
                    <p className="text-gray-500 text-sm mt-0.5 flex items-center gap-1">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      {c.city}{c.city && c.country ? ', ' : ''}{c.country}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {c.total_inventory > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-50 to-sky-50 text-blue-700 text-xs font-semibold border border-blue-100">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                      {c.total_inventory} vehicles
                    </span>
                  )}
                  {c.instagram && (
                    <a href={`https://instagram.com/${c.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-r from-pink-50 to-rose-50 text-pink-600 text-xs font-medium border border-pink-100 hover:border-pink-200 transition-colors">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                      @{c.instagram}
                    </a>
                  )}
                </div>
                <Link to={`/org/${c.slug}`}
                  className="mt-3 block text-center px-3 py-2.5 bg-gradient-to-r from-blue-600 to-sky-600 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-sky-700 transition-all shadow-sm hover:shadow-md">
                  View Collection →
                </Link>
                {/* Nearby collections */}
                {(() => {
                  const nearby = colls.filter(n => n.id !== c.id && Math.abs(n.lat - c.lat) < 0.5 && Math.abs(n.lng - c.lng) < 0.5).slice(0, 3);
                  if (!nearby.length) return null;
                  return (
                    <div className="mt-3 pt-2.5 border-t border-gray-100">
                      <div className="text-[10px] text-gray-400 font-medium mb-1.5">Nearby collections</div>
                      {nearby.map(n => (
                        <Link key={n.id} to={`/org/${n.slug}`} className="flex items-center gap-1.5 py-1 text-[11px] text-gray-600 hover:text-blue-600 transition-colors">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-300 flex-shrink-0" />
                          {n.name}
                        </Link>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );

  // ── Count labels on choropleth ──
  const countLabels = useMemo(() => {
    const labels: Array<{ key: string; lat: number; lng: number; label: string }> = [];
    const addFromGeo = (geo: FeatureCollection | null, agg: Map<string, Agg>, idKey: 'name' | 'id', minCount: number) => {
      if (!geo) return;
      for (const f of geo.features) {
        const id = idKey === 'id' ? (f.id as string) : (f.properties?.name || '');
        const a = agg.get(id);
        if (!a || a.count < minCount) continue;
        try {
          const center = L.geoJSON(f as any).getBounds().getCenter();
          const val = metric === 'count' ? a.count : a.inventory;
          labels.push({ key: id, lat: center.lat, lng: center.lng, label: fmtNum(val) });
        } catch {}
      }
    };
    if (drill.level === 'world') addFromGeo(worldGeo, countryAgg, 'name', 2);
    else if (drill.level === 'country' && drill.country === 'USA') addFromGeo(statesGeo, stateAgg, 'id', 1);
    else if (drill.level === 'state') addFromGeo(stateCountiesGeo, countyAgg, 'id', 1);
    return labels;
  }, [drill, worldGeo, statesGeo, stateCountiesGeo, countryAgg, stateAgg, countyAgg, metric]);

  const renderCountLabels = () => countLabels.map(l => (
    <Marker key={`cnt-${l.key}`} position={[l.lat, l.lng]}
      icon={L.divIcon({ className: '', html: `<div class="region-count">${l.label}</div>`, iconSize: [32, 18], iconAnchor: [16, 9] })}
      interactive={false} />
  ));

  // ── Render layers ──

  // Heatmap dots - multi-layer glow effect behind choropleth
  const heatmapDots = useMemo(() => {
    if (!showHeatmap || drill.level === 'markers') return null;
    // At world level, show behind choropleth; at deeper levels, show all scoped collections
    const colls = drill.level === 'world' ? filtered :
      drill.level === 'country' ? filtered.filter(c => c.country === drill.country) :
      drill.level === 'state' ? filtered.filter(c => stateAssign.get(c.id) === drill.stateId) :
      filtered.filter(c => countyAssign.get(c.id) === drill.countyId);
    if (colls.length === 0) return null;
    // Create density clusters for glow rings
    return colls.map(c => {
      const inventoryScale = Math.min(c.total_inventory / 50, 1); // 0-1 based on inventory
      const baseRadius = drill.level === 'world' ? 6 : 12;
      return (
        <CircleMarker key={`h-${c.id}`} center={[c.lat, c.lng]}
          radius={baseRadius + inventoryScale * 8}
          pathOptions={{ color: 'transparent', fillColor: inventoryScale > 0.5 ? '#34d399' : '#38bdf8', fillOpacity: drill.level === 'world' ? 0.08 : 0.12, weight: 0 }}
          interactive={false} />
      );
    });
  }, [showHeatmap, drill, filtered, stateAssign, countyAssign]);

  if (drill.level === 'world' && worldGeo) {
    const mx = maxAgg(countryAgg, metric);
    return <>
      {heatmapDots}
      <GeoJSON key={`w-${metric}-${searchTerm}`} data={worldGeo}
        style={f => ({ fillColor: choroplethColor((countryAgg.get(f?.properties?.name || '') || { count: 0, inventory: 0 })[metric], mx), fillOpacity: 0.55, color: '#334155', weight: 0.5 })}
        onEachFeature={makeOnEach(countryAgg, 'name', n => setDrill({ level: 'country', country: toOurName(n) }))} />
      {renderCountLabels()}
    </>;
  }

  if (drill.level === 'country' && drill.country === 'USA' && statesGeo) {
    const mx = maxAgg(stateAgg, metric);
    return <>
      {heatmapDots}
      <GeoJSON key={`s-${metric}-${searchTerm}`} data={statesGeo}
        style={f => ({ fillColor: choroplethColor((stateAgg.get(f?.id as string) || { count: 0, inventory: 0 })[metric], mx), fillOpacity: 0.55, color: '#334155', weight: 0.5 })}
        onEachFeature={makeOnEach(stateAgg, 'id', (id, name) => setDrill({ level: 'state', country: 'USA', stateId: id, stateName: name }))} />
      {renderCountLabels()}
    </>;
  }

  if (drill.level === 'country' && drill.country !== 'USA' && cityGroups.length > 0) {
    const mx = Math.max(...cityGroups.map(g => g[metric === 'count' ? 'count' : 'inventory']), 1);
    return <>
      {cityGroups.map(g => (
        <CircleMarker key={g.city} center={[g.lat, g.lng]}
          radius={Math.max(12, Math.min(40, 12 + Math.sqrt(g.count) * 10))}
          pathOptions={{ color: '#38bdf8', fillColor: choroplethColor(g[metric === 'count' ? 'count' : 'inventory'], mx), fillOpacity: 0.75, weight: 2 }}
          eventHandlers={{ click: () => setDrill({ level: 'markers', country: drill.country, city: g.city }) }}>
          <Tooltip direction="top" className="map-tooltip">
            <div style={{ minWidth: 100 }}>
              <strong>{g.city}</strong>
              <div style={{ marginTop: 3, fontSize: 11 }}>
                <span style={{ color: '#38bdf8', fontWeight: 600 }}>{g.count}</span> collections
                <span style={{ margin: '0 6px', opacity: 0.3 }}>|</span>
                <span style={{ color: '#34d399', fontWeight: 600 }}>{g.inventory}</span> vehicles
              </div>
            </div>
          </Tooltip>
          {g.count >= 2 && (
            <Tooltip permanent direction="center" className="city-count-label">
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.8)' }}>{g.count}</span>
            </Tooltip>
          )}
        </CircleMarker>
      ))}
    </>;
  }

  if (drill.level === 'state' && stateCountiesGeo) {
    const mx = maxAgg(countyAgg, metric);
    return <>
      {heatmapDots}
      <GeoJSON key={`c-${drill.stateId}-${metric}-${searchTerm}`} data={stateCountiesGeo}
        style={f => ({ fillColor: choroplethColor((countyAgg.get(f?.id as string) || { count: 0, inventory: 0 })[metric], mx), fillOpacity: 0.55, color: '#334155', weight: 0.5 })}
        onEachFeature={makeOnEach(countyAgg, 'id', (id, name) => setDrill({ level: 'county', country: 'USA', stateId: drill.stateId, stateName: drill.stateName, countyId: id, countyName: name }))} />
      {renderCountLabels()}
    </>;
  }

  if ((drill.level === 'county' || drill.level === 'markers') && markerCollections.length > 0)
    return renderMarkers(markerCollections);

  return null;
}

// ── MapInstance (captures map ref for external controls) ─────────────────────

function MapInstance({ onMap, onMoveEnd }: { onMap: (map: L.Map) => void; onMoveEnd?: (center: [number, number]) => void }) {
  const map = useMap();
  useEffect(() => { onMap(map); }, [map, onMap]);
  useEffect(() => {
    if (!onMoveEnd) return;
    const handler = () => {
      const c = map.getCenter();
      onMoveEnd([c.lat, c.lng]);
    };
    map.on('moveend', handler);
    return () => { map.off('moveend', handler); };
  }, [map, onMoveEnd]);
  return null;
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const MAP_STYLES = `
  .map-tooltip { background: rgba(15,23,42,.95) !important; color: #e2e8f0 !important; border: 1px solid rgba(56,189,248,.2) !important; border-radius: 10px !important; padding: 10px 14px !important; font-size: 12px !important; box-shadow: 0 8px 32px rgba(0,0,0,.6) !important; backdrop-filter: blur(12px); }
  .map-tooltip::before { border-top-color: rgba(56,189,248,.2) !important; }
  .city-count-label { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
  .city-count-label::before { display: none !important; }
  .region-count { background: rgba(15,23,42,.75); color: #e2e8f0; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 6px; text-align: center; white-space: nowrap; pointer-events: none; border: 1px solid rgba(56,189,248,.15); text-shadow: 0 1px 2px rgba(0,0,0,.5); }
  .leaflet-popup-content-wrapper { border-radius: 12px !important; }
  .leaflet-popup-content { margin: 0 !important; }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 8px rgba(56,189,248,0.6),0 2px 4px rgba(0,0,0,.4); } 50% { box-shadow: 0 0 16px rgba(56,189,248,0.9),0 2px 8px rgba(0,0,0,.4); } }
  .sidebar-slide { transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1); }
  .panel-slide { transition: transform 300ms cubic-bezier(0.4, 0, 0.2, 1); }
  .backdrop-fade { transition: opacity 200ms ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .fade-in { animation: fadeIn 300ms ease; }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
  .scale-in { animation: scaleIn 400ms cubic-bezier(0.16, 1, 0.3, 1); }
  .leaflet-marker-icon { transition: transform 150ms ease !important; }
  .sidebar-item-enter { animation: slideInLeft 250ms cubic-bezier(0.16, 1, 0.3, 1); }
  @keyframes slideInLeft { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
  .legend-interactive:hover .legend-bar { filter: brightness(1.3); }
  .stat-card { transition: all 200ms ease; }
  .stat-card:hover { background: rgba(30,41,59,0.8); transform: translateY(-1px); }
  @keyframes drillTransition { 0% { opacity: 0.5; } 100% { opacity: 0; } }
  .drill-transition { animation: drillTransition 400ms ease-out forwards; }
  .leaflet-popup-content-wrapper { box-shadow: 0 8px 32px rgba(0,0,0,.25) !important; border: none !important; }
  .leaflet-popup-tip { box-shadow: none !important; }
  .marker-name-label { background: rgba(15,23,42,.7) !important; border: 1px solid rgba(56,189,248,.1) !important; border-radius: 4px !important; padding: 1px 4px !important; box-shadow: 0 2px 8px rgba(0,0,0,.4) !important; }
  .marker-name-label::before { border-bottom-color: rgba(56,189,248,.1) !important; }
  /* Light mode adaptations */
  .map-light .region-count { background: rgba(255,255,255,.85); color: #1e293b; border-color: rgba(37,99,235,.2); text-shadow: none; }
  .map-light .marker-name-label { background: rgba(255,255,255,.85) !important; color: #1e293b !important; border-color: rgba(37,99,235,.15) !important; }
  .map-light .marker-name-label span { color: #1e293b !important; text-shadow: none !important; }
  /* Improved scrollbar for sidebar/panel */
  .custom-scroll::-webkit-scrollbar { width: 4px; }
  .custom-scroll::-webkit-scrollbar-track { background: transparent; }
  .custom-scroll::-webkit-scrollbar-thumb { background: rgba(56,189,248,.15); border-radius: 4px; }
  .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(56,189,248,.3); }
  /* Minimap */
  .minimap-container { border-radius: 8px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,.5); }
  .minimap-container .leaflet-control-container { display: none; }
  .minimap-viewport { border: 1.5px solid #38bdf8; background: rgba(56,189,248,.08); pointer-events: none; }
  /* Favorite star */
  @keyframes starPop { 0% { transform: scale(1); } 50% { transform: scale(1.4); } 100% { transform: scale(1); } }
  .star-pop { animation: starPop 300ms ease; }
  /* Tour progress bar */
  @keyframes tourProgress { from { width: 0%; } to { width: 100%; } }
  .tour-progress { animation: tourProgress 4s linear; }
  /* Minimap entrance */
  @keyframes minimapIn { from { opacity: 0; transform: scale(0.85) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
  .minimap-enter { animation: minimapIn 400ms cubic-bezier(0.16, 1, 0.3, 1); }
  /* Compare bar slide up */
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  .slide-up { animation: slideUp 300ms cubic-bezier(0.16, 1, 0.3, 1); }
  /* Glowing ring on highlighted marker */
  @keyframes glowRing { 0% { box-shadow: 0 0 0 0 rgba(56,189,248,0.6); } 100% { box-shadow: 0 0 0 12px rgba(56,189,248,0); } }
  .glow-ring { animation: glowRing 1.5s ease-out infinite; }
`;

// ── Main Component ───────────────────────────────────────────────────────────

export default function CollectionsMap() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<'count' | 'inventory'>('count');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'inventory' | 'city' | 'distance'>('name');
  const [mapCenter, setMapCenter] = useState<[number, number]>([20, 0]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [filterVehicles, setFilterVehicles] = useState(false);
  const [filterInstagram, setFilterInstagram] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [favorites, toggleFavorite] = useFavorites();
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [touring, setTouring] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const tourTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const handleMap = useCallback((map: L.Map) => { mapRef.current = map; }, []);
  const handleMoveEnd = useCallback((center: [number, number]) => { setMapCenter(center); }, []);
  const [transitioning, setTransitioning] = useState(false);
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'light'>('dark');

  // Responsive
  const windowWidth = useWindowWidth();
  const isCompact = windowWidth < 1024;
  const isMobile = windowWidth < 640;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // URL-synced drill state
  const drill = useMemo(() => paramsToDrill(searchParams), [searchParams]);
  const prevDrillLevel = useRef(drill.level);
  const setDrill = useCallback((d: DrillState) => {
    setSearchParams(drillToParams(d), { replace: false });
  }, [setSearchParams]);

  // Go back one drill level
  const goBack = useCallback(() => {
    const idx = DRILL_ORDER.indexOf(drill.level);
    if (idx <= 0) return;
    switch (drill.level) {
      case 'country': setDrill({ level: 'world' }); break;
      case 'state': setDrill({ level: 'country', country: drill.country }); break;
      case 'county': setDrill({ level: 'state', country: drill.country, stateId: drill.stateId, stateName: drill.stateName }); break;
      case 'markers':
        if (drill.countyId) setDrill({ level: 'county', country: drill.country, stateId: drill.stateId, stateName: drill.stateName, countyId: drill.countyId, countyName: drill.countyName });
        else if (drill.city) setDrill({ level: 'country', country: drill.country });
        else setDrill({ level: 'world' });
        break;
    }
  }, [drill, setDrill]);

  // Close overlays and trigger transition on drill change
  useEffect(() => {
    if (isCompact) { setSidebarOpen(false); setPanelOpen(false); }
    if (prevDrillLevel.current !== drill.level) {
      setTransitioning(true);
      const t = setTimeout(() => setTransitioning(false), 400);
      prevDrillLevel.current = drill.level;
      return () => clearTimeout(t);
    }
  }, [drill.level, isCompact]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        if (touring) { stopTour(); return; }
        if (sidebarOpen) { setSidebarOpen(false); return; }
        if (panelOpen) { setPanelOpen(false); return; }
        if (searchExpanded) { setSearchExpanded(false); setSearchTerm(''); return; }
        goBack();
      }
      // Map style shortcuts
      if (e.key === '1') setMapStyle('dark');
      if (e.key === '2') setMapStyle('satellite');
      if (e.key === '3') setMapStyle('light');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sidebarOpen, panelOpen, searchExpanded, goBack, touring, stopTour]);

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

  // ── TopoJSON loading ──

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

  const sortedCollections = useMemo(() => {
    let arr = [...scopedCollections];
    if (filterVehicles) arr = arr.filter(c => c.total_inventory > 0);
    if (filterInstagram) arr = arr.filter(c => !!c.instagram);
    if (filterFavorites) arr = arr.filter(c => favorites.has(c.id));
    switch (sortBy) {
      case 'name': arr.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'inventory': arr.sort((a, b) => b.total_inventory - a.total_inventory); break;
      case 'city': arr.sort((a, b) => a.city.localeCompare(b.city)); break;
      case 'distance': {
        const [clat, clng] = mapCenter;
        const dist = (c: Collection) => Math.sqrt(Math.pow(c.lat - clat, 2) + Math.pow(c.lng - clng, 2));
        arr.sort((a, b) => dist(a) - dist(b));
        break;
      }
    }
    return arr;
  }, [scopedCollections, sortBy, filterVehicles, filterInstagram, filterFavorites, favorites, mapCenter]);

  // ── Sidebar items ──

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

  // ── Analytics: top distribution ──
  const topDistribution = useMemo(() => {
    if (!sidebarItems.length) return [];
    const total = sidebarItems.reduce((s, i) => s + i[metric === 'count' ? 'count' : 'inventory'], 0);
    return sidebarItems.slice(0, 5).map(i => ({
      label: i.label,
      value: i[metric === 'count' ? 'count' : 'inventory'],
      pct: total > 0 ? Math.round((i[metric === 'count' ? 'count' : 'inventory'] / total) * 100) : 0,
    }));
  }, [sidebarItems, metric]);

  // ── Stats & breadcrumbs ──
  const stats = useMemo(() => {
    const total = scopedCollections.length;
    const vehicles = scopedCollections.reduce((s, c) => s + c.total_inventory, 0);
    const cities = new Set(scopedCollections.map(c => c.city)).size;
    const countries = new Set(scopedCollections.map(c => c.country)).size;
    return { total, vehicles, cities, countries };
  }, [scopedCollections]);

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

  // Export collections as CSV
  const exportCSV = useCallback(() => {
    const headers = ['Name', 'City', 'Country', 'Vehicles', 'Instagram', 'Latitude', 'Longitude', 'URL'];
    const rows = sortedCollections.map(c => [
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.city}"`,
      `"${c.country}"`,
      c.total_inventory,
      c.instagram || '',
      c.lat,
      c.lng,
      `https://nuke.build/org/${c.slug}`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collections-${drill.level}${drill.country ? '-' + drill.country : ''}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedCollections, drill]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else mapContainerRef.current?.requestFullscreen();
  };

  // Random collection discovery
  const discoverRandom = useCallback(() => {
    if (!collections.length) return;
    const c = collections[Math.floor(Math.random() * collections.length)];
    setHighlightedId(c.id);
    setExpandedId(c.id);
    mapRef.current?.flyTo([c.lat, c.lng], 12, { duration: 1.2 });
    // Set drill to appropriate level
    if (c.country === 'USA') {
      const sid = stateAssign.get(c.id);
      const cid = countyAssign.get(c.id);
      if (cid) {
        setDrill({ level: 'markers', country: 'USA', stateId: sid, stateName: stateNames.get(sid || '') || sid, countyId: cid, countyName: countyNames.get(cid) || cid });
      } else if (sid) {
        setDrill({ level: 'state', country: 'USA', stateId: sid, stateName: stateNames.get(sid) || sid });
      }
    } else {
      setDrill({ level: 'markers', country: c.country, city: c.city });
    }
  }, [collections, stateAssign, countyAssign, stateNames, countyNames, setDrill]);

  // Auto-tour: fly to each collection in sequence
  const startTour = useCallback(() => {
    setTouring(true);
    setTourIndex(0);
  }, []);

  const stopTour = useCallback(() => {
    setTouring(false);
    if (tourTimerRef.current) clearTimeout(tourTimerRef.current);
    tourTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (!touring || !collections.length) return;
    const tourCollections = sortedCollections.length > 0 ? sortedCollections : collections;
    const idx = tourIndex % tourCollections.length;
    const c = tourCollections[idx];
    setHighlightedId(c.id);
    setExpandedId(c.id);
    mapRef.current?.flyTo([c.lat, c.lng], 13, { duration: 1.5 });
    // Set drill for context
    if (c.country === 'USA') {
      const sid = stateAssign.get(c.id);
      const cid = countyAssign.get(c.id);
      if (cid) setDrill({ level: 'markers', country: 'USA', stateId: sid, stateName: stateNames.get(sid || '') || sid, countyId: cid, countyName: countyNames.get(cid) || cid });
      else if (sid) setDrill({ level: 'state', country: 'USA', stateId: sid, stateName: stateNames.get(sid) || sid });
    } else {
      setDrill({ level: 'markers', country: c.country, city: c.city });
    }
    tourTimerRef.current = setTimeout(() => {
      setTourIndex(prev => prev + 1);
    }, 4000);
    return () => { if (tourTimerRef.current) clearTimeout(tourTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touring, tourIndex, collections.length]);

  const toggleCompare = useCallback((id: string) => {
    setCompareIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else if (next.size < 6) next.add(id);
      return next;
    });
  }, []);

  const compareCollections = useMemo(() =>
    collections.filter(c => compareIds.has(c.id)),
  [collections, compareIds]);

  const shareUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const filteredSidebarItems = useMemo(() => {
    if (!sidebarSearch) return sidebarItems;
    const t = sidebarSearch.toLowerCase();
    return sidebarItems.filter(i => i.label.toLowerCase().includes(t));
  }, [sidebarItems, sidebarSearch]);

  // Reset sidebar search on drill change
  useEffect(() => { setSidebarSearch(''); }, [drill.level]);

  // Update page title based on drill level
  useEffect(() => {
    const parts = ['Collections Map'];
    if (drill.country) parts.push(drill.country);
    if (drill.stateName) parts.push(drill.stateName);
    if (drill.countyName) parts.push(drill.countyName);
    if (drill.city) parts.push(drill.city);
    document.title = parts.join(' · ') + ' | Nuke';
    return () => { document.title = 'Nuke'; };
  }, [drill]);

  const sidebarMaxMetric = Math.max(...sidebarItems.map(i => i[metric === 'count' ? 'count' : 'inventory']), 1);

  // Legend max value for current drill level
  const legendMax = useMemo(() => {
    const metricKey = metric === 'count' ? 'count' : 'inventory';
    return Math.max(...sidebarItems.map(i => i[metricKey]), 0);
  }, [sidebarItems, metric]);

  // ── Sidebar content (shared between desktop & mobile) ──
  const renderSidebar = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">{sidebarTitle}{sidebarItems.length > 0 ? ` (${sidebarItems.length})` : ''}</h2>
        {isCompact && (
          <button onClick={() => setSidebarOpen(false)} className="text-gray-500 hover:text-white p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* Sidebar search */}
      {sidebarItems.length > 5 && (
        <div className="px-3 pb-2">
          <div className="relative">
            <input type="text" placeholder={`Filter ${sidebarTitle.toLowerCase()}...`} value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)}
              className="w-full pl-7 pr-3 py-1 bg-gray-800/60 border border-gray-700/40 rounded-md text-[11px] text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500/50 focus:border-sky-500/50" />
            <svg className="absolute left-2 top-1.5 w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
        </div>
      )}

      {/* Analytics distribution */}
      {topDistribution.length > 0 && !sidebarSearch && (
        <div className="px-3 pb-3 border-b border-gray-800/50">
          <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <svg className="w-3 h-3 text-sky-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            Top {metric === 'count' ? 'by count' : 'by vehicles'}
          </div>
          {topDistribution.map((d, i) => (
            <div key={d.label} className="flex items-center gap-2 mb-1.5" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="w-16 truncate text-[10px] text-gray-400 flex items-center gap-1">
                {drill.level === 'world' && COUNTRY_FLAGS[d.label] && <span className="text-xs">{COUNTRY_FLAGS[d.label]}</span>}
                <span className="truncate">{d.label}</span>
              </div>
              <div className="flex-1 h-2 bg-gray-800/80 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${d.pct}%`, background: `linear-gradient(90deg, #1e40af, #38bdf8)` }} />
              </div>
              <div className="w-10 text-right text-[10px] text-gray-500 font-medium tabular-nums">{d.pct}%</div>
            </div>
          ))}
        </div>
      )}

      {/* Region list with percentage bars */}
      <div className="flex-1 overflow-y-auto custom-scroll px-2 pb-2 space-y-0.5 mt-1">
        {filteredSidebarItems.map(item => {
          const pct = (item[metric === 'count' ? 'count' : 'inventory'] / sidebarMaxMetric) * 100;
          return (
            <button key={item.key} onClick={item.onClick}
              title={`${item.label}: ${item.count} collections, ${item.inventory.toLocaleString()} vehicles`}
              className="w-full relative overflow-hidden rounded-md text-xs text-gray-300 hover:text-white transition-all group sidebar-item-enter">
              {/* Background percentage bar */}
              <div className="absolute inset-y-0 left-0 bg-sky-500/8 rounded-md transition-all duration-300 group-hover:bg-sky-500/15"
                style={{ width: `${pct}%` }} />
              {/* Content */}
              <div className="relative flex items-center justify-between px-2.5 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  {drill.level === 'world' && COUNTRY_FLAGS[item.label] ? (
                    <span className="text-sm flex-shrink-0 leading-none">{COUNTRY_FLAGS[item.label]}</span>
                  ) : (
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: choroplethColor(item[metric === 'count' ? 'count' : 'inventory'], sidebarMaxMetric) }} />
                  )}
                  <span className="truncate">{item.label}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-1">
                  <span className="text-[10px] font-medium text-sky-400/80">{item.count}</span>
                  <span className="text-[10px] text-gray-600">{item.inventory}v</span>
                </div>
              </div>
            </button>
          );
        })}
        {filteredSidebarItems.length === 0 && sidebarSearch && (
          <div className="px-2 py-6 text-center">
            <div className="text-gray-600 text-xs">No {sidebarTitle.toLowerCase()} match "{sidebarSearch}"</div>
          </div>
        )}
        {sidebarItems.length === 0 && !sidebarSearch && drill.level !== 'county' && drill.level !== 'markers' && (
          <div className="px-2 py-8 text-center">
            <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-gray-800/50 flex items-center justify-center">
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div className="text-gray-600 text-xs">Loading {sidebarTitle.toLowerCase()}...</div>
          </div>
        )}
        {(drill.level === 'county' || drill.level === 'markers') && (
          <div className="px-2 py-3 space-y-1">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Collections</div>
            {scopedCollections.slice(0, 30).map(c => (
              <Link key={c.id} to={`/org/${c.slug}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-800/60 group">
                {c.logo_url ? (
                  <img src={c.logo_url} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-5 h-5 rounded bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <span className="text-[8px] text-sky-400 font-bold">{c.name.charAt(0)}</span>
                  </div>
                )}
                <span className="truncate">{c.name}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── Right panel content (shared between desktop & mobile) ──
  const renderRightPanel = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 border-b border-gray-800/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Collections ({sortedCollections.length})</h2>
            {drill.level !== 'world' && collections.length > 0 && (
              <span className="text-[9px] text-gray-600 tabular-nums">{Math.round((scopedCollections.length / collections.length) * 100)}%</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex rounded overflow-hidden border border-gray-700/50">
              <button onClick={() => setViewMode('list')} title="List view"
                className={`px-1.5 py-1 transition-colors ${viewMode === 'list' ? 'bg-gray-700 text-white' : 'bg-gray-800/50 text-gray-500 hover:text-gray-300'}`}>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
              <button onClick={() => setViewMode('grid')} title="Grid view"
                className={`px-1.5 py-1 transition-colors ${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'bg-gray-800/50 text-gray-500 hover:text-gray-300'}`}>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
              </button>
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
              className="text-[10px] bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-400 focus:outline-none">
              <option value="name">Name</option>
              <option value="inventory">Vehicles</option>
              <option value="city">City</option>
              <option value="distance">Nearest</option>
            </select>
            {/* Export button */}
            <button onClick={exportCSV} title="Export as CSV"
              className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:text-sky-400 hover:bg-gray-700/60 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </button>
            {isCompact && (
              <button onClick={() => setPanelOpen(false)} className="text-gray-500 hover:text-white p-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>
        {/* Scope stats */}
        {drill.level !== 'world' && (
          <div className="flex items-center gap-3 mt-2 text-[10px]">
            <span className="text-gray-500"><span className="text-white font-medium">{stats.total}</span> in scope</span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-500"><span className="text-sky-400 font-medium">{stats.vehicles.toLocaleString()}</span> vehicles</span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-500"><span className="text-emerald-400 font-medium">{stats.cities}</span> cities</span>
          </div>
        )}
        {/* Filter chips */}
        <div className="flex items-center gap-1.5 mt-2">
          <button onClick={() => setFilterVehicles(!filterVehicles)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${filterVehicles ? 'bg-sky-500/20 border-sky-500/40 text-sky-300' : 'bg-gray-800/50 border-gray-700/50 text-gray-500 hover:text-gray-300 hover:border-gray-600'}`}>
            {filterVehicles && <span className="mr-0.5">✓</span>} Has vehicles
          </button>
          <button onClick={() => setFilterInstagram(!filterInstagram)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${filterInstagram ? 'bg-pink-500/20 border-pink-500/40 text-pink-300' : 'bg-gray-800/50 border-gray-700/50 text-gray-500 hover:text-gray-300 hover:border-gray-600'}`}>
            {filterInstagram && <span className="mr-0.5">✓</span>} Has Instagram
          </button>
          {favorites.size > 0 && (
            <button onClick={() => setFilterFavorites(!filterFavorites)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${filterFavorites ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-gray-800/50 border-gray-700/50 text-gray-500 hover:text-gray-300 hover:border-gray-600'}`}>
              {filterFavorites && <span className="mr-0.5">✓</span>} ★ Favorites ({favorites.size})
            </button>
          )}
          {(filterVehicles || filterInstagram || filterFavorites) && (
            <button onClick={() => { setFilterVehicles(false); setFilterInstagram(false); setFilterFavorites(false); }}
              className="px-1.5 py-0.5 rounded-full text-[10px] text-gray-500 hover:text-gray-300 transition-colors" title="Clear filters">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        {/* Filtered result count */}
        {(filterVehicles || filterInstagram || filterFavorites || searchTerm) && sortedCollections.length !== scopedCollections.length && (
          <div className="mt-1.5 text-[10px] text-gray-500">
            Showing {sortedCollections.length} of {scopedCollections.length}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto custom-scroll">
        {viewMode === 'list' ? (
          // List view
          sortedCollections.slice(0, 100).map(c => {
            const isExpanded = expandedId === c.id;
            return (
              <div key={c.id}
                onMouseEnter={() => setHighlightedId(c.id)} onMouseLeave={() => setHighlightedId(null)}
                className={`border-b border-gray-800/30 transition-all group ${highlightedId === c.id ? 'bg-sky-500/10 border-l-2 border-l-sky-500' : 'hover:bg-gray-800/40'}`}>
                <div className="px-3 py-2.5 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : c.id)}>
                  <div className="flex items-start gap-2.5">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt="" className="w-8 h-8 rounded-md object-cover flex-shrink-0 bg-gray-800" />
                    ) : (
                      <div className="w-8 h-8 rounded-md bg-gradient-to-br from-sky-900/40 to-blue-900/40 flex items-center justify-center flex-shrink-0">
                        <span className="text-sky-400 text-[10px] font-bold">{c.name.charAt(0)}</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-xs font-medium truncate group-hover:text-sky-400 transition-colors">
                        <HighlightText text={c.name} query={searchTerm} />
                      </div>
                      <p className="text-gray-500 text-[10px] truncate">
                        <HighlightText text={`${c.city}${c.city && c.country ? ', ' : ''}${c.country}`} query={searchTerm} />
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {c.total_inventory > 0 && <span className="text-sky-400/80 text-[10px] font-medium">{c.total_inventory} vehicles</span>}
                        {c.instagram && <span className="text-pink-400/60 text-[10px] truncate">@{c.instagram}</span>}
                      </div>
                    </div>
                    {/* Favorite star */}
                    <button onClick={(e) => { e.stopPropagation(); toggleFavorite(c.id); }}
                      className={`flex-shrink-0 w-5 h-5 flex items-center justify-center transition-colors ${favorites.has(c.id) ? 'text-amber-400 star-pop' : 'text-gray-700 opacity-0 group-hover:opacity-100 hover:text-amber-400'}`}
                      title={favorites.has(c.id) ? 'Remove from favorites' : 'Add to favorites'}>
                      <svg className="w-3.5 h-3.5" fill={favorites.has(c.id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                    </button>
                    {/* Expand indicator */}
                    <svg className={`w-3 h-3 text-gray-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-0 fade-in">
                    <div className="ml-[42px] space-y-2">
                      {/* Quick info badges */}
                      <div className="flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-800/80 text-gray-400 text-[10px]">
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>
                          {c.lat.toFixed(3)}, {c.lng.toFixed(3)}
                        </span>
                        {c.state && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-800/80 text-gray-400 text-[10px]">
                            {c.state}
                          </span>
                        )}
                        {drill.level === 'world' && COUNTRY_FLAGS[c.country] && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-800/80 text-gray-400 text-[10px]">
                            {COUNTRY_FLAGS[c.country]} {c.country}
                          </span>
                        )}
                      </div>
                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <Link to={`/org/${c.slug}`}
                          className="flex-1 text-center px-2.5 py-1.5 bg-sky-600/20 text-sky-400 text-[10px] font-medium rounded-lg border border-sky-500/20 hover:bg-sky-600/30 transition-colors">
                          View Collection
                        </Link>
                        <button onClick={(e) => { e.stopPropagation(); mapRef.current?.flyTo([c.lat, c.lng], 14, { duration: 0.8 }); setHighlightedId(c.id); }}
                          className="px-2.5 py-1.5 bg-gray-800/60 text-gray-400 text-[10px] font-medium rounded-lg border border-gray-700/50 hover:text-white hover:bg-gray-700/60 transition-colors">
                          Locate
                        </button>
                        {c.instagram && (
                          <a href={`https://instagram.com/${c.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                            className="px-2.5 py-1.5 bg-pink-500/10 text-pink-400 text-[10px] font-medium rounded-lg border border-pink-500/20 hover:bg-pink-500/20 transition-colors">
                            Instagram
                          </a>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); toggleCompare(c.id); }}
                          className={`px-2.5 py-1.5 text-[10px] font-medium rounded-lg border transition-colors ${compareIds.has(c.id) ? 'bg-violet-500/20 text-violet-400 border-violet-500/30' : 'bg-gray-800/60 text-gray-400 border-gray-700/50 hover:text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/30'}`}>
                          {compareIds.has(c.id) ? '✓ Compare' : 'Compare'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          // Grid view
          <div className="grid grid-cols-2 gap-1.5 p-2">
            {sortedCollections.slice(0, 80).map(c => (
              <div key={c.id}
                onMouseEnter={() => setHighlightedId(c.id)} onMouseLeave={() => setHighlightedId(null)}
                className={`relative rounded-xl border transition-all group overflow-hidden ${highlightedId === c.id ? 'bg-sky-500/15 border-sky-500/40 ring-1 ring-sky-500/20' : 'bg-gray-800/30 border-gray-800/50 hover:bg-gray-800/60 hover:border-gray-700/50'}`}>
                {/* Favorite indicator */}
                {favorites.has(c.id) && (
                  <div className="absolute top-1.5 right-1.5 z-10 text-amber-400 text-[10px]">★</div>
                )}
                {/* Gradient header strip */}
                <div className="h-1 w-full" style={{ background: c.total_inventory > 0 ? 'linear-gradient(90deg, #2563eb, #38bdf8, #34d399)' : 'linear-gradient(90deg, #1e293b, #334155)' }} />
                <Link to={`/org/${c.slug}`} className="block p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0 bg-gray-800 ring-1 ring-gray-700/50" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-900/50 to-blue-900/50 flex items-center justify-center flex-shrink-0 ring-1 ring-sky-500/10">
                        <span className="text-sky-400 text-xs font-bold">{c.name.charAt(0)}</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="text-white text-[10px] font-medium truncate group-hover:text-sky-400 transition-colors leading-tight">
                        <HighlightText text={c.name} query={searchTerm} />
                      </h3>
                      <p className="text-gray-500 text-[9px] truncate">{c.city}{c.city && c.country ? ', ' : ''}{c.country}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {c.total_inventory > 0 && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-sky-500/10 text-sky-400 text-[9px] font-semibold border border-sky-500/10">
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                        {c.total_inventory}
                      </span>
                    )}
                    {c.instagram && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-pink-500/10 text-pink-400 text-[9px] border border-pink-500/10">
                        @{c.instagram.length > 12 ? c.instagram.slice(0, 12) + '…' : c.instagram}
                      </span>
                    )}
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
        {sortedCollections.length === 0 && (
          <div className="px-4 py-12 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-800/50 flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
            <div className="text-gray-500 text-xs font-medium">No collections found</div>
            <div className="text-gray-600 text-[10px] mt-1">
              {(filterVehicles || filterInstagram || filterFavorites) ? 'Try removing some filters' : searchTerm ? 'Try a different search term' : 'Drill into a region to see collections'}
            </div>
            {(filterVehicles || filterInstagram || filterFavorites) && (
              <button onClick={() => { setFilterVehicles(false); setFilterInstagram(false); setFilterFavorites(false); }}
                className="mt-3 px-3 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-[10px] font-medium transition-colors">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div ref={mapContainerRef} className="fullscreen-content h-screen flex flex-col bg-gray-950">
      <style>{MAP_STYLES}</style>

      {/* ── Header ── */}
      <div className="bg-gray-900/80 backdrop-blur border-b border-gray-800 px-3 sm:px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            {/* Mobile hamburger */}
            {isCompact && (
              <button onClick={() => setSidebarOpen(true)}
                className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-800/60 border border-gray-700/50 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700/60 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-white tracking-tight truncate">Collections Map</h1>
              {!isMobile && (
                <p className="text-gray-500 text-[10px] sm:text-xs">{stats.total} collections / {stats.vehicles.toLocaleString()} vehicles / {stats.countries} countries</p>
              )}
            </div>
            {/* Breadcrumbs - desktop */}
            {!isMobile && drill.level !== 'world' && (
              <div className="flex items-center gap-1 text-sm ml-2 px-3 py-1 rounded-full bg-gray-800/60 border border-gray-700/50">
                {breadcrumbs.map((bc, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-gray-600 text-xs">/</span>}
                    {i === 1 && COUNTRY_FLAGS[bc.label] && <span className="text-sm">{COUNTRY_FLAGS[bc.label]}</span>}
                    <button onClick={bc.onClick} className={`whitespace-nowrap ${i === breadcrumbs.length - 1 ? 'text-sky-400 font-medium' : 'text-gray-400 hover:text-gray-200'}`}>{bc.label}</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Search */}
            {!isMobile || searchExpanded ? (
              <div className="relative">
                <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  autoFocus={isMobile && searchExpanded}
                  className={`pl-7 sm:pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 ${isMobile ? 'w-40' : 'w-44 sm:w-52'}`} />
                <svg className="absolute left-2 sm:left-2.5 top-2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                {isMobile && (
                  <button onClick={() => { setSearchExpanded(false); setSearchTerm(''); }} className="absolute right-2 top-1.5 text-gray-500 hover:text-white">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            ) : (
              <button onClick={() => setSearchExpanded(true)}
                className="w-8 h-8 rounded-lg bg-gray-800/60 border border-gray-700/50 flex items-center justify-center text-gray-400 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </button>
            )}
            {/* Discover random collection */}
            <button onClick={discoverRandom} title="Discover a random collection"
              className="w-8 h-8 rounded-lg bg-gray-800/60 border border-gray-700/50 flex items-center justify-center text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/30 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            </button>
            {/* Auto-tour button */}
            <button onClick={touring ? stopTour : startTour} title={touring ? 'Stop tour' : 'Auto-tour collections'}
              className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${touring ? 'bg-sky-600/30 border-sky-500/50 text-sky-300' : 'bg-gray-800/60 border-gray-700/50 text-gray-400 hover:text-sky-400 hover:bg-sky-500/10 hover:border-sky-500/30'}`}>
              {touring ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            {/* Metric toggle */}
            <div className="flex rounded-md overflow-hidden border border-gray-700">
              {(['count', 'inventory'] as const).map(m => (
                <button key={m} onClick={() => setMetric(m)}
                  className={`px-2 sm:px-3 py-1.5 text-[10px] sm:text-xs font-medium transition-colors ${metric === m ? 'bg-sky-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                  {m === 'count' ? 'Count' : 'Vehicles'}
                </button>
              ))}
            </div>
            {/* Mobile panel toggle */}
            {isCompact && (
              <button onClick={() => setPanelOpen(true)}
                className="w-8 h-8 rounded-lg bg-gray-800/60 border border-gray-700/50 flex items-center justify-center text-gray-400 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
              </button>
            )}
          </div>
        </div>
        {/* Mobile breadcrumbs */}
        {isMobile && drill.level !== 'world' && (
          <div className="flex items-center gap-1 text-xs mt-1.5 overflow-x-auto">
            {breadcrumbs.map((bc, i) => (
              <span key={i} className="flex items-center gap-1 flex-shrink-0">
                {i > 0 && <span className="text-gray-600 text-[10px]">/</span>}
                {i === 1 && COUNTRY_FLAGS[bc.label] && <span className="text-xs">{COUNTRY_FLAGS[bc.label]}</span>}
                <button onClick={bc.onClick} className={i === breadcrumbs.length - 1 ? 'text-sky-400 font-medium' : 'text-gray-400'}>{bc.label}</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex min-h-0 relative">

        {/* Sidebar - desktop: static column */}
        {!isCompact && (
          <div className="w-60 bg-gray-900/50 border-r border-gray-800 flex flex-col min-h-0">
            {renderSidebar()}
          </div>
        )}

        {/* Sidebar - mobile/tablet: slide-in overlay */}
        {isCompact && (
          <>
            {sidebarOpen && (
              <div className="fixed inset-0 bg-black/50 z-[1100] backdrop-fade" onClick={() => setSidebarOpen(false)} />
            )}
            <div className={`fixed top-0 left-0 bottom-0 w-72 bg-gray-900 border-r border-gray-800 z-[1200] sidebar-slide ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
              {renderSidebar()}
            </div>
          </>
        )}

        {/* ── Map area ── */}
        <div className="flex-1 relative min-h-0 min-w-0">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="w-16 h-16 border-2 border-sky-500/20 rounded-full" />
                  <div className="absolute inset-0 w-16 h-16 border-2 border-transparent border-t-sky-500 rounded-full animate-spin" />
                  <svg className="absolute inset-0 m-auto w-6 h-6 text-sky-500/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div className="text-center">
                  <div className="text-white text-sm font-medium">Loading Collections Map</div>
                  <div className="text-gray-500 text-xs mt-1">Discovering collections worldwide...</div>
                </div>
              </div>
            </div>
          ) : (
            <MapContainer center={[20, 0]} zoom={2} className={`absolute inset-0 ${mapStyle === 'light' ? 'map-light' : ''}`}
              style={{ background: mapStyle === 'light' ? '#f0f0f0' : '#0a0f1a' }}
              zoomControl={false} attributionControl={false}>
              <MapInstance onMap={handleMap} onMoveEnd={handleMoveEnd} />
              <TileLayer key={mapStyle} url={MAP_TILES[mapStyle].url} />
              <MapLayers collections={collections} drill={drill} setDrill={setDrill} metric={metric} searchTerm={searchTerm}
                worldGeo={worldGeo} statesGeo={statesGeo} countiesGeo={countiesGeo} stateAssign={stateAssign} countyAssign={countyAssign} highlightedId={highlightedId}
                favorites={favorites} toggleFavorite={toggleFavorite} showHeatmap={showHeatmap} />
            </MapContainer>
          )}

          {/* Drill transition overlay */}
          {transitioning && (
            <div className="absolute inset-0 z-[999] bg-gray-950/30 pointer-events-none drill-transition" />
          )}

          {/* Tour overlay */}
          {touring && (
            <>
              <div className="absolute top-0 left-0 right-0 z-[1001] h-1 bg-gray-800/50">
                <div key={tourIndex} className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 tour-progress" />
              </div>
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1001] bg-gray-900/90 backdrop-blur rounded-xl px-4 py-2 border border-sky-500/30 flex items-center gap-3 fade-in">
                <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                <span className="text-white text-xs font-medium">
                  Touring {tourIndex % (sortedCollections.length || collections.length) + 1} / {sortedCollections.length || collections.length}
                </span>
                <button onClick={stopTour} className="text-gray-400 hover:text-white transition-colors ml-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </>
          )}

          {/* Back button + drill level indicator */}
          {drill.level !== 'world' && (
            <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 fade-in">
              <button onClick={goBack} title="Go back (Esc)"
                className="h-8 pl-2 pr-3 rounded-lg bg-gray-900/80 backdrop-blur border border-gray-700/50 text-gray-300 hover:text-white hover:bg-gray-800 flex items-center gap-1.5 text-xs font-medium transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back
              </button>
              {/* Drill depth dots */}
              <div className="flex items-center gap-1 h-8 px-2 rounded-lg bg-gray-900/60 backdrop-blur border border-gray-800/30">
                {DRILL_ORDER.map((level, i) => (
                  <div key={level} className={`rounded-full transition-all duration-300 ${
                    i <= DRILL_ORDER.indexOf(drill.level)
                      ? 'w-2 h-2 bg-sky-400'
                      : 'w-1.5 h-1.5 bg-gray-700'
                  }`} title={level} />
                ))}
              </div>
            </div>
          )}

          {/* Map controls - top right */}
          <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
            <button onClick={() => mapRef.current?.zoomIn()} title="Zoom in"
              className="w-8 h-8 rounded-lg bg-gray-900/80 backdrop-blur border border-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center transition-colors text-lg font-light leading-none">
              +
            </button>
            <button onClick={() => mapRef.current?.zoomOut()} title="Zoom out"
              className="w-8 h-8 rounded-lg bg-gray-900/80 backdrop-blur border border-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center transition-colors text-lg font-light leading-none">
              -
            </button>
            <div className="w-full h-px bg-gray-700/30 my-0.5" />
            <button onClick={() => setDrill({ level: 'world' })} title="Reset view"
              className="w-8 h-8 rounded-lg bg-gray-900/80 backdrop-blur border border-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
            <button onClick={toggleFullscreen} title="Fullscreen"
              className="w-8 h-8 rounded-lg bg-gray-900/80 backdrop-blur border border-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
            </button>
            <button onClick={shareUrl} title={copied ? 'Copied!' : 'Copy link'} className="relative">
              <div className={`w-8 h-8 rounded-lg bg-gray-900/80 backdrop-blur border border-gray-700/50 flex items-center justify-center transition-colors ${copied ? 'text-emerald-400 border-emerald-500/30' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
                {copied ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                )}
              </div>
              {copied && (
                <div className="absolute right-10 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[10px] font-medium whitespace-nowrap fade-in">
                  Copied!
                </div>
              )}
            </button>
            <div className="w-full h-px bg-gray-700/30 my-0.5" />
            {/* Map style switcher */}
            <div className="relative group/style">
              <button title="Map style"
                className="w-8 h-8 rounded-lg bg-gray-900/80 backdrop-blur border border-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-800 flex items-center justify-center transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
              </button>
              <div className="absolute right-10 top-0 hidden group-hover/style:flex items-center gap-1 bg-gray-900/90 backdrop-blur rounded-lg p-1 border border-gray-700/50 shadow-xl">
                {(['dark', 'satellite', 'light'] as const).map(s => (
                  <button key={s} onClick={() => setMapStyle(s)} title={s.charAt(0).toUpperCase() + s.slice(1)}
                    className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium whitespace-nowrap transition-colors ${mapStyle === s ? 'bg-sky-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700/60'}`}>
                    {s === 'dark' ? '🌙 Dark' : s === 'satellite' ? '🛰 Satellite' : '☀️ Light'}
                  </button>
                ))}
              </div>
            </div>
            {/* Heatmap toggle */}
            <button onClick={() => setShowHeatmap(!showHeatmap)} title={showHeatmap ? 'Hide density glow' : 'Show density glow'}
              className={`w-8 h-8 rounded-lg backdrop-blur border flex items-center justify-center transition-colors ${showHeatmap ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-400' : 'bg-gray-900/80 border-gray-700/50 text-gray-400 hover:text-cyan-400 hover:bg-gray-800'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" /></svg>
            </button>
          </div>

          {/* Color legend */}
          <div className={`absolute z-[1000] bg-gray-900/80 backdrop-blur rounded-xl p-2.5 border border-gray-800/50 legend-interactive ${isMobile ? 'bottom-3 right-3' : 'bottom-14 right-3'}`}>
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-sky-400/60" />
              {metric === 'count' ? 'Collections' : 'Vehicles'} per {levelLabel}
            </div>
            <div className="w-24 sm:w-32 h-2.5 rounded-full legend-bar" style={{ background: `linear-gradient(to right, ${choroplethGradientCSS()})` }} />
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-gray-600 font-medium">0</span>
              <span className="text-[9px] text-gray-500 font-medium tabular-nums">{fmtNum(legendMax)}</span>
            </div>
          </div>

          {/* Minimap inset - shows world context when drilled in */}
          {!isMobile && drill.level !== 'world' && (
            <div className="absolute bottom-32 left-3 z-[1000] minimap-container minimap-enter border border-gray-700/50"
              style={{ width: 140, height: 90 }}>
              <MapContainer center={[20, 0]} zoom={1} zoomControl={false} attributionControl={false}
                dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false}
                style={{ width: 140, height: 90, background: '#0a0f1a' }}>
                <TileLayer url={MAP_TILES.dark.url} />
                {/* Viewport indicator */}
                {(() => {
                  const c = drill.country && COUNTRY_COORDS[drill.country] ? COUNTRY_COORDS[drill.country] : mapCenter;
                  return (
                    <CircleMarker center={c} radius={6}
                      pathOptions={{ color: '#38bdf8', fillColor: '#38bdf8', fillOpacity: 0.3, weight: 2 }} />
                  );
                })()}
              </MapContainer>
              <button onClick={() => setDrill({ level: 'world' })}
                className="absolute top-1 right-1 w-4 h-4 rounded bg-gray-900/80 flex items-center justify-center text-gray-500 hover:text-white transition-colors"
                title="Back to world view">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </button>
            </div>
          )}

          {/* Summary stats */}
          <div className={`absolute bottom-3 left-3 z-[1000] bg-gray-900/80 backdrop-blur rounded-xl px-1 py-1 border border-gray-800/50 flex items-stretch ${isMobile ? 'gap-0' : 'gap-0'}`}>
            <div className="stat-card px-3 py-1.5 rounded-lg cursor-default">
              <div className="text-white text-sm font-bold tabular-nums">{stats.total}</div>
              <div className="text-[9px] text-gray-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 inline-block" />
                Collections
              </div>
            </div>
            <div className="w-px self-stretch my-1.5 bg-gray-700/50" />
            <div className="stat-card px-3 py-1.5 rounded-lg cursor-default">
              <div className="text-sky-400 text-sm font-bold tabular-nums">{stats.vehicles.toLocaleString()}</div>
              <div className="text-[9px] text-gray-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400/40 inline-block" />
                Vehicles
              </div>
            </div>
            {!isMobile && (
              <>
                <div className="w-px self-stretch my-1.5 bg-gray-700/50" />
                <div className="stat-card px-3 py-1.5 rounded-lg cursor-default">
                  <div className="text-emerald-400 text-sm font-bold tabular-nums">{stats.cities}</div>
                  <div className="text-[9px] text-gray-500 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/40 inline-block" />
                    Cities
                  </div>
                </div>
                <div className="w-px self-stretch my-1.5 bg-gray-700/50" />
                <div className="stat-card px-3 py-1.5 rounded-lg cursor-default">
                  <div className="text-amber-400 text-sm font-bold tabular-nums">{stats.countries}</div>
                  <div className="text-[9px] text-gray-500 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/40 inline-block" />
                    Countries
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Keyboard hints */}
          {!isMobile && drill.level !== 'world' && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] text-[10px] text-gray-600 flex items-center gap-3">
              <span>
                <kbd className="px-1 py-0.5 rounded bg-gray-800/60 border border-gray-700/40 text-gray-500 font-mono text-[9px]">Esc</kbd> Back
              </span>
              <span className="opacity-50">|</span>
              <span>
                <kbd className="px-1 py-0.5 rounded bg-gray-800/60 border border-gray-700/40 text-gray-500 font-mono text-[9px]">1</kbd>
                <kbd className="px-1 py-0.5 rounded bg-gray-800/60 border border-gray-700/40 text-gray-500 font-mono text-[9px] ml-0.5">2</kbd>
                <kbd className="px-1 py-0.5 rounded bg-gray-800/60 border border-gray-700/40 text-gray-500 font-mono text-[9px] ml-0.5">3</kbd> Style
              </span>
            </div>
          )}
          {/* First visit hint */}
          {!isMobile && drill.level === 'world' && !searchTerm && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] text-[10px] text-gray-500 bg-gray-900/60 backdrop-blur rounded-lg px-3 py-1.5 border border-gray-800/30 fade-in">
              Click any country to explore its collections
            </div>
          )}
        </div>

        {/* Right panel - desktop: static column */}
        {!isCompact && (
          <div className="w-72 bg-gray-900/50 border-l border-gray-800 flex flex-col min-h-0">
            {renderRightPanel()}
          </div>
        )}

        {/* Right panel - mobile/tablet: bottom sheet */}
        {isCompact && (
          <>
            {panelOpen && (
              <div className="fixed inset-0 bg-black/50 z-[1100] backdrop-fade" onClick={() => setPanelOpen(false)} />
            )}
            <div className={`fixed left-0 right-0 bottom-0 bg-gray-900 border-t border-gray-800 z-[1200] rounded-t-2xl panel-slide ${panelOpen ? 'translate-y-0' : 'translate-y-full'}`}
              style={{ height: isMobile ? '65vh' : '50vh' }}>
              {/* Drag handle */}
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-8 h-1 rounded-full bg-gray-700" />
              </div>
              {renderRightPanel()}
            </div>
          </>
        )}

        {/* Mobile: peek bar - shows top collections when panel is closed */}
        {isMobile && !panelOpen && sortedCollections.length > 0 && (
          <button onClick={() => setPanelOpen(true)}
            className="fixed bottom-0 left-0 right-0 z-[1050] bg-gray-900/90 backdrop-blur border-t border-gray-800/50 px-3 py-2 flex items-center gap-3">
            <div className="flex -space-x-2">
              {sortedCollections.slice(0, 5).map(c => (
                c.logo_url ? (
                  <img key={c.id} src={c.logo_url} alt="" className="w-7 h-7 rounded-full border-2 border-gray-900 object-cover bg-gray-800" />
                ) : (
                  <div key={c.id} className="w-7 h-7 rounded-full border-2 border-gray-900 bg-gradient-to-br from-sky-900 to-blue-900 flex items-center justify-center">
                    <span className="text-[8px] text-sky-400 font-bold">{c.name.charAt(0)}</span>
                  </div>
                )
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-white text-[11px] font-medium">{sortedCollections.length} collections</div>
              <div className="text-gray-500 text-[9px]">Tap to browse</div>
            </div>
            <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        )}

        {/* Compare bar - appears when collections are selected for comparison */}
        {compareIds.size >= 2 && (
          <div className="fixed bottom-0 left-0 right-0 z-[1300] bg-gray-900/95 backdrop-blur border-t border-violet-500/30 slide-up">
            <div className="flex items-center justify-between px-4 py-2">
              <div className="flex items-center gap-3 overflow-x-auto custom-scroll">
                {compareCollections.map(c => (
                  <div key={c.id} className="flex items-center gap-1.5 flex-shrink-0">
                    {c.logo_url ? (
                      <img src={c.logo_url} alt="" className="w-6 h-6 rounded-full object-cover border border-violet-500/30" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-violet-900/40 flex items-center justify-center border border-violet-500/30">
                        <span className="text-[8px] text-violet-400 font-bold">{c.name.charAt(0)}</span>
                      </div>
                    )}
                    <span className="text-white text-[10px] font-medium whitespace-nowrap">{c.name.length > 15 ? c.name.slice(0, 13) + '…' : c.name}</span>
                    <button onClick={() => toggleCompare(c.id)} className="text-gray-500 hover:text-white ml-0.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                <button onClick={() => setCompareOpen(!compareOpen)}
                  className="px-3 py-1.5 bg-violet-600/20 text-violet-400 text-[10px] font-medium rounded-lg border border-violet-500/30 hover:bg-violet-600/30 transition-colors">
                  {compareOpen ? 'Hide' : 'Compare'} ({compareIds.size})
                </button>
                <button onClick={() => { setCompareIds(new Set()); setCompareOpen(false); }}
                  className="px-2 py-1.5 text-gray-500 hover:text-white text-[10px] transition-colors">
                  Clear
                </button>
              </div>
            </div>
            {/* Comparison table */}
            {compareOpen && (
              <div className="px-4 pb-3 pt-1 border-t border-gray-800/50 overflow-x-auto custom-scroll fade-in">
                <table className="w-full text-[10px] min-w-[400px]">
                  <thead>
                    <tr className="text-gray-500">
                      <th className="text-left py-1 font-medium w-24">Metric</th>
                      {compareCollections.map(c => (
                        <th key={c.id} className="text-center py-1 font-medium">{c.name.length > 12 ? c.name.slice(0, 10) + '…' : c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-gray-800/30">
                      <td className="py-1.5 text-gray-400">City</td>
                      {compareCollections.map(c => <td key={c.id} className="text-center text-white py-1.5">{c.city || '-'}</td>)}
                    </tr>
                    <tr className="border-t border-gray-800/30">
                      <td className="py-1.5 text-gray-400">Country</td>
                      {compareCollections.map(c => <td key={c.id} className="text-center text-white py-1.5">{COUNTRY_FLAGS[c.country] || ''} {c.country}</td>)}
                    </tr>
                    <tr className="border-t border-gray-800/30">
                      <td className="py-1.5 text-gray-400">Vehicles</td>
                      {compareCollections.map(c => (
                        <td key={c.id} className="text-center py-1.5">
                          <span className={c.total_inventory === Math.max(...compareCollections.map(x => x.total_inventory)) && c.total_inventory > 0 ? 'text-sky-400 font-semibold' : 'text-white'}>
                            {c.total_inventory}
                          </span>
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-gray-800/30">
                      <td className="py-1.5 text-gray-400">Instagram</td>
                      {compareCollections.map(c => (
                        <td key={c.id} className="text-center text-pink-400 py-1.5">
                          {c.instagram ? `@${c.instagram}` : <span className="text-gray-600">-</span>}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-gray-800/30">
                      <td className="py-1.5 text-gray-400">Link</td>
                      {compareCollections.map(c => (
                        <td key={c.id} className="text-center py-1.5">
                          <Link to={`/org/${c.slug}`} className="text-sky-400 hover:text-sky-300 transition-colors">View →</Link>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const SAMPLE: Collection[] = [
  { id: 's1', slug: 'jay-lenos-car-collection', name: "Jay Leno's Car Collection", instagram: 'jaylenosgarage', country: 'USA', city: 'Burbank, CA', state: 'California', lat: 34.1808, lng: -118.309, total_inventory: 0, logo_url: null },
  { id: 's2', slug: 'ferrari-museum-maranello', name: 'Ferrari Museum Maranello', instagram: null, country: 'Italy', city: 'Maranello', state: null, lat: 44.5294, lng: 10.8656, total_inventory: 0, logo_url: null },
];
