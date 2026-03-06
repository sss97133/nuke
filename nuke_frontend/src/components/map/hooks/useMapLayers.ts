import { useMemo } from 'react';
import { FlyToInterpolator } from '@deck.gl/core';
import { ScatterplotLayer, TextLayer, GeoJsonLayer, IconLayer } from '@deck.gl/layers';
import { HeatmapLayer, HexagonLayer } from '@deck.gl/aggregation-layers';
import type Supercluster from 'supercluster';
import {
  COLOR_PRESETS, ColorPreset, MAP_FONT,
  VPin, ColPin, BizPin, PhotoPin, MarketplacePin, LiveEvent,
  hexRadiusForZoom, hexColorRange,
  HEX_FADE_START, HEX_FADE_END, POINTS_FADE_START, POINTS_FADE_END,
  colColor, CAR_SVG_URI, BUILDING_SVG_URI,
  fmtPrice, simpleHash,
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

  return useMemo(() => {
    const result: any[] = [];
    const now = Date.now();
    const colors = COLOR_PRESETS[colorPreset];

    const vehColor: [number, number, number] = hasQuery ? colors.query : colors.vehicle;
    const glowAlpha = Math.max(0, Math.min(255, glowIntensity));

    // Zoom-based point scale — visible at z4.5 (nationwide), grows slightly with zoom
    const zoomScale = Math.max(0.6, Math.min(1.5, 0.4 + zoom / 12));
    const ptBase = pointSize * zoomScale;

    // Glow fades as you zoom in past z12, but never fully disappears
    const showGlow = mode === 'density';
    const glowFade = showGlow ? Math.max(0.15, Math.min(1, (14 - zoom) / 8)) : 0;

    // Shape evolution: circles crossfade to rectangles at z14+
    const shapeFade = Math.max(0, Math.min(1, zoom - 13)); // 0 at z13, 1 at z14+
    const circleFade = 1 - shapeFade;

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
          radiusUnits: 'meters' as const,
          getFillColor: [255, 200, 100, 60] as [number, number, number, number],
          radiusMinPixels: 0,
          radiusMaxPixels: 4,
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
        lineWidthMinPixels: (f: any) => {
          return 0.5;
        },
        getLineWidth: (f: any) => {
          const isSelected = selectedCounties.has(f.properties.GEOID || f.id);
          return isSelected ? 2 : 0.5;
        },
        lineWidthUnits: 'pixels' as const,
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
    if (zctaGeoJson && zoom >= 8.5 && mode !== 'thermal') {
      const zipOpacity = Math.max(0, Math.min(1, zoom - 8.5));
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
    // VEHICLE LAYERS — hex binning + crossfade architecture
    // ============================================================
    const hexRadiusBase = hexRadiusForZoom(Math.round(zoom));
    const hexRadius = Math.round(hexRadiusBase * (glowRadius / 60));
    const layerOpacity = glowIntensity / 100;
    const hexOpacity = mode !== 'density' ? 0
      : zoom < HEX_FADE_START ? 0.85
      : zoom > HEX_FADE_END ? 0
      : 0.85 * ((HEX_FADE_END - zoom) / (HEX_FADE_END - HEX_FADE_START));
    const pointsOpacity = mode === 'points' ? 1
      : mode === 'thermal' ? 0
      : zoom < POINTS_FADE_START ? 0
      : zoom > POINTS_FADE_END ? 1
      : (zoom - POINTS_FADE_START) / (POINTS_FADE_END - POINTS_FADE_START);

    // --- Vehicle hex bins (density mode only, z3-z12.5) ---
    if (showVehicles && !hasQuery && hexOpacity > 0) {
      result.push(new HexagonLayer({
        id: 'vehicle-hexbins',
        data: filteredVehicles,
        gpuAggregation: false,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getColorWeight: (d: VPin) => d.weight || 1,
        colorAggregation: 'SUM',
        radius: hexRadius,
        coverage: 0.88,
        extruded: false,
        colorRange: hexColorRange(vehColor),
        colorScaleType: 'quantile',
        opacity: hexOpacity * layerOpacity,
        pickable: true,
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const count = object.points?.length || object.colorValue || 0;
            const pts = object.points?.map((p: any) => p.source || p) as VPin[] | undefined;
            let detail = `${count.toLocaleString()} vehicles`;
            if (pts && pts.length > 0) {
              const prices = pts.filter((p: VPin) => p.price).map((p: VPin) => p.price as number);
              if (prices.length > 0) {
                const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
                detail += ` · avg ${fmtPrice(avg)}`;
              }
            }
            setHoverInfo({ x, y, text: detail });
          } else {
            setHoverInfo(null);
          }
        },
        onClick: ({ object }: any) => {
          if (object) {
            deckClickedRef.current = true;
            const pts = (object.points || []).map((p: any) => p.source || p) as VPin[];
            setSelectedPin({
              pin: {
                id: `hex-${object.position?.[0]?.toFixed(4)}-${object.position?.[1]?.toFixed(4)}`,
                _isHexBin: true,
                _hexCount: pts.length,
                _hexPoints: pts,
                _hexPosition: object.position,
                lat: object.position?.[1] || 0,
                lng: object.position?.[0] || 0,
              } as any,
              type: 'vehicle',
            });
            setTimeout(() => { deckClickedRef.current = false; }, 100);
          }
        },
        updateTriggers: {
          colorRange: [colorPreset],
          radius: [zoom, glowRadius],
        },
      }));
    }

    // --- Vehicle individual points (always visible in 'points' mode, crossfade in 'density') ---
    if (showVehicles && !hasQuery && pointsOpacity > 0) {
      let clusterData: any[] = [];
      let singlePoints: VPin[] = filteredVehicles;

      if (clusterIndex && zoom < 15) {
        try {
          const bbox: [number, number, number, number] = viewportBounds
            ? [viewportBounds.west, viewportBounds.south, viewportBounds.east, viewportBounds.north]
            : [-180, -90, 180, 90];
          const rawClusters = clusterIndex.getClusters(bbox, Math.floor(zoom));
          clusterData = rawClusters.filter((c: any) => c.properties.cluster);
          const singles = rawClusters.filter((c: any) => !c.properties.cluster);
          const singleIds = new Set(singles.map((s: any) => s.properties.id));
          singlePoints = filteredVehicles.filter(v => singleIds.has(v.id));
        } catch {
          singlePoints = filteredVehicles;
          clusterData = [];
        }
      }

      // Render individual (non-clustered) points
      result.push(new ScatterplotLayer({
        id: 'vehicle-points',
        data: singlePoints,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getRadius: ptBase,
        radiusUnits: 'meters' as const,
        radiusMinPixels: 0,
        radiusMaxPixels: pointSize * 2,
        getFillColor: (d: VPin) => d.isGpsOnly
          ? [150, 150, 150, 100] as [number, number, number, number]
          : [...vehColor, 200] as [number, number, number, number],
        opacity: pointsOpacity * (zoom >= 13 ? circleFade : 1) * layerOpacity,
        pickable: pointsOpacity > 0.5,
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
        transitions: {
          getPosition: { duration: 600 },
          getFillColor: { duration: 800 },
        },
        updateTriggers: { getFillColor: [colorPreset], getRadius: [pointSize, zoom], opacity: [pointsOpacity, circleFade] },
      }));

      // Render cluster circles
      if (clusterData.length > 0) {
        result.push(new ScatterplotLayer({
          id: 'vehicle-clusters',
          data: clusterData,
          getPosition: (d: any) => d.geometry.coordinates,
          getRadius: (d: any) => {
            const count = d.properties.point_count || 1;
            return ptBase * Math.min(4, 1.5 + Math.log10(count));
          },
          radiusUnits: 'meters' as const,
          radiusMinPixels: 8,
          radiusMaxPixels: pointSize * 6,
          getFillColor: [...vehColor, 180] as [number, number, number, number],
          opacity: pointsOpacity * layerOpacity,
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
          updateTriggers: { getRadius: [pointSize, zoom], getFillColor: [colorPreset] },
        }));

        // Cluster count labels
        result.push(new TextLayer({
          id: 'vehicle-cluster-labels',
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
          opacity: pointsOpacity * layerOpacity,
          pickable: false,
        }));
      }
    }

    // --- Vehicle shape evolution — rectangles at z14+ ---
    if (showVehicles && !hasQuery && mode !== 'thermal' && pointsOpacity > 0 && shapeFade > 0) {
      result.push(new IconLayer({
        id: 'vehicle-shapes',
        data: filteredVehicles,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getIcon: () => ({
          url: CAR_SVG_URI,
          width: 10,
          height: 4,
          anchorX: 5,
          anchorY: 2,
        }),
        getSize: 5,
        sizeUnits: 'meters' as const,
        sizeMinPixels: 0,
        sizeMaxPixels: 8,
        getAngle: (d: VPin) => simpleHash(d.id) % 360,
        getColor: (d: VPin) => [...vehColor, Math.round(220 * shapeFade)] as [number, number, number, number],
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
        updateTriggers: { getColor: [colorPreset, zoom] },
      }));
    }

    // ============================================================
    // QUERY RESULTS — hex binning + crossfade (same architecture as vehicles)
    // ============================================================

    // --- Query hex bins (density mode only, z3-z12.5) ---
    if (hasQuery && showVehicles && queryResults.length > 0 && hexOpacity > 0) {
      result.push(new HexagonLayer({
        id: 'query-hexbins',
        data: queryResults,
        gpuAggregation: false,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getColorWeight: (d: VPin) => d.weight || 1,
        colorAggregation: 'SUM',
        radius: hexRadius,
        coverage: 0.88,
        extruded: false,
        colorRange: hexColorRange(colors.query),
        colorScaleType: 'quantile',
        opacity: hexOpacity,
        pickable: true,
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const count = object.points?.length || object.colorValue || 0;
            const pts = object.points?.map((p: any) => p.source || p) as VPin[] | undefined;
            let detail = `${count.toLocaleString()} results`;
            if (pts && pts.length > 0) {
              const prices = pts.filter((p: VPin) => p.price).map((p: VPin) => p.price as number);
              if (prices.length > 0) {
                const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
                detail += ` · avg ${fmtPrice(avg)}`;
              }
            }
            setHoverInfo({ x, y, text: detail });
          } else {
            setHoverInfo(null);
          }
        },
        onClick: ({ object }: any) => {
          if (object) {
            deckClickedRef.current = true;
            const pts = (object.points || []).map((p: any) => p.source || p) as VPin[];
            setSelectedPin({
              pin: {
                id: `qhex-${object.position?.[0]?.toFixed(4)}-${object.position?.[1]?.toFixed(4)}`,
                _isHexBin: true,
                _hexCount: pts.length,
                _hexPoints: pts,
                _hexPosition: object.position,
                lat: object.position?.[1] || 0,
                lng: object.position?.[0] || 0,
              } as any,
              type: 'vehicle',
            });
            setTimeout(() => { deckClickedRef.current = false; }, 100);
          }
        },
        updateTriggers: {
          colorRange: [colorPreset],
          radius: [zoom],
        },
      }));
    }

    // --- Query individual points ---
    if (hasQuery && showVehicles && queryResults.length > 0 && pointsOpacity > 0) {
      result.push(new ScatterplotLayer({
        id: 'query-points',
        data: queryResults,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getRadius: ptBase * 1.3,
        radiusUnits: 'meters' as const,
        radiusMinPixels: 0,
        radiusMaxPixels: pointSize * 2.5,
        getFillColor: [...colors.query, 220] as [number, number, number, number],
        opacity: pointsOpacity,
        pickable: pointsOpacity > 0.5,
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
        transitions: {
          getFillColor: { duration: 200 },
          getRadius: { duration: 200 },
        },
        updateTriggers: { getRadius: [pointSize, zoom], opacity: [pointsOpacity] },
      }));
    }

    // --- Query shape evolution — rectangles at z14+ ---
    if (hasQuery && showVehicles && queryResults.length > 0 && pointsOpacity > 0 && shapeFade > 0) {
      result.push(new IconLayer({
        id: 'query-shapes',
        data: queryResults,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getIcon: () => ({
          url: CAR_SVG_URI,
          width: 10,
          height: 4,
          anchorX: 5,
          anchorY: 2,
        }),
        getSize: 5,
        sizeUnits: 'meters' as const,
        sizeMinPixels: 0,
        sizeMaxPixels: 14,
        getAngle: (d: VPin) => simpleHash(d.id) % 360,
        getColor: [...colors.query, Math.round(220 * shapeFade)] as [number, number, number, number],
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
        updateTriggers: { getColor: [colorPreset, zoom] },
      }));
    }

    // --- Collection Glow ---
    if (showCollections && !hasQuery && showGlow) {
      result.push(new ScatterplotLayer({
        id: 'collection-glow',
        data: collections,
        getPosition: (d: ColPin) => [d.lng, d.lat],
        getRadius: (d: ColPin) => d.totalInventory > 20 ? 800 : 400,
        radiusUnits: 'meters' as const,
        getFillColor: (d: ColPin) => [...colColor(d.country), Math.round(glowAlpha * 0.8)] as [number, number, number, number],
        radiusMinPixels: 0,
        radiusMaxPixels: glowRadius * 0.6,
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
        updateTriggers: { getRadius: [glowRadius, zoom] },
      }));
    }

    // --- Collection Points ---
    if (showCollections && !hasQuery) {
      result.push(new ScatterplotLayer({
        id: 'collection-points',
        data: collections,
        getPosition: (d: ColPin) => [d.lng, d.lat],
        getRadius: 30,
        radiusUnits: 'meters' as const,
        getFillColor: (d: ColPin) => [...colColor(d.country), 220] as [number, number, number, number],
        radiusMinPixels: 0,
        radiusMaxPixels: 12,
        pickable: true,
        onClick: ({ object }: any) => handleLayerClick(object, 'collection'),
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const inv = object.totalInventory ? ` (${object.totalInventory})` : '';
            setHoverInfo({ x, y, text: object.name + inv });
          }
          else setHoverInfo(null);
        },
        updateTriggers: { getRadius: [pointSize, zoom] },
      }));

      // --- Collection Labels — visible at z10+ ---
      if (zoom >= 10) {
        result.push(new TextLayer({
          id: 'collection-labels',
          data: collections,
          getPosition: (d: ColPin) => [d.lng, d.lat],
          getText: (d: ColPin) => d.name,
          getSize: Math.min(14, 9 + (zoom - 10) * 1.5),
          getColor: [255, 255, 255, zoom >= 13 ? 230 : 160],
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
      if (shapeFade > 0) {
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
          getSize: 25,
          sizeUnits: 'meters' as const,
          sizeMinPixels: 0,
          sizeMaxPixels: 14,
          getColor: (d: ColPin) => [...colColor(d.country), Math.round(220 * shapeFade)] as [number, number, number, number],
          pickable: true,
          onClick: ({ object }: any) => handleLayerClick(object, 'collection'),
          updateTriggers: { getColor: [zoom] },
        }));
      }
    }

    // --- Business Glow ---
    if (showBusinesses && !hasQuery && showGlow) {
      result.push(new ScatterplotLayer({
        id: 'business-glow',
        data: businesses,
        getPosition: (d: BizPin) => [d.lng, d.lat],
        getRadius: 300,
        radiusUnits: 'meters' as const,
        getFillColor: [...colors.business, Math.round(glowAlpha * 0.6)] as [number, number, number, number],
        radiusMinPixels: 0,
        radiusMaxPixels: glowRadius * 0.5,
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
        updateTriggers: { getRadius: [glowRadius, zoom], getFillColor: [colorPreset, glowIntensity] },
      }));
    }

    // --- Business Points ---
    if (showBusinesses && !hasQuery) {
      result.push(new ScatterplotLayer({
        id: 'business-points',
        data: businesses,
        getPosition: (d: BizPin) => [d.lng, d.lat],
        getRadius: 20,
        radiusUnits: 'meters' as const,
        getFillColor: [...colors.business, 200] as [number, number, number, number],
        radiusMinPixels: 0,
        radiusMaxPixels: 7,
        pickable: true,
        onClick: ({ object }: any) => handleLayerClick(object, 'business'),
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const t = object.type ? ` · ${object.type}` : '';
            setHoverInfo({ x, y, text: object.name + t });
          }
          else setHoverInfo(null);
        },
        updateTriggers: { getRadius: [pointSize, zoom] },
      }));

      // --- Business Labels — visible at z12+ ---
      if (zoom >= 12) {
        result.push(new TextLayer({
          id: 'business-labels',
          data: businesses,
          getPosition: (d: BizPin) => [d.lng, d.lat],
          getText: (d: BizPin) => d.name,
          getSize: Math.min(12, 8 + (zoom - 12) * 1.5),
          getColor: [200, 230, 220, zoom >= 14 ? 220 : 140],
          getPixelOffset: [0, -10],
          fontFamily: MAP_FONT,
          outlineWidth: 2,
          outlineColor: [0, 0, 0, 160],
          billboard: false,
          sizeUnits: 'pixels',
          pickable: false,
        }));
      }

      // Business shapes (building squares) at z14+
      if (shapeFade > 0) {
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
          getSize: 15,
          sizeUnits: 'meters' as const,
          sizeMinPixels: 0,
          sizeMaxPixels: 10,
          getColor: [...colors.business, Math.round(220 * shapeFade)] as [number, number, number, number],
          pickable: true,
          onClick: ({ object }: any) => handleLayerClick(object, 'business'),
          updateTriggers: { getColor: [zoom, colorPreset] },
        }));
      }
    }

    // ============================================================
    // PHOTO LAYERS — hex binning + crossfade architecture
    // ============================================================

    // --- Photo hex bins (density mode only, z3-z12.5) ---
    if (showPhotos && !hasQuery && photos.length > 0 && hexOpacity > 0) {
      result.push(new HexagonLayer({
        id: 'photo-hexbins',
        data: photos,
        gpuAggregation: false,
        getPosition: (d: PhotoPin) => [d.lng, d.lat],
        getColorWeight: () => 1,
        colorAggregation: 'SUM',
        radius: hexRadiusForZoom(Math.round(zoom)),
        coverage: 0.88,
        extruded: false,
        colorRange: hexColorRange(colors.photo),
        colorScaleType: 'quantile',
        opacity: hexOpacity,
        pickable: true,
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const count = object.points?.length || object.colorValue || 0;
            setHoverInfo({ x, y, text: `${count.toLocaleString()} photos` });
          } else {
            setHoverInfo(null);
          }
        },
        onClick: ({ object }: any) => {
          if (object) {
            deckClickedRef.current = true;
            const pts = (object.points || []).map((p: any) => p.source || p) as PhotoPin[];
            setSelectedPin({
              pin: {
                id: `photo-hex-${object.position?.[0]?.toFixed(4)}-${object.position?.[1]?.toFixed(4)}`,
                _isPhotoHexBin: true,
                _hexCount: pts.length,
                _hexPoints: pts,
                lat: object.position?.[1] || 0,
                lng: object.position?.[0] || 0,
              } as any,
              type: 'photo',
            });
            setTimeout(() => { deckClickedRef.current = false; }, 100);
          }
        },
        updateTriggers: {
          colorRange: [colorPreset],
          radius: [zoom],
        },
      }));
    }

    // --- Photo individual points (fade in z13 → z15) ---
    if (showPhotos && !hasQuery && photos.length > 0 && pointsOpacity > 0) {
      const photoThumbFade = Math.max(0, Math.min(1, zoom - 13.5));
      const photoDotFade = 1 - photoThumbFade;

      // Dot layer (fades out as thumbnails appear)
      if (photoDotFade > 0) {
        result.push(new ScatterplotLayer({
          id: 'photo-points',
          data: photos,
          getPosition: (d: PhotoPin) => [d.lng, d.lat],
          getRadius: ptBase * 0.7,
          radiusUnits: 'meters' as const,
          radiusMinPixels: 0,
          radiusMaxPixels: pointSize * 1.5,
          getFillColor: (d: PhotoPin) => {
            if (!d.hasRealImage) return [150, 150, 150, 80] as [number, number, number, number];
            return [...colors.photo, 230] as [number, number, number, number];
          },
          opacity: pointsOpacity * photoDotFade,
          pickable: pointsOpacity > 0.5 && photoDotFade > 0.3,
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
          transitions: {
            getFillColor: { duration: 200 },
            getRadius: { duration: 200 },
          },
          updateTriggers: { getFillColor: [colorPreset], opacity: [pointsOpacity, photoDotFade] },
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
            opacity: pointsOpacity * photoThumbFade,
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
            updateTriggers: { opacity: [pointsOpacity, photoThumbFade] },
          }));
        }
      }
    }

    // --- Marketplace Glow (green — live for-sale listings) ---
    if (showMarketplace && !hasQuery && marketplace.length > 0 && mode === 'density' && glowFade > 0) {
      result.push(new ScatterplotLayer({
        id: 'marketplace-glow',
        data: marketplace,
        getPosition: (d: MarketplacePin) => [d.lng, d.lat],
        getRadius: 500,
        radiusUnits: 'meters' as const,
        getFillColor: [74, 222, 128, Math.round(glowAlpha * 0.8)] as [number, number, number, number],
        radiusMinPixels: 0,
        radiusMaxPixels: 20,
        opacity: glowFade * 0.8,
        pickable: false,
      }));
    }

    // --- Marketplace Points (green — FB listings) ---
    if (showMarketplace && !hasQuery && marketplace.length > 0 && pointsOpacity > 0) {
      result.push(new ScatterplotLayer({
        id: 'marketplace-points',
        data: marketplace,
        getPosition: (d: MarketplacePin) => [d.lng, d.lat],
        getRadius: ptBase,
        radiusUnits: 'meters' as const,
        radiusMinPixels: 0,
        radiusMaxPixels: pointSize * 1.5,
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
        transitions: {
          getFillColor: { duration: 200 },
          getRadius: { duration: 200 },
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
          return age * 2000;
        },
        getFillColor: (d: LiveEvent) => {
          const age = (now - d.ts) / 2500;
          return [74, 222, 128, Math.round(180 * (1 - age))] as [number, number, number, number];
        },
        radiusMinPixels: 2,
        radiusMaxPixels: 40,
        pickable: false,
        updateTriggers: { getRadius: [tick], getFillColor: [tick] },
      }));
      result.push(new ScatterplotLayer({
        id: 'live-dots',
        data: liveEvents,
        getPosition: (d: LiveEvent) => [d.lng, d.lat],
        getRadius: 100,
        getFillColor: [74, 222, 128, 255] as [number, number, number, number],
        radiusMinPixels: 2,
        radiusMaxPixels: 4,
        pickable: false,
      }));
    }

    return result;
  }, [filteredVehicles, collections, businesses, photos, marketplace, queryResults, showVehicles, showCollections, showBusinesses,
      showPhotos, showMarketplace, showCountyOverlay, hasQuery, zoom, mode, glowRadius, glowIntensity, pointSize, colorPreset, tick, countyFeatures, clusterIndex, viewportBounds, zctaGeoJson, selectedZip, selectedCounties,
      handleLayerClick, setHoverInfo, setSelectedPin, setSelectedCounties, setSelectedZip, setViewState, deckClickedRef, liveEventsRef]);
}
