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
const RICH_FIELDS = `${BASE_FIELDS},sale_price,asking_price,current_value,nuke_estimate,mileage,color,interior_color,engine_type,engine_size,horsepower,transmission,drivetrain,body_style,condition_rating,deal_score,heat_score,created_at,bat_sale_date,auction_end_date`;

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
  dateTs: number; // epoch ms — for timeline filtering
  dateLabel: string; // "Mar 2024" for display
}

interface ColPin { id: string; name: string; slug: string; ig: string | null; country: string; city: string; lat: number; lng: number; totalInventory: number; }
interface BizPin { id: string; name: string; lat: number; lng: number; type: string | null; }

interface PhotoPin {
  id: string;
  lat: number;
  lng: number;
  img: string;
  thumb: string | null;
  hasRealImage: boolean;       // false for placeholder.nuke.app URLs
  vehicleId: string | null;
  vehicleTitle: string;
  vehicleThumb: string | null; // primary image of the linked vehicle
  locationName: string | null;
  takenAt: string | null;
  takenLabel: string;
  source: string;
  cameraModel: string | null;
}

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
  const dateStr = v.bat_sale_date || v.auction_end_date || v.created_at || null;
  const dateTs = dateStr ? new Date(dateStr).getTime() : 0;
  const d = dateStr ? new Date(dateStr) : null;
  const dateLabel = d ? `${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}` : '';

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
    dateTs,
    dateLabel,
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
  const [showPhotos, setShowPhotos] = useState(true);

  const [collections, setCollections] = useState<ColPin[]>([]);
  const [vehicles, setVehicles] = useState<VPin[]>([]);
  const [businesses, setBiz] = useState<BizPin[]>([]);
  const [photos, setPhotos] = useState<PhotoPin[]>([]);
  const [vehLoading, setVehLoading] = useState(true);

  const [searchText, setSearchText] = useState('');
  const [queryResults, setQueryResults] = useState<VPin[]>([]);
  const [queryNoLoc, setQueryNoLoc] = useState<{ id: string; title: string; loc: string }[]>([]);
  const [queryTotal, setQueryTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');

  // deck.gl viewState
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  // Side panel popup (replaces floating popup that overlapped data)
  const [selectedPin, setSelectedPin] = useState<{ pin: VPin | ColPin | BizPin | PhotoPin; type: 'vehicle' | 'collection' | 'business' | 'photo' } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; text: string } | null>(null);

  // Slider controls — defaults tuned so data is visible immediately at zoom 4.5
  const [glowRadius, setGlowRadius] = useState(60);
  const [glowIntensity, setGlowIntensity] = useState(25);
  const [pointSize, setPointSize] = useState(4);
  const [mode, setMode] = useState<'density' | 'points'>('density');
  const [controlsOpen, setControlsOpen] = useState(false);

  // Timeline — filter vehicles by date
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [timeCutoff, setTimeCutoff] = useState(100); // 0-100 percentage of date range

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

  // ---- Load GPS-tagged photos ----
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('vehicle_images')
        .select('id, latitude, longitude, image_url, thumbnail_url, vehicle_id, location_name, taken_at, source, exif_data')
        .not('latitude', 'is', null).not('longitude', 'is', null)
        .order('taken_at', { ascending: false })
        .limit(15000);
      if (!data) return;

      // Get vehicle titles + primary images for linked photos
      const vehicleIds = [...new Set(data.map(d => d.vehicle_id).filter(Boolean))];
      const vehicleInfo: Record<string, { title: string; thumb: string | null }> = {};
      if (vehicleIds.length > 0) {
        // Fetch in batches of 200 (Supabase .in() limit)
        for (let i = 0; i < vehicleIds.length; i += 200) {
          const batch = vehicleIds.slice(i, i + 200);
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
      }

      setPhotos(data.map(d => {
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
      }));
    })();
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

  // --- Timeline: compute date range and filter ---
  const timelineRange = useMemo(() => {
    if (vehicles.length === 0) return { min: 0, max: Date.now(), minLabel: '', maxLabel: '' };
    const dates = vehicles.filter(v => v.dateTs > 0).map(v => v.dateTs);
    if (dates.length === 0) return { min: 0, max: Date.now(), minLabel: '', maxLabel: '' };
    const mn = Math.min(...dates.slice(0, 10000)); // avoid perf hit on huge arrays
    const mx = Math.max(...dates.slice(-10000));
    // Scan in chunks for accuracy on large datasets
    let realMin = mn, realMax = mx;
    for (let i = 0; i < dates.length; i += 100) {
      if (dates[i] < realMin) realMin = dates[i];
      if (dates[i] > realMax) realMax = dates[i];
    }
    const fmtD = (ts: number) => {
      const d = new Date(ts);
      return `${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}`;
    };
    return { min: realMin, max: realMax, minLabel: fmtD(realMin), maxLabel: fmtD(realMax) };
  }, [vehicles]);

  const filteredVehicles = useMemo(() => {
    if (!timelineEnabled || timeCutoff >= 100) return vehicles;
    const range = timelineRange.max - timelineRange.min;
    const cutoffTs = timelineRange.min + (range * timeCutoff / 100);
    return vehicles.filter(v => v.dateTs <= cutoffTs);
  }, [vehicles, timelineEnabled, timeCutoff, timelineRange]);

  const cutoffLabel = useMemo(() => {
    if (!timelineEnabled || timeCutoff >= 100) return timelineRange.maxLabel;
    const range = timelineRange.max - timelineRange.min;
    const cutoffTs = timelineRange.min + (range * timeCutoff / 100);
    const d = new Date(cutoffTs);
    return `${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}`;
  }, [timelineEnabled, timeCutoff, timelineRange]);

  const counts = useMemo(() => {
    const vehCount = filteredVehicles.length;
    return {
      collections: collections.length,
      vehicles: vehCount,
      businesses: businesses.length,
      photos: photos.length,
      query: queryResults.length,
      total: (showCollections && !hasQuery ? collections.length : 0)
           + (showVehicles && !hasQuery ? vehCount : 0)
           + (showBusinesses && !hasQuery ? businesses.length : 0)
           + (showPhotos && !hasQuery ? photos.length : 0)
           + queryResults.length,
    };
  }, [showCollections, showVehicles, showBusinesses, showPhotos, collections, filteredVehicles, businesses, photos, queryResults, hasQuery]);

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
        data: filteredVehicles,
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
        data: filteredVehicles,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getRadius: 50,
        getFillColor: [...vehColor, 200] as [number, number, number, number],
        radiusMinPixels: ptMin,
        radiusMaxPixels: ptMax,
        pickable: true,
        onClick: ({ object, x, y }: any) => {
          if (object) setSelectedPin({ pin: object, type: 'vehicle' });
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
          if (object) setSelectedPin({ pin: object, type: 'vehicle' });
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
          if (object) setSelectedPin({ pin: object, type: 'collection' });
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
          if (object) setSelectedPin({ pin: object, type: 'business' });
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

    // --- Photo Glow (magenta) ---
    if (showPhotos && !hasQuery && photos.length > 0 && glowFade > 0) {
      result.push(new ScatterplotLayer({
        id: 'photo-glow',
        data: photos,
        getPosition: (d: PhotoPin) => [d.lng, d.lat],
        getRadius: 400,
        getFillColor: [217, 70, 239, Math.round(glowAlpha * 0.7)] as [number, number, number, number],
        radiusMinPixels: Math.max(8, 10 * zoomScale),
        radiusMaxPixels: Math.max(20, 35 * zoomScale),
        opacity: glowFade * 0.7,
        pickable: false,
      }));
    }

    // --- Photo Points (magenta dots, pickable) ---
    if (showPhotos && !hasQuery && photos.length > 0) {
      result.push(new ScatterplotLayer({
        id: 'photo-points',
        data: photos,
        getPosition: (d: PhotoPin) => [d.lng, d.lat],
        getRadius: (d: PhotoPin) => d.hasRealImage ? 60 : 40,
        getFillColor: (d: PhotoPin) => d.hasRealImage
          ? [217, 70, 239, 230] as [number, number, number, number]
          : [217, 70, 239, 120] as [number, number, number, number],
        radiusMinPixels: Math.max(3, ptMin * 1.2),
        radiusMaxPixels: Math.max(6, ptMax * 1.2),
        pickable: true,
        onClick: ({ object }: any) => {
          if (object) setSelectedPin({ pin: object, type: 'photo' as any });
        },
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const label = object.vehicleTitle || 'Photo';
            const loc = object.locationName ? ` · ${object.locationName.split(',')[0]}` : '';
            const date = object.takenLabel ? ` · ${object.takenLabel}` : '';
            setHoverInfo({ x, y, text: `📷 ${label}${loc}${date}` });
          } else {
            setHoverInfo(null);
          }
        },
        updateTriggers: { radiusMinPixels: [ptMin], radiusMaxPixels: [ptMax] },
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
  }, [filteredVehicles, collections, businesses, photos, queryResults, showVehicles, showCollections, showBusinesses,
      showPhotos, hasQuery, zoom, mode, glowRadius, glowIntensity, pointSize, tick]);

  const panelW = 320; // side panel width
  const hasSidePanel = selectedPin !== null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, flex: 1, background: '#0d1117', display: 'flex' }}
      onClick={() => setSelectedPin(null)}>

      {/* Map area — shrinks when side panel is open */}
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
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

        {/* Loading overlay */}
        {vehLoading && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1100,
            background: 'rgba(13,17,23,0.9)', border: '1px solid rgba(59,130,246,0.3)',
            borderRadius: 8, padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10,
            backdropFilter: 'blur(8px)',
          }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B82F6', animation: 'pulse 1.5s ease-in-out infinite' }} />
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
          }}>
            {hoverInfo.text}
          </div>
        )}

        {/* Search bar — top left */}
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="text" placeholder="Search: red porsche, 1966 mustang, v8 swap..."
              value={searchText} onChange={e => setSearchText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              style={{ width: 280, padding: '8px 12px', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6,
                background: 'rgba(13,17,23,0.85)', color: '#e0e0e0', outline: 'none' }}
            />
            <button onClick={handleSearch} disabled={searching}
              style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 600, fontFamily: 'system-ui, sans-serif',
                background: searching ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.8)',
                color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              {searching ? '...' : 'Search'}
            </button>
            {activeQuery && (
              <button onClick={clearSearch} style={{ padding: '8px 12px', fontSize: '12px', fontFamily: 'system-ui, sans-serif',
                background: 'rgba(255,255,255,0.08)', color: '#999', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer' }}>
                Clear
              </button>
            )}
          </div>
          {activeQuery && !searching && (
            <div style={{ background: 'rgba(13,17,23,0.9)', border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 6, padding: '6px 12px', fontSize: '11px', color: '#999', fontFamily: 'system-ui, sans-serif' }}>
              <strong style={{ color: '#F59E0B' }}>{queryTotal.toLocaleString()}</strong> match &ldquo;{activeQuery}&rdquo; &mdash; <strong style={{ color: '#e0e0e0' }}>{queryResults.length.toLocaleString()}</strong> mapped
              {queryNoLoc.length > 0 && <span style={{ color: '#666' }}> &middot; {queryNoLoc.length.toLocaleString()} no location</span>}
            </div>
          )}
        </div>

        {/* Controls — top right */}
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, fontFamily: 'system-ui, sans-serif' }}>
          {!controlsOpen ? (
            <button onClick={(e) => { e.stopPropagation(); setControlsOpen(true); }}
              style={{ background: 'rgba(13,17,23,0.85)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8, padding: '8px 14px', color: '#e0e0e0', cursor: 'pointer',
                fontSize: '11px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '14px' }}>&#9881;</span>
              <span>
                <span style={{ color: '#3B82F6' }}>{counts.vehicles.toLocaleString()}</span>
                {' / '}
                <span style={{ color: '#EC4899' }}>{counts.collections.toLocaleString()}</span>
                {' / '}
                <span style={{ color: '#14B8A6' }}>{counts.businesses.toLocaleString()}</span>
                {counts.photos > 0 && <>
                  {' / '}
                  <span style={{ color: '#D946EF' }}>{counts.photos.toLocaleString()}</span>
                </>}
              </span>
            </button>
          ) : (
            <div onClick={(e) => e.stopPropagation()} style={{ background: 'rgba(13,17,23,0.92)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 14,
              minWidth: 200, backdropFilter: 'blur(12px)', color: '#e0e0e0', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#999' }}>Layers</span>
                <button onClick={() => setControlsOpen(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px', padding: '0 2px' }}>x</button>
              </div>
              <LT label="Vehicles" color="#3B82F6" checked={showVehicles} set={setShowVehicles} n={counts.vehicles} dim={hasQuery} loading={vehLoading} />
              <LT label="Collections" color="#EC4899" checked={showCollections} set={setShowCollections} n={counts.collections} dim={hasQuery} />
              <LT label="Businesses" color="#14B8A6" checked={showBusinesses} set={setShowBusinesses} n={counts.businesses} dim={hasQuery} />
              <LT label="Photos" color="#D946EF" checked={showPhotos} set={setShowPhotos} n={counts.photos} dim={hasQuery} />
              {activeQuery && <>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '6px 0' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
                  <span style={{ color: '#F59E0B', fontWeight: 600 }}>Query</span>
                  <span style={{ color: '#F59E0B', marginLeft: 'auto' }}>{counts.query.toLocaleString()}</span>
                </div>
              </>}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '8px 0 6px' }} />
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {(['density', 'points'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)} style={{
                    flex: 1, padding: '5px 0', fontSize: '11px', fontWeight: mode === m ? 600 : 400,
                    background: mode === m ? 'rgba(59,130,246,0.2)' : 'transparent',
                    color: mode === m ? '#3B82F6' : '#666',
                    border: `1px solid ${mode === m ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 5, cursor: 'pointer' }}>
                    {m === 'density' ? 'Glow + Points' : 'Points Only'}
                  </button>
                ))}
              </div>
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

        {/* Timeline slider — bottom center */}
        <div style={{
          position: 'absolute', bottom: 12, left: 12, right: hasSidePanel ? 12 : 12, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(13,17,23,0.85)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8, padding: '8px 14px', fontFamily: 'system-ui, sans-serif',
        }}>
          {/* Stats */}
          <div style={{ fontSize: '11px', color: '#999', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            {vehLoading && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3B82F6', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />}
            {hasQuery
              ? <><strong style={{ color: '#F59E0B' }}>{counts.query.toLocaleString()}</strong> / {queryTotal.toLocaleString()}</>
              : <><strong style={{ color: '#e0e0e0' }}>{counts.total.toLocaleString()}</strong> items</>}
          </div>

          {/* Timeline toggle + slider */}
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 10, display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <button
              onClick={() => setTimelineEnabled(!timelineEnabled)}
              style={{
                padding: '3px 8px', fontSize: '10px', fontWeight: 600,
                background: timelineEnabled ? 'rgba(139,92,246,0.3)' : 'transparent',
                color: timelineEnabled ? '#A78BFA' : '#666',
                border: `1px solid ${timelineEnabled ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Timeline
            </button>
            {timelineEnabled && (
              <>
                <span style={{ fontSize: '9px', color: '#666', whiteSpace: 'nowrap' }}>{timelineRange.minLabel}</span>
                <input type="range" min={0} max={100} value={timeCutoff}
                  onChange={e => setTimeCutoff(Number(e.target.value))}
                  style={{ flex: 1, height: 4, WebkitAppearance: 'none' as any, appearance: 'none' as any,
                    background: 'rgba(139,92,246,0.3)', outline: 'none', cursor: 'pointer', borderRadius: 2 }}
                />
                <span style={{ fontSize: '10px', color: '#A78BFA', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 60 }}>{cutoffLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* Unmapped results list */}
        {queryNoLoc.length > 0 && (
          <div style={{ position: 'absolute', top: 70, left: 12, zIndex: 1000, width: 280, maxHeight: '40vh',
            overflowY: 'auto', background: 'rgba(13,17,23,0.92)', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)', fontSize: '12px', fontFamily: 'system-ui, sans-serif', color: '#e0e0e0' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#999',
              fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, position: 'sticky', top: 0, background: 'rgba(13,17,23,0.95)' }}>
              No location ({queryNoLoc.length})
            </div>
            {queryNoLoc.slice(0, 50).map(r => (
              <a key={r.id} href={`/vehicle/${r.id}`} style={{ display: 'block', padding: '6px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.04)', textDecoration: 'none', color: '#e0e0e0', fontSize: '11px' }}>
                {r.title}
                {r.loc && <span style={{ color: '#666', marginLeft: 8, fontSize: '10px' }}>{r.loc}</span>}
              </a>
            ))}
            {queryNoLoc.length > 50 && <div style={{ padding: '6px 12px', color: '#666', fontSize: '10px' }}>+{queryNoLoc.length - 50} more</div>}
          </div>
        )}
      </div>

      {/* Side panel — slides in from right when a point is clicked */}
      {hasSidePanel && (() => {
        const { pin, type } = selectedPin!;
        return (
          <div onClick={(e) => e.stopPropagation()} style={{
            width: panelW, flexShrink: 0, background: '#111827', borderLeft: '1px solid rgba(255,255,255,0.08)',
            overflowY: 'auto', fontFamily: 'system-ui, sans-serif', color: '#e0e0e0',
          }}>
            {/* Close button */}
            <button onClick={() => setSelectedPin(null)} style={{
              position: 'sticky', top: 0, zIndex: 1, width: '100%', padding: '8px 14px',
              background: 'rgba(17,24,39,0.95)', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
              color: '#999', cursor: 'pointer', fontSize: '11px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: '16px' }}>&larr;</span> Close
            </button>

            {type === 'vehicle' && (() => {
              const v = pin as VPin;
              const title = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
              const subtitle = [v.trim, v.body].filter(Boolean).join(' \u00b7 ');
              const specs = [v.color, v.engine, v.hp ? `${v.hp}hp` : null, v.trans, v.drive].filter(Boolean);
              const thumb = thumbUrl(v.img);
              return (
                <div>
                  {thumb && <a href={`/vehicle/${v.id}`}>
                    <img src={thumb} alt={title} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </a>}
                  <div style={{ padding: '14px 16px' }}>
                    <a href={`/vehicle/${v.id}`} style={{ color: hasQuery ? '#F59E0B' : '#3B82F6', textDecoration: 'none', fontWeight: 700, fontSize: '16px', display: 'block', marginBottom: 4 }}>
                      {title}
                    </a>
                    {subtitle && <div style={{ color: '#999', fontSize: '12px', marginBottom: 8 }}>{subtitle}</div>}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'baseline' }}>
                      {v.price && <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '18px', fontFamily: 'monospace' }}>{fmtPrice(v.price)}</span>}
                      {v.mileage && <span style={{ color: '#999', fontSize: '12px' }}>{fmtMiles(v.mileage)}</span>}
                    </div>
                    {specs.length > 0 && <div style={{ color: '#999', fontSize: '11px', marginBottom: 8, lineHeight: 1.6 }}>{specs.join(' \u00b7 ')}</div>}
                    {v.intColor && <div style={{ color: '#999', fontSize: '11px', marginBottom: 8 }}>Interior: {v.intColor}</div>}
                    {(v.deal != null || v.heat != null || v.condition != null) && (
                      <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: '11px' }}>
                        {v.deal != null && <span style={{ color: v.deal >= 70 ? '#4ade80' : v.deal >= 40 ? '#facc15' : '#f87171' }}>Deal: {v.deal}</span>}
                        {v.heat != null && <span style={{ color: '#f97316' }}>Heat: {v.heat}</span>}
                        {v.condition != null && <span style={{ color: '#60a5fa' }}>Condition: {v.condition}/10</span>}
                      </div>
                    )}
                    {v.dateLabel && <div style={{ color: '#666', fontSize: '10px', marginBottom: 8 }}>{v.dateLabel}</div>}
                    {v.loc && <div style={{ color: '#666', fontSize: '10px', marginBottom: 12 }}>{v.loc}</div>}
                    <a href={`/vehicle/${v.id}`} style={{
                      display: 'block', textAlign: 'center', padding: '10px', borderRadius: 6,
                      background: 'rgba(59,130,246,0.2)', color: '#3B82F6', textDecoration: 'none',
                      fontWeight: 600, fontSize: '12px', border: '1px solid rgba(59,130,246,0.3)',
                    }}>View Full Profile</a>
                  </div>
                </div>
              );
            })()}

            {type === 'collection' && (() => {
              const c = pin as ColPin;
              return (
                <div style={{ padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: 6, color: '#fff' }}>{c.name}</div>
                  <div style={{ color: '#999', fontSize: '12px', marginBottom: 10 }}>{c.city}, {c.country}</div>
                  {c.totalInventory > 0 && <div style={{ color: '#3B82F6', fontWeight: 600, fontSize: '14px', marginBottom: 12 }}>{c.totalInventory} vehicles</div>}
                  <a href={`/org/${c.slug}`} style={{ display: 'block', textAlign: 'center', padding: '10px', borderRadius: 6,
                    background: 'rgba(59,130,246,0.2)', color: '#3B82F6', textDecoration: 'none', fontWeight: 600, fontSize: '12px',
                    border: '1px solid rgba(59,130,246,0.3)', marginBottom: 8 }}>View Collection</a>
                  {c.ig && <a href={`https://instagram.com/${c.ig}`} target="_blank" rel="noreferrer" style={{
                    display: 'block', textAlign: 'center', padding: '10px', borderRadius: 6,
                    background: 'rgba(236,72,153,0.15)', color: '#EC4899', textDecoration: 'none', fontWeight: 600, fontSize: '12px',
                    border: '1px solid rgba(236,72,153,0.3)' }}>@{c.ig}</a>}
                </div>
              );
            })()}

            {type === 'business' && (() => {
              const b = pin as BizPin;
              return (
                <div style={{ padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: 6, color: '#fff' }}>{b.name}</div>
                  {b.type && <div style={{ color: '#999', fontSize: '12px', marginBottom: 10 }}>{b.type}</div>}
                  <a href={`/org/${b.id}`} style={{ display: 'block', textAlign: 'center', padding: '10px', borderRadius: 6,
                    background: 'rgba(20,184,166,0.2)', color: '#14B8A6', textDecoration: 'none', fontWeight: 600, fontSize: '12px',
                    border: '1px solid rgba(20,184,166,0.3)' }}>View Profile</a>
                </div>
              );
            })()}

            {type === 'photo' && (() => {
              const p = pin as PhotoPin;
              // Show real photo thumbnail, or fall back to the vehicle's primary image
              const imgSrc = p.hasRealImage ? (p.thumb || p.img) : p.vehicleThumb;
              return (
                <div>
                  {imgSrc && <img src={imgSrc} alt={p.vehicleTitle || 'Photo'} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block', background: '#111' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                  {!imgSrc && p.vehicleTitle && (
                    <div style={{ width: '100%', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#555', fontSize: 13 }}>
                      No image available
                    </div>
                  )}
                  <div style={{ padding: '14px 16px' }}>
                    {/* Vehicle title — the primary thing you care about */}
                    {p.vehicleTitle ? (
                      <a href={p.vehicleId ? `/vehicle/${p.vehicleId}` : '#'} style={{
                        color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: '15px', display: 'block', marginBottom: 6,
                        lineHeight: 1.3,
                      }}>{p.vehicleTitle}</a>
                    ) : (
                      <div style={{ color: '#888', fontSize: '13px', marginBottom: 6 }}>Unlinked photo</div>
                    )}

                    {/* Location + date on one line */}
                    <div style={{ color: '#aaa', fontSize: '12px', marginBottom: 10, lineHeight: 1.5 }}>
                      {p.locationName && <div>{p.locationName}</div>}
                      {p.takenLabel && <div style={{ color: '#888' }}>{p.takenLabel}{p.cameraModel ? ` \u00b7 ${p.cameraModel}` : ''}</div>}
                    </div>

                    {/* Source badge */}
                    {!p.hasRealImage && (
                      <div style={{ fontSize: '10px', color: '#D946EF', marginBottom: 10, opacity: 0.7 }}>
                        GPS location from Apple Photos
                      </div>
                    )}

                    {/* Action button */}
                    {p.vehicleId && (
                      <a href={`/vehicle/${p.vehicleId}`} style={{
                        display: 'block', textAlign: 'center', padding: '10px', borderRadius: 6,
                        background: 'rgba(217,70,239,0.15)', color: '#D946EF', textDecoration: 'none',
                        fontWeight: 600, fontSize: '13px', border: '1px solid rgba(217,70,239,0.3)',
                      }}>View {p.vehicleTitle.split(' ').slice(1, 3).join(' ') || 'Vehicle'}</a>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

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
