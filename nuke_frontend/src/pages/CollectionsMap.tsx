import { useEffect, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';
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

interface Agg {
  count: number;
  inventory: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

// Map between our DB country names and Natural Earth TopoJSON names
const OUR_TO_TOPO: Record<string, string> = {
  'USA': 'United States of America',
  'UK': 'United Kingdom',
  'UAE': 'United Arab Emirates',
};
const TOPO_TO_OURS: Record<string, string> = {};
Object.entries(OUR_TO_TOPO).forEach(([k, v]) => { TOPO_TO_OURS[v] = k; });

function toOurName(topoName: string): string { return TOPO_TO_OURS[topoName] || topoName; }
function toTopoName(ourName: string): string { return OUR_TO_TOPO[ourName] || ourName; }

const COUNTRY_COORDS: Record<string, [number, number]> = {
  'USA': [39.8283, -98.5795], 'UK': [55.3781, -3.4360], 'Italy': [41.8719, 12.5674],
  'Germany': [51.1657, 10.4515], 'France': [46.2276, 2.2137], 'Monaco': [43.7384, 7.4246],
  'Switzerland': [46.8182, 8.2275], 'Japan': [36.2048, 138.2529], 'UAE': [23.4241, 53.8478],
  'Qatar': [25.3548, 51.1839], 'South Korea': [35.9078, 127.7669], 'Taiwan': [23.6978, 120.9605],
  'Australia': [-25.2744, 133.7751], 'Canada': [56.1304, -106.3468], 'Singapore': [1.3521, 103.8198],
  'Belgium': [50.5039, 4.4699], 'Poland': [51.9194, 19.1451], 'Denmark': [56.2639, 9.5018],
  'Chile': [-35.6751, -71.543], 'Turkey': [38.9637, 35.2433], 'Austria': [47.5162, 14.5501],
  'Norway': [60.4720, 8.4689], 'Netherlands': [52.1326, 5.2913], 'New Zealand': [-40.9006, 174.886],
  'Czechia': [49.8175, 15.4730], 'Morocco': [31.7917, -7.0926], 'China': [35.8617, 104.1954],
  'Brazil': [-14.2350, -51.9253], 'Thailand': [15.8700, 100.9925], 'Mexico': [23.6345, -102.5528],
  'India': [20.5937, 78.9629], 'Hong Kong': [22.3193, 114.1694], 'Israel': [31.0461, 34.8516],
  'Portugal': [39.3999, -8.2245], 'Malaysia': [4.2105, 101.9758], 'Saudi Arabia': [23.8859, 45.0792],
  'Oman': [21.4735, 55.9754], 'Lebanon': [33.8547, 35.8623], 'Slovakia': [48.6690, 19.6990],
  'Dominican Republic': [18.7357, -70.1627], 'Kazakhstan': [48.0196, 66.9237],
};

// ── Color utilities ──────────────────────────────────────────────────────────

function choroplethColor(value: number, maxValue: number): string {
  if (!value || !maxValue) return 'rgba(30, 41, 59, 0.15)';
  const t = Math.sqrt(Math.min(value / maxValue, 1));
  const r = Math.round(30 * (1 - t) + 147 * t);
  const g = Math.round(58 * (1 - t) + 197 * t);
  const b = Math.round(138 * (1 - t) + 253 * t);
  return `rgb(${r}, ${g}, ${b})`;
}

const MARKER_ICON = L.divIcon({
  className: '',
  html: `<div style="background:#3b82f6;width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -7],
});

// ── Aggregation helpers ──────────────────────────────────────────────────────

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

// ── MapLayers: renders choropleth / bubbles / markers based on drill level ──

function MapLayers({
  collections, drill, setDrill, metric, searchTerm,
}: {
  collections: Collection[];
  drill: DrillState;
  setDrill: (d: DrillState) => void;
  metric: 'count' | 'inventory';
  searchTerm: string;
}) {
  const map = useMap();

  // TopoJSON data (loaded lazily)
  const [worldTopo, setWorldTopo] = useState<Topology | null>(null);
  const [statesTopo, setStatesTopo] = useState<Topology | null>(null);
  const [countiesTopo, setCountiesTopo] = useState<Topology | null>(null);

  // Load world on mount
  useEffect(() => { fetch('/data/world-110m.json').then(r => r.json()).then(setWorldTopo); }, []);

  // Load US states when first needed
  useEffect(() => {
    if (drill.country === 'USA' && !statesTopo)
      fetch('/data/us-states-10m.json').then(r => r.json()).then(setStatesTopo);
  }, [drill.country, statesTopo]);

  // Load US counties when first needed
  useEffect(() => {
    if (drill.level === 'state' && drill.country === 'USA' && !countiesTopo)
      fetch('/data/us-counties-10m.json').then(r => r.json()).then(setCountiesTopo);
  }, [drill.level, drill.country, countiesTopo]);

  // Convert TopoJSON → GeoJSON
  const worldGeo = useMemo<FeatureCollection | null>(() => {
    if (!worldTopo) return null;
    return topojson.feature(worldTopo, worldTopo.objects.countries) as unknown as FeatureCollection;
  }, [worldTopo]);

  const statesGeo = useMemo<FeatureCollection | null>(() => {
    if (!statesTopo) return null;
    return topojson.feature(statesTopo, statesTopo.objects.states) as unknown as FeatureCollection;
  }, [statesTopo]);

  const countiesGeo = useMemo<FeatureCollection | null>(() => {
    if (!countiesTopo) return null;
    return topojson.feature(countiesTopo, countiesTopo.objects.counties) as unknown as FeatureCollection;
  }, [countiesTopo]);

  // Assign US collections to states via point-in-polygon
  const stateAssign = useMemo(() => {
    const m = new Map<string, string>(); // collection.id → state FIPS
    if (!statesGeo) return m;
    const usColls = collections.filter(c => c.country === 'USA');
    for (const c of usColls) {
      const pt = point([c.lng, c.lat]);
      for (const feat of statesGeo.features) {
        try {
          if (booleanPointInPolygon(pt, feat as any)) {
            m.set(c.id, feat.id as string);
            break;
          }
        } catch { /* skip malformed geometry */ }
      }
    }
    return m;
  }, [collections, statesGeo]);

  // Assign US collections to counties
  const countyAssign = useMemo(() => {
    const m = new Map<string, string>(); // collection.id → county FIPS
    if (!countiesGeo || stateAssign.size === 0) return m;
    const usColls = collections.filter(c => c.country === 'USA');
    for (const c of usColls) {
      const sid = stateAssign.get(c.id);
      if (!sid) continue;
      const pt = point([c.lng, c.lat]);
      for (const feat of countiesGeo.features) {
        if (!(feat.id as string).startsWith(sid)) continue;
        try {
          if (booleanPointInPolygon(pt, feat as any)) {
            m.set(c.id, feat.id as string);
            break;
          }
        } catch { /* skip */ }
      }
    }
    return m;
  }, [collections, countiesGeo, stateAssign]);

  // State/county name lookups
  const stateNames = useMemo(() => {
    const m = new Map<string, string>();
    statesGeo?.features.forEach(f => m.set(f.id as string, f.properties?.name || ''));
    return m;
  }, [statesGeo]);

  const countyNames = useMemo(() => {
    const m = new Map<string, string>();
    countiesGeo?.features.forEach(f => m.set(f.id as string, f.properties?.name || ''));
    return m;
  }, [countiesGeo]);

  // Apply search filter to collections for aggregation
  const filtered = useMemo(() => {
    if (!searchTerm) return collections;
    const term = searchTerm.toLowerCase();
    return collections.filter(c =>
      c.name.toLowerCase().includes(term) ||
      c.slug.toLowerCase().includes(term) ||
      c.city.toLowerCase().includes(term) ||
      (c.instagram && c.instagram.toLowerCase().includes(term))
    );
  }, [collections, searchTerm]);

  // ── Fly-to on drill changes ──────────────────────────────────────────────
  useEffect(() => {
    switch (drill.level) {
      case 'world':
        map.flyTo([20, 0], 2, { duration: 0.8 });
        break;
      case 'country': {
        const coords = COUNTRY_COORDS[drill.country!];
        if (coords) map.flyTo(coords, drill.country === 'USA' ? 4 : 5, { duration: 0.8 });
        break;
      }
      case 'state': {
        if (statesGeo && drill.stateId) {
          const feat = statesGeo.features.find(f => f.id === drill.stateId);
          if (feat) map.fitBounds(L.geoJSON(feat as any).getBounds(), { padding: [30, 30] });
        }
        break;
      }
      case 'county': {
        if (countiesGeo && drill.countyId) {
          const feat = countiesGeo.features.find(f => f.id === drill.countyId);
          if (feat) map.fitBounds(L.geoJSON(feat as any).getBounds(), { padding: [40, 40] });
        }
        break;
      }
      case 'markers': {
        const mc = drill.city
          ? filtered.filter(c => c.city === drill.city && c.country === drill.country)
          : drill.countyId
            ? filtered.filter(c => countyAssign.get(c.id) === drill.countyId)
            : [];
        if (mc.length > 0) {
          const bounds = L.latLngBounds(mc.map(c => [c.lat, c.lng] as L.LatLngTuple));
          map.fitBounds(bounds.pad(0.5));
        }
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill]);

  // ── Aggregations ─────────────────────────────────────────────────────────

  const countryAgg = useMemo(() => aggregateBy(filtered, c => toTopoName(c.country)), [filtered]);
  const stateAgg = useMemo(() => {
    const usColls = filtered.filter(c => c.country === 'USA');
    return aggregateBy(usColls, c => stateAssign.get(c.id));
  }, [filtered, stateAssign]);
  const countyAgg = useMemo(() => {
    if (!drill.stateId) return new Map<string, Agg>();
    const stateColls = filtered.filter(c => stateAssign.get(c.id) === drill.stateId);
    return aggregateBy(stateColls, c => countyAssign.get(c.id));
  }, [filtered, drill.stateId, stateAssign, countyAssign]);

  // Filtered counties GeoJSON for selected state
  const stateCountiesGeo = useMemo<FeatureCollection | null>(() => {
    if (!countiesGeo || !drill.stateId) return null;
    return {
      type: 'FeatureCollection',
      features: countiesGeo.features.filter(f => (f.id as string).startsWith(drill.stateId!)),
    };
  }, [countiesGeo, drill.stateId]);

  // City groups for non-US or county-level view
  const cityGroups = useMemo(() => {
    let scope: Collection[];
    if (drill.level === 'country' && drill.country && drill.country !== 'USA') {
      scope = filtered.filter(c => c.country === drill.country);
    } else if (drill.level === 'county' && drill.countyId) {
      scope = filtered.filter(c => countyAssign.get(c.id) === drill.countyId);
    } else {
      return [];
    }
    const groups = new Map<string, { lat: number; lng: number; count: number; inventory: number; items: Collection[] }>();
    for (const c of scope) {
      const key = c.city || 'Unknown';
      const g = groups.get(key) || { lat: 0, lng: 0, count: 0, inventory: 0, items: [] };
      g.items.push(c);
      g.count++;
      g.inventory += c.total_inventory;
      g.lat += c.lat;
      g.lng += c.lng;
      groups.set(key, g);
    }
    // Average positions
    for (const g of groups.values()) {
      g.lat /= g.count;
      g.lng /= g.count;
    }
    return Array.from(groups.entries()).map(([city, g]) => ({ city, ...g }));
  }, [filtered, drill, countyAssign]);

  // Marker-level collections
  const markerCollections = useMemo(() => {
    if (drill.level === 'county') {
      return filtered.filter(c => countyAssign.get(c.id) === drill.countyId);
    }
    if (drill.level === 'markers') {
      if (drill.city) return filtered.filter(c => c.city === drill.city && c.country === drill.country);
      if (drill.countyId) return filtered.filter(c => countyAssign.get(c.id) === drill.countyId);
    }
    return [];
  }, [filtered, drill, countyAssign]);

  // ── onEachFeature builders ───────────────────────────────────────────────

  const makeOnEach = useCallback(
    (agg: Map<string, Agg>, nameKey: 'name', idKey: 'name' | 'id', onClick: (id: string, name: string) => void) => {
      return (feature: Feature<Geometry>, layer: L.Layer) => {
        const id = idKey === 'id' ? (feature.id as string) : (feature.properties?.[nameKey] || '');
        const name = feature.properties?.[nameKey] || id;
        const data = agg.get(id) || { count: 0, inventory: 0 };
        (layer as L.Path).bindTooltip(
          `<strong>${name}</strong><br/>${data.count} collection${data.count !== 1 ? 's' : ''}<br/>${data.inventory} vehicles`,
          { sticky: true, direction: 'top', className: 'dark-tooltip' }
        );
        (layer as L.Path).on({
          mouseover: (e) => { e.target.setStyle({ weight: 2, fillOpacity: 0.75 }); e.target.bringToFront(); },
          mouseout: (e) => { e.target.setStyle({ weight: 0.5, fillOpacity: 0.5 }); },
          click: () => onClick(id, name),
        });
      };
    },
    []
  );

  // ── Render layers ────────────────────────────────────────────────────────

  // World level: country choropleth
  if (drill.level === 'world' && worldGeo) {
    const mx = maxAgg(countryAgg, metric);
    return (
      <GeoJSON
        key={`world-${metric}-${searchTerm}`}
        data={worldGeo}
        style={(feature) => {
          const name = feature?.properties?.name || '';
          const data = countryAgg.get(name);
          const val = data ? data[metric] : 0;
          return { fillColor: choroplethColor(val, mx), fillOpacity: 0.5, color: '#475569', weight: 0.5 };
        }}
        onEachFeature={makeOnEach(countryAgg, 'name', 'name', (topoName) => {
          const country = toOurName(topoName);
          setDrill({ level: 'country', country });
        })}
      />
    );
  }

  // Country level (US): state choropleth
  if (drill.level === 'country' && drill.country === 'USA' && statesGeo) {
    const mx = maxAgg(stateAgg, metric);
    return (
      <GeoJSON
        key={`states-${metric}-${searchTerm}`}
        data={statesGeo}
        style={(feature) => {
          const id = feature?.id as string;
          const data = stateAgg.get(id);
          const val = data ? data[metric] : 0;
          return { fillColor: choroplethColor(val, mx), fillOpacity: 0.5, color: '#475569', weight: 0.5 };
        }}
        onEachFeature={makeOnEach(stateAgg, 'name', 'id', (stateId, stateName) => {
          setDrill({ level: 'state', country: 'USA', stateId, stateName });
        })}
      />
    );
  }

  // Country level (non-US): city bubbles
  if (drill.level === 'country' && drill.country !== 'USA') {
    const mx = Math.max(...cityGroups.map(g => g[metric === 'count' ? 'count' : 'inventory']), 1);
    return (
      <>
        {cityGroups.map(g => (
          <CircleMarker
            key={g.city}
            center={[g.lat, g.lng]}
            radius={Math.max(8, Math.min(30, 8 + Math.sqrt(g.count) * 8))}
            pathOptions={{ color: '#3b82f6', fillColor: choroplethColor(g[metric === 'count' ? 'count' : 'inventory'], mx), fillOpacity: 0.7, weight: 2 }}
            eventHandlers={{ click: () => setDrill({ level: 'markers', country: drill.country, city: g.city }) }}
          >
            <Tooltip direction="top">
              <strong>{g.city}</strong><br />
              {g.count} collection{g.count !== 1 ? 's' : ''}<br />
              {g.inventory} vehicles
            </Tooltip>
          </CircleMarker>
        ))}
      </>
    );
  }

  // State level: county choropleth
  if (drill.level === 'state' && stateCountiesGeo) {
    const mx = maxAgg(countyAgg, metric);
    return (
      <GeoJSON
        key={`counties-${drill.stateId}-${metric}-${searchTerm}`}
        data={stateCountiesGeo}
        style={(feature) => {
          const id = feature?.id as string;
          const data = countyAgg.get(id);
          const val = data ? data[metric] : 0;
          return { fillColor: choroplethColor(val, mx), fillOpacity: 0.5, color: '#475569', weight: 0.5 };
        }}
        onEachFeature={makeOnEach(countyAgg, 'name', 'id', (countyId, countyName) => {
          setDrill({ level: 'county', country: 'USA', stateId: drill.stateId, stateName: drill.stateName, countyId, countyName });
        })}
      />
    );
  }

  // County level: show individual markers within county
  if (drill.level === 'county' && markerCollections.length > 0) {
    return (
      <>
        {markerCollections.map(c => (
          <Marker key={c.id} position={[c.lat, c.lng]} icon={MARKER_ICON}>
            <Popup>
              <div className="min-w-[220px]">
                <h3 className="font-bold text-base mb-1">{c.name}</h3>
                <p className="text-gray-600 text-sm mb-1">{c.city}, {c.country}</p>
                {c.total_inventory > 0 && <p className="text-sm text-blue-600 font-medium mb-1">{c.total_inventory} vehicles</p>}
                {c.instagram && (
                  <a href={`https://instagram.com/${c.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                    className="text-pink-500 text-sm">@{c.instagram}</a>
                )}
                <br />
                <Link to={`/org/${c.slug}`} className="inline-block mt-1 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600">
                  View Collection
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </>
    );
  }

  // Markers level (final): individual markers for a city group (non-US path)
  if (drill.level === 'markers' && markerCollections.length > 0) {
    return (
      <>
        {markerCollections.map(c => (
          <Marker key={c.id} position={[c.lat, c.lng]} icon={MARKER_ICON}>
            <Popup>
              <div className="min-w-[220px]">
                <h3 className="font-bold text-base mb-1">{c.name}</h3>
                <p className="text-gray-600 text-sm mb-1">{c.city}, {c.country}</p>
                {c.total_inventory > 0 && <p className="text-sm text-blue-600 font-medium mb-1">{c.total_inventory} vehicles</p>}
                {c.instagram && (
                  <a href={`https://instagram.com/${c.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                    className="text-pink-500 text-sm">@{c.instagram}</a>
                )}
                <br />
                <Link to={`/org/${c.slug}`} className="inline-block mt-1 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600">
                  View Collection
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </>
    );
  }

  return null;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function CollectionsMap() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillState>({ level: 'world' });
  const [metric, setMetric] = useState<'count' | 'inventory'>('count');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('id, business_name, slug, latitude, longitude, city, state, country, social_links, total_inventory, logo_url')
          .eq('business_type', 'collection')
          .not('latitude', 'is', null)
          .not('longitude', 'is', null);
        if (error) throw error;
        setCollections((data || []).map((b: any) => ({
          id: b.id, slug: b.slug || b.id, name: b.business_name,
          instagram: b.social_links?.instagram || null,
          country: b.country || 'Unknown', city: b.city || '', state: b.state || null,
          lat: Number(b.latitude), lng: Number(b.longitude),
          total_inventory: b.total_inventory || 0, logo_url: b.logo_url || null,
        })));
      } catch {
        setCollections(SAMPLE_COLLECTIONS);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Scope collections to current drill level
  const scopedCollections = useMemo(() => {
    let result = collections;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(term) || c.slug.toLowerCase().includes(term) ||
        c.city.toLowerCase().includes(term) || (c.instagram && c.instagram.toLowerCase().includes(term))
      );
    }
    if (drill.level !== 'world' && drill.country) {
      result = result.filter(c => c.country === drill.country);
    }
    return result;
  }, [collections, searchTerm, drill]);

  // Sidebar items based on drill level
  const sidebarItems = useMemo(() => {
    if (drill.level === 'world') {
      const agg = aggregateBy(scopedCollections, c => c.country);
      return Array.from(agg.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .map(([country, data]) => ({
          key: country, label: country, ...data,
          onClick: () => setDrill({ level: 'country', country }),
        }));
    }
    if (drill.level === 'country' && drill.country !== 'USA') {
      const agg = aggregateBy(scopedCollections, c => c.city || 'Unknown');
      return Array.from(agg.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .map(([city, data]) => ({
          key: city, label: city, ...data,
          onClick: () => setDrill({ level: 'markers', country: drill.country, city }),
        }));
    }
    // For US state/county levels, items are built from the GeoJSON names
    // We show simple collection count for now
    return [];
  }, [drill, scopedCollections]);

  // Breadcrumb segments
  const breadcrumbs = useMemo(() => {
    const parts: { label: string; onClick: () => void }[] = [
      { label: 'World', onClick: () => setDrill({ level: 'world' }) },
    ];
    if (drill.country) {
      parts.push({ label: drill.country, onClick: () => setDrill({ level: 'country', country: drill.country }) });
    }
    if (drill.stateName) {
      parts.push({
        label: drill.stateName,
        onClick: () => setDrill({ level: 'state', country: 'USA', stateId: drill.stateId, stateName: drill.stateName }),
      });
    }
    if (drill.countyName) {
      parts.push({
        label: drill.countyName,
        onClick: () => setDrill({
          level: 'county', country: 'USA', stateId: drill.stateId, stateName: drill.stateName,
          countyId: drill.countyId, countyName: drill.countyName,
        }),
      });
    }
    if (drill.city) {
      parts.push({ label: drill.city, onClick: () => {} });
    }
    return parts;
  }, [drill]);

  const sidebarTitle = drill.level === 'world' ? 'Countries'
    : drill.level === 'country' && drill.country === 'USA' ? 'States'
    : drill.level === 'country' ? 'Cities'
    : drill.level === 'state' ? 'Counties'
    : 'Collections';

  return (
    <div className="fullscreen-content h-screen flex flex-col bg-gray-900">
      {/* Tooltip styles */}
      <style>{`
        .dark-tooltip { background: #1e293b !important; color: #e2e8f0 !important; border: 1px solid #475569 !important; border-radius: 6px !important; padding: 6px 10px !important; font-size: 12px !important; }
        .dark-tooltip::before { border-top-color: #475569 !important; }
      `}</style>

      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Collections World Map</h1>
            <p className="text-gray-400 text-sm">
              {collections.length} collections across {new Set(collections.map(c => c.country)).size} countries
            </p>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="text" placeholder="Search collections..." value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            />
            {/* Metric toggle */}
            <div className="flex rounded-lg overflow-hidden border border-gray-600">
              <button
                onClick={() => setMetric('count')}
                className={`px-3 py-2 text-xs font-medium ${metric === 'count' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >Count</button>
              <button
                onClick={() => setMetric('inventory')}
                className={`px-3 py-2 text-xs font-medium ${metric === 'inventory' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >Vehicles</button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <div className="w-64 bg-gray-800 border-r border-gray-700 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{sidebarTitle}</h2>
            <div className="space-y-1">
              {sidebarItems.map(item => (
                <button
                  key={item.key}
                  onClick={item.onClick}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  <span className="truncate">{item.label}</span>
                  <span className="text-xs bg-gray-700 px-2 py-0.5 rounded-full ml-2 flex-shrink-0">
                    {metric === 'count' ? item.count : item.inventory}
                  </span>
                </button>
              ))}
              {sidebarItems.length === 0 && (
                <p className="text-gray-500 text-xs italic">
                  {drill.level === 'county' || drill.level === 'markers'
                    ? 'Viewing individual collections'
                    : 'Loading...'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative min-h-0 min-w-0">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <div className="text-gray-400">Loading map data...</div>
            </div>
          ) : (
            <MapContainer center={[20, 0]} zoom={2} className="absolute inset-0" style={{ background: '#1a1a2e' }}>
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com">CARTO</a>'
              />
              <MapLayers
                collections={collections}
                drill={drill}
                setDrill={setDrill}
                metric={metric}
                searchTerm={searchTerm}
              />
            </MapContainer>
          )}

          {/* Breadcrumbs overlay */}
          {drill.level !== 'world' && (
            <div className="absolute top-4 left-4 z-[1000] bg-gray-800/90 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-1 text-sm">
              {breadcrumbs.map((bc, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-gray-500">/</span>}
                  <button
                    onClick={bc.onClick}
                    className={`${i === breadcrumbs.length - 1 ? 'text-white' : 'text-blue-400 hover:text-blue-300'}`}
                  >{bc.label}</button>
                </span>
              ))}
            </div>
          )}

          {/* Stats overlay */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-gray-800/90 backdrop-blur-sm rounded-lg p-3 text-sm">
            <div className="text-gray-400">
              Showing <span className="text-white font-semibold">{scopedCollections.length}</span> collections
            </div>
          </div>
        </div>

        {/* Collection List Panel */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Collections ({scopedCollections.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-700">
            {scopedCollections.slice(0, 50).map(c => (
              <Link key={c.slug} to={`/org/${c.slug}`} className="block p-3 hover:bg-gray-700/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0 bg-blue-500" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-white font-medium text-sm truncate">{c.name}</h3>
                    <p className="text-gray-400 text-xs truncate">{c.city}, {c.country}</p>
                    {c.total_inventory > 0 && <p className="text-blue-400 text-xs">{c.total_inventory} vehicles</p>}
                    {c.instagram && <p className="text-pink-400 text-xs truncate">@{c.instagram}</p>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const SAMPLE_COLLECTIONS: Collection[] = [
  { id: 'sample-1', slug: 'jay-lenos-car-collection', name: "Jay Leno's Car Collection", instagram: 'jaylenosgarage', country: 'USA', city: 'Burbank, CA', state: 'California', lat: 34.1808, lng: -118.309, total_inventory: 0, logo_url: null },
  { id: 'sample-2', slug: 'ferrari-museum-maranello', name: 'Ferrari Museum Maranello', instagram: null, country: 'Italy', city: 'Maranello', state: null, lat: 44.5294, lng: 10.8656, total_inventory: 0, logo_url: null },
];
