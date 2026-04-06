import React, { useCallback, useRef, useMemo } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import DeckGL from '@deck.gl/react';
import { Map as MapLibre, Source, Layer, Popup } from 'react-map-gl/maplibre';
import type { MapViewState, MapMode, BizPin } from './types';
import MapTimeline from './controls/MapTimeline';

interface Props {
  viewState: MapViewState;
  onViewStateChange: (vs: MapViewState) => void;
  layers: any[];
  mapStyle: string;
  timeline: {
    buckets: any[];
    timeEnd?: string;
    scrubTo: (month: string | undefined) => void;
    loading: boolean;
  };
  mode: MapMode;
  businesses?: BizPin[];
  onBusinessClick?: (info: any) => void;
}

export default function DeckGLMap({ viewState, onViewStateChange, layers, mapStyle, timeline, mode, businesses, onBusinessClick }: Props) {
  const [popup, setPopup] = React.useState<{ lng: number; lat: number; name: string; id: string } | null>(null);

  // Convert businesses to GeoJSON for MapLibre native rendering
  const bizGeoJSON = useMemo(() => {
    if (!businesses?.length) return null;
    return {
      type: 'FeatureCollection' as const,
      features: businesses.map(b => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
        properties: {
          id: b.id,
          name: b.name,
          type: b.type,
          color: b.color ? `rgb(${b.color[0]},${b.color[1]},${b.color[2]})` : 'rgb(20,184,166)',
        },
      })),
    };
  }, [businesses]);

  const handleMapClick = useCallback((e: any) => {
    const features = e.features;
    if (features?.length > 0) {
      const f = features[0];
      setPopup({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: f.properties.name, id: f.properties.id });
      if (onBusinessClick) onBusinessClick({ object: { id: f.properties.id } });
    } else {
      setPopup(null);
    }
  }, [onBusinessClick]);

  return (
    <>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }: any) => onViewStateChange(vs)}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }: { isHovering: boolean }) => isHovering ? 'pointer' : 'grab'}
      >
        <MapLibre
          mapStyle={mapStyle}
          interactiveLayerIds={bizGeoJSON ? ['biz-circles'] : undefined}
          onClick={handleMapClick}
        >
          {/* Business markers — MapLibre native, no DeckGL needed */}
          {bizGeoJSON && (
            <Source id="businesses" type="geojson" data={bizGeoJSON}>
              <Layer
                id="biz-circles"
                type="circle"
                paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 15, 8, 17, 12],
                  'circle-color': ['get', 'color'],
                  'circle-stroke-width': 1.5,
                  'circle-stroke-color': 'rgba(255,255,255,0.5)',
                  'circle-opacity': 0.85,
                }}
              />
              <Layer
                id="biz-labels"
                type="symbol"
                minzoom={14}
                layout={{
                  'text-field': ['get', 'name'],
                  'text-size': 10,
                  'text-offset': [1, 0],
                  'text-anchor': 'left',
                  'text-font': ['Arial Unicode MS Regular'],
                  'text-max-width': 12,
                }}
                paint={{
                  'text-color': ['get', 'color'],
                  'text-halo-color': 'rgba(0,0,0,0.8)',
                  'text-halo-width': 1.5,
                }}
              />
            </Source>
          )}

          {/* Popup on click */}
          {popup && (
            <Popup
              longitude={popup.lng}
              latitude={popup.lat}
              anchor="bottom"
              onClose={() => setPopup(null)}
              closeOnClick={false}
              style={{ zIndex: 10 }}
            >
              <div style={{ fontFamily: 'Arial', fontSize: 11, fontWeight: 700, color: '#111', padding: '2px 4px' }}>
                {popup.name}
              </div>
            </Popup>
          )}
        </MapLibre>
      </DeckGL>

      {/* Timeline */}
      {mode !== 'county' && (
        <MapTimeline
          buckets={timeline.buckets}
          timeEnd={timeline.timeEnd}
          onScrub={timeline.scrubTo}
          loading={timeline.loading}
        />
      )}
    </>
  );
}
