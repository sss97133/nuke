import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { FlyToInterpolator, WebMercatorViewport } from '@deck.gl/core';
import { Map } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import Supercluster from 'supercluster';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import '../../styles/unified-design-system.css';
import MapVehicleDetail from './panels/MapVehicleDetail';
import MapOrgDetail from './panels/MapOrgDetail';
import ZipSidebarPanel from './panels/ZipSidebarPanel';
import * as topojson from 'topojson-client';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';
import {
  MAP_FONT, CARTO_DARK, CARTO_LIGHT, SATELLITE_MAP_STYLE,
  COLOR_PRESETS,
  pinFromRow, fmtPrice, fmtMiles, thumbUrl,
  RICH_FIELDS, INITIAL_VIEW,
  geo,
} from './mapUtils';
import type {
  ColorPreset, VPin, ColPin, BizPin, PhotoPin, MarketplacePin, LiveEvent,
} from './mapUtils';
import { useMapLayers } from './hooks/useMapLayers';

export default function UnifiedMap() {
  const { theme } = useTheme();
  const [showCollections, setShowCollections] = useState(true);
  const [showVehicles, setShowVehicles] = useState(true);
  const [showBusinesses, setShowBusinesses] = useState(true);
  const [showPhotos, setShowPhotos] = useState(true);
  const [showMarketplace, setShowMarketplace] = useState(true);

  const [collections, setCollections] = useState<ColPin[]>([]);
  const [vehicles, setVehicles] = useState<VPin[]>([]);
  const [businesses, setBiz] = useState<BizPin[]>([]);
  const [photos, setPhotos] = useState<PhotoPin[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplacePin[]>([]);
  const [vehLoading, setVehLoading] = useState(true);
  const [mktLoading, setMktLoading] = useState(true);
  const [photoLoading, setPhotoLoading] = useState(true);

  const [searchText, setSearchText] = useState('');
  const [queryResults, setQueryResults] = useState<VPin[]>([]);
  const [queryNoLoc, setQueryNoLoc] = useState<{ id: string; title: string; loc: string }[]>([]);
  const [queryTotal, setQueryTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');

  // deck.gl viewState
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const zoom = viewState.zoom;

  // Side panel popup (replaces floating popup that overlapped data)
  const [selectedPin, setSelectedPin] = useState<{ pin: VPin | ColPin | BizPin | PhotoPin | MarketplacePin; type: 'vehicle' | 'collection' | 'business' | 'photo' | 'marketplace' } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; text: string } | null>(null);
  const [showCountyOverlay, setShowCountyOverlay] = useState(false);

  // Ref to prevent outer div from clearing selectedPin on deck.gl clicks
  const deckClickedRef = useRef(false);

  const handleLayerClick = useCallback((object: any, type: 'vehicle' | 'collection' | 'business' | 'photo' | 'marketplace') => {
    if (object) {
      deckClickedRef.current = true;
      setSelectedPin({ pin: object, type });
      setSidebarView({ type: 'pin', pin: object, pinType: type });
      setSidebarHistory([]);
      setTimeout(() => { deckClickedRef.current = false; }, 100);
    }
  }, []);

  // Slider controls — defaults tuned so data is visible immediately at zoom 4.5
  const [glowRadius, setGlowRadius] = useState(60);
  const [glowIntensity, setGlowIntensity] = useState(25);
  const [pointSize, setPointSize] = useState(4);
  const [mode, setMode] = useState<'density' | 'points' | 'thermal'>('density');
  const [controlsOpen, setControlsOpen] = useState(false);
  const [colorPreset, setColorPreset] = useState<ColorPreset>('default');
  const mapStyle = colorPreset === 'satellite' ? SATELLITE_MAP_STYLE
    : theme === 'dark' ? CARTO_DARK : CARTO_LIGHT;

  // Sidebar navigation state machine — replaces simple selectedPin for in-map navigation
  type SidebarView =
    | { type: 'pin'; pin: any; pinType: 'vehicle' | 'collection' | 'business' | 'photo' | 'marketplace' }
    | { type: 'vehicle-detail'; vehicleId: string }
    | { type: 'org-detail'; orgId: string }
    | null;
  const [sidebarView, setSidebarView] = useState<SidebarView>(null);
  const [sidebarHistory, setSidebarHistory] = useState<SidebarView[]>([]);

  const pushSidebar = useCallback((view: SidebarView) => {
    setSidebarView(prev => {
      if (prev) setSidebarHistory(h => [...h, prev]);
      return view;
    });
  }, []);

  const popSidebar = useCallback(() => {
    setSidebarHistory(h => {
      const prev = h[h.length - 1];
      setSidebarView(prev || null);
      return h.slice(0, -1);
    });
  }, []);

  const navigateInSidebar = useCallback((target: { type: string; id: string }) => {
    if (target.type === 'vehicle-detail') {
      pushSidebar({ type: 'vehicle-detail', vehicleId: target.id });
    } else if (target.type === 'org-detail') {
      pushSidebar({ type: 'org-detail', orgId: target.id });
    }
  }, [pushSidebar]);

  // Timeline — filter vehicles by date
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [timeCutoff, setTimeCutoff] = useState(100); // 0-100 percentage of date range
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelineSpeed, setTimelineSpeed] = useState(1); // 1x, 2x, 5x
  // Timeline zoom/pan
  const [timelineZoom, setTimelineZoom] = useState(1); // 1 = full range, higher = zoomed in (max 20)
  const [timelineCenter, setTimelineCenter] = useState(50); // center position as % of full range
  const timelineDragRef = useRef<{ startX: number; startCenter: number } | null>(null);
  const histogramRef = useRef<HTMLDivElement | null>(null);

  // County choropleth for thermal mode
  const [countyGeoJson, setCountyGeoJson] = useState<any>(null);
  const [countyLoading, setCountyLoading] = useState(false);

  // Live events
  const liveEventsRef = useRef<LiveEvent[]>([]);
  const [tick, setTick] = useState(0);

  // Animation loop — only runs when live events exist (saves CPU)
  useEffect(() => {
    let raf: number;
    let running = false;
    const loop = () => {
      const hasActive = liveEventsRef.current.some(e => Date.now() - e.ts < 2500);
      if (hasActive) {
        setTick(t => t + 1);
        raf = requestAnimationFrame(loop);
      } else {
        running = false;
      }
    };
    // Check every 2s if we need to start the loop
    const interval = setInterval(() => {
      if (!running && liveEventsRef.current.length > 0) {
        running = true;
        raf = requestAnimationFrame(loop);
      }
    }, 2000);
    return () => { cancelAnimationFrame(raf); clearInterval(interval); };
  }, []);

  // ---- Load collections from DB ----
  useEffect(() => {
    supabase.from('businesses')
      .select('id, business_name, slug, latitude, longitude, city, country, social_links, total_inventory')
      .eq('business_type', 'collection')
      .not('latitude', 'is', null).not('longitude', 'is', null)
      .then(({ data }) => {
        if (data) setCollections(data.map((b: any) => ({
          id: b.id, name: b.business_name, slug: b.slug || b.id,
          ig: b.social_links?.instagram || null,
          country: b.country || 'Unknown', city: b.city || '',
          lat: Number(b.latitude), lng: Number(b.longitude),
          totalInventory: b.total_inventory || 0,
        })));
      });
  }, []);

  // ---- Load businesses ----
  useEffect(() => {
    supabase.from('businesses').select('id, business_name, latitude, longitude, entity_type')
      .not('latitude', 'is', null).not('longitude', 'is', null).limit(5000)
      .then(({ data }) => {
        if (data) setBiz(data.map((b: any) => ({ id: b.id, name: b.business_name || 'Business', lat: b.latitude, lng: b.longitude, type: b.entity_type })));
      });
  }, []);

  // ---- Load GPS-tagged photos — cursor-paginated like vehicles ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhotoLoading(true);
      const allRows: any[] = [];
      const vehicleInfo: Record<string, { title: string; thumb: string | null }> = {};
      let lastId = '';
      let fetched = 0;
      let batchesSinceRender = 0;
      const maxRows = 50000;

      const buildPins = (rows: any[]): PhotoPin[] => rows.map(d => {
        const dt = d.taken_at ? new Date(d.taken_at) : null;
        const exif = d.exif_data as any;
        const isPlaceholder = d.image_url?.includes('placeholder.nuke.app');
        const vInfo = d.vehicle_id ? vehicleInfo[d.vehicle_id] : null;
        return {
          id: d.id,
          lat: Number(d.latitude),
          lng: Number(d.longitude),
          img: d.image_url,
          thumb: isPlaceholder ? null : (d.thumbnail_url || (d.image_url?.includes('/storage/v1/object/public/')
            ? d.image_url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=200&height=140&quality=70&resize=cover'
            : null)),
          hasRealImage: !isPlaceholder,
          vehicleId: d.vehicle_id,
          vehicleTitle: vInfo?.title || '',
          vehicleThumb: vInfo?.thumb || null,
          locationName: d.location_name,
          takenAt: d.taken_at,
          takenLabel: dt ? `${dt.toLocaleString('en', { month: 'short', day: 'numeric', year: 'numeric' })}` : '',
          source: d.source || 'unknown',
          cameraModel: exif?.camera_model || null,
        };
      });

      const fetchVehicleInfo = async (rows: any[]) => {
        const newIds = [...new Set(rows.map((d: any) => d.vehicle_id).filter(Boolean))]
          .filter((id: string) => !vehicleInfo[id]);
        if (newIds.length === 0) return;
        for (let i = 0; i < newIds.length; i += 200) {
          const batch = newIds.slice(i, i + 200);
          const { data: vehs } = await supabase.from('vehicles')
            .select('id, year, make, model, primary_image_url')
            .in('id', batch);
          for (const v of vehs || []) {
            const thumb = v.primary_image_url?.includes('/storage/v1/object/public/')
              ? v.primary_image_url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=200&height=140&quality=70&resize=cover'
              : v.primary_image_url || null;
            vehicleInfo[v.id] = {
              title: [v.year, v.make, v.model].filter(Boolean).join(' '),
              thumb,
            };
          }
        }
      };

      while (fetched < maxRows) {
        if (cancelled) return;
        let q = supabase.from('vehicle_images')
          .select('id, latitude, longitude, image_url, thumbnail_url, vehicle_id, location_name, taken_at, source, exif_data')
          .not('latitude', 'is', null).not('longitude', 'is', null);
        if (lastId) q = q.gt('id', lastId);
        q = q.order('id', { ascending: true }).limit(500);
        const { data, error } = await q;
        if (error) { console.warn('Photo fetch error:', error.message); break; }
        if (!data || data.length === 0) break;

        await fetchVehicleInfo(data);
        for (const row of data) allRows.push(row);
        lastId = data[data.length - 1].id;
        fetched += data.length;
        batchesSinceRender++;

        // Progressive render every 3 batches
        if (batchesSinceRender === 1 || batchesSinceRender % 3 === 0) {
          if (!cancelled) setPhotos(buildPins(allRows));
        }
      }

      if (!cancelled) {
        setPhotos(buildPins(allRows));
        setPhotoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Load FB Marketplace listings ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMktLoading(true);
      const all: MarketplacePin[] = [];
      let lastId = '';
      let fetched = 0;
      const maxRows = 20000;

      while (fetched < maxRows) {
        if (cancelled) return;
        let q = supabase.from('marketplace_listings')
          .select('id,facebook_id,title,parsed_year,parsed_make,parsed_model,price,current_price,image_url,location,status,description,seller_name,url,scraped_at')
          .eq('status', 'active')
          .not('location', 'is', null);
        if (lastId) q = q.gt('id', lastId);
        q = q.order('id', { ascending: true }).limit(500);

        const { data, error } = await q;
        if (error) { console.warn('Marketplace fetch error:', error.message); break; }
        if (!data || data.length === 0) break;

        for (const row of data) {
          const locStr = row.location || '';
          const coords = geo(locStr);
          if (!coords) continue;
          all.push({
            id: row.id,
            fbId: row.facebook_id,
            year: row.parsed_year,
            make: row.parsed_make,
            model: row.parsed_model,
            lat: coords[0],
            lng: coords[1],
            loc: locStr,
            img: row.image_url,
            price: row.current_price || row.price || null,
            title: row.title || [row.parsed_year, row.parsed_make, row.parsed_model].filter(Boolean).join(' ') || 'Listing',
            seller: row.seller_name,
            description: row.description,
            url: row.url || `https://www.facebook.com/marketplace/item/${row.facebook_id}`,
            status: row.status,
            scrapedAt: row.scraped_at,
          });
        }

        lastId = data[data.length - 1].id;
        fetched += data.length;

        // Progressive render every 2 batches
        if (fetched <= 1000 || fetched % 2000 === 0) {
          if (!cancelled) setMarketplace([...all]);
        }
      }

      if (!cancelled) {
        setMarketplace([...all]);
        setMktLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Load base vehicle layer — progressive cursor pagination ----
  // Renders first batch immediately, then streams in background
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setVehLoading(true);
      const all: VPin[] = [];
      const seen = new Set<string>();
      let batchesSinceRender = 0;

      const addRows = (rows: any[]) => {
        for (const v of rows) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          const p = pinFromRow(v);
          if (p) all.push(p);
        }
      };

      const paginate = async (
        buildQuery: (q: any) => any,
        maxRows: number,
      ) => {
        let lastId = '';
        let fetched = 0;
        while (fetched < maxRows) {
          if (cancelled) return;
          let q = buildQuery(supabase.from('vehicles').select(RICH_FIELDS));
          if (lastId) q = q.gt('id', lastId);
          q = q.order('id', { ascending: true }).limit(500);
          const { data, error } = await q;
          if (error) { console.warn('Vehicle fetch error:', error.message); break; }
          if (!data || data.length === 0) break;
          addRows(data);
          lastId = data[data.length - 1].id;
          fetched += data.length;
          batchesSinceRender++;

          // Progressive render: first batch immediately, then every 3 batches (3k rows)
          if (batchesSinceRender === 1 || batchesSinceRender % 3 === 0) {
            if (!cancelled) {
              // Sort newest-first so the most recently added vehicles render at the front
              all.sort((a, b) => b.dateTs - a.dateTs);
              setVehicles([...all]);
            }
          }
        }
      };

      // 1) listing_location vehicles — up to 150k (all 122k with listing_location)
      await paginate(
        (q: any) => q.not('listing_location', 'is', null),
        150000,
      );
      if (!cancelled) setVehicles([...all]);

      // 2) bat_location vehicles (no listing_location) — up to 30k
      await paginate(
        (q: any) => q.is('listing_location', null).not('bat_location', 'is', null).neq('bat_location', 'United States'),
        30000,
      );
      if (!cancelled) setVehicles([...all]);

      // 3) GPS coord vehicles
      await paginate(
        (q: any) => q.not('gps_latitude', 'is', null).not('gps_longitude', 'is', null),
        15000,
      );

      if (!cancelled) {
        setVehicles([...all]);
        setVehLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Timeline play/pause auto-advance ----
  useEffect(() => {
    if (!timelinePlaying || !timelineEnabled) return;
    // Advance speed: 1x = 1% per 100ms (10s full), 2x = 2%/100ms, 5x = 5%/100ms
    const intervalMs = 100;
    const step = timelineSpeed;
    const id = setInterval(() => {
      setTimeCutoff(c => {
        const next = c + step;
        if (next >= 100) { setTimelinePlaying(false); return 100; }
        return next;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [timelinePlaying, timelineEnabled, timelineSpeed]);

  // ---- Load county boundaries for thermal choropleth ----
  useEffect(() => {
    if ((mode !== 'thermal' && !showCountyOverlay) || countyGeoJson) return;
    setCountyLoading(true);
    fetch('/data/us-counties-10m.json')
      .then(r => r.json())
      .then(topo => {
        const geo = topojson.feature(topo, topo.objects.counties);
        // Pre-compute bounding boxes for fast spatial lookup
        for (const f of (geo as any).features) {
          const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
          let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
          for (const ring of coords) {
            for (const [lng, lat] of ring) {
              if (lat < minLat) minLat = lat;
              if (lat > maxLat) maxLat = lat;
              if (lng < minLng) minLng = lng;
              if (lng > maxLng) maxLng = lng;
            }
          }
          f.properties._bbox = [minLng, minLat, maxLng, maxLat];
        }
        setCountyGeoJson(geo);
        setCountyLoading(false);
      })
      .catch(err => { console.error('County load error:', err); setCountyLoading(false); });
  }, [mode, countyGeoJson, showCountyOverlay]);

  // ---- Load ZCTA (ZIP code) boundaries ----
  const [zctaGeoJson, setZctaGeoJson] = useState<any>(null);
  const [zctaLoading, setZctaLoading] = useState(false);
  const [selectedZip, setSelectedZip] = useState<string | null>(null);
  const [selectedCounties, setSelectedCounties] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Load ZCTA at z8+ or when needed
    if (zoom < 7.5 || zctaGeoJson || zctaLoading) return;
    setZctaLoading(true);
    fetch('/data/us-zcta-500k.json')
      .then(r => r.json())
      .then(topo => {
        const objectKey = Object.keys(topo.objects)[0];
        const geo = topojson.feature(topo, topo.objects[objectKey]);
        setZctaGeoJson(geo);
        setZctaLoading(false);
      })
      .catch(err => { console.error('ZCTA load error:', err); setZctaLoading(false); });
  }, [zoom, zctaGeoJson, zctaLoading]);

  // ---- Query engine ----
  const handleSearch = useCallback(async () => {
    const q = searchText.trim();
    if (!q) { clearSearch(); return; }
    setSearching(true);
    setActiveQuery(q);

    try {
      const yearMatch = q.match(/^(\d{4})\b/);
      let query = supabase.from('vehicles').select(RICH_FIELDS, { count: 'exact' });

      if (yearMatch) {
        query = query.eq('year', parseInt(yearMatch[1]));
        const rest = q.slice(4).trim();
        if (rest) query = query.textSearch('search_vector', rest, { type: 'websearch' });
      } else {
        query = query.textSearch('search_vector', q, { type: 'websearch' });
      }

      const { data, count, error: searchError } = await query.limit(3000);
      if (searchError) { console.error('Search error:', searchError); }
      setQueryTotal(count || 0);

      const pins: VPin[] = [];
      const noLoc: { id: string; title: string; loc: string }[] = [];

      for (const v of (data || [])) {
        const p = pinFromRow(v);
        if (p) { pins.push(p); }
        else {
          noLoc.push({
            id: v.id,
            title: [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || 'Vehicle',
            loc: v.listing_location || v.bat_location || v.location || '',
          });
        }
      }

      setQueryResults(pins);
      setQueryNoLoc(noLoc);

      if (pins.length > 0) {
        const avgLat = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
        const avgLng = pins.reduce((s, p) => s + p.lng, 0) / pins.length;
        setViewState(vs => ({
          ...vs,
          latitude: avgLat,
          longitude: avgLng,
          zoom: 5,
          transitionDuration: 1200,
          transitionInterpolator: new FlyToInterpolator(),
        }));
      }
    } catch (err) {
      console.error('Map query error:', err);
    } finally {
      setSearching(false);
    }
  }, [searchText]);

  const clearSearch = () => {
    setSearchText(''); setQueryResults([]); setQueryNoLoc([]);
    setQueryTotal(0); setActiveQuery('');
  };

  const hasQuery = activeQuery.length > 0;

  // --- Timeline: compute date range and filter ---
  const timelineRange = useMemo(() => {
    if (vehicles.length === 0) return { min: 0, max: Date.now(), minLabel: '', maxLabel: '' };
    const dates = vehicles.filter(v => v.dateTs > 0).map(v => v.dateTs);
    if (dates.length === 0) return { min: 0, max: Date.now(), minLabel: '', maxLabel: '' };
    const now = Date.now();
    // Full scan — no sampling approximation
    const sorted = dates.slice().sort((a, b) => a - b);
    const realMin = sorted[0];
    const realMax = Math.min(sorted[sorted.length - 1], now);
    const fmtD = (ts: number) => {
      const d = new Date(ts);
      return `${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}`;
    };
    return { min: realMin, max: realMax, minLabel: fmtD(realMin), maxLabel: fmtD(realMax) };
  }, [vehicles]);

  // --- Timeline: visible window based on zoom/pan ---
  const visibleRange = useMemo(() => {
    if (timelineZoom <= 1) return { start: 0, end: 100 };
    const windowSize = 100 / timelineZoom;
    const start = Math.max(0, timelineCenter - windowSize / 2);
    const end = Math.min(100, start + windowSize);
    return { start, end };
  }, [timelineZoom, timelineCenter]);

  // --- Timeline: 48-bin histogram computed over visible window ---
  const timelineHistogram = useMemo(() => {
    if (vehicles.length === 0 || timelineRange.min === timelineRange.max) return [];
    const NUM_BINS = 48;
    const fullRange = timelineRange.max - timelineRange.min;
    const visStart = timelineRange.min + (fullRange * visibleRange.start / 100);
    const visEnd = timelineRange.min + (fullRange * visibleRange.end / 100);
    const visDuration = visEnd - visStart;
    if (visDuration <= 0) return [];
    const bins = new Array(NUM_BINS).fill(0);
    for (const v of vehicles) {
      if (v.dateTs <= 0 || v.dateTs < visStart || v.dateTs > visEnd) continue;
      const idx = Math.min(NUM_BINS - 1, Math.floor(((v.dateTs - visStart) / visDuration) * NUM_BINS));
      bins[idx]++;
    }
    const maxBin = Math.max(...bins, 1);
    // Log-scale normalization: prevents one dominant bin from flattening all others
    const logMax = Math.log1p(maxBin);
    return bins.map(n => logMax > 0 ? Math.log1p(n) / logMax : 0);
  }, [vehicles, timelineRange, visibleRange]);

  // --- Date ticks for timeline ---
  const dateTicks = useMemo(() => {
    if (!timelineEnabled || timelineRange.min === timelineRange.max) return [];
    const fullRange = timelineRange.max - timelineRange.min;
    const visStart = timelineRange.min + (fullRange * visibleRange.start / 100);
    const visEnd = timelineRange.min + (fullRange * visibleRange.end / 100);
    const visDuration = visEnd - visStart;
    if (visDuration <= 0) return [];
    const msPerDay = 86400000;
    let interval: number;
    let format: (d: Date) => string;
    if (timelineZoom >= 10) {
      interval = 7 * msPerDay;
      format = (d) => `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
    } else if (timelineZoom >= 4) {
      interval = 30 * msPerDay;
      format = (d) => `${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}`;
    } else {
      interval = 365 * msPerDay;
      format = (d) => `${d.getFullYear()}`;
    }
    const rawTicks: { pct: number; label: string }[] = [];
    let t = Math.ceil(visStart / interval) * interval;
    while (t <= visEnd) {
      const pct = ((t - visStart) / visDuration) * 100;
      rawTicks.push({ pct, label: format(new Date(t)) });
      t += interval;
    }
    // Auto-thin: minimum 8% spacing between labels (~60px on a 750px bar)
    const MIN_SPACING = 8;
    const thinned: typeof rawTicks = [];
    for (const tick of rawTicks) {
      if (thinned.length === 0 || tick.pct - thinned[thinned.length - 1].pct >= MIN_SPACING) {
        thinned.push(tick);
      }
    }
    return thinned;
  }, [timelineRange, visibleRange, timelineZoom, timelineEnabled]);

  // --- Timeline scroll wheel zoom handler ---
  // Must use capture-phase native listener on the timeline CONTAINER (not just histogram)
  // because deck.gl registers its own capture-phase wheel listener on the canvas.
  // We attach to the entire bottom timeline bar so any scroll over it is intercepted.
  const timelineBarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = timelineBarRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Only zoom timeline when timeline is enabled and histogram is showing
      if (!histogramRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const delta = e.deltaY > 0 ? -1 : 1;
      setTimelineZoom(z => Math.max(1, Math.min(20, z + delta * 0.5)));
    };
    // Capture phase = fires BEFORE deck.gl's bubble-phase handler
    el.addEventListener('wheel', handler, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', handler, { capture: true } as any);
  });

  const filteredVehicles = useMemo(() => {
    if (!timelineEnabled || timeCutoff >= 100) return vehicles;
    const range = timelineRange.max - timelineRange.min;
    const cutoffTs = timelineRange.min + (range * timeCutoff / 100);
    return vehicles.filter(v => v.dateTs <= cutoffTs);
  }, [vehicles, timelineEnabled, timeCutoff, timelineRange]);

  // ---- Supercluster index for vehicle point de-stacking ----
  const clusterIndex = useMemo(() => {
    if (filteredVehicles.length === 0) return null;
    const index = new Supercluster({ radius: 60, maxZoom: 14, minZoom: 0 });
    index.load(filteredVehicles.map(v => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] },
      properties: { id: v.id },
    })));
    return index;
  }, [filteredVehicles]);

  // ---- Compute county vehicle counts for choropleth (async to avoid blocking UI) ----
  const [countyFeatures, setCountyFeatures] = useState<any>(null);
  const [thermalComputing, setThermalComputing] = useState(false);
  useEffect(() => {
    if (!countyGeoJson || (mode !== 'thermal' && !showCountyOverlay)) { setCountyFeatures(null); return; }
    const data = hasQuery ? queryResults : filteredVehicles;
    if (data.length === 0) { setCountyFeatures(countyGeoJson); return; }

    setThermalComputing(true);
    // Defer heavy computation so React can render loading state first
    const timer = setTimeout(() => {
      try {
        // Build spatial grid (0.5° cells) for fast county lookup
        const grid: Record<string, any[]> = {};
        for (const f of countyGeoJson.features) {
          const [minLng, minLat, maxLng, maxLat] = f.properties._bbox;
          const gMinX = Math.floor(minLng * 2), gMaxX = Math.floor(maxLng * 2);
          const gMinY = Math.floor(minLat * 2), gMaxY = Math.floor(maxLat * 2);
          for (let gx = gMinX; gx <= gMaxX; gx++) {
            for (let gy = gMinY; gy <= gMaxY; gy++) {
              const key = `${gx},${gy}`;
              if (!grid[key]) grid[key] = [];
              grid[key].push(f);
            }
          }
        }

        // Count vehicles per county using grid-accelerated PIP
        const countMap = new Map<string, number>();
        for (const v of data) {
          const gx = Math.floor(v.lng * 2), gy = Math.floor(v.lat * 2);
          const candidates = grid[`${gx},${gy}`];
          if (!candidates) continue;
          const pt = turfPoint([v.lng, v.lat]);
          for (const f of candidates) {
            const [minLng, minLat, maxLng, maxLat] = f.properties._bbox;
            if (v.lng < minLng || v.lng > maxLng || v.lat < minLat || v.lat > maxLat) continue;
            if (booleanPointInPolygon(pt, f)) {
              countMap.set(f.id, (countMap.get(f.id) || 0) + 1);
              break;
            }
          }
        }

        const vals = [...countMap.values()];
        const maxCount = vals.length > 0 ? Math.max(...vals) : 1;
        setCountyFeatures({
          ...countyGeoJson,
          features: countyGeoJson.features.map((f: any) => ({
            ...f,
            properties: { ...f.properties, _count: countMap.get(f.id) || 0, _maxCount: maxCount },
          })),
        });
      } catch (err) {
        console.error('Thermal computation error:', err);
        setCountyFeatures(null);
      }
      setThermalComputing(false);
    }, 50);
    return () => clearTimeout(timer);
  }, [countyGeoJson, mode, showCountyOverlay, hasQuery, queryResults, filteredVehicles]);

  const cutoffLabel = useMemo(() => {
    if (!timelineEnabled || timeCutoff >= 100) return timelineRange.maxLabel;
    const range = timelineRange.max - timelineRange.min;
    const cutoffTs = timelineRange.min + (range * timeCutoff / 100);
    const d = new Date(cutoffTs);
    return `${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}`;
  }, [timelineEnabled, timeCutoff, timelineRange]);

  // Viewport bounds for filtering counts to visible area
  const viewportBounds = useMemo(() => {
    try {
      const vp = new WebMercatorViewport({ ...viewState, width: window.innerWidth, height: window.innerHeight });
      const [west, south] = vp.unproject([0, window.innerHeight]);
      const [east, north] = vp.unproject([window.innerWidth, 0]);
      return { west, south, east, north };
    } catch { return null; }
  }, [viewState]);

  const counts = useMemo(() => {
    const inView = (lat: number, lng: number) => {
      if (!viewportBounds) return true;
      return lat >= viewportBounds.south && lat <= viewportBounds.north
          && lng >= viewportBounds.west && lng <= viewportBounds.east;
    };
    const vehInView = filteredVehicles.filter(v => inView(v.lat, v.lng)).length;
    const colInView = collections.filter(c => inView(c.lat, c.lng)).length;
    const bizInView = businesses.filter(b => inView(b.lat, b.lng)).length;
    const phoInView = photos.filter(p => inView(p.lat, p.lng)).length;
    const mktInView = marketplace.filter(m => inView(m.lat, m.lng)).length;
    const qryInView = queryResults.filter(q => inView(q.lat, q.lng)).length;
    return {
      collections: colInView,
      vehicles: vehInView,
      businesses: bizInView,
      photos: phoInView,
      marketplace: mktInView,
      query: qryInView,
      total: (showCollections && !hasQuery ? colInView : 0)
           + (showVehicles && !hasQuery ? vehInView : 0)
           + (showBusinesses && !hasQuery ? bizInView : 0)
           + (showPhotos && !hasQuery ? phoInView : 0)
           + (showMarketplace && !hasQuery ? mktInView : 0)
           + qryInView,
    };
  }, [showCollections, showVehicles, showBusinesses, showPhotos, showMarketplace, collections, filteredVehicles, businesses, photos, marketplace, queryResults, hasQuery, viewportBounds]);

  // --- deck.gl layers ---
  const layers = useMapLayers({
    filteredVehicles, collections, businesses, photos, marketplace, queryResults,
    showVehicles, showCollections, showBusinesses, showPhotos, showMarketplace, showCountyOverlay, hasQuery,
    zoom, mode, glowRadius, glowIntensity, pointSize, colorPreset,
    tick, liveEventsRef,
    countyFeatures, clusterIndex, viewportBounds, zctaGeoJson, selectedZip, selectedCounties,
    handleLayerClick, setHoverInfo, setSelectedPin, setSelectedCounties, setSelectedZip, setViewState, deckClickedRef,
  });


  const panelW = 320; // side panel width
  const hasSidePanel = sidebarView !== null || selectedZip !== null;

  return (
    <div className="nuke-map-root" style={{ position: 'absolute', inset: 0, background: 'var(--bg)', display: 'flex', overflow: 'hidden', fontFamily: MAP_FONT }}
      onClick={() => { if (!deckClickedRef.current) { setSelectedPin(null); setSidebarView(null); setSidebarHistory([]); setSelectedZip(null); setSelectedCounties(new Set()); } }}>

      {/* Map area — shrinks when side panel is open */}
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <DeckGL
            viewState={viewState}
            onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
            controller={{
              scrollZoom: { speed: 0.01, smooth: true },
              inertia: 300,
              dragPan: true,
              touchZoom: true,
              doubleClickZoom: true,
              keyboard: true,
            }}
            layers={layers}
            getCursor={({ isHovering }: { isHovering: boolean }) => isHovering ? 'pointer' : 'grab'}
            style={{ position: 'absolute', inset: 0 }}
          >
            <Map mapStyle={mapStyle} attributionControl={false} />
          </DeckGL>
        </div>

        {/* Loading progress bar — 1px at top */}
        {(vehLoading || countyLoading || thermalComputing) && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1100, height: 1, background: 'var(--border)' }}>
            <div style={{ height: '100%', background: 'var(--text)', width: (countyLoading || thermalComputing) ? '50%' : `${Math.min(100, (vehicles.length / 15000) * 100)}%`, transition: 'width 0.3s ease' }} />
          </div>
        )}

        {/* Hover tooltip */}
        {hoverInfo && (
          <div style={{
            position: 'absolute', left: hoverInfo.x + 14, top: hoverInfo.y - 24, zIndex: 1500,
            background: 'var(--surface-glass)', color: 'var(--text)', padding: '4px 8px',
            fontSize: '10px', fontFamily: MAP_FONT, pointerEvents: 'none',
            whiteSpace: 'nowrap', border: '1px solid var(--border)',
          }}>
            {hoverInfo.text}
          </div>
        )}

        {/* Search bar — top left */}
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <input type="text" placeholder="Search: red porsche, 1966 mustang, v8 swap..."
              value={searchText} onChange={e => setSearchText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={{ width: 300, padding: '6px 10px', fontSize: '11px', fontFamily: MAP_FONT,
                border: '1px solid var(--border)',
                background: 'var(--surface-glass)', color: 'var(--text)', outline: 'none' }}
            />
            <button onClick={handleSearch} disabled={searching}
              style={{ padding: '6px 14px', fontSize: '10px', fontWeight: 600, fontFamily: MAP_FONT,
                textTransform: 'uppercase', letterSpacing: '0.8px',
                background: searching ? 'var(--surface)' : 'var(--text)',
                color: searching ? 'var(--text-disabled)' : 'var(--bg)',
                border: '1px solid var(--border)', cursor: 'pointer' }}>
              {searching ? '...' : 'SEARCH'}
            </button>
            {activeQuery && (
              <button onClick={clearSearch} style={{ padding: '6px 10px', fontSize: '10px', fontFamily: MAP_FONT,
                textTransform: 'uppercase', letterSpacing: '0.5px',
                background: 'var(--surface-glass)', color: 'var(--text-disabled)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                CLEAR
              </button>
            )}
          </div>
          {activeQuery && !searching && (
            <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--border)',
              padding: '5px 10px', fontSize: '10px', color: 'var(--text-disabled)', fontFamily: MAP_FONT }}>
              <strong style={{ color: 'var(--text)' }}>{queryTotal.toLocaleString()}</strong> match &ldquo;{activeQuery}&rdquo; &mdash; <strong style={{ color: 'var(--text)' }}>{queryResults.length.toLocaleString()}</strong> mapped
              {queryNoLoc.length > 0 && <span> &middot; {queryNoLoc.length.toLocaleString()} no location</span>}
            </div>
          )}
        </div>

        {/* Controls — top right */}
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, fontFamily: MAP_FONT }}>
          {!controlsOpen ? (
            <button onClick={(e) => { e.stopPropagation(); setControlsOpen(true); }}
              style={{ background: 'var(--surface-glass)', border: '1px solid var(--border)',
                padding: '6px 12px', color: 'var(--text)', cursor: 'pointer',
                fontSize: '10px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>LAYERS</span>
              <span style={{ color: 'var(--text-disabled)', fontSize: '10px', fontVariantNumeric: 'tabular-nums' }}>
                {counts.vehicles.toLocaleString()}
              </span>
            </button>
          ) : (
            <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface-glass)',
              border: '1px solid var(--border)', padding: 12,
              minWidth: 200, color: 'var(--text)', fontSize: '11px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)' }}>LAYERS</span>
                <button onClick={() => setControlsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-disabled)', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}>x</button>
              </div>
              <LT label="Vehicles" color={`rgb(${COLOR_PRESETS[colorPreset].vehicle.join(',')})`} checked={showVehicles} set={setShowVehicles} n={counts.vehicles} dim={hasQuery} loading={vehLoading} />
              <LT label="For Sale" color="#4ADE80" checked={showMarketplace} set={setShowMarketplace} n={counts.marketplace} dim={hasQuery} loading={mktLoading} />
              <LT label="Collections" color={`rgb(${COLOR_PRESETS[colorPreset].collection.join(',')})`} checked={showCollections} set={setShowCollections} n={counts.collections} dim={hasQuery} />
              <LT label="Businesses" color={`rgb(${COLOR_PRESETS[colorPreset].business.join(',')})`} checked={showBusinesses} set={setShowBusinesses} n={counts.businesses} dim={hasQuery} />
              <LT label="Photos" color={`rgb(${COLOR_PRESETS[colorPreset].photo.join(',')})`} checked={showPhotos} set={setShowPhotos} n={counts.photos} dim={hasQuery} loading={photoLoading} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '3px 0', fontSize: '11px', fontFamily: MAP_FONT }}>
                <input type="checkbox" checked={showCountyOverlay} onChange={e => setShowCountyOverlay(e.target.checked)} />
                <span style={{ color: 'var(--text)' }}>Counties</span>
              </label>
              {activeQuery && <>
                <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                  <span style={{ width: 8, height: 8, background: `rgb(${COLOR_PRESETS[colorPreset].query.join(',')})`, display: 'inline-block' }} />
                  <span style={{ fontWeight: 600, fontSize: '10px' }}>Query</span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', fontVariantNumeric: 'tabular-nums' }}>{counts.query.toLocaleString()}</span>
                </div>
              </>}
              <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0 6px' }} />

              {/* Mode toggle: GLOW | POINTS | THERMAL */}
              <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 4, fontWeight: 600 }}>MODE</div>
              <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
                {(['density', 'points', 'thermal'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)} style={{
                    flex: 1, padding: '4px 0', fontSize: '9px', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: MAP_FONT,
                    background: mode === m ? 'var(--text)' : 'transparent',
                    color: mode === m ? 'var(--bg)' : 'var(--text-disabled)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer' }}>
                    {m === 'density' ? 'HEX' : m === 'points' ? 'POINTS' : 'THERMAL'}
                  </button>
                ))}
              </div>

              {/* Color presets */}
              <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 4, fontWeight: 600 }}>COLOR</div>
              <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
                {(['default', 'thermal', 'mono', 'satellite'] as const).map(p => (
                  <button key={p} onClick={() => setColorPreset(p)} style={{
                    flex: 1, padding: '3px 0', fontSize: '8px', textTransform: 'uppercase',
                    letterSpacing: '0.5px', fontFamily: MAP_FONT,
                    background: colorPreset === p ? 'var(--text)' : 'transparent',
                    color: colorPreset === p ? 'var(--bg)' : 'var(--text-disabled)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer' }}>
                    {p === 'default' ? 'DFLT' : p.slice(0, 4).toUpperCase()}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SliderControl label="Point Size" value={pointSize} min={1} max={12} onChange={setPointSize} />
                {(mode === 'density' || mode === 'thermal') && <>
                  <SliderControl label={mode === 'thermal' ? 'Heat Rad' : 'Hex Size'} value={glowRadius} min={5} max={200} onChange={setGlowRadius} />
                  <SliderControl label={mode === 'thermal' ? 'Heat Int' : 'Opacity'} value={glowIntensity} min={1} max={100} onChange={setGlowIntensity} />
                </> }
              </div>
            </div>
          )}
        </div>

        {/* Timeline slider — bottom center */}
        <div ref={timelineBarRef} style={{
          position: 'absolute', bottom: 10, left: 10, right: 10, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--surface-glass)', border: '1px solid var(--border)',
          padding: '6px 12px', fontFamily: MAP_FONT,
        }}>
          {/* Stats */}
          <div style={{ fontSize: '10px', color: 'var(--text-disabled)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            {vehLoading && <span style={{ width: 4, height: 4, background: 'var(--text)', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />}
            {hasQuery
              ? <><strong style={{ color: 'var(--text)' }}>{counts.query.toLocaleString()}</strong> / {queryTotal.toLocaleString()}</>
              : <><strong style={{ color: 'var(--text)' }}>{counts.total.toLocaleString()}</strong> items</>}
          </div>

          {/* Timeline toggle + controls */}
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 10, display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <button
              onClick={() => { setTimelineEnabled(!timelineEnabled); if (timelinePlaying) setTimelinePlaying(false); }}
              style={{
                padding: '3px 8px', fontSize: '9px', fontWeight: 600, fontFamily: MAP_FONT,
                textTransform: 'uppercase', letterSpacing: '0.5px',
                background: timelineEnabled ? 'var(--text)' : 'transparent',
                color: timelineEnabled ? 'var(--bg)' : 'var(--text-disabled)',
                border: '1px solid var(--border)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              TIMELINE
            </button>
            {timelineEnabled && (
              <>
                {/* Quick-select time range buttons */}
                <div style={{ display: 'flex', gap: 0 }}>
                  {([
                    { label: '1W', ms: 7 * 86400000 },
                    { label: '1M', ms: 30 * 86400000 },
                    { label: '1Y', ms: 365 * 86400000 },
                    { label: 'ALL', ms: 0 },
                  ] as const).map(({ label, ms }) => (
                    <button key={label} onClick={() => {
                      setTimelinePlaying(false);
                      if (ms === 0) {
                        setTimeCutoff(100);
                      } else {
                        const fullRange = timelineRange.max - timelineRange.min;
                        if (fullRange <= 0) return;
                        const cutoffTs = timelineRange.max - ms;
                        const pct = Math.max(0, ((cutoffTs - timelineRange.min) / fullRange) * 100);
                        setTimeCutoff(pct);
                      }
                    }} style={{
                      padding: '2px 5px', fontSize: '7px', fontWeight: 600, fontFamily: MAP_FONT,
                      background: 'transparent', color: 'var(--text-disabled)',
                      border: '1px solid var(--border)', cursor: 'pointer',
                      textTransform: 'uppercase', letterSpacing: '0.3px',
                    }}>{label}</button>
                  ))}
                </div>
                {/* Play/pause button */}
                <button
                  onClick={() => {
                    if (timeCutoff >= 100 && !timelinePlaying) setTimeCutoff(0);
                    setTimelinePlaying(p => !p);
                  }}
                  style={{
                    padding: '3px 8px', fontSize: '9px', fontWeight: 600, fontFamily: MAP_FONT,
                    background: timelinePlaying ? 'var(--text)' : 'transparent',
                    color: timelinePlaying ? 'var(--bg)' : 'var(--text-disabled)',
                    border: '1px solid var(--border)', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {timelinePlaying ? '■ STOP' : '▶ PLAY'}
                </button>
                {/* Speed selector */}
                <div style={{ display: 'flex', gap: 0 }}>
                  {([1, 2, 5] as const).map(s => (
                    <button key={s} onClick={() => setTimelineSpeed(s)} style={{
                      padding: '3px 6px', fontSize: '8px', fontWeight: 600, fontFamily: MAP_FONT,
                      background: timelineSpeed === s ? 'var(--text)' : 'transparent',
                      color: timelineSpeed === s ? 'var(--bg)' : 'var(--text-disabled)',
                      border: '1px solid var(--border)', cursor: 'pointer',
                    }}>{s}x</button>
                  ))}
                </div>
                <span style={{ fontSize: '9px', color: 'var(--text-disabled)', whiteSpace: 'nowrap' }}>{timelineRange.minLabel}</span>
                {/* Histogram + slider composite */}
                <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Mini bar chart histogram with scroll-zoom + drag-pan */}
                  {timelineHistogram.length > 0 && (
                    <div
                      ref={histogramRef}
                      style={{ display: 'flex', alignItems: 'flex-end', height: 40, gap: 1, cursor: timelineZoom > 1 ? 'ew-resize' : 'default' }}
                      onDoubleClick={() => { setTimeCutoff(100); setTimelinePlaying(false); }}
                      onMouseDown={(e) => {
                        if (timelineZoom <= 1) return;
                        timelineDragRef.current = { startX: e.clientX, startCenter: timelineCenter };
                      }}
                      onMouseMove={(e) => {
                        if (!timelineDragRef.current || timelineZoom <= 1) return;
                        const dx = e.clientX - timelineDragRef.current.startX;
                        const containerWidth = (e.currentTarget as HTMLElement).offsetWidth;
                        const panAmount = (dx / containerWidth) * 100;
                        const windowSize = 100 / timelineZoom;
                        const newCenter = Math.max(windowSize / 2, Math.min(100 - windowSize / 2,
                          timelineDragRef.current.startCenter - panAmount
                        ));
                        setTimelineCenter(newCenter);
                      }}
                      onMouseUp={() => { timelineDragRef.current = null; }}
                      onMouseLeave={() => { timelineDragRef.current = null; }}
                    >
                      {timelineHistogram.map((h, i) => {
                        // Map bin position within visible range to global %
                        const binPctInWindow = (i / timelineHistogram.length) * 100;
                        const globalPct = visibleRange.start + (binPctInWindow / 100) * (visibleRange.end - visibleRange.start);
                        const active = globalPct <= timeCutoff;
                        return (
                          <div key={i} style={{
                            flex: 1, height: `${Math.max(2, Math.round(h * 36))}px`,
                            background: active ? 'var(--text)' : 'var(--border)',
                            minWidth: 1,
                          }} />
                        );
                      })}
                    </div>
                  )}
                  {/* Date ticks below histogram */}
                  {dateTicks.length > 0 && (
                    <div style={{ position: 'relative', height: 10, pointerEvents: 'none' }}>
                      {dateTicks.map((tick, i) => (
                        <span key={i} style={{
                          position: 'absolute', left: `${tick.pct}%`, transform: 'translateX(-50%)',
                          fontSize: '7px', color: 'var(--text-disabled)', whiteSpace: 'nowrap', lineHeight: 1,
                        }}>{tick.label}</span>
                      ))}
                    </div>
                  )}
                  {/* Range slider — maps within visible window */}
                  {(() => {
                    const sliderVal = visibleRange.end > visibleRange.start
                      ? Math.max(0, Math.min(100, ((timeCutoff - visibleRange.start) / (visibleRange.end - visibleRange.start)) * 100))
                      : 100;
                    return (
                      <input type="range" min={0} max={100} step={0.5} value={sliderVal}
                        onChange={e => {
                          setTimelinePlaying(false);
                          const globalVal = visibleRange.start + (Number(e.target.value) / 100) * (visibleRange.end - visibleRange.start);
                          setTimeCutoff(globalVal);
                        }}
                        style={{ width: '100%', height: 2, WebkitAppearance: 'none' as any, appearance: 'none' as any,
                          background: 'transparent', outline: 'none', cursor: 'pointer', margin: 0 }}
                      />
                    );
                  })()}
                  {/* Mini overview bar — shows full range with visible window highlighted */}
                  {timelineZoom > 1 && (
                    <div style={{ position: 'relative', height: 4, background: 'var(--border)', marginTop: 1 }}>
                      <div style={{
                        position: 'absolute',
                        left: `${visibleRange.start}%`,
                        width: `${visibleRange.end - visibleRange.start}%`,
                        height: '100%',
                        background: 'var(--text)',
                        opacity: 0.7,
                      }} />
                      {/* Playhead position on overview */}
                      <div style={{
                        position: 'absolute',
                        left: `${timeCutoff}%`,
                        width: 1,
                        height: '100%',
                        background: '#4ade80',
                      }} />
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '10px', color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 60, fontVariantNumeric: 'tabular-nums' }}>{cutoffLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* Unmapped results list */}
        {queryNoLoc.length > 0 && (
          <div style={{ position: 'absolute', top: 56, left: 10, zIndex: 1000, width: 300, maxHeight: '40vh',
            overflowY: 'auto', background: 'var(--surface-glass)',
            border: '1px solid var(--border)', fontSize: '11px', fontFamily: MAP_FONT, color: 'var(--text)' }}>
            <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-disabled)',
              fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--surface-glass)' }}>
              No location ({queryNoLoc.length})
            </div>
            {queryNoLoc.slice(0, 50).map(r => (
              <div key={r.id} onClick={() => pushSidebar({ type: 'vehicle-detail', vehicleId: r.id })} style={{ display: 'block', padding: '5px 10px',
                borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: '10px', cursor: 'pointer' }}>
                {r.title}
                {r.loc && <span style={{ color: 'var(--text-disabled)', marginLeft: 8, fontSize: '9px' }}>{r.loc}</span>}
              </div>
            ))}
            {queryNoLoc.length > 50 && <div style={{ padding: '5px 10px', color: 'var(--text-disabled)', fontSize: '9px' }}>+{queryNoLoc.length - 50} more</div>}
          </div>
        )}
      </div>

      {/* Side panel — slides in from right when a point is clicked */}
      {hasSidePanel && (() => {
        return (
          <div onClick={(e) => e.stopPropagation()} style={{
            width: panelW, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--border)',
            overflowY: 'auto', fontFamily: MAP_FONT, color: 'var(--text)',
          }}>
            {/* ZIP sidebar panel — shown when a ZIP polygon is selected */}
            {selectedZip && !sidebarView && (
              <ZipSidebarPanel
                zip={selectedZip}
                onClose={() => setSelectedZip(null)}
                onNavigate={(view) => {
                  if (view.type === 'vehicle-detail') {
                    pushSidebar({ type: 'vehicle-detail', vehicleId: view.id });
                  } else if (view.type === 'org-detail') {
                    pushSidebar({ type: 'org-detail', orgId: view.id });
                  }
                }}
              />
            )}
            {/* Detail views (vehicle/org) — rendered by dedicated components */}
            {sidebarView?.type === 'vehicle-detail' && (
              <MapVehicleDetail
                vehicleId={(sidebarView as any).vehicleId}
                onBack={popSidebar}
                onNavigate={navigateInSidebar}
              />
            )}
            {sidebarView?.type === 'org-detail' && (
              <MapOrgDetail
                orgId={(sidebarView as any).orgId}
                onBack={popSidebar}
                onNavigate={navigateInSidebar}
              />
            )}
            {/* Pin-based views — existing sidebar content */}
            {sidebarView?.type === 'pin' && selectedPin && (() => {
            const { pin, type } = selectedPin;
            return (<>
            {/* Close button */}
            <button onClick={() => { setSelectedPin(null); setSidebarView(null); setSidebarHistory([]); }} style={{
              position: 'sticky', top: 0, zIndex: 1, width: '100%', padding: '6px 12px',
              background: 'var(--surface)', border: 'none', borderBottom: '1px solid var(--border)',
              color: 'var(--text-disabled)', cursor: 'pointer', fontSize: '10px', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 6, fontFamily: MAP_FONT,
              textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
              CLOSE
            </button>

            {type === 'vehicle' && (() => {
              
              const v = pin as any;

              // ---- HEX BIN aggregate panel ----
              if (v._isHexBin) {
                // Unwrap HexagonLayer CPU-mode point objects: each is {source: VPin, index: n}
                const pts = ((v._hexPoints || []) as any[]).map((p: any) => p.source || p) as VPin[];
                const count = pts.length;
                const prices = pts.filter((p: VPin) => p.price).map((p: VPin) => p.price as number);
                const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
                const minPrice = prices.length > 0 ? Math.min(...prices) : null;
                const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
                // Compute median
                const medianPrice = prices.length > 0 ? (() => {
                  const sorted = [...prices].sort((a, b) => a - b);
                  const mid = Math.floor(sorted.length / 2);
                  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
                })() : null;
                const makeCounts: Record<string, number> = {};
                pts.forEach((p: VPin) => { if (p.make) makeCounts[p.make] = (makeCounts[p.make] || 0) + 1; });
                const topMakes = Object.entries(makeCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
                const modelCounts: Record<string, number> = {};
                pts.forEach((p: VPin) => {
                  const key = [p.make, p.model].filter(Boolean).join(' ');
                  if (key) modelCounts[key] = (modelCounts[key] || 0) + 1;
                });
                const topModels = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
                const years = pts.filter((p: VPin) => p.year).map((p: VPin) => Number(p.year)).filter(y => y > 1900);
                const yearMin = years.length > 0 ? Math.min(...years) : null;
                const yearMax = years.length > 0 ? Math.max(...years) : null;
                return (
                  <div style={{ padding: 0 }}>
                    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 4, fontWeight: 600 }}>HEX BIN</div>
                      <div style={{ fontWeight: 700, fontSize: '22px', fontFamily: 'monospace', color: 'var(--text)' }}>{count.toLocaleString()}</div>
                      <div style={{ color: 'var(--text-disabled)', fontSize: '10px' }}>vehicles in this area</div>
                    </div>
                    {avgPrice != null && (
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 6, fontWeight: 600 }}>PRICE</div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 4 }}>
                          <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '16px', fontFamily: 'monospace' }}>{fmtPrice(avgPrice)}</span>
                          <span style={{ color: 'var(--text-disabled)', fontSize: '10px' }}>avg</span>
                          {medianPrice != null && <>
                            <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: '14px', fontFamily: 'monospace' }}>{fmtPrice(medianPrice)}</span>
                            <span style={{ color: 'var(--text-disabled)', fontSize: '10px' }}>median</span>
                          </>}
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: '10px', color: 'var(--text-disabled)' }}>
                          {minPrice != null && <span>Low: <strong style={{ color: 'var(--text)' }}>{fmtPrice(minPrice)}</strong></span>}
                          {maxPrice != null && <span>High: <strong style={{ color: 'var(--text)' }}>{fmtPrice(maxPrice)}</strong></span>}
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-disabled)', marginTop: 4 }}>{prices.length} priced of {count}</div>
                      </div>
                    )}
                    {yearMin != null && yearMax != null && (
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 4, fontWeight: 600 }}>YEARS</div>
                        <div style={{ fontSize: '12px', color: 'var(--text)', fontFamily: 'monospace' }}>
                          {yearMin === yearMax ? yearMin : `${yearMin} \u2013 ${yearMax}`}
                        </div>
                      </div>
                    )}
                    {topMakes.length > 0 && (
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 6, fontWeight: 600 }}>TOP MAKES</div>
                        {topMakes.map(([make, n]) => (
                          <div key={make} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text)' }}>{make}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: Math.max(4, Math.round((n / count) * 80)), height: 3, background: 'var(--text-disabled)' }} />
                              <span style={{ fontSize: '10px', color: 'var(--text-disabled)', fontVariantNumeric: 'tabular-nums', minWidth: 20, textAlign: 'right' }}>{n}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {topModels.length > 0 && (
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 6, fontWeight: 600 }}>TOP MODELS</div>
                        {topModels.map(([model, n]) => (
                          <div key={model} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                            <span style={{ fontSize: '10px', color: 'var(--text)' }}>{model}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-disabled)', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Mini thumbnail grid — up to 4 vehicle images from hex */}
                    {(() => {
                      const thumbPts = pts.filter((p: VPin) => p.img).slice(0, 4);
                      if (thumbPts.length === 0) return null;
                      return (
                        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 6, fontWeight: 600 }}>PHOTOS</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                            {thumbPts.map((p: VPin) => {
                              const t = thumbUrl(p.img);
                              return t ? (
                                <div key={p.id} onClick={() => navigateInSidebar({ type: 'vehicle-detail', vehicleId: p.id })} style={{ cursor: 'pointer' }}>
                                  <img src={t} alt="" style={{ width: '100%', aspectRatio: '3/2', objectFit: 'cover', display: 'block', background: 'var(--surface)' }}
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                </div>
                              ) : null;
                            })}
                          </div>
                        </div>
                      );
                    })()}
                    <div style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 6, fontWeight: 600 }}>
                        VEHICLES ({count > 10 ? 'TOP 10' : count})
                      </div>
                      {pts
                        .slice()
                        .sort((a, b) => (b.price || 0) - (a.price || 0))
                        .slice(0, 10)
                        .map((p: VPin) => {
                          const t = [p.year, p.make, p.model].filter(Boolean).join(' ') || 'Vehicle';
                          return (
                            <div key={p.id} onClick={() => navigateInSidebar({ type: 'vehicle-detail', vehicleId: p.id })} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '4px 0', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                            }}>
                              <span style={{ fontSize: '10px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{t}</span>
                              <span style={{ fontSize: '10px', color: p.price ? '#4ade80' : 'var(--text-disabled)', fontFamily: 'monospace', flexShrink: 0 }}>
                                {p.price ? fmtPrice(p.price) : '\u2014'}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              }

              // ---- Single vehicle panel (original + enhanced) ----
              const title = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
              const subtitle = [v.trim, v.body].filter(Boolean).join(' \u00b7 ');
              const specs = [v.color, v.engine, v.hp ? `${v.hp}hp` : null, v.trans, v.drive].filter(Boolean);
              const thumb = thumbUrl(v.img);
              // SIMILAR NEARBY: same make in current filteredVehicles
              const similarNearby = v.make
                ? filteredVehicles.filter((fv: VPin) => fv.make === v.make && fv.id !== v.id).length
                : 0;
              return (
                <div>
                  {thumb && <div onClick={() => navigateInSidebar({ type: 'vehicle-detail', vehicleId: v.id })} style={{ cursor: 'pointer' }}>
                    <img src={thumb} alt={title} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>}
                  <div style={{ padding: '12px 14px' }}>
                    <span onClick={() => navigateInSidebar({ type: 'vehicle-detail', vehicleId: v.id })} style={{ color: 'var(--text)', fontWeight: 700, fontSize: '14px', display: 'block', marginBottom: 4, cursor: 'pointer' }}>
                      {title}
                    </span>
                    {subtitle && <div style={{ color: 'var(--text-disabled)', fontSize: '11px', marginBottom: 8 }}>{subtitle}</div>}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'baseline' }}>
                      {v.price && <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '16px', fontFamily: 'monospace' }}>{fmtPrice(v.price)}</span>}
                      {v.mileage && <span style={{ color: 'var(--text-disabled)', fontSize: '11px' }}>{fmtMiles(v.mileage)}</span>}
                    </div>
                    {specs.length > 0 && <div style={{ color: 'var(--text-disabled)', fontSize: '10px', marginBottom: 8, lineHeight: 1.6 }}>{specs.join(' \u00b7 ')}</div>}
                    {v.intColor && <div style={{ color: 'var(--text-disabled)', fontSize: '10px', marginBottom: 8 }}>Interior: {v.intColor}</div>}
                    {/* Stat badges: Deal Score, Heat Score, Condition */}
                    {(v.deal != null || v.heat != null || v.condition != null) && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                        {v.deal != null && (
                          <span style={{
                            padding: '2px 7px', fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
                            background: v.deal >= 70 ? 'rgba(74,222,128,0.15)' : v.deal >= 40 ? 'rgba(250,204,21,0.15)' : 'rgba(248,113,113,0.15)',
                            color: v.deal >= 70 ? '#4ade80' : v.deal >= 40 ? '#facc15' : '#f87171',
                            border: `1px solid ${v.deal >= 70 ? '#4ade8040' : v.deal >= 40 ? '#facc1540' : '#f8717140'}`,
                          }}>DEAL {v.deal}</span>
                        )}
                        {v.heat != null && (
                          <span style={{ padding: '2px 7px', fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
                            background: 'rgba(249,115,22,0.15)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)' }}>HEAT {v.heat}</span>
                        )}
                        {v.condition != null && (
                          <span style={{ padding: '2px 7px', fontSize: '9px', fontWeight: 700, letterSpacing: '0.5px',
                            background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)' }}>COND {v.condition}/10</span>
                        )}
                      </div>
                    )}
                    {/* Date label — prominent */}
                    {v.dateLabel && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ width: 4, height: 4, background: 'var(--text-disabled)', borderRadius: '50%', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-disabled)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                          {v.dateLabel}
                        </span>
                      </div>
                    )}
                    {v.loc && <div style={{ color: 'var(--text-disabled)', fontSize: '9px', marginBottom: 12 }}>{v.loc}</div>}
                    {/* SIMILAR NEARBY */}
                    {v.make && similarNearby > 0 && (
                      <div style={{ padding: '7px 10px', background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 10, fontSize: '10px' }}>
                        <span style={{ color: 'var(--text-disabled)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SIMILAR NEARBY </span>
                        <span style={{ color: 'var(--text)', fontWeight: 700 }}>{similarNearby.toLocaleString()}</span>
                        <span style={{ color: 'var(--text-disabled)' }}> {v.make} in view</span>
                      </div>
                    )}
                    <span onClick={() => pushSidebar({ type: 'vehicle-detail', vehicleId: v.id })} style={{
                      display: 'block', textAlign: 'center', padding: '8px', cursor: 'pointer',
                      background: 'var(--text)', color: 'var(--bg)',
                      fontWeight: 600, fontSize: '10px', border: '1px solid var(--border)',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>VIEW FULL PROFILE</span>
                  </div>
                </div>
              );
            })()}

            {type === 'collection' && (() => {
              const c = pin as ColPin;
              return (
                <div style={{ padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: 4, color: 'var(--text)' }}>{c.name}</div>
                  <div style={{ color: 'var(--text-disabled)', fontSize: '11px', marginBottom: 10 }}>{c.city}, {c.country}</div>
                  {c.totalInventory > 0 && <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: '13px', marginBottom: 12 }}>{c.totalInventory} vehicles</div>}
                  <span onClick={() => navigateInSidebar({ type: 'org-detail', orgId: c.slug })} style={{ display: 'block', textAlign: 'center', padding: '8px',
                    background: 'var(--text)', color: 'var(--bg)', fontWeight: 600, fontSize: '10px',
                    border: '1px solid var(--border)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer' }}>VIEW COLLECTION</span>
                  {c.ig && <a href={`https://instagram.com/${c.ig}`} target="_blank" rel="noreferrer" style={{
                    display: 'block', textAlign: 'center', padding: '8px',
                    background: 'transparent', color: 'var(--text-disabled)', textDecoration: 'none', fontWeight: 600, fontSize: '10px',
                    border: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>@{c.ig}</a>}
                </div>
              );
            })()}

            {type === 'business' && (() => {
              const b = pin as BizPin;
              return (
                <div style={{ padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: 4, color: 'var(--text)' }}>{b.name}</div>
                  {b.type && <div style={{ color: 'var(--text-disabled)', fontSize: '11px', marginBottom: 10 }}>{b.type}</div>}
                  <span onClick={() => navigateInSidebar({ type: 'org-detail', orgId: b.id })} style={{ display: 'block', textAlign: 'center', padding: '8px',
                    background: 'var(--text)', color: 'var(--bg)', fontWeight: 600, fontSize: '10px',
                    border: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.5px', cursor: 'pointer' }}>VIEW PROFILE</span>
                </div>
              );
            })()}

            {type === 'marketplace' && (() => {
              const m = pin as MarketplacePin;
              const titleParts = [m.year, m.make, m.model].filter(Boolean).join(' ');
              const displayTitle = titleParts || m.title || 'FB Listing';
              return (
                <div>
                  {m.img && <a href={m.url} target="_blank" rel="noreferrer">
                    <img src={m.img} alt={displayTitle} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </a>}
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'inline-block', padding: '2px 6px', background: 'var(--surface)', color: '#4ADE80', fontSize: '9px', fontWeight: 600, marginBottom: 8, border: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      FB MARKETPLACE
                    </div>
                    <a href={m.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 700, fontSize: '14px', display: 'block', marginBottom: 4 }}>
                      {displayTitle}
                    </a>
                    {m.title !== displayTitle && <div style={{ color: 'var(--text-disabled)', fontSize: '10px', marginBottom: 6 }}>{m.title}</div>}
                    {m.price && <div style={{ color: '#4ade80', fontWeight: 700, fontSize: '18px', fontFamily: 'monospace', marginBottom: 8 }}>{fmtPrice(m.price)}</div>}
                    {m.loc && <div style={{ color: 'var(--text-disabled)', fontSize: '10px', marginBottom: 6 }}>{m.loc}</div>}
                    {m.seller && <div style={{ color: 'var(--text-disabled)', fontSize: '10px', marginBottom: 8 }}>Seller: {m.seller}</div>}
                    {m.description && <div style={{ color: 'var(--text-disabled)', fontSize: '10px', marginBottom: 12, lineHeight: 1.5, maxHeight: 100, overflow: 'hidden' }}>{m.description}</div>}
                    {m.scrapedAt && <div style={{ color: 'var(--text-disabled)', fontSize: '9px', marginBottom: 12 }}>Scraped: {new Date(m.scrapedAt).toLocaleString()}</div>}
                    <a href={m.url} target="_blank" rel="noreferrer" style={{
                      display: 'block', textAlign: 'center', padding: '8px',
                      background: 'var(--text)', color: 'var(--bg)', textDecoration: 'none',
                      fontWeight: 600, fontSize: '10px', border: '1px solid var(--border)',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>VIEW ON FACEBOOK</a>
                  </div>
                </div>
              );
            })()}

            {type === 'photo' && (() => {
              const p = pin as any;

              // ---- PHOTO HEX BIN aggregate panel ----
              if (p._isPhotoHexBin) {
                const pts = ((p._hexPoints || []) as any[]).map((pt: any) => pt.source || pt) as PhotoPin[];
                const count = pts.length;
                const withRealImage = pts.filter((ph: PhotoPin) => ph.hasRealImage).length;
                const placeholders = count - withRealImage;
                // Top vehicles by photo count
                const vehicleCounts: Record<string, { title: string; count: number; thumb: string | null }> = {};
                pts.forEach((ph: PhotoPin) => {
                  if (ph.vehicleId && ph.vehicleTitle) {
                    if (!vehicleCounts[ph.vehicleId]) vehicleCounts[ph.vehicleId] = { title: ph.vehicleTitle, count: 0, thumb: ph.vehicleThumb };
                    vehicleCounts[ph.vehicleId].count++;
                  }
                });
                const topVehicles = Object.entries(vehicleCounts).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
                // Thumb grid: up to 6 photos with real images
                const thumbPhotos = pts.filter((ph: PhotoPin) => ph.hasRealImage && ph.thumb).slice(0, 6);
                return (
                  <div style={{ padding: 0 }}>
                    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 4, fontWeight: 600 }}>PHOTO HEX BIN</div>
                      <div style={{ fontWeight: 700, fontSize: '22px', fontFamily: 'monospace', color: 'var(--text)' }}>{count.toLocaleString()}</div>
                      <div style={{ color: 'var(--text-disabled)', fontSize: '10px' }}>photos in this area</div>
                    </div>
                    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 6, fontWeight: 600 }}>IMAGE QUALITY</div>
                      <div style={{ display: 'flex', gap: 16, fontSize: '11px' }}>
                        <span style={{ color: '#4ade80' }}><strong>{withRealImage.toLocaleString()}</strong> real</span>
                        <span style={{ color: 'var(--text-disabled)' }}><strong>{placeholders.toLocaleString()}</strong> GPS-only</span>
                      </div>
                    </div>
                    {thumbPhotos.length > 0 && (
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 6, fontWeight: 600 }}>PHOTOS</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                          {thumbPhotos.map((ph: PhotoPin) => (
                            <img key={ph.id} src={ph.thumb!} alt="" onClick={() => setSelectedPin({ pin: ph, type: 'photo' })}
                              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', cursor: 'pointer', background: 'var(--surface)' }}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          ))}
                        </div>
                      </div>
                    )}
                    {topVehicles.length > 0 && (
                      <div style={{ padding: '10px 14px' }}>
                        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-disabled)', marginBottom: 6, fontWeight: 600 }}>TOP VEHICLES</div>
                        {topVehicles.map(([vid, info]) => (
                          <div key={vid} onClick={() => navigateInSidebar({ type: 'vehicle-detail', vehicleId: vid })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ fontSize: '10px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>{info.title}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-disabled)', flexShrink: 0 }}>{info.count} photos</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              // ---- Single photo panel (original) ----
              const imgSrc = p.hasRealImage ? (p.thumb || p.img) : p.vehicleThumb;
              return (
                <div>
                  {imgSrc && <img src={imgSrc} alt={p.vehicleTitle || 'Photo'} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block', background: 'var(--surface)' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                  {!imgSrc && p.vehicleTitle && (
                    <div style={{ width: '100%', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', color: 'var(--text-disabled)', fontSize: 12 }}>
                      No image available
                    </div>
                  )}
                  <div style={{ padding: '12px 14px' }}>
                    {p.vehicleTitle ? (
                      <span onClick={() => p.vehicleId && navigateInSidebar({ type: 'vehicle-detail', vehicleId: p.vehicleId })} style={{
                        color: 'var(--text)', fontWeight: 700, fontSize: '14px', display: 'block', marginBottom: 6,
                        lineHeight: 1.3, cursor: p.vehicleId ? 'pointer' : 'default',
                      }}>{p.vehicleTitle}</span>
                    ) : (
                      <div style={{ color: 'var(--text-disabled)', fontSize: '12px', marginBottom: 6 }}>Unlinked photo</div>
                    )}
                    <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginBottom: 10, lineHeight: 1.5 }}>
                      {p.locationName && <div>{p.locationName}</div>}
                      {p.takenLabel && <div style={{ color: 'var(--text-disabled)' }}>{p.takenLabel}{p.cameraModel ? ` \u00b7 ${p.cameraModel}` : ''}</div>}
                    </div>
                    {!p.hasRealImage && (
                      <div style={{ fontSize: '9px', color: 'var(--text-disabled)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        GPS LOCATION FROM APPLE PHOTOS
                      </div>
                    )}
                    {p.vehicleId && (
                      <span onClick={() => navigateInSidebar({ type: 'vehicle-detail', vehicleId: p.vehicleId })} style={{
                        display: 'block', textAlign: 'center', padding: '8px',
                        background: 'var(--text)', color: 'var(--bg)', cursor: 'pointer',
                        fontWeight: 600, fontSize: '10px', border: '1px solid var(--border)',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}>VIEW {(p.vehicleTitle.split(' ').slice(1, 3).join(' ') || 'VEHICLE').toUpperCase()}</span>
                    )}
                  </div>
                </div>
              );
            })()}
          </>);
          })()}
          </div>
        );
      })()}

      <style>{`
        .nuke-map-root, .nuke-map-root * {
          font-family: Arial, Helvetica, sans-serif !important;
        }
        .nuke-map-root input, .nuke-map-root button, .nuke-map-root select {
          font-family: Arial, Helvetica, sans-serif !important;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// --- Sub-components ---

function LT({ label, color, checked, set, n, dim, loading }: {
  label: string; color: string; checked: boolean; set: (v: boolean) => void; n: number; dim?: boolean; loading?: boolean;
}) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
      padding: '3px 0', opacity: dim ? 0.4 : 1, fontSize: '11px',
      fontFamily: MAP_FONT,
    }}>
      <input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} style={{ accentColor: color }} />
      <span style={{ width: 8, height: 8, background: color, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ color: 'var(--text)' }}>{label}</span>
      <span style={{ color: 'var(--text-disabled)', marginLeft: 'auto', fontSize: '10px', fontVariantNumeric: 'tabular-nums' }}>
        {loading ? <span style={{ color: color, animation: 'pulse 1.5s ease-in-out infinite' }}>...</span> : n.toLocaleString()}
      </span>
    </label>
  );
}

function SliderControl({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '10px', fontFamily: MAP_FONT }}>
      <span style={{ color: 'var(--text-disabled)', width: 50, textAlign: 'right', flexShrink: 0, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step || 1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          flex: 1, height: 2, WebkitAppearance: 'none' as any, appearance: 'none' as any,
          background: 'var(--border)', outline: 'none', cursor: 'pointer',
        }}
      />
      <span style={{ color: 'var(--text-disabled)', width: 24, fontSize: '9px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
