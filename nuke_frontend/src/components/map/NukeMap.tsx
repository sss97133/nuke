import React, { useState, useCallback, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map as MapLibre } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import { supabase } from '../../lib/supabase';
import type { MapViewState, MapMode, MapEventPoint, BizPin, ColPin } from './types';
import { INITIAL_VIEW, CARTO_DARK, DEFAULT_MIN_CONFIDENCE, APPROX_MIN_CONFIDENCE } from './constants';
import { useMapData } from './hooks/useMapData';
import { useMapTimeline } from './hooks/useMapTimeline';
import { useMapLayers } from './hooks/useMapLayers';
import { useMapSidebar } from './hooks/useMapSidebar';
import MapTimeline from './controls/MapTimeline';
import MapLayerPanel from './controls/MapLayerPanel';
import MapSearchBar from './controls/MapSearchBar';
import MapVehicleDetail from './panels/MapVehicleDetail';
import MapOrgDetail from './panels/MapOrgDetail';
import EventPinDetail from './panels/EventPinDetail';

export default function NukeMap() {
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW);
  const [mode, setMode] = useState<MapMode>('points');
  const [showBusinesses, setShowBusinesses] = useState(true);
  const [showCollections, setShowCollections] = useState(true);
  const [showApproximate, setShowApproximate] = useState(false);
  const [searchMake, setSearchMake] = useState<string | undefined>();

  // Static overlay data (loaded once)
  const [businesses, setBusinesses] = useState<BizPin[]>([]);
  const [collections, setCollections] = useState<ColPin[]>([]);

  const minConfidence = showApproximate ? APPROX_MIN_CONFIDENCE : DEFAULT_MIN_CONFIDENCE;

  // Timeline
  const timeline = useMapTimeline(viewState, minConfidence);

  // Server-driven event data
  const { data, loading, error } = useMapData({
    viewState,
    minConfidence,
    timeStart: timeline.timeStart,
    timeEnd: timeline.timeEnd,
    make: searchMake,
  });

  // Sidebar
  const sidebar = useMapSidebar();

  // Load businesses + collections once
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

  // Click handlers
  const onEventClick = useCallback((info: any) => {
    if (!info.object) return;
    const props = info.object.properties as MapEventPoint;
    sidebar.openEventPin(props as unknown as Record<string, unknown>);
  }, [sidebar]);

  const onClusterClick = useCallback((info: any) => {
    if (!info.object) return;
    // Zoom into cluster
    const [lng, lat] = info.object.geometry.coordinates;
    setViewState(prev => ({
      ...prev,
      longitude: lng, latitude: lat,
      zoom: Math.min(prev.zoom + 2, 18),
    }));
  }, []);

  const onBusinessClick = useCallback((info: any) => {
    if (!info.object) return;
    sidebar.openOrgDetail(info.object.id);
  }, [sidebar]);

  const onCollectionClick = useCallback((info: any) => {
    if (!info.object) return;
    sidebar.openOrgDetail(info.object.id);
  }, [sidebar]);

  // Layers
  const layers = useMapLayers({
    data, zoom: viewState.zoom, mode,
    showBusinesses, showCollections,
    businesses, collections,
    onEventClick, onClusterClick,
    onBusinessClick, onCollectionClick,
  });

  // Search handler
  const handleSearch = useCallback((query: string) => {
    setSearchMake(query || undefined);
  }, []);

  const totalEvents = data?.meta?.total_matched ?? 0;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }: { isHovering: boolean }) => isHovering ? 'pointer' : 'grab'}
      >
        <MapLibre mapStyle={CARTO_DARK} />
      </DeckGL>

      {/* Controls */}
      <MapSearchBar onSearch={handleSearch} />
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

      {/* Timeline */}
      <MapTimeline
        buckets={timeline.buckets}
        timeEnd={timeline.timeEnd}
        onScrub={timeline.scrubTo}
        loading={timeline.loading}
      />

      {/* Loading indicator */}
      {loading && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', padding: '4px 10px', fontSize: 8,
          fontFamily: 'Arial', color: 'rgba(245, 158, 11, 0.8)', zIndex: 10,
          textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          LOADING...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(200,0,0,0.7)', padding: '4px 10px', fontSize: 9,
          fontFamily: 'Arial', color: 'white', zIndex: 10,
        }}>
          {error}
        </div>
      )}

      {/* Sidebar */}
      {sidebar.current && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 340,
          background: 'var(--bg, #111)', borderLeft: '1px solid var(--border, #333)',
          overflowY: 'auto', zIndex: 20,
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
