import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, TextLayer, GeoJsonLayer, IconLayer } from '@deck.gl/layers';
import { HeatmapLayer, HexagonLayer } from '@deck.gl/aggregation-layers';
import { Map } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import '../../styles/unified-design-system.css';
import ZIP_DB from './us-zips.json';
import * as topojson from 'topojson-client';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';

const MAP_FONT = 'Arial, Helvetica, sans-serif';
const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const CARTO_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// Color presets for data layers
type ColorPreset = 'default' | 'thermal' | 'mono' | 'satellite';
const COLOR_PRESETS: Record<ColorPreset, {
  vehicle: [number, number, number]; collection: [number, number, number];
  business: [number, number, number]; photo: [number, number, number];
  query: [number, number, number];
}> = {
  default:   { vehicle: [245, 158, 11],  collection: [236, 72, 153],  business: [20, 184, 166],  photo: [217, 70, 239],  query: [245, 158, 11] },
  thermal:   { vehicle: [220, 50, 30],   collection: [255, 200, 50],  business: [255, 160, 20],  photo: [255, 100, 40],  query: [255, 230, 50] },
  mono:      { vehicle: [200, 200, 200], collection: [180, 180, 180], business: [160, 160, 160], photo: [140, 140, 140], query: [220, 220, 220] },
  satellite: { vehicle: [139, 119, 86],  collection: [86, 125, 70],   business: [86, 108, 139],  photo: [139, 86, 100],  query: [180, 160, 100] },
};

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

// Canadian province abbreviations → full name
const CA_ABBR: Record<string, string> = {
  'ab':'alberta','bc':'british columbia','mb':'manitoba','nb':'new brunswick',
  'nl':'newfoundland and labrador','ns':'nova scotia','nt':'northwest territories',
  'nu':'nunavut','on':'ontario','pe':'prince edward island','qc':'quebec',
  'sk':'saskatchewan','yt':'yukon',
};

// Canadian province centroids
const CA_PROV: Record<string, [number, number]> = {
  'alberta': [53.9, -116.6], 'british columbia': [53.7, -127.6], 'manitoba': [53.8, -98.8],
  'new brunswick': [46.5, -66.2], 'newfoundland and labrador': [53.1, -57.7],
  'nova scotia': [44.7, -63.0], 'northwest territories': [64.3, -119.0], 'nunavut': [70.3, -86.0],
  'ontario': [51.3, -85.3], 'prince edward island': [46.2, -63.0], 'quebec': [52.9, -73.5],
  'saskatchewan': [52.9, -106.5], 'yukon': [64.3, -135.0],
};

// International country/region centroids
const INTL: Record<string, [number, number]> = {
  // UK regions
  'england': [52.3, -1.2], 'scotland': [56.5, -4.0], 'wales': [52.1, -3.8],
  'united kingdom': [52.3, -1.2], 'london': [51.5, -0.1], 'surrey': [51.3, -0.4],
  'kent': [51.3, 0.5], 'essex': [51.7, 0.6], 'hampshire': [51.0, -1.3],
  'west sussex': [50.9, -0.5],
  // Europe
  'germany': [51.2, 10.4], 'deutschland': [51.2, 10.4], 'munich': [48.1, 11.6],
  'münchen': [48.1, 11.6], 'berlin': [52.5, 13.4], 'stuttgart': [48.8, 9.2],
  'frankfurt': [50.1, 8.7], 'hamburg': [53.6, 10.0],
  'france': [46.6, 2.2], 'paris': [48.9, 2.3],
  'italy': [41.9, 12.5], 'roma': [41.9, 12.5], 'milan': [45.5, 9.2],
  'spain': [40.4, -3.7], 'madrid': [40.4, -3.7], 'barcelona': [41.4, 2.2],
  'netherlands': [52.1, 5.3], 'amsterdam': [52.4, 4.9],
  'switzerland': [46.8, 8.2], 'zurich': [47.4, 8.5],
  'sweden': [59.3, 18.1], 'stockholm': [59.3, 18.1],
  'belgium': [50.8, 4.4], 'brussels': [50.8, 4.4],
  'austria': [48.2, 16.4], 'vienna': [48.2, 16.4],
  'norway': [59.9, 10.8], 'denmark': [55.7, 12.6],
  'portugal': [38.7, -9.1], 'monaco': [43.7, 7.4],
  // Asia-Pacific
  'japan': [36.2, 138.3], 'tokyo': [35.7, 139.7],
  'australia': [-25.3, 133.8], 'sydney': [-33.9, 151.2], 'melbourne': [-37.8, 145.0],
  'new south wales': [-33.9, 151.2], 'victoria': [-37.8, 145.0], 'queensland': [-27.5, 153.0],
  'new zealand': [-36.8, 174.8], 'auckland': [-36.8, 174.8],
  'uae': [25.2, 55.3], 'dubai': [25.2, 55.3], 'abu dhabi': [24.5, 54.7],
  'south korea': [37.6, 127.0], 'seoul': [37.6, 127.0],
  // Americas
  'mexico': [19.4, -99.1], 'méxico': [19.4, -99.1],
  'brazil': [-15.8, -47.9], 'brasil': [-15.8, -47.9],
  'argentina': [-34.6, -58.4],
  // Africa
  'south africa': [-33.9, 18.4],
  // Canadian cities (matched before generic "canada" fallback)
  'toronto': [43.7, -79.4], 'vancouver': [49.3, -123.1], 'montreal': [45.5, -73.6],
  'montréal': [45.5, -73.6], 'calgary': [51.0, -114.1], 'ottawa': [45.4, -75.7],
  'edmonton': [53.5, -113.5], 'winnipeg': [49.9, -97.1], 'halifax': [44.6, -63.6],
  'quebec city': [46.8, -71.2], 'guelph': [43.5, -80.3], 'maple ridge': [49.2, -122.6],
};

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function spread(coords: [number, number], loc: string, range: number): [number, number] {
  const h = simpleHash(loc);
  const latOff = ((h & 0xff) / 255 - 0.5) * range;
  const lngOff = (((h >> 8) & 0xff) / 255 - 0.5) * range;
  return [coords[0] + latOff, coords[1] + lngOff];
}

function geo(loc: string): [number, number] | null {
  // 1) Try ZIP code — gives city-level accuracy
  const zipMatch = loc.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const coords = ZIPS[zipMatch[1]];
    if (coords) return spread(coords, loc, 0.04);
  }

  const l = loc.toLowerCase();

  // 2) Canadian province abbreviation (e.g. "Maple Ridge, BC, Canada" or "Toronto, ON")
  //    Must check BEFORE US states — "ON" is not a US state but could conflict
  const caAbbrMatch = loc.match(/,\s*([A-Z]{2})\s*(?:,\s*Canada)?\s*$/i);
  if (caAbbrMatch) {
    const provFull = CA_ABBR[caAbbrMatch[1].toLowerCase()];
    if (provFull && CA_PROV[provFull]) {
      return spread(CA_PROV[provFull], loc, 0.4);
    }
  }

  // 3) Full Canadian province name or "canada" keyword
  if (l.includes('canada') || l.includes('canadian')) {
    for (const [prov, c] of Object.entries(CA_PROV)) {
      if (l.includes(prov)) return spread(c, loc, 0.4);
    }
    // Try Canadian city names
    for (const city of ['toronto','vancouver','montreal','montréal','calgary','ottawa','edmonton','winnipeg','halifax','guelph','maple ridge','quebec city']) {
      if (l.includes(city) && INTL[city]) return spread(INTL[city], loc, 0.05);
    }
    // Fallback: center of southern Canada
    return spread([49.3, -96.8], loc, 1.0);
  }

  // 4) US state abbreviation (e.g. "Phoenix, AZ")
  const abbrMatch = loc.match(/,\s*([A-Z]{2})\s*$/);
  if (abbrMatch) {
    const fullState = ST_ABBR[abbrMatch[1].toLowerCase()];
    if (fullState && ST[fullState]) return spread(ST[fullState], loc, 0.3);
  }

  // 5) Full US state name — fallback with wider spread
  for (const [s, c] of Object.entries(ST)) {
    if (l.includes(s)) return spread(c, loc, 0.4);
  }

  // 6) International — try all known locations
  for (const [name, c] of Object.entries(INTL)) {
    if (l.includes(name)) return spread(c, loc, 0.25);
  }

  return null;
}

// --- Country colors ---
const COUNTRY_COLORS: Record<string, [number, number, number]> = {
  'USA': [59, 130, 246], 'UK': [239, 68, 68], 'Italy': [34, 197, 94], 'Germany': [245, 158, 11],
  'France': [139, 92, 246], 'Monaco': [236, 72, 153], 'Switzerland': [20, 184, 166], 'Japan': [249, 115, 22],
  'UAE': [99, 102, 241], 'Australia': [251, 191, 36], 'Canada': [220, 38, 38], 'default': [236, 72, 153],
};
const colColor = (country: string): [number, number, number] => COUNTRY_COLORS[country] || COUNTRY_COLORS['default'];

// SVG data URIs for shape evolution at z14+
const CAR_SVG_URI = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="4"><rect width="10" height="4" rx="1" fill="white"/></svg>')}`;
const BUILDING_SVG_URI = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="white"/></svg>')}`;

// --- Vehicle fields for display ---
const BASE_FIELDS = 'id,year,make,model,trim,listing_location,bat_location,location,gps_latitude,gps_longitude,primary_image_url';
const RICH_FIELDS = `${BASE_FIELDS},sale_price,asking_price,current_value,nuke_estimate,mileage,color,interior_color,engine_type,engine_size,horsepower,transmission,drivetrain,body_style,condition_rating,deal_score,heat_score,created_at,bat_sale_date,auction_end_date`;

// Search uses search_vector GIN index — fast even on 130k+ rows

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

interface MarketplacePin {
  id: string;
  fbId: string;
  year: number | null;
  make: string | null;
  model: string | null;
  lat: number;
  lng: number;
  loc: string;
  img: string | null;
  price: number | null;
  title: string;
  seller: string | null;
  description: string | null;
  url: string;
  status: string;
  scrapedAt: string | null;
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


export default function UnifiedMap() {
  const { theme } = useTheme();
  const mapStyle = theme === 'dark' ? CARTO_DARK : CARTO_LIGHT;
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

  const [searchText, setSearchText] = useState('');
  const [queryResults, setQueryResults] = useState<VPin[]>([]);
  const [queryNoLoc, setQueryNoLoc] = useState<{ id: string; title: string; loc: string }[]>([]);
  const [queryTotal, setQueryTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');

  // deck.gl viewState
  const [viewState, setViewState] = useState(INITIAL_VIEW);

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

  // Timeline — filter vehicles by date
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [timeCutoff, setTimeCutoff] = useState(100); // 0-100 percentage of date range

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
        .limit(20000);
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
    const now = Date.now();
    const mn = Math.min(...dates.slice(0, 10000)); // avoid perf hit on huge arrays
    const mx = Math.min(Math.max(...dates.slice(-10000)), now);
    // Scan in chunks for accuracy on large datasets
    let realMin = mn, realMax = mx;
    for (let i = 0; i < dates.length; i += 100) {
      if (dates[i] < realMin) realMin = dates[i];
      if (dates[i] > realMax && dates[i] <= now) realMax = dates[i];
    }
    realMax = Math.min(realMax, now); // hard cap at today
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

  const counts = useMemo(() => {
    const vehCount = filteredVehicles.length;
    return {
      collections: collections.length,
      vehicles: vehCount,
      businesses: businesses.length,
      photos: photos.length,
      marketplace: marketplace.length,
      query: queryResults.length,
      total: (showCollections && !hasQuery ? collections.length : 0)
           + (showVehicles && !hasQuery ? vehCount : 0)
           + (showBusinesses && !hasQuery ? businesses.length : 0)
           + (showPhotos && !hasQuery ? photos.length : 0)
           + (showMarketplace && !hasQuery ? marketplace.length : 0)
           + queryResults.length,
    };
  }, [showCollections, showVehicles, showBusinesses, showPhotos, showMarketplace, collections, filteredVehicles, businesses, photos, marketplace, queryResults, hasQuery]);

  // --- deck.gl layers ---
  const zoom = viewState.zoom;

  const layers = useMemo(() => {
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
          // Log scale for better distribution
          const t = Math.log1p(count) / Math.log1p(maxC);
          // Infrared ramp: dark indigo → purple → red → orange → yellow → white
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
        // Ghost dots underneath so data sources remain visible through gradient
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

    // --- Vehicle Hex Grid (density mode — tessellating hexagons, no stacking) ---
    if (showVehicles && !hasQuery && mode === 'density') {
      // Zoom-adaptive hex radius: 40km at z4 → 200m floor, scaled by slider
      const hexRadius = Math.max(200, 40000 / Math.pow(2, Math.max(0, zoom - 4))) * (glowRadius / 60);
      const hexColorRange: [number, number, number][] = [
        [Math.round(vehColor[0] * 0.15), Math.round(vehColor[1] * 0.15), Math.round(vehColor[2] * 0.15)],
        [Math.round(vehColor[0] * 0.4), Math.round(vehColor[1] * 0.4), Math.round(vehColor[2] * 0.4)],
        [Math.round(vehColor[0] * 0.7), Math.round(vehColor[1] * 0.7), Math.round(vehColor[2] * 0.7)],
        [vehColor[0], vehColor[1], vehColor[2]],
        [Math.min(255, Math.round(vehColor[0] * 1.2)), Math.min(255, Math.round(vehColor[1] * 1.3)), Math.min(255, Math.round(vehColor[2] * 1.5))],
        [255, 255, 240],
      ];
      result.push(new HexagonLayer({
        id: 'vehicle-hex',
        data: filteredVehicles,
        getPosition: (d: VPin) => [d.lng, d.lat],
        radius: hexRadius,
        extruded: false,
        coverage: 0.85,
        colorRange: hexColorRange,
        opacity: Math.min(1, glowIntensity / 50),
        pickable: true,
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const count = object.count || 0;
            setHoverInfo({ x, y, text: `${count.toLocaleString()} vehicle${count !== 1 ? 's' : ''}` });
          } else {
            setHoverInfo(null);
          }
        },
        onClick: ({ object }: any) => {
          if (object?.position) {
            setViewState(vs => ({
              ...vs,
              longitude: object.position[0],
              latitude: object.position[1],
              zoom: Math.min(vs.zoom + 3, 18),
            }));
          }
        },
        updateTriggers: {
          radius: [glowRadius, zoom],
          colorRange: [colorPreset],
        },
      }));
    }

    // --- Vehicle Points (individual dots — points mode only) ---
    if (showVehicles && !hasQuery && mode === 'points') {
      result.push(new ScatterplotLayer({
        id: 'vehicle-points',
        data: filteredVehicles,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getRadius: 3,
        radiusUnits: 'meters' as const,
        getFillColor: [...vehColor, 200] as [number, number, number, number],
        radiusMinPixels: 0,
        radiusMaxPixels: 8,
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
        updateTriggers: { getFillColor: [colorPreset], getRadius: [pointSize, zoom] },
        opacity: zoom >= 13 ? circleFade : 1,
      }));

      // Vehicle shapes (car rectangles) at z14+
      if (shapeFade > 0) {
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
    }

    // --- Query Hex Grid (density mode) ---
    if (hasQuery && queryResults.length > 0 && mode === 'density') {
      const qColor = colors.query;
      const hexRadius = Math.max(200, 40000 / Math.pow(2, Math.max(0, zoom - 4))) * (glowRadius / 60);
      const qHexColorRange: [number, number, number][] = [
        [Math.round(qColor[0] * 0.15), Math.round(qColor[1] * 0.15), Math.round(qColor[2] * 0.15)],
        [Math.round(qColor[0] * 0.4), Math.round(qColor[1] * 0.4), Math.round(qColor[2] * 0.4)],
        [Math.round(qColor[0] * 0.7), Math.round(qColor[1] * 0.7), Math.round(qColor[2] * 0.7)],
        [qColor[0], qColor[1], qColor[2]],
        [Math.min(255, Math.round(qColor[0] * 1.2)), Math.min(255, Math.round(qColor[1] * 1.3)), Math.min(255, Math.round(qColor[2] * 1.5))],
        [255, 255, 240],
      ];
      result.push(new HexagonLayer({
        id: 'query-hex',
        data: queryResults,
        getPosition: (d: VPin) => [d.lng, d.lat],
        radius: hexRadius,
        extruded: false,
        coverage: 0.85,
        colorRange: qHexColorRange,
        opacity: Math.min(1, glowIntensity / 50),
        pickable: true,
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const count = object.count || 0;
            setHoverInfo({ x, y, text: `${count.toLocaleString()} result${count !== 1 ? 's' : ''}` });
          } else {
            setHoverInfo(null);
          }
        },
        onClick: ({ object }: any) => {
          if (object?.position) {
            setViewState(vs => ({
              ...vs,
              longitude: object.position[0],
              latitude: object.position[1],
              zoom: Math.min(vs.zoom + 3, 18),
            }));
          }
        },
        updateTriggers: {
          radius: [glowRadius, zoom],
          colorRange: [colorPreset],
        },
      }));
    }

    // --- Query Points (individual dots — points mode only) ---
    if (hasQuery && queryResults.length > 0 && mode === 'points') {
      result.push(new ScatterplotLayer({
        id: 'query-points',
        data: queryResults,
        getPosition: (d: VPin) => [d.lng, d.lat],
        getRadius: 4,
        radiusUnits: 'meters' as const,
        getFillColor: [...colors.query, 220] as [number, number, number, number],
        radiusMinPixels: 0,
        radiusMaxPixels: 10,
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
        updateTriggers: { getRadius: [pointSize, zoom] },
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
        updateTriggers: { getRadius: [glowRadius, zoom] },
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

    // --- Photo Glow ---
    if (showPhotos && !hasQuery && photos.length > 0 && mode === 'density' && glowFade > 0) {
      result.push(new ScatterplotLayer({
        id: 'photo-glow',
        data: photos,
        getPosition: (d: PhotoPin) => [d.lng, d.lat],
        getRadius: 200,
        radiusUnits: 'meters' as const,
        getFillColor: [...colors.photo, Math.round(glowAlpha * 0.7)] as [number, number, number, number],
        radiusMinPixels: 0,
        radiusMaxPixels: glowRadius * 0.4,
        opacity: glowFade * 0.7,
        pickable: true,
        onClick: ({ object }: any) => handleLayerClick(object, 'photo'),
        onHover: ({ object, x, y }: any) => {
          if (object) {
            setHoverInfo({ x, y, text: object.vehicleTitle || object.locationName || 'Photo' });
          } else {
            setHoverInfo(null);
          }
        },
        updateTriggers: { getRadius: [glowRadius, zoom] },
      }));
    }

    // --- Photo Points ---
    if (showPhotos && !hasQuery && photos.length > 0 && mode !== 'thermal') {
      result.push(new ScatterplotLayer({
        id: 'photo-points',
        data: photos,
        getPosition: (d: PhotoPin) => [d.lng, d.lat],
        getRadius: 2,
        radiusUnits: 'meters' as const,
        radiusMinPixels: 0,
        radiusMaxPixels: 6,
        getFillColor: (d: PhotoPin) => d.hasRealImage
          ? [...colors.photo, 230] as [number, number, number, number]
          : [...colors.photo, 120] as [number, number, number, number],
        pickable: true,
        onClick: ({ object }: any) => handleLayerClick(object, 'photo'),
        onHover: ({ object, x, y }: any) => {
          if (object) {
            const label = object.vehicleTitle || 'Photo';
            const loc = object.locationName ? ` · ${object.locationName.split(',')[0]}` : '';
            const date = object.takenLabel ? ` · ${object.takenLabel}` : '';
            setHoverInfo({ x, y, text: label + loc + date });
          } else {
            setHoverInfo(null);
          }
        },
      }));
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
    if (showMarketplace && !hasQuery && marketplace.length > 0 && mode !== 'thermal') {
      result.push(new ScatterplotLayer({
        id: 'marketplace-points',
        data: marketplace,
        getPosition: (d: MarketplacePin) => [d.lng, d.lat],
        getRadius: 3,
        radiusUnits: 'meters' as const,
        radiusMinPixels: 0,
        radiusMaxPixels: 6,
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
      showPhotos, showMarketplace, hasQuery, zoom, mode, glowRadius, glowIntensity, pointSize, colorPreset, tick, countyFeatures]);

  const panelW = 320; // side panel width
  const hasSidePanel = selectedPin !== null;

  return (
    <div className="nuke-map-root" style={{ position: 'absolute', inset: 0, background: 'var(--bg)', display: 'flex', overflow: 'hidden', fontFamily: MAP_FONT }}
      onClick={() => { if (!deckClickedRef.current) setSelectedPin(null); }}>

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
              <LT label="Photos" color={`rgb(${COLOR_PRESETS[colorPreset].photo.join(',')})`} checked={showPhotos} set={setShowPhotos} n={counts.photos} dim={hasQuery} />
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
                </>}
              </div>
            </div>
          )}
        </div>

        {/* Timeline slider — bottom center */}
        <div style={{
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

          {/* Timeline toggle + slider */}
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 10, display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <button
              onClick={() => setTimelineEnabled(!timelineEnabled)}
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
                <span style={{ fontSize: '9px', color: 'var(--text-disabled)', whiteSpace: 'nowrap' }}>{timelineRange.minLabel}</span>
                <input type="range" min={0} max={100} value={timeCutoff}
                  onChange={e => setTimeCutoff(Number(e.target.value))}
                  style={{ flex: 1, height: 2, WebkitAppearance: 'none' as any, appearance: 'none' as any,
                    background: 'var(--border)', outline: 'none', cursor: 'pointer' }}
                />
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
              <a key={r.id} href={`/vehicle/${r.id}`} style={{ display: 'block', padding: '5px 10px',
                borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)', fontSize: '10px' }}>
                {r.title}
                {r.loc && <span style={{ color: 'var(--text-disabled)', marginLeft: 8, fontSize: '9px' }}>{r.loc}</span>}
              </a>
            ))}
            {queryNoLoc.length > 50 && <div style={{ padding: '5px 10px', color: 'var(--text-disabled)', fontSize: '9px' }}>+{queryNoLoc.length - 50} more</div>}
          </div>
        )}
      </div>

      {/* Side panel — slides in from right when a point is clicked */}
      {hasSidePanel && (() => {
        const { pin, type } = selectedPin!;
        return (
          <div onClick={(e) => e.stopPropagation()} style={{
            width: panelW, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--border)',
            overflowY: 'auto', fontFamily: MAP_FONT, color: 'var(--text)',
          }}>
            {/* Close button */}
            <button onClick={() => setSelectedPin(null)} style={{
              position: 'sticky', top: 0, zIndex: 1, width: '100%', padding: '6px 12px',
              background: 'var(--surface)', border: 'none', borderBottom: '1px solid var(--border)',
              color: 'var(--text-disabled)', cursor: 'pointer', fontSize: '10px', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 6, fontFamily: MAP_FONT,
              textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
              CLOSE
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
                  <div style={{ padding: '12px 14px' }}>
                    <a href={`/vehicle/${v.id}`} style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 700, fontSize: '14px', display: 'block', marginBottom: 4 }}>
                      {title}
                    </a>
                    {subtitle && <div style={{ color: 'var(--text-disabled)', fontSize: '11px', marginBottom: 8 }}>{subtitle}</div>}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'baseline' }}>
                      {v.price && <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '16px', fontFamily: 'monospace' }}>{fmtPrice(v.price)}</span>}
                      {v.mileage && <span style={{ color: 'var(--text-disabled)', fontSize: '11px' }}>{fmtMiles(v.mileage)}</span>}
                    </div>
                    {specs.length > 0 && <div style={{ color: 'var(--text-disabled)', fontSize: '10px', marginBottom: 8, lineHeight: 1.6 }}>{specs.join(' \u00b7 ')}</div>}
                    {v.intColor && <div style={{ color: 'var(--text-disabled)', fontSize: '10px', marginBottom: 8 }}>Interior: {v.intColor}</div>}
                    {(v.deal != null || v.heat != null || v.condition != null) && (
                      <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: '10px' }}>
                        {v.deal != null && <span style={{ color: v.deal >= 70 ? '#4ade80' : v.deal >= 40 ? '#facc15' : '#f87171' }}>Deal: {v.deal}</span>}
                        {v.heat != null && <span style={{ color: '#f97316' }}>Heat: {v.heat}</span>}
                        {v.condition != null && <span style={{ color: '#60a5fa' }}>Cond: {v.condition}/10</span>}
                      </div>
                    )}
                    {v.dateLabel && <div style={{ color: 'var(--text-disabled)', fontSize: '9px', marginBottom: 6 }}>{v.dateLabel}</div>}
                    {v.loc && <div style={{ color: 'var(--text-disabled)', fontSize: '9px', marginBottom: 12 }}>{v.loc}</div>}
                    <a href={`/vehicle/${v.id}`} style={{
                      display: 'block', textAlign: 'center', padding: '8px',
                      background: 'var(--text)', color: 'var(--bg)', textDecoration: 'none',
                      fontWeight: 600, fontSize: '10px', border: '1px solid var(--border)',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>VIEW FULL PROFILE</a>
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
                  <a href={`/org/${c.slug}`} style={{ display: 'block', textAlign: 'center', padding: '8px',
                    background: 'var(--text)', color: 'var(--bg)', textDecoration: 'none', fontWeight: 600, fontSize: '10px',
                    border: '1px solid var(--border)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>VIEW COLLECTION</a>
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
                  <a href={`/org/${b.id}`} style={{ display: 'block', textAlign: 'center', padding: '8px',
                    background: 'var(--text)', color: 'var(--bg)', textDecoration: 'none', fontWeight: 600, fontSize: '10px',
                    border: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>VIEW PROFILE</a>
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
              const p = pin as PhotoPin;
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
                      <a href={p.vehicleId ? `/vehicle/${p.vehicleId}` : '#'} style={{
                        color: 'var(--text)', textDecoration: 'none', fontWeight: 700, fontSize: '14px', display: 'block', marginBottom: 6,
                        lineHeight: 1.3,
                      }}>{p.vehicleTitle}</a>
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
                      <a href={`/vehicle/${p.vehicleId}`} style={{
                        display: 'block', textAlign: 'center', padding: '8px',
                        background: 'var(--text)', color: 'var(--bg)', textDecoration: 'none',
                        fontWeight: 600, fontSize: '10px', border: '1px solid var(--border)',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}>VIEW {(p.vehicleTitle.split(' ').slice(1, 3).join(' ') || 'VEHICLE').toUpperCase()}</a>
                    )}
                  </div>
                </div>
              );
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
