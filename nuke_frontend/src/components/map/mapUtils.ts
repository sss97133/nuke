import ZIP_DB from './us-zips.json';

export const MAP_FONT = 'Arial, Helvetica, sans-serif';
export const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
export const CARTO_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
export const SATELLITE_MAP_STYLE: any = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
};

// Color presets for data layers
export type ColorPreset = 'default' | 'thermal' | 'mono' | 'satellite';
export const COLOR_PRESETS: Record<ColorPreset, {
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

export function simpleHash(s: string): number {
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

export function geo(loc: string): [number, number] | null {
  // 1) Try ZIP code — gives city-level accuracy
  const zipMatch = loc.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const coords = ZIPS[zipMatch[1]];
    if (coords) return spread(coords, loc, 0.04);
  }

  const l = loc.toLowerCase();

  // 2) Canadian province abbreviation (e.g. "Maple Ridge, BC, Canada" or "Toronto, ON")
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
    for (const city of ['toronto','vancouver','montreal','montréal','calgary','ottawa','edmonton','winnipeg','halifax','guelph','maple ridge','quebec city']) {
      if (l.includes(city) && INTL[city]) return spread(INTL[city], loc, 0.05);
    }
    return spread([49.3, -96.8], loc, 1.0);
  }

  // 4) US state abbreviation (e.g. "Phoenix, AZ")
  const abbrMatch = loc.match(/,\s*([A-Z]{2})\s*$/);
  if (abbrMatch) {
    const fullState = ST_ABBR[abbrMatch[1].toLowerCase()];
    if (fullState && ST[fullState]) return spread(ST[fullState], loc, 0.3);
  }

  // 5) Full US state name
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
export const COUNTRY_COLORS: Record<string, [number, number, number]> = {
  'USA': [59, 130, 246], 'UK': [239, 68, 68], 'Italy': [34, 197, 94], 'Germany': [245, 158, 11],
  'France': [139, 92, 246], 'Monaco': [236, 72, 153], 'Switzerland': [20, 184, 166], 'Japan': [249, 115, 22],
  'UAE': [99, 102, 241], 'Australia': [251, 191, 36], 'Canada': [220, 38, 38], 'default': [236, 72, 153],
};
export const colColor = (country: string): [number, number, number] => COUNTRY_COLORS[country] || COUNTRY_COLORS['default'];

// SVG data URIs for shape evolution at z14+
export const CAR_SVG_URI = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="4"><rect width="10" height="4" rx="1" fill="white"/></svg>')}`;
export const BUILDING_SVG_URI = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="white"/></svg>')}`;

// ============================================================
// HEX BINNING — zoom-dependent radius for elegant density handling
// ============================================================
export function hexRadiusForZoom(z: number): number {
  return Math.max(30, Math.round(50000 / Math.pow(2, Math.max(0, z - 4))));
}

export function hexColorRange(base: [number, number, number]): [number, number, number][] {
  return [
    [Math.round(base[0] * 0.15), Math.round(base[1] * 0.15), Math.round(base[2] * 0.15)],
    [Math.round(base[0] * 0.30), Math.round(base[1] * 0.30), Math.round(base[2] * 0.30)],
    [Math.round(base[0] * 0.50), Math.round(base[1] * 0.50), Math.round(base[2] * 0.50)],
    [Math.round(base[0] * 0.70), Math.round(base[1] * 0.70), Math.round(base[2] * 0.70)],
    [Math.round(base[0] * 0.85), Math.round(base[1] * 0.85), Math.round(base[2] * 0.85)],
    [base[0], base[1], base[2]],
  ];
}

// Transition zone: hex bins fade out z12→z14, individual points fade in z13→z15
export const HEX_FADE_START = 12;
export const HEX_FADE_END = 14;
export const POINTS_FADE_START = 13;
export const POINTS_FADE_END = 15;

// --- Vehicle fields for display ---
export const BASE_FIELDS = 'id,year,make,model,trim,listing_location,bat_location,location,gps_latitude,gps_longitude,primary_image_url';
export const RICH_FIELDS = `${BASE_FIELDS},sale_price,asking_price,current_value,nuke_estimate,mileage,color,interior_color,engine_type,engine_size,horsepower,transmission,drivetrain,body_style,condition_rating,deal_score,heat_score,created_at,bat_sale_date,auction_end_date`;

// --- Pin types ---
export interface VPin {
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
  dateTs: number;
  dateLabel: string;
  isGpsOnly: boolean;
}

export interface ColPin { id: string; name: string; slug: string; ig: string | null; country: string; city: string; lat: number; lng: number; totalInventory: number; }
export interface BizPin { id: string; name: string; lat: number; lng: number; type: string | null; }

export interface PhotoPin {
  id: string;
  lat: number;
  lng: number;
  img: string;
  thumb: string | null;
  hasRealImage: boolean;
  vehicleId: string | null;
  vehicleTitle: string;
  vehicleThumb: string | null;
  locationName: string | null;
  takenAt: string | null;
  takenLabel: string;
  source: string;
  cameraModel: string | null;
}

export interface MarketplacePin {
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

export interface LiveEvent { id: string; lat: number; lng: number; ts: number; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pinFromRow(v: any): VPin | null {
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
  const isGpsOnly = !!(v.gps_latitude && v.gps_longitude && !v.listing_location && !v.bat_location);
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
    isGpsOnly,
  };
}

// --- Helpers ---
export const fmtPrice = (p: number) => '$' + p.toLocaleString();
export const fmtMiles = (m: number) => m.toLocaleString() + ' mi';

export function thumbUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.includes('/storage/v1/object/public/')) {
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=280&height=160&quality=80&resize=cover';
  }
  return url;
}

export const INITIAL_VIEW = { longitude: -98, latitude: 39, zoom: 4.5, pitch: 0, bearing: 0 };
