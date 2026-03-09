import { useMemo } from 'react';
import { FlyToInterpolator } from '@deck.gl/core';
import { ScatterplotLayer, TextLayer, GeoJsonLayer, IconLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type Supercluster from 'supercluster';
import {
  COLOR_PRESETS, MAP_FONT,
  colColor, CAR_SVG_URI, BUILDING_SVG_URI,
  fmtPrice, simpleHash,
} from '../mapUtils';
import type {
  ColorPreset, VPin, ColPin, BizPin, PhotoPin, MarketplacePin, LiveEvent,
} from '../mapUtils';

export interface UseMapLayersParams {
  // Data
  filteredVehicles: VPin[];
  collections: ColPin[];
  businesses: BizPin[];
  photos: PhotoPin[];
  marketplace: MarketplacePin[];
  queryResults: VPin[];
  // Visibility
  showVehicles: boolean;
  showCollections: boolean;
  showBusinesses: boolean;
  showPhotos: boolean;
  showMarketplace: boolean;
  showCountyOverlay: boolean;
  hasQuery: boolean;
  // View
  zoom: number;
  mode: 'density' | 'points' | 'thermal';
  glowRadius: number;
  glowIntensity: number;
  pointSize: number;
  colorPreset: ColorPreset;
  // Animation
  tick: number;
  liveEventsRef: React.MutableRefObject<LiveEvent[]>;
  // Geo
  countyFeatures: any;
  clusterIndex: Supercluster | null;
  viewportBounds: { north: number; south: number; east: number; west: number } | null;
  zctaGeoJson: any;
  selectedZip: string | null;
  selectedCounties: Set<string>;
  // Callbacks
  handleLayerClick: (object: any, type: 'vehicle' | 'collection' | 'business' | 'photo' | 'marketplace') => void;
  setHoverInfo: (info: { x: number; y: number; text: string } | null) => void;
  setSelectedPin: (pin: any) => void;
  setSelectedCounties: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedZip: React.Dispatch<React.SetStateAction<string | null>>;
  setViewState: React.Dispatch<React.SetStateAction<any>>;
  deckClickedRef: React.MutableRefObject<boolean>;
}

export function useMapLayers(params: UseMapLayersParams) {
  const {
    filteredVehicles, collections, businesses, photos, marketplace, queryResults,
    showVehicles, showCollections, showBusinesses, showPhotos, showMarketplace, showCountyOverlay, hasQuery,
    zoom, mode, glowRadius, glowIntensity, pointSize, colorPreset,
    tick, liveEventsRef,
    countyFeatures, clusterIndex, viewportBounds, zctaGeoJson, selectedZip, selectedCounties,
    handleLayerClick, setHoverInfo, setSelectedPin, setSelectedCounties, setSelectedZip, setViewState, deckClickedRef,
  } = params;

  // Quantize zoom to 0.5 steps so layers don't rebuild on every sub-pixel scroll
  const qZoom = Math.round(zoom * 2) / 2;

  return useMemo(() => {
    const result: any[] = [];
    const now = Date.now();
    const colors = COLOR_PRESETS[colorPreset];
    const vehColor: [number, number, number] = hasQuery ? colors.query : colors.vehicle;

    // --- Thermal Choropleth (county boundaries colored by vehicle density) ---
    if (showVehicles && mode === 'thermal' && countyFeatures) {
      result.push(new GeoJsonLayer({
        id: 'county-choropleth',
        data: countyFeatures,
        filled: true,
        stroked: true,
        getFillColor: (f: any) => {
          const count = f.properties._count || 0;
          if (count === 0) return [0, 0, 0, 0];
          const maxC = f.properties._maxCount || 1;
          const t = Math.log1p(count) / Math.log1p(maxC);
          if (t < 0.15) return [20 + t * 400, 10, 80 + t * 267, Math.round(60 + t * 600)];
          if (t < 0.3)  return [80, 0, 120, Math.round(100 + t * 400)];
          if (t < 0.5)  return [180, 30, 30, Math.round(140 + t * 200)];
          if (t < 0.7)  return [230, 120, 20, Math.round(160 + t * 120)];
          if (t < 0.9)  return [255, 230, 50, Math.round(180 + t * 80)];
          return [255, 255, 240, 230];
        },
        getLineColor: [255, 255, 255, 30],
        lineWidthMinPixels: 0.5,
        pickable: true,
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const count = object.properties._count || 0;
            setHoverInfo({ x, y, text: `${object.properties.name}: ${count.toLocaleString()} vehicles` });
          } else {
            setHoverInfo(null);
          }
        },
        updateTriggers: { getFillColor: [countyFeatures] },
      }));
    }

    // --- True Thermal Heatmap (continuous gradient) ---
    if (showVehicles && mode === 'thermal') {
      const thermalData = hasQuery ? queryResults : filteredVehicles;
      if (thermalData.length > 0) {
        result.push(new HeatmapLayer({
          id: 'thermal-heatmap',
          data: thermalData,
          getPosition: (d: VPin) => [d.lng, d.lat],
          getWeight: (d: VPin) => d.weight || 1,
          radiusPixels: glowRadius,
          intensity: glowIntensity / 40,
          threshold: 0.03,
          colorRange: [
            [10, 5, 50],
            [40, 0, 100],
            [120, 0, 80],
            [200, 40, 20],
            [240, 140, 30],
            [255, 230, 60],
            [255, 255, 230],
          ],
          aggregation: 'SUM',
        }));
        result.push(new ScatterplotLayer({
          id: 'thermal-ghost-dots',
          data: thermalData,
          getPosition: (d: VPin) => [d.lng, d.lat],
          getRadius: 2,
          radiusUnits: 'pixels' as const,
          getFillColor: [255, 200, 100, 60] as [number, number, number, number],
          pickable: true,
          onClick: ({ object }: any) => handleLayerClick(object, 'vehicle'),
          onHover: ({ object, x, y }: any) => {
            if (object) {
              const t = [object.year, object.make, object.model].filter(Boolean).join(' ');
              const price = object.price ? ' · ' + fmtPrice(object.price) : '';
              setHoverInfo({ x, y, text: (t || 'Vehicle') + price });
            } else {
              setHoverInfo(null);
            }
          },
        }));
      }
    }

    // --- County Overlay (independent toggle, works in any mode) ---
    if (showCountyOverlay && mode !== 'thermal' && countyFeatures) {
      result.push(new GeoJsonLayer({
        id: 'county-overlay',
        data: countyFeatures,
        filled: true,
        stroked: true,
        getFillColor: (f: any) => {
          const isSelected = selectedCounties.has(f.properties.GEOID || f.id);
          const count = f.properties._count || 0;
          if (isSelected) return [255, 255, 255, 50];
          if (count === 0) return [0, 0, 0, 0];
          const maxC = f.properties._maxCount || 1;
          const t = Math.log1p(count) / Math.log1p(maxC);
          if (t < 0.15) return [20 + t * 400, 10, 80 + t * 267, Math.round(60 + t * 600)];
          if (t < 0.3)  return [80, 0, 120, Math.round(100 + t * 400)];
          if (t < 0.5)  return [180, 30, 30, Math.round(140 + t * 200)];
          if (t < 0.7)  return [230, 120, 20, Math.round(160 + t * 120)];
          if (t < 0.9)  return [255, 230, 50, Math.round(180 + t * 80)];
          return [255, 255, 240, 230];
        },
        getLineColor: (f: any) => {
          const isSelected = selectedCounties.has(f.properties.GEOID || f.id);
          return isSelected ? [255, 255, 255, 200] : [255, 255, 255, 30];
        },
        getLineWidth: (f: any) => {
          const isSelected = selectedCounties.has(f.properties.GEOID || f.id);
          return isSelected ? 2 : 0.5;
        },
        lineWidthUnits: 'pixels' as const,
        lineWidthMinPixels: 0.5,
        pickable: true,
        onClick: ({ object, srcEvent }: any) => {
          if (object) {
            deckClickedRef.current = true;
            const id = object.properties.GEOID || object.id;
            setSelectedCounties(prev => {
              const next = new Set(prev);
              if (srcEvent?.shiftKey || srcEvent?.ctrlKey || srcEvent?.metaKey) {
                if (next.has(id)) next.delete(id); else next.add(id);
              } else {
                if (next.has(id) && next.size === 1) { next.clear(); } else { next.clear(); next.add(id); }
              }
              return next;
            });
            setTimeout(() => { deckClickedRef.current = false; }, 100);
          }
        },
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const count = object.properties._count || 0;
            setHoverInfo({ x, y, text: `${object.properties.name}: ${count.toLocaleString()} vehicles` });
          } else {
            setHoverInfo(null);
          }
        },
        updateTriggers: { getFillColor: [countyFeatures, selectedCounties], getLineColor: [selectedCounties], getLineWidth: [selectedCounties] },
      }));
    }

    // --- ZIP Code (ZCTA) Polygon Layer (z9+) ---
    if (zctaGeoJson && qZoom >= 8.5 && mode !== 'thermal') {
      const zipOpacity = Math.max(0, Math.min(1, qZoom - 8.5));
      result.push(new GeoJsonLayer({
        id: 'zcta-polygons',
        data: zctaGeoJson,
        filled: true,
        stroked: true,
        getFillColor: (f: any) => {
          const isSelected = selectedZip === f.properties.zip;
          if (isSelected) return [255, 255, 255, 40];
          return [0, 0, 0, 0];
        },
        getLineColor: (f: any) => {
          const isSelected = selectedZip === f.properties.zip;
          return isSelected ? [255, 255, 255, 180] : [255, 255, 255, 20];
        },
        getLineWidth: (f: any) => {
          const isSelected = selectedZip === f.properties.zip;
          return isSelected ? 2 : 0.3;
        },
        lineWidthUnits: 'pixels' as const,
        lineWidthMinPixels: 0.3,
        opacity: zipOpacity,
        pickable: true,
        onClick: ({ object }: any) => {
          if (object) {
            deckClickedRef.current = true;
            const zip = object.properties.zip;
            setSelectedZip(prev => prev === zip ? null : zip);
            setTimeout(() => { deckClickedRef.current = false; }, 100);
          }
        },
        onHover: ({ object, x, y }: any) => {
          if (object) {
            setHoverInfo({ x, y, text: `ZIP ${object.properties.zip}` });
          } else {
            setHoverInfo(null);
          }
        },
        updateTriggers: { getFillColor: [selectedZip], getLineColor: [selectedZip], getLineWidth: [selectedZip] },
      }));
    }

    // ============================================================
    // VEHICLE LAYERS — Supercluster only, no hexagons
    // ============================================================

    if (showVehicles && mode !== 'thermal') {
      const isQuery = hasQuery && queryResults.length > 0;
      const sourceData = isQuery ? queryResults : filteredVehicles;
      const baseColor = isQuery ? colors.query : vehColor;
      const layerId = isQuery ? 'query' : 'vehicle';

      if (sourceData.length > 0) {
        // Use Supercluster for aggregation at all zoom levels
        let clusterData: any[] = [];
        let singlePoints: VPin[] = sourceData;

        if (clusterIndex && qZoom < 15) {
          try {
            const bbox: [number, number, number, number] = viewportBounds
              ? [viewportBounds.west, viewportBounds.south, viewportBounds.east, viewportBounds.north]
              : [-180, -90, 180, 90];
            const rawClusters = clusterIndex.getClusters(bbox, Math.floor(qZoom));
            clusterData = rawClusters.filter((c: any) => c.properties.cluster);
            const singles = rawClusters.filter((c: any) => !c.properties.cluster);
            const singleIds = new Set(singles.map((s: any) => s.properties.id));
            singlePoints = sourceData.filter(v => singleIds.has(v.id));
          } catch {
            singlePoints = sourceData;
            clusterData = [];
          }
        }

        // Individual points — pixel-based sizing, no jitter
        result.push(new ScatterplotLayer({
          id: `${layerId}-points`,
          data: singlePoints,
          getPosition: (d: VPin) => [d.lng, d.lat],
          getRadius: pointSize,
          radiusUnits: 'pixels' as const,
          getFillColor: (d: VPin) => d.isGpsOnly
            ? [150, 150, 150, 100] as [number, number, number, number]
            : [...baseColor, 200] as [number, number, number, number],
          pickable: true,
          onClick: ({ object }: any) => handleLayerClick(object, 'vehicle'),
          onHover: ({ object, x, y }: any) => {
            if (object) {
              const t = [object.year, object.make, object.model].filter(Boolean).join(' ');
              const price = object.price ? ' · ' + fmtPrice(object.price) : '';
              setHoverInfo({ x, y, text: (t || 'Vehicle') + price });
            } else {
              setHoverInfo(null);
            }
          },
          updateTriggers: { getFillColor: [colorPreset] },
        }));

        // Cluster circles
        if (clusterData.length > 0) {
          result.push(new ScatterplotLayer({
            id: `${layerId}-clusters`,
            data: clusterData,
            getPosition: (d: any) => d.geometry.coordinates,
            getRadius: (d: any) => {
              const count = d.properties.point_count || 1;
              return Math.min(pointSize * 6, (pointSize + 2) * (1.2 + Math.log10(count) * 0.8));
            },
            radiusUnits: 'pixels' as const,
            getFillColor: [...baseColor, 180] as [number, number, number, number],
            pickable: true,
            onClick: ({ object }: any) => {
              if (object && clusterIndex) {
                const expansionZoom = Math.min(clusterIndex.getClusterExpansionZoom(object.id as number), 16);
                setViewState((prev: any) => ({
                  ...prev,
                  longitude: object.geometry.coordinates[0],
                  latitude: object.geometry.coordinates[1],
                  zoom: expansionZoom,
                  transitionDuration: 500,
                  transitionInterpolator: new FlyToInterpolator(),
                }));
              }
            },
            onHover: ({ object, x, y }: any) => {
              if (object) {
                setHoverInfo({ x, y, text: `${object.properties.point_count.toLocaleString()} vehicles` });
              } else {
                setHoverInfo(null);
              }
            },
            updateTriggers: { getRadius: [pointSize], getFillColor: [colorPreset] },
          }));

          // Cluster count labels
          result.push(new TextLayer({
            id: `${layerId}-cluster-labels`,
            data: clusterData,
            getPosition: (d: any) => d.geometry.coordinates,
            getText: (d: any) => {
              const count = d.properties.point_count || 0;
              return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
            },
            getSize: 10,
            getColor: [255, 255, 255, 230],
            getTextAnchor: 'middle' as const,
            getAlignmentBaseline: 'center' as const,
            fontFamily: 'Arial, sans-serif',
            fontWeight: 700,
            outlineWidth: 2,
            outlineColor: [0, 0, 0, 180],
            pickable: false,
          }));
        }

        // Car shape icons at z14+
        if (qZoom >= 14) {
          const shapeFade = Math.max(0, Math.min(1, qZoom - 13));
          result.push(new IconLayer({
            id: `${layerId}-shapes`,
            data: sourceData,
            getPosition: (d: VPin) => [d.lng, d.lat],
            getIcon: () => ({
              url: CAR_SVG_URI,
              width: 10,
              height: 4,
              anchorX: 5,
              anchorY: 2,
            }),
            getSize: isQuery ? 14 : 8,
            sizeUnits: 'pixels' as const,
            getAngle: (d: VPin) => simpleHash(d.id) % 360,
            getColor: [...baseColor, Math.round(220 * shapeFade)] as [number, number, number, number],
            pickable: true,
            onClick: ({ object }: any) => handleLayerClick(object, 'vehicle'),
            onHover: ({ object, x, y }: any) => {
              if (object) {
                const t = [object.year, object.make, object.model].filter(Boolean).join(' ');
                const price = object.price ? ' · ' + fmtPrice(object.price) : '';
                setHoverInfo({ x, y, text: (t || 'Vehicle') + price });
              } else {
                setHoverInfo(null);
              }
            },
            updateTriggers: { getColor: [colorPreset, qZoom] },
          }));
        }
      }
    }

    // --- Collection Points ---
    if (showCollections && !hasQuery) {
      // Glow in density mode
      if (mode === 'density') {
        const glowFade = Math.max(0.15, Math.min(1, (14 - qZoom) / 8));
        result.push(new ScatterplotLayer({
          id: 'collection-glow',
          data: collections,
          getPosition: (d: ColPin) => [d.lng, d.lat],
          getRadius: (d: ColPin) => d.totalInventory > 20 ? 20 : 12,
          radiusUnits: 'pixels' as const,
          getFillColor: (d: ColPin) => [...colColor(d.country), Math.round(glowIntensity * 0.8)] as [number, number, number, number],
          opacity: glowFade * 0.8,
          pickable: true,
          onClick: ({ object }: any) => handleLayerClick(object, 'collection'),
          onHover: ({ object, x, y }: any) => {
            if (object) {
              const inv = object.totalInventory ? ` (${object.totalInventory})` : '';
              setHoverInfo({ x, y, text: object.name + inv });
            } else {
              setHoverInfo(null);
            }
          },
        }));
      }

      result.push(new ScatterplotLayer({
        id: 'collection-points',
        data: collections,
        getPosition: (d: ColPin) => [d.lng, d.lat],
        getRadius: 5,
        radiusUnits: 'pixels' as const,
        getFillColor: (d: ColPin) => [...colColor(d.country), 220] as [number, number, number, number],
        pickable: true,
        onClick: ({ object }: any) => handleLayerClick(object, 'collection'),
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const inv = object.totalInventory ? ` (${object.totalInventory})` : '';
            setHoverInfo({ x, y, text: object.name + inv });
          }
          else setHoverInfo(null);
        },
      }));

      // Collection Labels — visible at z10+
      if (qZoom >= 10) {
        result.push(new TextLayer({
          id: 'collection-labels',
          data: collections,
          getPosition: (d: ColPin) => [d.lng, d.lat],
          getText: (d: ColPin) => d.name,
          getSize: Math.min(14, 9 + (qZoom - 10) * 1.5),
          getColor: [255, 255, 255, qZoom >= 13 ? 230 : 160],
          getPixelOffset: [0, -12],
          fontFamily: MAP_FONT,
          fontWeight: 'bold',
          outlineWidth: 2,
          outlineColor: [0, 0, 0, 180],
          billboard: false,
          sizeUnits: 'pixels',
          pickable: false,
        }));
      }

      // Collection shapes (building squares) at z14+
      if (qZoom >= 14) {
        const shapeFade = Math.max(0, Math.min(1, qZoom - 13));
        result.push(new IconLayer({
          id: 'collection-shapes',
          data: collections,
          getPosition: (d: ColPin) => [d.lng, d.lat],
          getIcon: () => ({
            url: BUILDING_SVG_URI,
            width: 8,
            height: 8,
            anchorX: 4,
            anchorY: 4,
          }),
          getSize: 14,
          sizeUnits: 'pixels' as const,
          getColor: (d: ColPin) => [...colColor(d.country), Math.round(220 * shapeFade)] as [number, number, number, number],
          pickable: true,
          onClick: ({ object }: any) => handleLayerClick(object, 'collection'),
          updateTriggers: { getColor: [qZoom] },
        }));
      }
    }

    // --- Business Points ---
    if (showBusinesses && !hasQuery) {
      // Glow in density mode
      if (mode === 'density') {
        const glowFade = Math.max(0.15, Math.min(1, (14 - qZoom) / 8));
        result.push(new ScatterplotLayer({
          id: 'business-glow',
          data: businesses,
          getPosition: (d: BizPin) => [d.lng, d.lat],
          getRadius: 10,
          radiusUnits: 'pixels' as const,
          getFillColor: [...colors.business, Math.round(glowIntensity * 0.6)] as [number, number, number, number],
          opacity: glowFade * 0.6,
          pickable: true,
          onClick: ({ object }: any) => handleLayerClick(object, 'business'),
          onHover: ({ object, x, y }: any) => {
            if (object) {
              const t = object.type ? ` · ${object.type}` : '';
              setHoverInfo({ x, y, text: object.name + t });
            } else {
              setHoverInfo(null);
            }
          },
        }));
      }

      result.push(new ScatterplotLayer({
        id: 'business-points',
        data: businesses,
        getPosition: (d: BizPin) => [d.lng, d.lat],
        getRadius: 3,
        radiusUnits: 'pixels' as const,
        getFillColor: [...colors.business, 200] as [number, number, number, number],
        pickable: true,
        onClick: ({ object }: any) => handleLayerClick(object, 'business'),
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const t = object.type ? ` · ${object.type}` : '';
            setHoverInfo({ x, y, text: object.name + t });
          }
          else setHoverInfo(null);
        },
      }));

      // Business Labels — visible at z12+
      if (qZoom >= 12) {
        result.push(new TextLayer({
          id: 'business-labels',
          data: businesses,
          getPosition: (d: BizPin) => [d.lng, d.lat],
          getText: (d: BizPin) => d.name,
          getSize: Math.min(12, 8 + (qZoom - 12) * 1.5),
          getColor: [200, 230, 220, qZoom >= 14 ? 220 : 140],
          getPixelOffset: [0, -10],
          fontFamily: MAP_FONT,
          outlineWidth: 2,
          outlineColor: [0, 0, 0, 160],
          billboard: false,
          sizeUnits: 'pixels',
          pickable: false,
        }));
      }

      // Business shapes at z14+
      if (qZoom >= 14) {
        const shapeFade = Math.max(0, Math.min(1, qZoom - 13));
        result.push(new IconLayer({
          id: 'business-shapes',
          data: businesses,
          getPosition: (d: BizPin) => [d.lng, d.lat],
          getIcon: () => ({
            url: BUILDING_SVG_URI,
            width: 8,
            height: 8,
            anchorX: 4,
            anchorY: 4,
          }),
          getSize: 10,
          sizeUnits: 'pixels' as const,
          getColor: [...colors.business, Math.round(220 * shapeFade)] as [number, number, number, number],
          pickable: true,
          onClick: ({ object }: any) => handleLayerClick(object, 'business'),
          updateTriggers: { getColor: [qZoom, colorPreset] },
        }));
      }
    }

    // ============================================================
    // PHOTO LAYERS — dots + thumbnails at high zoom
    // ============================================================
    if (showPhotos && !hasQuery && photos.length > 0 && mode !== 'thermal') {
      const photoThumbFade = Math.max(0, Math.min(1, qZoom - 13.5));
      const photoDotFade = 1 - photoThumbFade;

      // Dot layer
      if (photoDotFade > 0) {
        result.push(new ScatterplotLayer({
          id: 'photo-points',
          data: photos,
          getPosition: (d: PhotoPin) => [d.lng, d.lat],
          getRadius: pointSize * 0.7,
          radiusUnits: 'pixels' as const,
          getFillColor: (d: PhotoPin) => {
            if (!d.hasRealImage) return [150, 150, 150, 80] as [number, number, number, number];
            return [...colors.photo, 230] as [number, number, number, number];
          },
          opacity: photoDotFade,
          pickable: photoDotFade > 0.3,
          onClick: ({ object }: any) => handleLayerClick(object, 'photo'),
          onHover: ({ object, x, y }: any) => {
            if (object) {
              const label = object.vehicleTitle || 'Photo';
              const tag = !object.hasRealImage ? ' [GPS]' : '';
              const loc = object.locationName ? ` · ${object.locationName.split(',')[0]}` : '';
              const date = object.takenLabel ? ` · ${object.takenLabel}` : '';
              setHoverInfo({ x, y, text: label + tag + loc + date });
            } else {
              setHoverInfo(null);
            }
          },
          updateTriggers: { getFillColor: [colorPreset], opacity: [photoDotFade] },
        }));
      }

      // Thumbnail IconLayer at z14+
      if (photoThumbFade > 0) {
        const thumbPhotos = photos.filter(p => p.hasRealImage && p.thumb);
        if (thumbPhotos.length > 0) {
          result.push(new IconLayer({
            id: 'photo-thumbnails',
            data: thumbPhotos,
            getPosition: (d: PhotoPin) => [d.lng, d.lat],
            getIcon: (d: PhotoPin) => ({
              url: d.thumb!,
              width: 64,
              height: 48,
              anchorX: 32,
              anchorY: 24,
            }),
            getSize: 32,
            sizeUnits: 'pixels' as const,
            sizeMinPixels: 16,
            sizeMaxPixels: 48,
            opacity: photoThumbFade,
            pickable: true,
            onClick: ({ object }: any) => handleLayerClick(object, 'photo'),
            onHover: ({ object, x, y }: any) => {
              if (object) {
                const label = object.vehicleTitle || 'Photo';
                const loc = object.locationName ? ` · ${object.locationName.split(',')[0]}` : '';
                setHoverInfo({ x, y, text: label + loc });
              } else {
                setHoverInfo(null);
              }
            },
            updateTriggers: { opacity: [photoThumbFade] },
          }));
        }
      }
    }

    // --- Marketplace Points (green — FB listings) ---
    if (showMarketplace && !hasQuery && marketplace.length > 0 && mode !== 'thermal') {
      // Glow in density mode
      if (mode === 'density') {
        const glowFade = Math.max(0.15, Math.min(1, (14 - qZoom) / 8));
        result.push(new ScatterplotLayer({
          id: 'marketplace-glow',
          data: marketplace,
          getPosition: (d: MarketplacePin) => [d.lng, d.lat],
          getRadius: 10,
          radiusUnits: 'pixels' as const,
          getFillColor: [74, 222, 128, Math.round(glowIntensity * 0.8)] as [number, number, number, number],
          opacity: glowFade * 0.8,
          pickable: false,
        }));
      }

      result.push(new ScatterplotLayer({
        id: 'marketplace-points',
        data: marketplace,
        getPosition: (d: MarketplacePin) => [d.lng, d.lat],
        getRadius: pointSize,
        radiusUnits: 'pixels' as const,
        getFillColor: [74, 222, 128, 220] as [number, number, number, number],
        pickable: true,
        onClick: ({ object }: any) => handleLayerClick(object, 'marketplace'),
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const price = object.price ? ' · ' + fmtPrice(object.price) : '';
            setHoverInfo({ x, y, text: (object.title || 'FB Listing') + price });
          } else {
            setHoverInfo(null);
          }
        },
      }));
    }

    // --- Live Event Rings (animated) ---
    const liveEvents = liveEventsRef.current.filter(e => now - e.ts < 2500);
    if (liveEvents.length > 0) {
      result.push(new ScatterplotLayer({
        id: 'live-rings',
        data: liveEvents,
        getPosition: (d: LiveEvent) => [d.lng, d.lat],
        getRadius: (d: LiveEvent) => {
          const age = (now - d.ts) / 2500;
          return age * 40;
        },
        getFillColor: (d: LiveEvent) => {
          const age = (now - d.ts) / 2500;
          return [74, 222, 128, Math.round(180 * (1 - age))] as [number, number, number, number];
        },
        radiusUnits: 'pixels' as const,
        pickable: false,
        updateTriggers: { getRadius: [tick], getFillColor: [tick] },
      }));
      result.push(new ScatterplotLayer({
        id: 'live-dots',
        data: liveEvents,
        getPosition: (d: LiveEvent) => [d.lng, d.lat],
        getRadius: 3,
        radiusUnits: 'pixels' as const,
        getFillColor: [74, 222, 128, 255] as [number, number, number, number],
        pickable: false,
      }));
    }

    return result;
  }, [filteredVehicles, collections, businesses, photos, marketplace, queryResults, showVehicles, showCollections, showBusinesses,
      showPhotos, showMarketplace, showCountyOverlay, hasQuery, qZoom, mode, glowRadius, glowIntensity, pointSize, colorPreset, tick, countyFeatures, clusterIndex, viewportBounds, zctaGeoJson, selectedZip, selectedCounties,
      handleLayerClick, setHoverInfo, setSelectedPin, setSelectedCounties, setSelectedZip, setViewState, deckClickedRef, liveEventsRef]);
}
