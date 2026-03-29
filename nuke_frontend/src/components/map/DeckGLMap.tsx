import React from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import DeckGL from '@deck.gl/react';
import { Map as MapLibre } from 'react-map-gl/maplibre';
import type { MapViewState, MapMode } from './types';
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
}

export default function DeckGLMap({ viewState, onViewStateChange, layers, mapStyle, timeline, mode }: Props) {
  return (
    <>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }: any) => onViewStateChange(vs)}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }: { isHovering: boolean }) => isHovering ? 'pointer' : 'grab'}
      >
        <MapLibre mapStyle={mapStyle} />
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
