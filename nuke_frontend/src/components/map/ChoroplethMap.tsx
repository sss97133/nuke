import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import type { CountyDatum, MakeHeatmapData } from './types';
import { MAP_FONT } from './constants';
import type { CountyLayerData } from './layers/countyLayer';
import type { StateLayerData } from './hooks/useStateData';
import { fetchMakeHeatmap } from './mapService';
import {
  COUNTY_NAMES, STATE_FIPS, COLORWAY_IDS,
  type Colorway, type ColorwayId, type DrillLevel,
  countyColor, zoomToLevel,
} from './shared';
import MapTimeline from './controls/MapTimeline';
import type { HistogramBucket } from './types';

// ─── Draggable panel ───────────────────────────────────────────────────────────
function DraggablePanel({ children, basemap }: { children: ReactNode; basemap: 'dark' | 'light' }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 12, y: -60 });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect || e.clientY - rect.top > 12) return;
    dragging.current = true;
    offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !panelRef.current) return;
      const parent = panelRef.current.parentElement;
      if (!parent) return;
      const pr = parent.getBoundingClientRect();
      setPos({
        x: e.clientX - pr.left - offset.current.x,
        y: -(pr.bottom - e.clientY - (panelRef.current.offsetHeight - offset.current.y)),
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div ref={panelRef} onMouseDown={onMouseDown} style={{
      position: 'absolute', bottom: Math.max(8, -pos.y), left: pos.x, zIndex: 1000,
      background: basemap === 'dark' ? 'rgba(0,0,0,0.88)' : 'rgba(255,255,255,0.94)',
      border: `1px solid ${basemap === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'}`,
      padding: '10px 10px 6px', fontFamily: MAP_FONT, width: 220,
      cursor: 'default', userSelect: 'none',
    }}>
      <div style={{
        position: 'absolute', top: 3, left: '50%', transform: 'translateX(-50%)',
        width: 28, height: 3,
        background: basemap === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
        cursor: 'grab',
      }} />
      {children}
    </div>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────
interface TimelineData {
  buckets: HistogramBucket[];
  timeStart?: string;
  timeEnd?: string;
  loading: boolean;
  scrubTo: (month: string | undefined) => void;
  clearTimeline: () => void;
}

interface ChoroplethMapProps {
  countyLayerData: CountyLayerData | null;
  stateLayerData: StateLayerData | null;
  stats: { totalCount: number; totalValue: number; countyCount?: number };
  colorway: Colorway;
  colorwayId: ColorwayId;
  onColorwayChange: (id: ColorwayId) => void;
  timeline?: TimelineData;
}

export default function ChoroplethMap({ countyLayerData, stateLayerData, stats, colorway, colorwayId, onColorwayChange, timeline }: ChoroplethMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<any>(null);
  const geoLayerRef = useRef<any>(null);
  const pointsLayerRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);

  const [tooltip, setTooltip] = useState<{
    x: number; y: number; name: string; state: string; fips: string; datum: CountyDatum | null;
  } | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<{
    name: string; state: string; fips: string; datum: CountyDatum | null; level: DrillLevel;
  } | null>(null);
  const [regionVehicles, setRegionVehicles] = useState<any[] | null>(null);
  const [regionLoading, setRegionLoading] = useState(false);
  const [drillLevel, setDrillLevel] = useState<DrillLevel>('state');
  const drillLevelRef = useRef(drillLevel);
  drillLevelRef.current = drillLevel;

  // ─── Proximity search state ──────────────────────────────────────────────────
  const [proximityPin, setProximityPin] = useState<{ lat: number; lng: number } | null>(null);
  const [proximityRadius, setProximityRadius] = useState<number>(50); // miles
  const [proximityResults, setProximityResults] = useState<any[] | null>(null);
  const [proximityLoading, setProximityLoading] = useState(false);
  const [showRadiusSelector, setShowRadiusSelector] = useState(false);
  const proximityMarkerRef = useRef<any>(null);
  const proximityCircleRef = useRef<any>(null);
  const proximityPointsRef = useRef<any>(null);
  const radiusSelectorPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // ─── Make heatmap filter ────────────────────────────────────────────────────
  const [makeInput, setMakeInput] = useState('');
  const [makeFilter, setMakeFilter] = useState<MakeHeatmapData | null>(null);
  const [makeLoading, setMakeLoading] = useState(false);
  const [makeError, setMakeError] = useState<string | null>(null);
  // When make filter is active, build an override lookup for county data
  const makeLookupRef = useRef<Map<string, CountyDatum> | null>(null);

  const applyMakeFilter = useCallback(async (make: string) => {
    const trimmed = make.trim();
    if (!trimmed) { clearMakeFilter(); return; }
    setMakeLoading(true);
    setMakeError(null);
    try {
      const data = await fetchMakeHeatmap(trimmed);
      if (data.total_vehicles === 0) {
        setMakeError(`No vehicles found for "${trimmed}"`);
        setMakeLoading(false);
        return;
      }
      // Build a county lookup from the make heatmap data
      const lookup = new Map<string, CountyDatum>();
      for (const c of data.counties) {
        lookup.set(c.fips, { fips: c.fips, count: c.count, value: 0, avg: 0 });
      }
      makeLookupRef.current = lookup;
      setMakeFilter(data);
    } catch (e) {
      setMakeError(e instanceof Error ? e.message : String(e));
    } finally { setMakeLoading(false); }
  }, []);

  const clearMakeFilter = useCallback(() => {
    setMakeFilter(null);
    setMakeInput('');
    setMakeError(null);
    makeLookupRef.current = null;
  }, []);

  // ─── Proximity search ──────────────────────────────────────────────────────
  const MILES_TO_DEG = 1 / 69.0; // rough conversion: 1 degree ≈ 69 miles

  const clearProximitySearch = useCallback(() => {
    const map = leafletRef.current;
    if (proximityMarkerRef.current && map) map.removeLayer(proximityMarkerRef.current);
    if (proximityCircleRef.current && map) map.removeLayer(proximityCircleRef.current);
    if (proximityPointsRef.current && map) map.removeLayer(proximityPointsRef.current);
    proximityMarkerRef.current = null;
    proximityCircleRef.current = null;
    proximityPointsRef.current = null;
    setProximityPin(null);
    setProximityResults(null);
    setShowRadiusSelector(false);
  }, []);

  const runProximitySearch = useCallback(async (lat: number, lng: number, radiusMiles: number) => {
    setProximityLoading(true);
    setProximityResults(null);
    const radiusDeg = radiusMiles * MILES_TO_DEG;

    try {
      // Query VLO for nearby vehicles
      const { data: observations, error: obsErr } = await supabase
        .from('vehicle_location_observations')
        .select('vehicle_id, latitude, longitude, confidence, location_text_raw, source_platform')
        .not('latitude', 'is', null)
        .gte('latitude', lat - radiusDeg)
        .lte('latitude', lat + radiusDeg)
        .gte('longitude', lng - radiusDeg)
        .lte('longitude', lng + radiusDeg)
        .gte('confidence', 0.50)
        .order('confidence', { ascending: false })
        .limit(500);

      if (obsErr || !observations) { setProximityLoading(false); return; }

      // Deduplicate by vehicle_id, keeping highest confidence
      const seen = new Map<string, typeof observations[0]>();
      for (const obs of observations) {
        if (!seen.has(obs.vehicle_id)) seen.set(obs.vehicle_id, obs);
      }
      const uniqueObs = [...seen.values()];

      // Filter by actual haversine distance
      const toRad = (d: number) => d * Math.PI / 180;
      const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
        const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); // miles
      };

      const withinRadius = uniqueObs
        .map(obs => ({ ...obs, distance: haversine(lat, lng, obs.latitude, obs.longitude) }))
        .filter(obs => obs.distance <= radiusMiles)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 200);

      // Fetch vehicle details
      const vehicleIds = withinRadius.map(o => o.vehicle_id);
      if (vehicleIds.length === 0) {
        setProximityResults([]);
        setProximityLoading(false);
        drawProximityResults([], lat, lng, radiusMiles);
        return;
      }

      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, sale_price, sold_price, primary_image_url, status')
        .in('id', vehicleIds.slice(0, 200));

      const vehicleMap = new Map((vehicles || []).map(v => [v.id, v]));
      const results = withinRadius
        .map(obs => {
          const v = vehicleMap.get(obs.vehicle_id);
          if (!v) return null;
          return { ...v, distance: obs.distance, latitude: obs.latitude, longitude: obs.longitude, confidence: obs.confidence };
        })
        .filter(Boolean);

      setProximityResults(results);
      drawProximityResults(results as any[], lat, lng, radiusMiles);
    } catch (e) {
      console.error('Proximity search failed:', e);
      setProximityResults([]);
    } finally {
      setProximityLoading(false);
    }
  }, []);

  const drawProximityResults = useCallback(async (results: any[], lat: number, lng: number, radiusMiles: number) => {
    const map = leafletRef.current;
    if (!map) return;
    const L = await import('leaflet');

    // Remove old proximity layers
    if (proximityCircleRef.current) map.removeLayer(proximityCircleRef.current);
    if (proximityPointsRef.current) map.removeLayer(proximityPointsRef.current);

    // Draw radius circle
    const radiusMeters = radiusMiles * 1609.34;
    const circle = L.circle([lat, lng], {
      radius: radiusMeters, fill: true,
      fillColor: 'rgba(6, 182, 212, 0.08)', fillOpacity: 1,
      color: 'rgba(6, 182, 212, 0.5)', weight: 1.5,
      dashArray: '6 4',
    }).addTo(map);
    proximityCircleRef.current = circle;

    // Draw cyan pins for results
    const markers = L.layerGroup();
    for (const r of results) {
      const label = `${r.year || '?'} ${(r.make || '').toUpperCase()} ${(r.model || '').toUpperCase()}`;
      const price = r.sale_price || r.sold_price;
      const marker = L.circleMarker([r.latitude, r.longitude], {
        radius: 5, fillColor: 'rgba(6, 182, 212, 0.9)', fillOpacity: 1,
        weight: 1, color: 'rgba(6, 182, 212, 0.4)',
      });
      marker.bindPopup(`
        <div style="font-family:Arial;font-size:11px;min-width:160px">
          ${r.primary_image_url ? `<img src="${r.primary_image_url}" style="width:100%;height:80px;object-fit:cover;margin-bottom:4px" />` : ''}
          <div style="font-weight:700">${label}</div>
          <div style="color:#888;font-size:10px">${price ? '$' + price.toLocaleString() : 'NO PRICE'}</div>
          <div style="color:#06b6d4;font-size:9px;margin-top:2px">${r.distance.toFixed(1)} mi away</div>
          <a href="/vehicle/${r.id}" target="_blank" style="color:#06b6d4;font-size:9px;text-decoration:none">VIEW PROFILE &rarr;</a>
        </div>
      `, { maxWidth: 220 });
      marker.bindTooltip(`<div style="font-family:Arial;font-size:10px;font-weight:700">${label}</div><div style="font-family:Arial;font-size:9px;color:#06b6d4">${r.distance.toFixed(1)} mi</div>`, { direction: 'top', offset: [0, -6] });
      markers.addLayer(marker);
    }
    markers.addTo(map);
    proximityPointsRef.current = markers;
  }, []);

  // ─── Load vehicle points for viewport ──────────────────────────────────────
  const loadPointsForBounds = useCallback(async (map: any) => {
    const L = await import('leaflet');
    const bounds = map.getBounds();

    try {
      const { data, error } = await supabase
        .from('vehicle_location_observations')
        .select('id, vehicle_id, latitude, longitude, location_text_raw, source_platform, confidence')
        .not('latitude', 'is', null)
        .gte('latitude', bounds.getSouth())
        .lte('latitude', bounds.getNorth())
        .gte('longitude', bounds.getWest())
        .lte('longitude', bounds.getEast())
        .order('confidence', { ascending: false })
        .limit(500);

      if (error || !data) return;

      const vehicleIds = [...new Set(data.map(d => d.vehicle_id))];
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, sale_price, sold_price, primary_image_url')
        .in('id', vehicleIds.slice(0, 200));

      const vehicleMap = new Map((vehicles || []).map(v => [v.id, v]));

      if (pointsLayerRef.current) map.removeLayer(pointsLayerRef.current);

      const markers = L.layerGroup();
      for (const obs of data) {
        const conf = obs.confidence ?? 0;
        // Low-confidence observations contribute only to choropleth aggregates
        if (conf < 0.50) continue;

        const v = vehicleMap.get(obs.vehicle_id);
        if (!v) continue;
        const price = v.sale_price || v.sold_price;
        const label = `${v.year || '?'} ${(v.make || '').toUpperCase()} ${(v.model || '').toUpperCase()}`;

        // Confidence-aware pin styling
        const pinStyle = conf >= 0.90
          ? { radius: 6, fillOpacity: 1,   weight: 1,   color: 'rgba(0,0,0,0.5)' }
          : conf >= 0.70
          ? { radius: 5, fillOpacity: 0.8, weight: 0.5, color: 'rgba(0,0,0,0.35)' }
          : { radius: 3, fillOpacity: 0.5, weight: 0,   color: 'transparent' };

        const marker = L.circleMarker([obs.latitude, obs.longitude], {
          ...pinStyle, fillColor: 'rgba(245, 158, 11, 0.9)',
        });

        marker.bindPopup(`
          <div style="font-family:Arial;font-size:11px;min-width:160px">
            ${v.primary_image_url ? `<img src="${v.primary_image_url}" style="width:100%;height:80px;object-fit:cover;margin-bottom:4px" />` : ''}
            <div style="font-weight:700">${label}</div>
            <div style="color:#888;font-size:10px">${price ? '$' + price.toLocaleString() : 'NO PRICE'}</div>
            <div style="color:#888;font-size:9px;margin-top:2px">${obs.location_text_raw || ''} &middot; ${obs.source_platform || ''}</div>
            <a href="/vehicle/${v.id}" target="_blank" style="color:#f59e0b;font-size:9px;text-decoration:none">VIEW PROFILE &rarr;</a>
          </div>
        `, { maxWidth: 220 });

        const confLabel = conf >= 0.90 ? 'GPS/VERIFIED' : conf >= 0.70 ? 'CITY' : 'COUNTY';
        const tooltipHtml = `<div style="font-family:Arial;font-size:10px;font-weight:700">${label}</div>`
          + `<div style="font-family:Arial;font-size:9px;color:#888">Source: ${obs.source_platform || '?'} · Confidence: ${conf.toFixed(2)} (${confLabel}) · ${obs.location_text_raw || ''}</div>`;
        marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -6] });
        markers.addLayer(marker);
      }

      markers.addTo(map);
      pointsLayerRef.current = markers;
    } catch (e) {
      console.error('Failed to load points:', e);
    }
  }, []);

  // ─── Init Leaflet map ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return;

    import('leaflet').then((L) => {
      import('leaflet/dist/leaflet.css');

      const map = L.map(mapRef.current!, {
        center: [39, -98], zoom: 4,
        zoomControl: false, attributionControl: false,
        zoomSnap: 0, wheelDebounceTime: 40,
      });

      const tile = L.tileLayer(colorway.tileUrl, { maxZoom: 19 }).addTo(map);
      tileLayerRef.current = tile;
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      const overlayPane = map.getPane('overlayPane');
      if (overlayPane) overlayPane.style.mixBlendMode = colorway.blendMode;

      map.on('zoomend', () => {
        const newLevel = zoomToLevel(map.getZoom());
        if (newLevel !== drillLevelRef.current) setDrillLevel(newLevel);
        if (newLevel === 'points') loadPointsForBounds(map);
      });
      map.on('moveend', () => {
        if (zoomToLevel(map.getZoom()) === 'points') loadPointsForBounds(map);
      });

      // Right-click → proximity search
      map.on('contextmenu', async (e: any) => {
        const { lat, lng } = e.latlng;
        const containerPt = e.containerPoint;

        // Clear any previous proximity search
        if (proximityMarkerRef.current) map.removeLayer(proximityMarkerRef.current);
        if (proximityCircleRef.current) map.removeLayer(proximityCircleRef.current);
        if (proximityPointsRef.current) map.removeLayer(proximityPointsRef.current);
        proximityMarkerRef.current = null;
        proximityCircleRef.current = null;
        proximityPointsRef.current = null;

        // Drop pin
        const pin = L.marker([lat, lng], {
          icon: L.divIcon({
            className: '',
            html: `<div style="width:12px;height:12px;background:rgba(6,182,212,1);border:2px solid #fff;transform:translate(-6px,-6px)"></div>`,
            iconSize: [0, 0],
          }),
        }).addTo(map);
        proximityMarkerRef.current = pin;

        // Store position for the radius selector popup
        radiusSelectorPos.current = { x: containerPt.x, y: containerPt.y };
        setProximityPin({ lat, lng });
        setShowRadiusSelector(true);
      });

      // Left-click clears proximity search
      map.on('click', () => {
        if (proximityMarkerRef.current) {
          clearProximitySearch();
        }
      });

      leafletRef.current = map;
    });

    return () => { leafletRef.current?.remove(); leafletRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Update blend mode ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    const p = map.getPane('overlayPane');
    if (p) p.style.mixBlendMode = colorway.blendMode;
  }, [colorway.blendMode]);

  // ─── Swap tile layer smoothly ──────────────────────────────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    import('leaflet').then((L) => {
      const newTile = L.tileLayer(colorway.tileUrl, { maxZoom: 19, opacity: 0 }).addTo(map);
      let opacity = 0;
      const fadeIn = setInterval(() => {
        opacity = Math.min(1, opacity + 0.15);
        newTile.setOpacity(opacity);
        if (opacity >= 1) {
          clearInterval(fadeIn);
          if (tileLayerRef.current && tileLayerRef.current !== newTile) map.removeLayer(tileLayerRef.current);
          tileLayerRef.current = newTile;
        }
      }, 30);
    });
  }, [colorway.tileUrl]);

  // ─── Render GeoJSON layer based on drill level ─────────────────────────────
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    import('leaflet').then((L) => {
      if (geoLayerRef.current) { map.removeLayer(geoLayerRef.current); geoLayerRef.current = null; }

      if (drillLevel === 'state' && stateLayerData) {
        const { geojson, lookup, nameLookup } = stateLayerData;
        const geoLayer = L.geoJSON(geojson as any, {
          style: (feature: any) => {
            const fips = String(feature?.id || '');
            const abbr = STATE_FIPS[fips] ?? '';
            const count = lookup.get(abbr)?.count ?? 0;
            return { fillColor: countyColor(count * 0.05, colorway), fillOpacity: 1, weight: 1, color: colorway.border };
          },
          onEachFeature: (feature: any, layer: any) => {
            const fips = String(feature?.id || '');
            const abbr = STATE_FIPS[fips] ?? '';
            const name = nameLookup.get(fips) || abbr;
            const datum = lookup.get(abbr) ?? null;
            layer.on('mouseover', (e: any) => {
              setTooltip({ x: e.containerPoint.x, y: e.containerPoint.y, name, state: abbr, fips,
                datum: datum ? { fips, count: datum.count, value: datum.value, avg: datum.avg } : null });
              layer.setStyle({ weight: 2, color: colorway.hoverBorder }); layer.bringToFront();
            });
            layer.on('mousemove', (e: any) => setTooltip(prev => prev ? { ...prev, x: e.containerPoint.x, y: e.containerPoint.y } : null));
            layer.on('mouseout', () => { setTooltip(null); geoLayer.resetStyle(layer); });
            layer.on('click', () => map.fitBounds(layer.getBounds(), { padding: [20, 20] }));
          },
        }).addTo(map);
        geoLayerRef.current = geoLayer;

      } else if ((drillLevel === 'county' || drillLevel === 'points') && countyLayerData) {
        const { geojson, lookup } = countyLayerData;
        const activeLookup = makeLookupRef.current || lookup;
        const geoLayer = L.geoJSON(geojson as any, {
          style: (feature: any) => {
            const fips = feature?.id || feature?.properties?.GEOID || '';
            const count = activeLookup.get(String(fips))?.count ?? 0;
            return { fillColor: countyColor(count, colorway), fillOpacity: 1, weight: 0.5, color: colorway.border };
          },
          onEachFeature: (feature: any, layer: any) => {
            const fips = String(feature?.id || feature?.properties?.GEOID || '');
            const datum = activeLookup.get(fips) ?? null;
            const name = COUNTY_NAMES[fips] || feature?.properties?.name || fips;
            const state = STATE_FIPS[fips.slice(0, 2)] ?? '';
            layer.on('mouseover', (e: any) => {
              setTooltip({ x: e.containerPoint.x, y: e.containerPoint.y, name, state, fips, datum });
              layer.setStyle({ weight: 2, color: colorway.hoverBorder }); layer.bringToFront();
            });
            layer.on('mousemove', (e: any) => setTooltip(prev => prev ? { ...prev, x: e.containerPoint.x, y: e.containerPoint.y } : null));
            layer.on('mouseout', () => { setTooltip(null); geoLayer.resetStyle(layer); });
            layer.on('click', () => { setSelectedRegion({ name, state, fips, datum, level: 'county' }); loadRegionVehicles(fips); });
          },
        }).addTo(map);
        geoLayerRef.current = geoLayer;
      }
    });
  }, [drillLevel, countyLayerData, stateLayerData, makeFilter]);

  // ─── Update styles in-place on colorway change ─────────────────────────────
  useEffect(() => {
    const layer = geoLayerRef.current;
    if (!layer) return;
    layer.eachLayer((l: any) => {
      const feature = l.feature;
      if (!feature) return;
      if (drillLevel === 'state' && stateLayerData) {
        const abbr = STATE_FIPS[String(feature?.id || '')] ?? '';
        const count = stateLayerData.lookup.get(abbr)?.count ?? 0;
        l.setStyle({ fillColor: countyColor(count * 0.05, colorway), weight: 1, color: colorway.border, fillOpacity: 1 });
      } else if (countyLayerData) {
        const activeLookup = makeLookupRef.current || countyLayerData.lookup;
        const fips = feature?.id || feature?.properties?.GEOID || '';
        const count = activeLookup.get(String(fips))?.count ?? 0;
        l.setStyle({ fillColor: countyColor(count, colorway), weight: 0.5, color: colorway.border, fillOpacity: 1 });
      }
    });
  }, [colorway, drillLevel, countyLayerData, stateLayerData, makeFilter]);

  // ─── Load county detail via single RPC ──────────────────────────────────────
  const [countyDetail, setCountyDetail] = useState<any>(null);

  const loadRegionVehicles = useCallback(async (fips: string) => {
    setRegionLoading(true);
    setRegionVehicles(null);
    setCountyDetail(null);
    try {
      const { data, error } = await supabase.rpc('get_county_detail', { p_fips: fips });
      if (error) throw error;
      if (data) {
        setCountyDetail(data);
        let vehicles = data.vehicles || [];
        // When make filter is active, filter sidebar vehicles to that make
        if (makeFilter) {
          const filterMake = makeFilter.make.toLowerCase();
          vehicles = vehicles.filter((v: any) => (v.make || '').toLowerCase() === filterMake);
        }
        setRegionVehicles(vehicles);
      } else {
        setRegionVehicles([]);
      }
    } catch (e) {
      console.error('Failed to load county detail:', e);
      setRegionVehicles([]);
    } finally { setRegionLoading(false); }
  }, [makeFilter]);

  // ─── Escape key clears proximity search ──────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && proximityPin) clearProximitySearch();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [proximityPin, clearProximitySearch]);

  // ─── Render ────────────────────────────────────────────────────────────────
  const isDark = colorway.basemap === 'dark';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Info panel */}
      <DraggablePanel basemap={colorway.basemap}>
        {/* Make filter input */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3,
            color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }}>FILTER BY MAKE</div>
          <div style={{ display: 'flex', gap: 3 }}>
            <input
              type="text"
              value={makeInput}
              onChange={(e) => setMakeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyMakeFilter(makeInput); }}
              placeholder="Porsche, Ford, BMW..."
              style={{
                flex: 1, fontSize: 9, padding: '3px 5px', fontFamily: MAP_FONT,
                background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
                color: isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)',
                outline: 'none',
              }}
            />
            {makeFilter && (
              <button onClick={clearMakeFilter} style={{
                background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)',
                color: 'rgba(245, 158, 11, 0.8)', fontSize: 8, cursor: 'pointer', padding: '2px 5px',
                fontFamily: MAP_FONT, fontWeight: 700,
              }}>X</button>
            )}
          </div>
          {makeLoading && (
            <div style={{ fontSize: 7, color: 'rgba(245, 158, 11, 0.6)', marginTop: 2 }}>LOADING...</div>
          )}
          {makeError && (
            <div style={{ fontSize: 7, color: 'rgba(200, 50, 50, 0.8)', marginTop: 2 }}>{makeError}</div>
          )}
          {makeFilter && (
            <div style={{ fontSize: 8, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 700, textTransform: 'uppercase', color: 'rgba(245, 158, 11, 1)' }}>
                {makeFilter.make.toUpperCase()}
              </span>
              <span style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }}>
                {makeFilter.total_vehicles.toLocaleString()} vehicles
              </span>
              <span style={{ color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)' }}>
                {makeFilter.county_count.toLocaleString()} counties
              </span>
            </div>
          )}
        </div>

        <input type="range" min={0} max={COLORWAY_IDS.length - 1}
          value={COLORWAY_IDS.indexOf(colorwayId)}
          onChange={(e) => onColorwayChange(COLORWAY_IDS[parseInt(e.target.value)])}
          style={{ width: '100%', height: 4, cursor: 'pointer', accentColor: 'rgba(245,158,11,1)', margin: '0 0 4px' }}
        />
        <div style={{ fontSize: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', padding: '1px 4px',
            background: 'rgba(245, 158, 11, 0.15)', color: 'rgba(245, 158, 11, 0.8)',
            border: '1px solid rgba(245, 158, 11, 0.3)' }}>{drillLevel}</span>
          <span style={{ fontSize: 7, textTransform: 'uppercase',
            color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)' }}>{colorway.label}</span>
          <span style={{ flex: 1, textAlign: 'right', color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }}>
            {makeFilter
              ? `${makeFilter.total_vehicles.toLocaleString()} ${makeFilter.make.toUpperCase()}`
              : <>{stats.totalCount.toLocaleString()} &middot; ${(stats.totalValue / 1e9).toFixed(1)}B</>
            }
          </span>
        </div>
        {/* Active time window label */}
        {timeline?.timeEnd && (
          <div style={{
            fontSize: 8, marginTop: 4, padding: '2px 4px',
            background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)',
            color: 'rgba(245, 158, 11, 0.9)', textTransform: 'uppercase', textAlign: 'center',
            fontFamily: 'Courier New, monospace', letterSpacing: '0.5px',
          }}>
            SHOWING: {timeline.timeStart
              ? `${new Date(timeline.timeStart).toLocaleDateString('en', { month: 'short', year: 'numeric' })} \u2013 ${new Date(timeline.timeEnd).toLocaleDateString('en', { month: 'short', year: 'numeric' })}`
              : `UP TO ${new Date(timeline.timeEnd).toLocaleDateString('en', { month: 'short', year: 'numeric' })}`
            }
          </div>
        )}
      </DraggablePanel>

      {/* Tooltip */}
      {tooltip && (
        <div style={{ position: 'absolute', left: tooltip.x + 14, top: tooltip.y - 10, zIndex: 1100,
          background: 'rgba(0,0,0,0.92)', border: '1px solid rgba(245, 158, 11, 0.4)',
          padding: '6px 10px', fontFamily: MAP_FONT, pointerEvents: 'none', maxWidth: 220 }}>
          <div style={{ fontSize: 10, color: 'rgba(245, 158, 11, 1)', fontWeight: 700 }}>
            {tooltip.name}{tooltip.state ? `, ${tooltip.state}` : ''}
          </div>
          {makeFilter && (
            <div style={{ fontSize: 8, color: 'rgba(245, 158, 11, 0.6)', textTransform: 'uppercase' }}>
              {makeFilter.make.toUpperCase()} ONLY
            </div>
          )}
          {tooltip.datum ? (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>
              {tooltip.datum.count.toLocaleString()} {makeFilter ? makeFilter.make.toLowerCase() : 'vehicles'}
              {!makeFilter && <> &middot; ${(tooltip.datum.value / 1e6).toFixed(1)}M</>}
            </div>
          ) : (
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>NO DATA</div>
          )}
        </div>
      )}

      {/* Proximity radius selector popup */}
      {showRadiusSelector && proximityPin && (
        <div style={{
          position: 'absolute', left: radiusSelectorPos.current.x + 16, top: radiusSelectorPos.current.y - 20,
          zIndex: 1300, background: 'rgba(0,0,0,0.92)', border: '1px solid rgba(6, 182, 212, 0.5)',
          padding: '8px 10px', fontFamily: MAP_FONT, minWidth: 150,
        }}>
          <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', color: 'rgba(6, 182, 212, 0.7)', marginBottom: 6 }}>
            RADIUS SEARCH
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
            {proximityPin.lat.toFixed(4)}, {proximityPin.lng.toFixed(4)}
          </div>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
            {[25, 50, 100, 200].map(r => (
              <button key={r} onClick={() => {
                setProximityRadius(r);
                setShowRadiusSelector(false);
                runProximitySearch(proximityPin.lat, proximityPin.lng, r);
              }} style={{
                background: r === proximityRadius ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${r === proximityRadius ? 'rgba(6, 182, 212, 0.6)' : 'rgba(255,255,255,0.12)'}`,
                color: r === proximityRadius ? 'rgba(6, 182, 212, 1)' : 'rgba(255,255,255,0.6)',
                fontSize: 9, fontWeight: 700, fontFamily: MAP_FONT, cursor: 'pointer', padding: '3px 8px',
              }}>{r} MI</button>
            ))}
          </div>
          <button onClick={() => setShowRadiusSelector(false)} style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.4)', fontSize: 8, cursor: 'pointer', padding: '2px 6px',
            fontFamily: MAP_FONT, width: '100%',
          }}>CANCEL</button>
        </div>
      )}

      {/* Proximity results sidebar */}
      {proximityPin && proximityResults !== null && !showRadiusSelector && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 320,
          background: '#111', borderLeft: '2px solid rgba(6, 182, 212, 0.2)',
          overflowY: 'auto', zIndex: 1200, fontFamily: MAP_FONT,
        }}>
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid rgba(6, 182, 212, 0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 13, color: 'rgba(6, 182, 212, 1)', fontWeight: 700 }}>
                  PROXIMITY SEARCH
                </div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', marginTop: 2, textTransform: 'uppercase' }}>
                  {proximityPin.lat.toFixed(4)}, {proximityPin.lng.toFixed(4)} &middot; {proximityRadius} MI RADIUS
                </div>
              </div>
              <button onClick={clearProximitySearch} style={{
                background: 'transparent', border: '1px solid rgba(6, 182, 212, 0.3)',
                color: 'rgba(6, 182, 212, 0.7)', fontSize: 9, cursor: 'pointer', padding: '2px 6px', fontFamily: MAP_FONT,
              }}>X</button>
            </div>
            {/* Radius re-select */}
            <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
              {[25, 50, 100, 200].map(r => (
                <button key={r} onClick={() => {
                  setProximityRadius(r);
                  runProximitySearch(proximityPin.lat, proximityPin.lng, r);
                }} style={{
                  background: r === proximityRadius ? 'rgba(6, 182, 212, 0.2)' : 'transparent',
                  border: `1px solid ${r === proximityRadius ? 'rgba(6, 182, 212, 0.5)' : 'rgba(255,255,255,0.1)'}`,
                  color: r === proximityRadius ? 'rgba(6, 182, 212, 1)' : 'rgba(255,255,255,0.4)',
                  fontSize: 8, fontWeight: 700, fontFamily: MAP_FONT, cursor: 'pointer', padding: '2px 6px',
                }}>{r} MI</button>
              ))}
            </div>
            <div style={{ fontSize: 16, color: '#fff', fontWeight: 700, marginTop: 8 }}>
              {proximityLoading ? '...' : proximityResults.length}
              <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)', marginLeft: 6, textTransform: 'uppercase', fontWeight: 400 }}>
                VEHICLES FOUND
              </span>
            </div>
          </div>

          <div style={{ padding: '8px 0' }}>
            {proximityLoading && (
              <div style={{ padding: 12, fontSize: 9, color: 'rgba(6, 182, 212, 0.6)', textAlign: 'center' }}>
                SEARCHING...
              </div>
            )}
            {proximityResults.map((v: any) => (
              <div key={v.id} onClick={() => window.open(`/vehicle/${v.id}`, '_blank')} style={{
                padding: '6px 12px', display: 'flex', gap: 8, alignItems: 'center',
                borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer',
              }}>
                {v.primary_image_url && <img src={v.primary_image_url} alt="" style={{ width: 48, height: 32, objectFit: 'cover', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.year} {v.make?.toUpperCase()} {v.model?.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>
                    {v.sale_price || v.sold_price ? `$${(v.sale_price || v.sold_price).toLocaleString()}` : 'NO PRICE'}
                    {v.status ? ` \u00B7 ${v.status}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 8, color: 'rgba(6, 182, 212, 0.8)', fontFamily: 'Courier New, monospace', flexShrink: 0 }}>
                  {v.distance.toFixed(1)} MI
                </div>
              </div>
            ))}
            {proximityResults.length === 0 && !proximityLoading && (
              <div style={{ padding: 12, fontSize: 9, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
                No vehicles found within {proximityRadius} miles
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timeline scrubber */}
      {timeline && (
        <MapTimeline
          buckets={timeline.buckets}
          timeEnd={timeline.timeEnd}
          onScrub={timeline.scrubTo}
          loading={timeline.loading}
        />
      )}

      {/* County detail sidebar */}
      {selectedRegion && (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 320,
          background: '#111', borderLeft: '2px solid rgba(255,255,255,0.1)',
          overflowY: 'auto', zIndex: 1200, fontFamily: MAP_FONT }}>
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 13, color: 'rgba(245, 158, 11, 1)', fontWeight: 700 }}>
                  {selectedRegion.name}{selectedRegion.state ? `, ${selectedRegion.state}` : ''}
                </div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', marginTop: 2, textTransform: 'uppercase' }}>
                  FIPS {selectedRegion.fips}
                  {makeFilter && (
                    <span style={{ marginLeft: 6, color: 'rgba(245, 158, 11, 0.7)' }}>
                      {makeFilter.make.toUpperCase()} ONLY
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => { setSelectedRegion(null); setRegionVehicles(null); }} style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.5)', fontSize: 9, cursor: 'pointer', padding: '2px 6px', fontFamily: MAP_FONT,
              }}>X</button>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <div>
                <div style={{ fontSize: 16, color: '#fff', fontWeight: 700 }}>
                  {(countyDetail?.vehicle_count ?? selectedRegion.datum?.count ?? 0).toLocaleString()}
                </div>
                <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>VEHICLES</div>
              </div>
              <div>
                <div style={{ fontSize: 16, color: '#fff', fontWeight: 700 }}>
                  ${((countyDetail?.total_value ?? selectedRegion.datum?.value ?? 0) / 1e6).toFixed(1)}M
                </div>
                <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>TOTAL</div>
              </div>
            </div>
          </div>

          {/* Makes + platforms from RPC */}
          {countyDetail?.makes && countyDetail.makes.length > 0 && (
            <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 4 }}>TOP MAKES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {countyDetail.makes.map((m: any) => (
                  <span key={m.make} style={{ fontSize: 7, padding: '1px 4px',
                    background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)',
                    color: 'rgba(245, 158, 11, 0.7)' }}>{m.make.toUpperCase()} ({m.count})</span>
                ))}
              </div>
            </div>
          )}
          {countyDetail?.platforms && countyDetail.platforms.length > 0 && (
            <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 4 }}>SOURCES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {countyDetail.platforms.map((p: any) => (
                  <span key={p.platform} style={{ fontSize: 7, padding: '1px 4px',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.5)' }}>{p.platform} ({p.count})</span>
                ))}
              </div>
            </div>
          )}

          <div style={{ padding: '8px 0' }}>
            <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', padding: '0 12px', marginBottom: 6 }}>
              {regionLoading ? 'LOADING VEHICLES...' : `VEHICLES (${regionVehicles?.length ?? 0})`}
            </div>
            {regionVehicles?.map((v: any) => (
              <div key={v.id} onClick={() => window.open(`/vehicle/${v.id}`, '_blank')} style={{
                padding: '6px 12px', display: 'flex', gap: 8, alignItems: 'center',
                borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                {v.primary_image_url && <img src={v.primary_image_url} alt="" style={{ width: 48, height: 32, objectFit: 'cover', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.year} {v.make?.toUpperCase()} {v.model?.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>
                    {v.sale_price || v.sold_price ? `$${(v.sale_price || v.sold_price).toLocaleString()}` : 'NO PRICE'}
                    {v.status ? ` · ${v.status}` : ''}
                  </div>
                </div>
              </div>
            ))}
            {regionVehicles?.length === 0 && !regionLoading && (
              <div style={{ padding: '12px', fontSize: 9, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
                No vehicles found for this county
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
