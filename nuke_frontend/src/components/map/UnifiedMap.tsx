import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';
import ZIP_DB from './us-zips.json';

// --- ZIP code geocoding (city-level accuracy) ---
const ZIPS: Record<string, [number, number]> = ZIP_DB as any;

// State abbreviations → full name for fallback matching
const ST_ABBR: Record<string, string> = {
  'al':'alabama','ak':'alaska','az':'arizona','ar':'arkansas','ca':'california',
  'co':'colorado','ct':'connecticut','de':'delaware','fl':'florida','ga':'georgia',
  'hi':'hawaii','id':'idaho','il':'illinois','in':'indiana','ia':'iowa',
  'ks':'kansas','ky':'kentucky','la':'louisiana','me':'maine','md':'maryland',
  'ma':'massachusetts','mi':'michigan','mn':'minnesota','ms':'mississippi','mo':'missouri',
  'mt':'montana','ne':'nebraska','nv':'nevada','nh':'new hampshire','nj':'new jersey',
  'nm':'new mexico','ny':'new york','nc':'north carolina','nd':'north dakota','oh':'ohio',
  'ok':'oklahoma','or':'oregon','pa':'pennsylvania','ri':'rhode island','sc':'south carolina',
  'sd':'south dakota','tn':'tennessee','tx':'texas','ut':'utah','vt':'vermont',
  'va':'virginia','wa':'washington','wv':'west virginia','wi':'wisconsin','wy':'wyoming',
  'dc':'district of columbia',
};

// State centroids — fallback only when ZIP + abbreviation both miss
const ST: Record<string, [number, number]> = {
  'alabama': [32.8, -86.8], 'alaska': [64.2, -152.5], 'arizona': [34.0, -111.1],
  'arkansas': [35.0, -92.4], 'california': [36.8, -119.4], 'colorado': [39.1, -105.4],
  'connecticut': [41.6, -72.7], 'delaware': [38.9, -75.5], 'florida': [27.8, -81.8],
  'georgia': [32.2, -83.4], 'hawaii': [19.9, -155.6], 'idaho': [44.1, -114.7],
  'illinois': [40.3, -89.0], 'indiana': [40.3, -86.1], 'iowa': [41.9, -93.1],
  'kansas': [38.5, -98.8], 'kentucky': [37.8, -84.3], 'louisiana': [30.5, -91.2],
  'maine': [45.3, -69.4], 'maryland': [39.0, -76.6], 'massachusetts': [42.4, -71.4],
  'michigan': [44.3, -85.6], 'minnesota': [46.7, -94.7], 'mississippi': [32.7, -89.7],
  'missouri': [38.5, -91.8], 'montana': [46.8, -110.4], 'nebraska': [41.1, -98.3],
  'nevada': [38.8, -116.4], 'new hampshire': [43.5, -71.5], 'new jersey': [40.1, -74.5],
  'new mexico': [34.2, -105.9], 'new york': [43.0, -75.5], 'north carolina': [35.6, -79.0],
  'north dakota': [47.5, -100.5], 'ohio': [40.4, -82.9], 'oklahoma': [35.0, -97.1],
  'oregon': [43.8, -120.6], 'pennsylvania': [41.2, -77.2], 'rhode island': [41.6, -71.5],
  'south carolina': [34.0, -81.0], 'south dakota': [43.9, -99.4], 'tennessee': [35.5, -86.6],
  'texas': [31.0, -100.0], 'utah': [39.3, -111.1], 'vermont': [44.6, -72.6],
  'virginia': [37.8, -78.2], 'washington': [47.8, -120.7], 'west virginia': [38.6, -80.6],
  'wisconsin': [43.8, -88.8], 'wyoming': [43.1, -107.6], 'district of columbia': [38.9, -77.0],
};

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function geo(loc: string): [number, number] | null {
  // 1) Try ZIP code — gives city-level accuracy
  const zipMatch = loc.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const coords = ZIPS[zipMatch[1]];
    if (coords) {
      // Tiny deterministic spread (±0.02° ≈ 2km) so same-ZIP vehicles don't stack
      const h = simpleHash(loc);
      const latOff = ((h & 0xff) / 255 - 0.5) * 0.04;
      const lngOff = (((h >> 8) & 0xff) / 255 - 0.5) * 0.04;
      return [coords[0] + latOff, coords[1] + lngOff];
    }
  }

  const l = loc.toLowerCase();

  // 2) Try state abbreviation match (e.g. "Phoenix, AZ")
  const abbrMatch = loc.match(/,\s*([A-Z]{2})\s*$/);
  if (abbrMatch) {
    const fullState = ST_ABBR[abbrMatch[1].toLowerCase()];
    if (fullState && ST[fullState]) {
      const c = ST[fullState];
      const h = simpleHash(loc);
      const latOff = ((h & 0xff) / 255 - 0.5) * 1.0;
      const lngOff = (((h >> 8) & 0xff) / 255 - 0.5) * 1.0;
      return [c[0] + latOff, c[1] + lngOff];
    }
  }

  // 3) Try full state name match — fallback with wider spread
  for (const [s, c] of Object.entries(ST)) {
    if (l.includes(s)) {
      const h = simpleHash(loc);
      const latOff = ((h & 0xff) / 255 - 0.5) * 1.5;
      const lngOff = (((h >> 8) & 0xff) / 255 - 0.5) * 1.5;
      return [c[0] + latOff, c[1] + lngOff];
    }
  }

  // 4) International — try known country patterns
  if (l.includes('canada')) return [45.4 + (simpleHash(loc) & 0xf) * 0.3, -75.7 - (simpleHash(loc) >> 4 & 0xf) * 0.5];
  if (l.includes('uk') || l.includes('england') || l.includes('london')) return [51.5, -0.1];
  if (l.includes('germany') || l.includes('deutschland')) return [50.1, 8.7];
  if (l.includes('netherlands') || l.includes('amsterdam')) return [52.4, 4.9];
  if (l.includes('japan') || l.includes('tokyo')) return [35.7, 139.7];
  if (l.includes('australia') || l.includes('sydney') || l.includes('melbourne')) return [-33.9, 151.2];
  if (l.includes('italy') || l.includes('roma') || l.includes('milan')) return [41.9, 12.5];
  if (l.includes('france') || l.includes('paris')) return [48.9, 2.3];
  if (l.includes('spain') || l.includes('madrid')) return [40.4, -3.7];
  if (l.includes('sweden') || l.includes('stockholm')) return [59.3, 18.1];
  if (l.includes('switzerland') || l.includes('zurich')) return [47.4, 8.5];

  return null;
}

// --- Country colors ---
const COUNTRY_COLORS: Record<string, [number, number, number]> = {
  'USA': [59, 130, 246], 'UK': [239, 68, 68], 'Italy': [34, 197, 94], 'Germany': [245, 158, 11],
  'France': [139, 92, 246], 'Monaco': [236, 72, 153], 'Switzerland': [20, 184, 166], 'Japan': [249, 115, 22],
  'UAE': [99, 102, 241], 'Australia': [251, 191, 36], 'Canada': [220, 38, 38], 'default': [236, 72, 153],
};
const colColor = (country: string): [number, number, number] => COUNTRY_COLORS[country] || COUNTRY_COLORS['default'];

// --- Vehicle fields for display ---
const BASE_FIELDS = 'id,year,make,model,trim,listing_location,bat_location,location,gps_latitude,gps_longitude,primary_image_url';
const RICH_FIELDS = `${BASE_FIELDS},sale_price,asking_price,current_value,nuke_estimate,mileage,color,interior_color,engine_type,engine_size,horsepower,transmission,drivetrain,body_style,condition_rating,deal_score,heat_score`;

function buildOr(q: string): string {
  const escaped = q.replace(/'/g, "''");
  return ['make', 'model', 'trim', 'color', 'interior_color', 'engine_type', 'engine_code',
    'transmission', 'drivetrain', 'body_style', 'tire_spec_front', 'tire_spec_rear',
    'modifications', 'description', 'title', 'vin',
  ].map(c => `${c}.ilike.%${escaped}%`).join(',');
}

// --- Pin types ---
interface VPin {
  id: string; year: number | null; make: string | null; model: string | null; trim: string | null;
  lat: number; lng: number; loc: string;
  img: string | null;
  price: number | null;
  mileage: number | null;
  color: string | null;
  intColor: string | null;
  engine: string | null;
  hp: number | null;
  trans: string | null;
  drive: string | null;
  body: string | null;
  condition: number | null;
  deal: number | null;
  heat: number | null;
  weight: number;
}

interface ColPin { id: string; name: string; slug: string; ig: string | null; country: string; city: string; lat: number; lng: number; totalInventory: number; }
interface BizPin { id: string; name: string; lat: number; lng: number; type: string | null; }

interface LiveEvent { id: string; lat: number; lng: number; ts: number; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pinFromRow(v: any): VPin | null {
  let lat: number, lng: number;
  const locStr = v.listing_location || v.bat_location || v.location || '';

  if (v.gps_latitude && v.gps_longitude) {
    lat = v.gps_latitude; lng = v.gps_longitude;
  } else if (locStr) {
    const coords = geo(locStr);
    if (!coords) return null;
    [lat, lng] = coords;
  } else {
    return null;
  }

  const price = v.sale_price || v.asking_price || v.current_value || v.nuke_estimate || null;

  return {
    id: v.id, year: v.year, make: v.make, model: v.model, trim: v.trim,
    lat, lng, loc: locStr,
    img: v.primary_image_url || null,
    price,
    mileage: v.mileage || null,
    color: v.color || null,
    intColor: v.interior_color || null,
    engine: v.engine_type || (v.engine_size ? `${v.engine_size}` : null),
    hp: v.horsepower || null,
    trans: v.transmission || null,
    drive: v.drivetrain || null,
    body: v.body_style || null,
    condition: v.condition_rating || null,
    deal: v.deal_score || null,
    heat: v.heat_score || null,
    weight: price ? Math.min(Math.max(price / 100000, 0.3), 3) : 1,
  };
}

// --- Helpers ---
const fmtPrice = (p: number) => '$' + p.toLocaleString();
const fmtMiles = (m: number) => m.toLocaleString() + ' mi';

function thumbUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.includes('/storage/v1/object/public/')) {
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=280&height=160&quality=80&resize=cover';
  }
  return url;
}

// --- Vehicle popup card ---
function VehicleCard({ v, accent }: { v: VPin; accent: string }) {
  const title = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
  const subtitle = [v.trim, v.body].filter(Boolean).join(' · ');
  const specs = [v.color, v.engine, v.hp ? `${v.hp}hp` : null, v.trans, v.drive].filter(Boolean);
  const thumb = thumbUrl(v.img);

  return (
    <div style={{ width: 260, fontFamily: 'Arial, sans-serif', fontSize: '11px', lineHeight: 1.4 }}>
      {thumb && (
        <a href={`/vehicle/${v.id}`}>
          <img
            src={thumb}
            alt={title}
            style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block', background: 'var(--surface)' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </a>
      )}
      <div style={{ padding: '6px 2px 2px' }}>
        <a href={`/vehicle/${v.id}`} style={{ color: accent, textDecoration: 'none', fontWeight: 700, fontSize: '12px', display: 'block' }}>
          {title}
        </a>
        {subtitle && <div style={{ color: 'var(--text-secondary)', fontSize: '10px', marginBottom: 2 }}>{subtitle}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 3, marginBottom: 3, alignItems: 'baseline' }}>
          {v.price && <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '13px', fontFamily: 'monospace' }}>{fmtPrice(v.price)}</span>}
          {v.mileage && <span style={{ color: 'var(--text-disabled)', fontSize: '10px' }}>{fmtMiles(v.mileage)}</span>}
        </div>
        {specs.length > 0 && (
          <div style={{ color: 'var(--text-disabled)', fontSize: '10px', marginBottom: 3 }}>
            {specs.join(' · ')}
          </div>
        )}
        {v.intColor && <div style={{ color: 'var(--text-disabled)', fontSize: '10px' }}>Int: {v.intColor}</div>}
        {(v.deal || v.heat || v.condition) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: '10px' }}>
            {v.deal != null && <span style={{ color: v.deal >= 70 ? '#4ade80' : v.deal >= 40 ? '#facc15' : '#f87171' }}>Deal: {v.deal}</span>}
            {v.heat != null && <span style={{ color: '#f97316' }}>Heat: {v.heat}</span>}
            {v.condition != null && <span style={{ color: '#60a5fa' }}>Cond: {v.condition}/10</span>}
          </div>
        )}
        {v.loc && <div style={{ color: 'var(--text-disabled)', fontSize: '9px', marginTop: 3 }}>{v.loc}</div>}
      </div>
    </div>
  );
}

// ===========================================
// MAIN COMPONENT
// ===========================================

const INITIAL_VIEW = { longitude: -98, latitude: 39, zoom: 4.5, pitch: 0, bearing: 0 };

const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

export default function UnifiedMap() {
  const [showCollections, setShowCollections] = useState(true);
  const [showVehicles, setShowVehicles] = useState(true);
  const [showBusinesses, setShowBusinesses] = useState(true);

  const [collections, setCollections] = useState<ColPin[]>([]);
  const [vehicles, setVehicles] = useState<VPin[]>([]);
  const [businesses, setBiz] = useState<BizPin[]>([]);
  const [vehLoading, setVehLoading] = useState(true);

  const [searchText, setSearchText] = useState('');
  const [queryResults, setQueryResults] = useState<VPin[]>([]);
  const [queryNoLoc, setQueryNoLoc] = useState<{ id: string; title: string; loc: string }[]>([]);
  const [queryTotal, setQueryTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');

  // deck.gl viewState
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  // Popup / hover state
  const [popup, setPopup] = useState<{ x: number; y: number; pin: VPin | ColPin | BizPin; type: 'vehicle' | 'collection' | 'business' } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; text: string } | null>(null);

  // Slider controls — defaults tuned so data is visible immediately at zoom 4.5
  const [glowRadius, setGlowRadius] = useState(60);
  const [glowIntensity, setGlowIntensity] = useState(25);
  const [pointSize, setPointSize] = useState(4);
  const [mode, setMode] = useState<'density' | 'points'>('density');
  const [controlsOpen, setControlsOpen] = useState(false);

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
      .not('latitude', 'is', null).not('longitude', 'is', null).limit(1000)
      .then(({ data }) => {
        if (data) setBiz(data.map((b: any) => ({ id: b.id, name: b.business_name || 'Business', lat: b.latitude, lng: b.longitude, type: b.entity_type })));
      });
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
          q = q.order('id', { ascending: true }).limit(1000);
          const { data, error } = await q;
          if (error) { console.warn('Vehicle fetch error:', error.message); break; }
          if (!data || data.length === 0) break;
          addRows(data);
          lastId = data[data.length - 1].id;
          fetched += data.length;
          batchesSinceRender++;

          // Progressive render: first batch immediately, then every 3 batches (3k rows)
          if (batchesSinceRender === 1 || batchesSinceRender % 3 === 0) {
            if (!cancelled) setVehicles([...all]);
          }
        }
      };

      // 1) listing_location vehicles — up to 80k
      await paginate(
        (q: any) => q.not('listing_location', 'is', null),
        80000,
      );
      if (!cancelled) setVehicles([...all]);

      // 2) bat_location vehicles (no listing_location)
      await paginate(
        (q: any) => q.is('listing_location', null).not('bat_location', 'is', null).neq('bat_location', 'United States'),
        10000,
      );
      if (!cancelled) setVehicles([...all]);

      // 3) GPS coord vehicles
      await paginate(
        (q: any) => q.not('gps_latitude', 'is', null).not('gps_longitude', 'is', null),
        5000,
      );

      if (!cancelled) {
        setVehicles([...all]);
        setVehLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
        if (rest) query = query.or(buildOr(rest));
      } else {
        query = query.or(buildOr(q));
      }

      const { data, count } = await query.limit(3000);
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
        setViewState(vs => ({ ...vs, latitude: avgLat, longitude: avgLng, zoom: 5 }));
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

  const counts = useMemo(() => ({
    collections: collections.length,
    vehicles: vehicles.length,
    businesses: businesses.length,
    query: queryResults.length,
    total: (showCollections && !hasQuery ? collections.length : 0)
         + (showVehicles && !hasQuery ? vehicles.length : 0)
         + (showBusinesses && !hasQuery ? businesses.length : 0)
         + queryResults.length,
  }), [showCollections, showVehicles, showBusinesses, collections, vehicles, businesses, queryResults, hasQuery]);

  // --- deck.gl layers ---
  const zoom = viewState.zoom;

  const layers = useMemo(() => {
    const result: any[] = [];
    const now = Date.now();

    // Zoom-proportional sizing: visible at z4, grows smoothly to large at z15
    // At z4.5 (default): zoomScale≈1.1, points are ~2px, glow is ~8px — clearly visible
    // At z8: zoomScale≈2.5, points are ~5px, glow is ~20px — easily clickable
    // At z12: zoomScale≈6.3, points are ~12px, glow is ~50px — large and detailed
    const zoomScale = Math.pow(2, (zoom - 4) / 3); // doubles every 3 zoom levels, 1.0 at z4
    const ptMin = Math.max(1.5, pointSize * 0.5 * zoomScale);
    const ptMax = Math.max(4, pointSize * 3 * zoomScale);
    const glowMin = Math.max(6, glowRadius * 0.15 * zoomScale);
    const glowMax = Math.max(15, glowRadius * 1.2 * zoomScale);

    const showGlow = mode === 'density';
    const vehColor: [number, number, number] = hasQuery ? [245, 158, 11] : [59, 130, 246];
    const glowAlpha = Math.max(0, Math.min(255, glowIntensity));

    // Glow fades as you zoom in past z12 (data separates naturally), but never fully disappears
    const glowFade = showGlow ? Math.max(0.15, Math.min(1, (14 - zoom) / 8)) : 0;

    // --- Vehicle Glow ---
    if (showVehicles && !hasQuery && glowFade > 0) {
      result.push(new ScatterplotLayer({
        id: 'vehicle-glow',
        data: vehicles,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getRadius: (d: VPin) => d.weight * 800,
        getFillColor: [...vehColor, glowAlpha] as [number, number, number, number],
        radiusMinPixels: glowMin,
        radiusMaxPixels: glowMax,
        opacity: glowFade,
        pickable: false,
        updateTriggers: { getFillColor: [glowAlpha], radiusMinPixels: [glowMin], radiusMaxPixels: [glowMax] },
      }));
    }

    // --- Vehicle Points — always pickable, always clickable ---
    if (showVehicles && !hasQuery) {
      result.push(new ScatterplotLayer({
        id: 'vehicle-points',
        data: vehicles,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getRadius: 50,
        getFillColor: [...vehColor, 200] as [number, number, number, number],
        radiusMinPixels: ptMin,
        radiusMaxPixels: ptMax,
        pickable: true,
        onClick: ({ object, x, y }: any) => {
          if (object) setPopup({ x, y, pin: object, type: 'vehicle' });
        },
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const t = [object.year, object.make, object.model].filter(Boolean).join(' ');
            const price = object.price ? ' · ' + fmtPrice(object.price) : '';
            setHoverInfo({ x, y, text: (t || 'Vehicle') + price });
          } else {
            setHoverInfo(null);
          }
        },
        updateTriggers: { radiusMinPixels: [ptMin], radiusMaxPixels: [ptMax] },
      }));
    }

    // --- Query Glow ---
    if (hasQuery && queryResults.length > 0 && glowFade > 0) {
      result.push(new ScatterplotLayer({
        id: 'query-glow',
        data: queryResults,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getRadius: (d: VPin) => d.weight * 800,
        getFillColor: [245, 158, 11, glowAlpha] as [number, number, number, number],
        radiusMinPixels: glowMin,
        radiusMaxPixels: glowMax,
        opacity: glowFade,
        pickable: false,
      }));
    }

    // --- Query Points ---
    if (hasQuery && queryResults.length > 0) {
      result.push(new ScatterplotLayer({
        id: 'query-points',
        data: queryResults,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getRadius: 80,
        getFillColor: [245, 158, 11, 220] as [number, number, number, number],
        radiusMinPixels: ptMin * 1.2,
        radiusMaxPixels: ptMax * 1.5,
        pickable: true,
        onClick: ({ object, x, y }: any) => {
          if (object) setPopup({ x, y, pin: object, type: 'vehicle' });
        },
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

    // Collections + Businesses — larger than vehicle dots, always prominent
    const colPtMin = Math.max(4, 3 * zoomScale);
    const colPtMax = Math.max(8, 12 * zoomScale);
    const colGlowMin = Math.max(8, 12 * zoomScale);
    const colGlowMax = Math.max(20, 40 * zoomScale);

    // --- Collection Glow ---
    if (showCollections && !hasQuery && showGlow) {
      result.push(new ScatterplotLayer({
        id: 'collection-glow',
        data: collections,
        getPosition: (d: ColPin) => [d.lng, d.lat],
        getRadius: 600,
        getFillColor: (d: ColPin) => [...colColor(d.country), glowAlpha * 0.8] as [number, number, number, number],
        radiusMinPixels: colGlowMin,
        radiusMaxPixels: colGlowMax,
        opacity: glowFade * 0.8,
        pickable: false,
      }));
    }

    // --- Collection Points ---
    if (showCollections && !hasQuery) {
      result.push(new ScatterplotLayer({
        id: 'collection-points',
        data: collections,
        getPosition: (d: ColPin) => [d.lng, d.lat],
        getRadius: 50,
        getFillColor: (d: ColPin) => [...colColor(d.country), 220] as [number, number, number, number],
        radiusMinPixels: colPtMin,
        radiusMaxPixels: colPtMax,
        pickable: true,
        onClick: ({ object, x, y }: any) => {
          if (object) setPopup({ x, y, pin: object, type: 'collection' });
        },
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const inv = object.totalInventory ? ` (${object.totalInventory})` : '';
            setHoverInfo({ x, y, text: object.name + inv });
          }
          else setHoverInfo(null);
        },
      }));
    }

    // --- Business Glow ---
    if (showBusinesses && !hasQuery && showGlow) {
      result.push(new ScatterplotLayer({
        id: 'business-glow',
        data: businesses,
        getPosition: (d: BizPin) => [d.lng, d.lat],
        getRadius: 500,
        getFillColor: [20, 184, 166, glowAlpha * 0.6] as [number, number, number, number],
        radiusMinPixels: colGlowMin * 0.7,
        radiusMaxPixels: colGlowMax * 0.7,
        opacity: glowFade * 0.6,
        pickable: false,
      }));
    }

    // --- Business Points ---
    if (showBusinesses && !hasQuery) {
      result.push(new ScatterplotLayer({
        id: 'business-points',
        data: businesses,
        getPosition: (d: BizPin) => [d.lng, d.lat],
        getRadius: 50,
        getFillColor: [20, 184, 166, 200] as [number, number, number, number],
        radiusMinPixels: colPtMin * 0.8,
        radiusMaxPixels: colPtMax * 0.8,
        pickable: true,
        onClick: ({ object, x, y }: any) => {
          if (object) setPopup({ x, y, pin: object, type: 'business' });
        },
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const t = object.type ? ` · ${object.type}` : '';
            setHoverInfo({ x, y, text: object.name + t });
          }
          else setHoverInfo(null);
        },
      }));
    }

    // --- Live Event Rings (animated) ---
    const liveEvents = liveEventsRef.current.filter(e => now - e.ts < 2500);
    if (liveEvents.length > 0) {
      // Expanding ring
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

      // Center dot
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
  }, [vehicles, collections, businesses, queryResults, showVehicles, showCollections, showBusinesses,
      hasQuery, zoom, mode, glowRadius, glowIntensity, pointSize, tick]);

  // --- Render popup content ---
  const renderPopup = () => {
    if (!popup) return null;
    const { x, y, pin, type } = popup;

    // Position popup near click, clamped to viewport
    const left = Math.min(x + 8, window.innerWidth - 300);
    const top = Math.max(8, Math.min(y - 20, window.innerHeight - 360));

    return (
      <div
        style={{
          position: 'absolute', left, top, zIndex: 2000,
          background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,.6)', maxWidth: 280,
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setPopup(null)}
          style={{
            position: 'absolute', top: 6, right: 8, background: 'rgba(255,255,255,0.1)',
            border: 'none', color: '#999', cursor: 'pointer',
            fontSize: '12px', lineHeight: 1, padding: '2px 6px', borderRadius: 4,
            zIndex: 1,
          }}
        >
          x
        </button>
        {type === 'vehicle' && <VehicleCard v={pin as VPin} accent={hasQuery ? '#F59E0B' : '#3B82F6'} />}
        {type === 'collection' && (() => {
          const c = pin as ColPin;
          return (
            <div style={{ padding: 12, fontSize: '12px', lineHeight: 1.5, color: '#e0e0e0' }}>
              <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: 4, color: '#fff' }}>{c.name}</div>
              <div style={{ color: '#999', fontSize: '11px', marginBottom: 6 }}>{c.city}, {c.country}</div>
              {c.totalInventory > 0 && <div style={{ color: '#3B82F6', fontWeight: 600, marginBottom: 6 }}>{c.totalInventory} vehicles</div>}
              <a href={`/org/${c.slug}`} style={{ color: '#3B82F6', textDecoration: 'none', fontWeight: 600, fontSize: '11px' }}>View collection</a>
              {c.ig && <> &middot; <a href={`https://instagram.com/${c.ig}`} target="_blank" rel="noreferrer" style={{ color: '#EC4899', textDecoration: 'none', fontSize: '11px' }}>@{c.ig}</a></>}
            </div>
          );
        })()}
        {type === 'business' && (() => {
          const b = pin as BizPin;
          return (
            <div style={{ padding: 12, fontSize: '12px', lineHeight: 1.5, color: '#e0e0e0' }}>
              <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: 4, color: '#fff' }}>{b.name}</div>
              {b.type && <div style={{ color: '#999', fontSize: '11px', marginBottom: 6 }}>{b.type}</div>}
              <a href={`/org/${b.id}`} style={{ color: '#14B8A6', textDecoration: 'none', fontWeight: 600, fontSize: '11px' }}>View profile</a>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, flex: 1, background: '#0d1117' }} onClick={() => setPopup(null)}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <DeckGL
          viewState={viewState}
          onViewStateChange={({ viewState: vs }: any) => setViewState(vs)}
          controller={true}
          layers={layers}
          getCursor={({ isHovering }: { isHovering: boolean }) => isHovering ? 'pointer' : 'grab'}
          style={{ position: 'absolute', inset: 0 }}
        >
          <Map mapStyle={CARTO_DARK} attributionControl={false} />
        </DeckGL>
      </div>

      {/* Loading overlay — shows while vehicles stream in */}
      {vehLoading && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1100,
          background: 'rgba(13,17,23,0.9)', border: '1px solid rgba(59,130,246,0.3)',
          borderRadius: 8, padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: '#3B82F6',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
          <span style={{ color: '#e0e0e0', fontSize: '12px', fontWeight: 500, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            Loading {vehicles.length.toLocaleString()} vehicles...
          </span>
        </div>
      )}

      {/* Hover tooltip */}
      {hoverInfo && (
        <div style={{
          position: 'absolute', left: hoverInfo.x + 14, top: hoverInfo.y - 24, zIndex: 1500,
          background: 'rgba(13,17,23,.92)', color: '#fff', padding: '5px 10px',
          fontSize: '11px', fontFamily: 'system-ui, -apple-system, sans-serif', pointerEvents: 'none',
          whiteSpace: 'nowrap', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(4px)',
        }}>
          {hoverInfo.text}
        </div>
      )}

      {/* Popup */}
      {renderPopup()}

      {/* Search bar — top left */}
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="Search: red porsche, 1966 mustang, v8 swap..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{
              width: 300, padding: '8px 12px', fontSize: '12px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
              background: 'rgba(13,17,23,0.85)', color: '#e0e0e0',
              backdropFilter: 'blur(8px)', outline: 'none',
            }}
          />
          <button
            onClick={handleSearch} disabled={searching}
            style={{
              padding: '8px 16px', fontSize: '12px', fontWeight: 600,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              background: searching ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.8)',
              color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            {searching ? '...' : 'Search'}
          </button>
          {activeQuery && (
            <button
              onClick={clearSearch}
              style={{
                padding: '8px 12px', fontSize: '12px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                background: 'rgba(255,255,255,0.08)', color: '#999',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>
        {activeQuery && !searching && (
          <div style={{
            background: 'rgba(13,17,23,0.9)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 6, padding: '6px 12px', fontSize: '11px', color: '#999',
            fontFamily: 'system-ui, -apple-system, sans-serif', backdropFilter: 'blur(8px)',
          }}>
            <strong style={{ color: '#F59E0B' }}>{queryTotal.toLocaleString()}</strong> match &ldquo;{activeQuery}&rdquo; &mdash; <strong style={{ color: '#e0e0e0' }}>{queryResults.length.toLocaleString()}</strong> mapped
            {queryNoLoc.length > 0 && <span style={{ color: '#666' }}> &middot; {queryNoLoc.length.toLocaleString()} no location</span>}
          </div>
        )}
      </div>

      {/* Controls panel — bottom right, collapsible */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12, zIndex: 1000,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* Collapsed state: just a button */}
        {!controlsOpen && (
          <button
            onClick={(e) => { e.stopPropagation(); setControlsOpen(true); }}
            style={{
              background: 'rgba(13,17,23,0.85)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8, padding: '8px 14px', color: '#e0e0e0', cursor: 'pointer',
              fontSize: '11px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
              backdropFilter: 'blur(8px)',
            }}
          >
            <span style={{ fontSize: '14px' }}>&#9881;</span>
            <span>
              <span style={{ color: '#3B82F6' }}>{counts.vehicles.toLocaleString()}</span>
              {' / '}
              <span style={{ color: '#EC4899' }}>{counts.collections.toLocaleString()}</span>
              {' / '}
              <span style={{ color: '#14B8A6' }}>{counts.businesses.toLocaleString()}</span>
            </span>
          </button>
        )}

        {/* Expanded panel */}
        {controlsOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'rgba(13,17,23,0.92)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, padding: 14, minWidth: 200, backdropFilter: 'blur(12px)',
              color: '#e0e0e0', fontSize: '12px',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#999' }}>Layers</span>
              <button
                onClick={() => setControlsOpen(false)}
                style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px', padding: '0 2px' }}
              >
                x
              </button>
            </div>

            {/* Layer toggles */}
            <LT label="Vehicles" color="#3B82F6" checked={showVehicles} set={setShowVehicles} n={counts.vehicles} dim={hasQuery} loading={vehLoading} />
            <LT label="Collections" color="#EC4899" checked={showCollections} set={setShowCollections} n={counts.collections} dim={hasQuery} />
            <LT label="Businesses" color="#14B8A6" checked={showBusinesses} set={setShowBusinesses} n={counts.businesses} dim={hasQuery} />
            {activeQuery && <>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '6px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
                <span style={{ color: '#F59E0B', fontWeight: 600 }}>Query results</span>
                <span style={{ color: '#F59E0B', marginLeft: 'auto' }}>{counts.query.toLocaleString()}</span>
              </div>
            </>}

            {/* Display mode */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '8px 0 6px' }} />
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              <button
                onClick={() => setMode('density')}
                style={{
                  flex: 1, padding: '5px 0', fontSize: '11px', fontWeight: mode === 'density' ? 600 : 400,
                  background: mode === 'density' ? 'rgba(59,130,246,0.2)' : 'transparent',
                  color: mode === 'density' ? '#3B82F6' : '#666',
                  border: `1px solid ${mode === 'density' ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 5, cursor: 'pointer',
                }}
              >
                Glow + Points
              </button>
              <button
                onClick={() => setMode('points')}
                style={{
                  flex: 1, padding: '5px 0', fontSize: '11px', fontWeight: mode === 'points' ? 600 : 400,
                  background: mode === 'points' ? 'rgba(59,130,246,0.2)' : 'transparent',
                  color: mode === 'points' ? '#3B82F6' : '#666',
                  border: `1px solid ${mode === 'points' ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 5, cursor: 'pointer',
                }}
              >
                Points Only
              </button>
            </div>

            {/* Sliders */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <SliderControl label="Size" value={pointSize} min={1} max={10} step={0.5} onChange={setPointSize} />
              {mode === 'density' && <>
                <SliderControl label="Glow" value={glowRadius} min={10} max={100} onChange={setGlowRadius} />
                <SliderControl label="Brightness" value={glowIntensity} min={5} max={50} onChange={setGlowIntensity} />
              </>}
            </div>
          </div>
        )}
      </div>

      {/* Stats bar — bottom left */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 1000,
        background: 'rgba(13,17,23,0.85)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6, padding: '6px 12px', fontSize: '11px', color: '#999',
        fontFamily: 'system-ui, -apple-system, sans-serif', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {vehLoading && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3B82F6', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />}
        {hasQuery
          ? <><strong style={{ color: '#F59E0B' }}>{counts.query.toLocaleString()}</strong> mapped / {queryTotal.toLocaleString()} total</>
          : <><strong style={{ color: '#e0e0e0' }}>{counts.total.toLocaleString()}</strong> items on map</>}
      </div>

      {/* Unmapped sidebar */}
      {queryNoLoc.length > 0 && (
        <div style={{
          position: 'absolute', top: 70, left: 12, zIndex: 1000, width: 300, maxHeight: '45vh',
          overflowY: 'auto', background: 'rgba(13,17,23,0.92)', borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.1)', fontSize: '12px',
          fontFamily: 'system-ui, -apple-system, sans-serif', color: '#e0e0e0',
          backdropFilter: 'blur(12px)',
        }}>
          <div style={{
            padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)',
            color: '#999', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px',
            fontWeight: 600, position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)',
          }}>
            No location ({queryNoLoc.length})
          </div>
          {queryNoLoc.slice(0, 50).map(r => (
            <a key={r.id} href={`/vehicle/${r.id}`} style={{
              display: 'block', padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
              textDecoration: 'none', color: '#e0e0e0', fontSize: '11px',
            }}>
              {r.title}
              {r.loc && <span style={{ color: '#666', marginLeft: 8, fontSize: '10px' }}>{r.loc}</span>}
            </a>
          ))}
          {queryNoLoc.length > 50 && <div style={{ padding: '6px 12px', color: '#666', fontSize: '10px' }}>+{queryNoLoc.length - 50} more</div>}
        </div>
      )}

      {/* CSS animations */}
      <style>{`
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
      display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
      padding: '4px 0', opacity: dim ? 0.4 : 1, fontSize: '12px',
    }}>
      <input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} style={{ accentColor: color }} />
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ color: '#e0e0e0' }}>{label}</span>
      <span style={{ color: '#666', marginLeft: 'auto', fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
        {loading ? <span style={{ color: color, animation: 'pulse 1.5s ease-in-out infinite' }}>loading</span> : n.toLocaleString()}
      </span>
    </label>
  );
}

function SliderControl({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '11px' }}>
      <span style={{ color: '#999', width: 56, textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step || 1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          flex: 1, height: 4, WebkitAppearance: 'none' as any, appearance: 'none' as any,
          background: 'rgba(255,255,255,0.15)', outline: 'none', cursor: 'pointer',
          borderRadius: 2,
        }}
      />
      <span style={{ color: '#666', width: 28, fontSize: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
