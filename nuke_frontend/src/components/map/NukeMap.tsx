import React, { useState, useCallback, useEffect, Suspense, lazy, Component } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import type { MapViewState, MapMode, MapEventPoint, BizPin, ColPin } from './types';
import { INITIAL_VIEW, CARTO_DARK, DEFAULT_MIN_CONFIDENCE, APPROX_MIN_CONFIDENCE, MAP_FONT } from './constants';
import { useMapData } from './hooks/useMapData';
import { useMapTimeline } from './hooks/useMapTimeline';
import { useMapLayers } from './hooks/useMapLayers';
import { useMapSidebar } from './hooks/useMapSidebar';
import { useCountyData } from './hooks/useCountyData';
import { useStateData } from './hooks/useStateData';
import { COLORWAYS, ensureCountyNames, type ColorwayId } from './shared';
import MapSearchBar from './controls/MapSearchBar';
import MapVehicleDetail from './panels/MapVehicleDetail';
import MapOrgDetail from './panels/MapOrgDetail';
import EventPinDetail from './panels/EventPinDetail';

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return null;
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}

const ChoroplethMap = lazy(() => import('./ChoroplethMap'));
const DeckGLMap = lazy(() => import('./DeckGLMap'));

// ─── Error boundary for deck.gl ────────────────────────────────────────────────
class MapErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

// ─── Main NukeMap ──────────────────────────────────────────────────────────────
export default function NukeMap() {
  // Support URL params for initial viewport: ?lat=17.9&lng=-62.83&zoom=14
  const initialView = (() => {
    const params = new URLSearchParams(window.location.search);
    const lat = params.get('lat');
    const lng = params.get('lng');
    const zoom = params.get('zoom');
    if (lat && lng) {
      return { ...INITIAL_VIEW, latitude: parseFloat(lat), longitude: parseFloat(lng), zoom: zoom ? parseFloat(zoom) : 14 };
    }
    return INITIAL_VIEW;
  })();
  const [viewState, setViewState] = useState<MapViewState>(initialView);
  const [mode, setMode] = useState<MapMode>('points');
  const [showBusinesses, setShowBusinesses] = useState(true);
  const [showCollections, setShowCollections] = useState(true);
  const [showApproximate, setShowApproximate] = useState(false);
  const [searchMake, setSearchMake] = useState<string | undefined>();
  const [colorwayId, setColorwayId] = useState<ColorwayId>('amber');
  const colorway = COLORWAYS[colorwayId];

  const [businesses, setBusinesses] = useState<BizPin[]>([]);
  const [collections, setCollections] = useState<ColPin[]>([]);

  const minConfidence = showApproximate ? APPROX_MIN_CONFIDENCE : DEFAULT_MIN_CONFIDENCE;
  const timeline = useMapTimeline(viewState, minConfidence);

  const { data, loading: pointsLoading, error: pointsError } = useMapData({
    viewState, minConfidence,
    timeStart: timeline.timeStart, timeEnd: timeline.timeEnd, make: searchMake,
  });

  const { layerData: countyLayerData, stats: countyStats, loading: countyLoading, error: countyError } = useCountyData(mode === 'county', timeline.timeStart, timeline.timeEnd);
  const { layerData: stateLayerData, loading: stateLoading } = useStateData(mode === 'county', timeline.timeStart, timeline.timeEnd);

  useEffect(() => { if (mode === 'county') ensureCountyNames(); }, [mode]);

  const loading = mode === 'county' ? (countyLoading || stateLoading) : pointsLoading;
  const error = mode === 'county' ? countyError : pointsError;

  const sidebar = useMapSidebar();

  useEffect(() => {
    async function loadOverlays() {
      const [bizRes, colRes] = await Promise.all([
        supabase.from('businesses').select('id, name, latitude, longitude, type, brand_design_language').not('latitude', 'is', null).limit(3000),
        supabase.from('businesses').select('id, name, slug, instagram_handle, country, city, latitude, longitude, total_inventory, brand_design_language').eq('type', 'collection').not('latitude', 'is', null).limit(1000),
      ]);
      if (bizRes.data) setBusinesses(bizRes.data.map((b: any) => {
        const bdl = b.brand_design_language;
        const hex = bdl?.colors?.primary;
        return {
          id: b.id, name: b.name, lat: b.latitude, lng: b.longitude, type: b.type,
          color: hex ? hexToRgb(hex) : null,
          logoUrl: bdl?.logos?.svg || bdl?.logos?.primary_dark || bdl?.logos?.primary_light || null,
        };
      }));
      if (colRes.data) setCollections(colRes.data.map((c: any) => ({
        id: c.id, name: c.name, slug: c.slug || '', ig: c.instagram_handle,
        country: c.country || '', city: c.city || '', lat: c.latitude, lng: c.longitude,
        totalInventory: c.total_inventory || 0,
      })));
    }
    loadOverlays();
  }, []);

  const onEventClick = useCallback((info: any) => { if (info.object) sidebar.openEventPin(info.object.properties as unknown as Record<string, unknown>); }, [sidebar]);
  const onClusterClick = useCallback((info: any) => { if (info.object) { const [lng, lat] = info.object.geometry.coordinates; setViewState(prev => ({ ...prev, longitude: lng, latitude: lat, zoom: Math.min(prev.zoom + 2, 18) })); } }, []);
  const onBusinessClick = useCallback((info: any) => { if (info.object) sidebar.openOrgDetail(info.object.id); }, [sidebar]);
  const onCollectionClick = useCallback((info: any) => { if (info.object) sidebar.openOrgDetail(info.object.id); }, [sidebar]);

  const layers = useMapLayers({
    data, zoom: viewState.zoom, mode,
    showBusinesses: mode !== 'county' && showBusinesses,
    showCollections: mode !== 'county' && showCollections,
    businesses, collections, countyLayerData: null,
    onEventClick, onClusterClick, onBusinessClick, onCollectionClick,
  });

  const handleSearch = useCallback((query: string) => setSearchMake(query || undefined), []);

  const loadingFallback = (
    <div style={{ width: '100%', height: '100%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 9, color: 'rgba(245,158,11,0.6)', fontFamily: MAP_FONT, textTransform: 'uppercase' }}>LOADING MAP...</div>
    </div>
  );

  const deckFallback = (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', fontFamily: MAP_FONT }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>MAP RENDERER UNAVAILABLE</div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>WebGL initialization failed.</div>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Choropleth mode */}
      {mode === 'county' && countyStats && (
        <Suspense fallback={loadingFallback}>
          <ChoroplethMap
            countyLayerData={countyLayerData}
            stateLayerData={stateLayerData}
            stats={countyStats}
            colorway={colorway}
            colorwayId={colorwayId}
            onColorwayChange={setColorwayId}
            timeline={timeline}
          />
        </Suspense>
      )}

      {/* deck.gl modes */}
      {mode !== 'county' && (
        <MapErrorBoundary fallback={deckFallback}>
          <Suspense fallback={loadingFallback}>
            <DeckGLMap viewState={viewState} onViewStateChange={setViewState}
              layers={layers} mapStyle={CARTO_DARK} timeline={timeline} mode={mode}
              businesses={businesses} onBusinessClick={onBusinessClick} />
          </Suspense>
        </MapErrorBoundary>
      )}

      {/* Loading overlay */}
      {loading && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', padding: '4px 10px', fontSize: 8,
          fontFamily: MAP_FONT, color: 'rgba(245, 158, 11, 0.8)', zIndex: 1010, textTransform: 'uppercase' }}>
          LOADING...
        </div>
      )}

      {/* Search */}
      <div style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'auto', zIndex: 1000 }}>
        <MapSearchBar onSearch={handleSearch} />
      </div>

      {/* Error */}
      {error && (
        <div style={{ position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(200,0,0,0.7)', padding: '4px 10px', fontSize: 9,
          fontFamily: MAP_FONT, color: 'white', zIndex: 1010 }}>
          {error}
        </div>
      )}

      {/* Sidebar (deck.gl modes) */}
      {sidebar.current && (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 340,
          background: 'var(--bg, #111)', borderLeft: '2px solid var(--border, #333)',
          overflowY: 'auto', zIndex: 1020 }}>
          {sidebar.current.type === 'event-pin' && (
            <EventPinDetail event={sidebar.current.data as unknown as MapEventPoint}
              onBack={sidebar.close} onViewVehicle={(id) => sidebar.openVehicleDetail(id)} />
          )}
          {sidebar.current.type === 'vehicle-detail' && (
            <MapVehicleDetail vehicleId={sidebar.current.data.vehicleId as string}
              onBack={sidebar.pop} onNavigate={(view) => { if (view.type === 'org-detail') sidebar.openOrgDetail(view.id); }} />
          )}
          {sidebar.current.type === 'org-detail' && (
            <MapOrgDetail orgId={sidebar.current.data.orgId as string}
              onBack={sidebar.close} onNavigate={(view) => { if (view.type === 'vehicle-detail') sidebar.openVehicleDetail(view.id); }} />
          )}
        </div>
      )}
    </div>
  );
}
