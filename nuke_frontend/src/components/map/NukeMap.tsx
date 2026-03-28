import React, { useState, useCallback, useEffect, useRef, Suspense, lazy, Component } from 'react';
import type { ReactNode } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

import { supabase } from '../../lib/supabase';
import type { MapViewState, MapMode, MapEventPoint, BizPin, ColPin, CountyDatum } from './types';
import { INITIAL_VIEW, CARTO_DARK, DEFAULT_MIN_CONFIDENCE, APPROX_MIN_CONFIDENCE, MAP_FONT } from './constants';
import { useMapData } from './hooks/useMapData';
import { useMapTimeline } from './hooks/useMapTimeline';
import { useMapLayers } from './hooks/useMapLayers';
import { useMapSidebar } from './hooks/useMapSidebar';
import { useCountyData } from './hooks/useCountyData';
import MapLayerPanel from './controls/MapLayerPanel';
import MapSearchBar from './controls/MapSearchBar';
import MapVehicleDetail from './panels/MapVehicleDetail';
import MapOrgDetail from './panels/MapOrgDetail';
import EventPinDetail from './panels/EventPinDetail';

// Lazy load deck.gl (heavy, may crash on some GPUs)
const DeckGLMap = lazy(() => import('./DeckGLMap'));

// ─── Error boundary for deck.gl WebGL crashes ─────────────────────────────────
class MapErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// ─── FIPS lookups ──────────────────────────────────────────────────────────────
const COUNTY_NAMES: Record<string, string> = {};
let _namesLoaded = false;
async function ensureCountyNames() {
  if (_namesLoaded) return;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json');
    const topo = await res.json();
    const geoms = topo.objects?.counties?.geometries ?? [];
    for (const g of geoms) {
      if (g.id && g.properties?.name) {
        COUNTY_NAMES[String(g.id)] = g.properties.name;
      }
    }
  } catch { /* names are optional */ }
  _namesLoaded = true;
}

const STATE_FIPS: Record<string, string> = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
  '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
  '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
  '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
  '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
  '54':'WV','55':'WI','56':'WY',
};

// ─── County choropleth color palettes ──────────────────────────────────────────
type ColorwayId = 'amber' | 'plasma' | 'viridis' | 'heat';

interface Colorway {
  label: string;
  basemap: 'dark' | 'light';
  tileUrl: string;
  empty: string;
  border: string;
  hoverBorder: string;
  stops: [number, string][];
}

const COLORWAYS: Record<ColorwayId, Colorway> = {
  amber: {
    label: 'AMBER',
    basemap: 'dark',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    empty: 'rgba(40, 35, 25, 0.6)',
    border: 'rgba(80,70,50,0.5)',
    hoverBorder: 'rgba(245, 158, 11, 0.9)',
    stops: [
      [0,    'rgba(40, 35, 25, 0.6)'],
      [1,    'rgba(140, 100, 20, 0.75)'],
      [5,    'rgba(200, 140, 15, 0.8)'],
      [15,   'rgba(235, 165, 15, 0.85)'],
      [50,   'rgba(245, 158, 11, 0.9)'],
      [150,  'rgba(255, 120, 10, 0.92)'],
      [500,  'rgba(255, 70, 10, 0.95)'],
      [1000, 'rgba(255, 30, 5, 1)'],
    ],
  },
  plasma: {
    label: 'PLASMA',
    basemap: 'dark',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    empty: 'rgba(15, 10, 40, 0.6)',
    border: 'rgba(50,40,80,0.5)',
    hoverBorder: 'rgba(240, 220, 60, 0.9)',
    stops: [
      [0,    'rgba(15, 10, 40, 0.6)'],
      [1,    'rgba(80, 20, 120, 0.75)'],
      [5,    'rgba(150, 30, 130, 0.8)'],
      [15,   'rgba(210, 50, 90, 0.85)'],
      [50,   'rgba(245, 100, 30, 0.9)'],
      [150,  'rgba(250, 170, 20, 0.92)'],
      [500,  'rgba(250, 220, 50, 0.95)'],
      [1000, 'rgba(240, 250, 90, 1)'],
    ],
  },
  viridis: {
    label: 'VIRIDIS',
    basemap: 'light',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    empty: 'rgba(240, 240, 235, 0.7)',
    border: 'rgba(180,180,175,0.6)',
    hoverBorder: 'rgba(30, 30, 30, 0.9)',
    stops: [
      [0,    'rgba(240, 240, 235, 0.7)'],
      [1,    'rgba(68, 1, 84, 0.7)'],
      [5,    'rgba(59, 82, 139, 0.75)'],
      [15,   'rgba(33, 144, 140, 0.8)'],
      [50,   'rgba(93, 201, 98, 0.85)'],
      [150,  'rgba(170, 220, 50, 0.9)'],
      [500,  'rgba(230, 245, 35, 0.92)'],
      [1000, 'rgba(253, 231, 37, 0.95)'],
    ],
  },
  heat: {
    label: 'HEAT',
    basemap: 'light',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    empty: 'rgba(245, 245, 240, 0.7)',
    border: 'rgba(200,195,190,0.6)',
    hoverBorder: 'rgba(30, 30, 30, 0.9)',
    stops: [
      [0,    'rgba(245, 245, 240, 0.7)'],
      [1,    'rgba(255, 230, 200, 0.75)'],
      [5,    'rgba(255, 200, 140, 0.8)'],
      [15,   'rgba(255, 160, 80, 0.85)'],
      [50,   'rgba(245, 110, 40, 0.9)'],
      [150,  'rgba(220, 60, 30, 0.92)'],
      [500,  'rgba(180, 20, 20, 0.95)'],
      [1000, 'rgba(120, 0, 10, 1)'],
    ],
  },
};

function countyColor(count: number, colorway: Colorway): string {
  const stops = colorway.stops;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (count >= stops[i][0]) return stops[i][1];
  }
  return stops[0][1];
}

// ─── Leaflet county choropleth ─────────────────────────────────────────────────
function CountyChoropleth({ layerData, stats, colorway, onColorwayChange }: {
  layerData: import('./layers/countyLayer').CountyLayerData;
  stats: { totalCount: number; totalValue: number; countyCount: number };
  colorway: Colorway;
  onColorwayChange: (id: ColorwayId) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<any>(null);
  const geoLayerRef = useRef<any>(null);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; name: string; state: string; fips: string; datum: CountyDatum | null;
  } | null>(null);

  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    // Dynamic import of Leaflet (already installed)
    import('leaflet').then((L) => {
      // @ts-ignore - Leaflet CSS
      import('leaflet/dist/leaflet.css');

      const map = L.map(mapRef.current!, {
        center: [39, -98],
        zoom: 4,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer(colorway.tileUrl, {
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      leafletRef.current = map;
    });

    return () => {
      leafletRef.current?.remove();
      leafletRef.current = null;
    };
  }, [colorway.tileUrl]);

  // Add/update GeoJSON layer when data changes
  useEffect(() => {
    const map = leafletRef.current;
    if (!map || !layerData) return;

    import('leaflet').then((L) => {
      // Remove old layer
      if (geoLayerRef.current) {
        map.removeLayer(geoLayerRef.current);
      }

      const { geojson, lookup } = layerData;

      const geoLayer = L.geoJSON(geojson as any, {
        style: (feature: any) => {
          const fips = feature?.id || feature?.properties?.GEOID || '';
          const datum = lookup.get(String(fips));
          const count = datum?.count ?? 0;
          return {
            fillColor: countyColor(count, colorway),
            fillOpacity: 1,
            weight: 0.5,
            color: colorway.border,
          };
        },
        onEachFeature: (feature: any, layer: any) => {
          const fips = String(feature?.id || feature?.properties?.GEOID || '');
          const datum = lookup.get(fips) ?? null;
          const name = COUNTY_NAMES[fips] || feature?.properties?.name || fips;
          const state = STATE_FIPS[fips.slice(0, 2)] ?? '';

          layer.on('mouseover', (e: any) => {
            const { containerPoint } = e;
            setTooltip({ x: containerPoint.x, y: containerPoint.y, name, state, fips, datum });
            layer.setStyle({ weight: 2, color: colorway.hoverBorder });
            layer.bringToFront();
          });
          layer.on('mousemove', (e: any) => {
            const { containerPoint } = e;
            setTooltip(prev => prev ? { ...prev, x: containerPoint.x, y: containerPoint.y } : null);
          });
          layer.on('mouseout', () => {
            setTooltip(null);
            geoLayer.resetStyle(layer);
          });
        },
      }).addTo(map);

      geoLayerRef.current = geoLayer;
    });
  }, [layerData, colorway]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Stats bar */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 1000,
        background: colorway.basemap === 'dark' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)',
        border: `1px solid ${colorway.basemap === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`,
        padding: '8px 12px', fontFamily: MAP_FONT,
      }}>
        <div style={{ fontSize: 7, color: colorway.basemap === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
          COUNTY COVERAGE
        </div>
        <div style={{ fontSize: 11, color: 'rgba(245, 158, 11, 1)', fontWeight: 700 }}>
          {stats.countyCount.toLocaleString()} COUNTIES
        </div>
        <div style={{ fontSize: 9, color: colorway.basemap === 'dark' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)', marginTop: 2 }}>
          {stats.totalCount.toLocaleString()} vehicles &middot; ${(stats.totalValue / 1e9).toFixed(2)}B total value
        </div>
      </div>

      {/* Color legend + colorway picker */}
      <div style={{
        position: 'absolute', bottom: 12, right: 50, zIndex: 1000,
        background: colorway.basemap === 'dark' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)',
        border: `1px solid ${colorway.basemap === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`,
        padding: '6px 10px', fontFamily: MAP_FONT,
      }}>
        {/* Colorway buttons */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 6 }}>
          {(Object.keys(COLORWAYS) as ColorwayId[]).map((id) => {
            const cw = COLORWAYS[id];
            const isActive = cw === colorway;
            const swatch = cw.stops[4][1]; // mid-range color as swatch
            return (
              <button key={id} onClick={() => onColorwayChange(id)} style={{
                flex: 1, padding: '3px 0', fontSize: 7, fontWeight: 700, fontFamily: MAP_FONT,
                background: isActive ? swatch : 'transparent',
                border: `1px solid ${isActive ? swatch : (colorway.basemap === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)')}`,
                color: isActive ? (cw.basemap === 'dark' ? '#fff' : '#000') : (colorway.basemap === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'),
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.3px',
              }}>
                {cw.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 7, color: colorway.basemap === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
          VEHICLES PER COUNTY
        </div>
        <div style={{ display: 'flex', gap: 1 }}>
          {colorway.stops.map(([threshold, color], i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 18, height: 10, background: color }} />
              <div style={{ fontSize: 6, color: colorway.basemap === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                {threshold === 0 ? '0' : threshold >= 1000 ? '1K+' : threshold + '+'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: tooltip.x + 14,
          top: tooltip.y - 10,
          zIndex: 1100,
          background: 'rgba(0,0,0,0.92)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
          padding: '6px 10px',
          fontFamily: MAP_FONT,
          pointerEvents: 'none',
          maxWidth: 220,
        }}>
          <div style={{ fontSize: 10, color: 'rgba(245, 158, 11, 1)', fontWeight: 700 }}>
            {tooltip.name}{tooltip.state ? `, ${tooltip.state}` : ''}
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>
            FIPS {tooltip.fips}
          </div>
          {tooltip.datum ? (
            <>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.8)' }}>
                {tooltip.datum.count.toLocaleString()} vehicles
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>
                ${tooltip.datum.value.toLocaleString()} total &middot; ${tooltip.datum.avg.toLocaleString()} avg
              </div>
            </>
          ) : (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>NO DATA</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main NukeMap ──────────────────────────────────────────────────────────────
export default function NukeMap() {
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW);
  const [mode, setMode] = useState<MapMode>('county');
  const [showBusinesses, setShowBusinesses] = useState(true);
  const [showCollections, setShowCollections] = useState(true);
  const [showApproximate, setShowApproximate] = useState(false);
  const [searchMake, setSearchMake] = useState<string | undefined>();
  const [deckError, setDeckError] = useState(false);
  const [colorwayId, setColorwayId] = useState<ColorwayId>('amber');
  const colorway = COLORWAYS[colorwayId];

  // Static overlay data (loaded once)
  const [businesses, setBusinesses] = useState<BizPin[]>([]);
  const [collections, setCollections] = useState<ColPin[]>([]);

  const minConfidence = showApproximate ? APPROX_MIN_CONFIDENCE : DEFAULT_MIN_CONFIDENCE;

  const timeline = useMapTimeline(viewState, minConfidence);

  const { data, loading: pointsLoading, error: pointsError } = useMapData({
    viewState,
    minConfidence,
    timeStart: timeline.timeStart,
    timeEnd: timeline.timeEnd,
    make: searchMake,
  });

  const { layerData: countyLayerData, stats: countyStats, loading: countyLoading, error: countyError } = useCountyData(mode === 'county');

  useEffect(() => {
    if (mode === 'county') ensureCountyNames();
  }, [mode]);

  const loading = mode === 'county' ? countyLoading : pointsLoading;
  const error = mode === 'county' ? countyError : pointsError;

  const sidebar = useMapSidebar();

  useEffect(() => {
    async function loadOverlays() {
      const [bizRes, colRes] = await Promise.all([
        supabase.from('businesses').select('id, name, latitude, longitude, type').not('latitude', 'is', null).limit(3000),
        supabase.from('businesses').select('id, name, slug, instagram_handle, country, city, latitude, longitude, total_inventory').eq('type', 'collection').not('latitude', 'is', null).limit(1000),
      ]);
      if (bizRes.data) {
        setBusinesses(bizRes.data.map((b: any) => ({ id: b.id, name: b.name, lat: b.latitude, lng: b.longitude, type: b.type })));
      }
      if (colRes.data) {
        setCollections(colRes.data.map((c: any) => ({
          id: c.id, name: c.name, slug: c.slug || '', ig: c.instagram_handle,
          country: c.country || '', city: c.city || '',
          lat: c.latitude, lng: c.longitude,
          totalInventory: c.total_inventory || 0,
        })));
      }
    }
    loadOverlays();
  }, []);

  const onEventClick = useCallback((info: any) => {
    if (!info.object) return;
    sidebar.openEventPin(info.object.properties as unknown as Record<string, unknown>);
  }, [sidebar]);

  const onClusterClick = useCallback((info: any) => {
    if (!info.object) return;
    const [lng, lat] = info.object.geometry.coordinates;
    setViewState(prev => ({ ...prev, longitude: lng, latitude: lat, zoom: Math.min(prev.zoom + 2, 18) }));
  }, []);

  const onBusinessClick = useCallback((info: any) => {
    if (!info.object) return;
    sidebar.openOrgDetail(info.object.id);
  }, [sidebar]);

  const onCollectionClick = useCallback((info: any) => {
    if (!info.object) return;
    sidebar.openOrgDetail(info.object.id);
  }, [sidebar]);

  const layers = useMapLayers({
    data, zoom: viewState.zoom, mode,
    showBusinesses: mode !== 'county' && showBusinesses,
    showCollections: mode !== 'county' && showCollections,
    businesses, collections,
    countyLayerData: null, // County mode uses Leaflet now
    onEventClick, onClusterClick,
    onBusinessClick, onCollectionClick,
  });

  const handleSearch = useCallback((query: string) => {
    setSearchMake(query || undefined);
  }, []);

  const totalEvents = mode === 'county'
    ? (countyStats?.totalCount ?? 0)
    : (data?.meta?.total_matched ?? 0);

  // Deck.gl error fallback
  const deckFallback = (
    <div style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#111', fontFamily: MAP_FONT,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>MAP RENDERER UNAVAILABLE</div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>WebGL initialization failed. Try the COUNTY view.</div>
        <button
          onClick={() => setMode('county')}
          style={{
            marginTop: 12, padding: '6px 16px', fontSize: 9, fontWeight: 700,
            background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.5)',
            color: 'rgba(245, 158, 11, 1)', cursor: 'pointer', fontFamily: MAP_FONT,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}
        >
          SWITCH TO COUNTY VIEW
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* County mode: Leaflet-based (no WebGL dependency) */}
      {mode === 'county' && countyLayerData && countyStats && (
        <CountyChoropleth layerData={countyLayerData} stats={countyStats} colorway={colorway} onColorwayChange={setColorwayId} />
      )}

      {/* Points/Thermal mode: deck.gl (wrapped in error boundary) */}
      {mode !== 'county' && !deckError && (
        <MapErrorBoundary fallback={deckFallback}>
          <Suspense fallback={
            <div style={{ width: '100%', height: '100%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 9, color: 'rgba(245,158,11,0.6)', fontFamily: MAP_FONT, textTransform: 'uppercase' }}>LOADING MAP...</div>
            </div>
          }>
            <DeckGLMap
              viewState={viewState}
              onViewStateChange={setViewState}
              layers={layers}
              mapStyle={CARTO_DARK}
              timeline={timeline}
              mode={mode}
            />
          </Suspense>
        </MapErrorBoundary>
      )}

      {/* Loading (county) */}
      {mode === 'county' && countyLoading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#111', zIndex: 5,
        }}>
          <div style={{ fontSize: 9, color: 'rgba(245,158,11,0.6)', fontFamily: MAP_FONT, textTransform: 'uppercase' }}>
            LOADING COUNTY DATA...
          </div>
        </div>
      )}

      {/* Controls — always visible */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 1000 }}>
        <div style={{ pointerEvents: 'auto' }}>
          <MapSearchBar onSearch={handleSearch} />
        </div>
        <div style={{ pointerEvents: 'auto', position: 'absolute', top: 12, right: 12 }}>
          <MapLayerPanel
            mode={mode}
            onModeChange={setMode}
            showBusinesses={showBusinesses}
            onToggleBusinesses={() => setShowBusinesses(p => !p)}
            showCollections={showCollections}
            onToggleCollections={() => setShowCollections(p => !p)}
            showApproximate={showApproximate}
            onToggleApproximate={() => setShowApproximate(p => !p)}
            totalEvents={totalEvents}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(200,0,0,0.7)', padding: '4px 10px', fontSize: 9,
          fontFamily: 'Arial', color: 'white', zIndex: 1010,
        }}>
          {error}
        </div>
      )}

      {/* Sidebar */}
      {sidebar.current && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 340,
          background: 'var(--bg, #111)', borderLeft: '1px solid var(--border, #333)',
          overflowY: 'auto', zIndex: 1020,
        }}>
          {sidebar.current.type === 'event-pin' && (
            <EventPinDetail
              event={sidebar.current.data as unknown as MapEventPoint}
              onBack={sidebar.close}
              onViewVehicle={(id) => sidebar.openVehicleDetail(id)}
            />
          )}
          {sidebar.current.type === 'vehicle-detail' && (
            <MapVehicleDetail
              vehicleId={sidebar.current.data.vehicleId as string}
              onBack={sidebar.pop}
              onNavigate={(view) => {
                if (view.type === 'org-detail') sidebar.openOrgDetail(view.id);
              }}
            />
          )}
          {sidebar.current.type === 'org-detail' && (
            <MapOrgDetail
              orgId={sidebar.current.data.orgId as string}
              onBack={sidebar.close}
              onNavigate={(view) => {
                if (view.type === 'vehicle-detail') sidebar.openVehicleDetail(view.id);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
