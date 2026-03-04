import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../../lib/supabase';
import '../../styles/unified-design-system.css';

// Fix Leaflet default marker icons
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// @ts-expect-error - Leaflet internal property access needed to fix default icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

// --- Icons ---
const dot = (color: string, size = 12) =>
  L.divIcon({
    className: '',
    html: `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });

const VEHICLE_ICON = dot('#3B82F6', 12);
const BUSINESS_ICON = dot('#22C55E', 12);
const QUERY_ICON = dot('#F59E0B', 16);

const COUNTRY_COLORS: Record<string, string> = {
  'USA': '#3B82F6', 'UK': '#EF4444', 'Italy': '#22C55E', 'Germany': '#F59E0B',
  'France': '#8B5CF6', 'Monaco': '#EC4899', 'Switzerland': '#14B8A6', 'Japan': '#F97316',
  'UAE': '#6366F1', 'Australia': '#FBBF24', 'Canada': '#DC2626', 'default': '#EC4899',
};
const colIcon = (country: string) => dot(COUNTRY_COLORS[country] || COUNTRY_COLORS['default'], 10);

// --- State centroid geocoding ---
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
  const l = loc.toLowerCase();
  for (const [s, c] of Object.entries(ST)) {
    if (l.includes(s)) {
      const h = simpleHash(loc);
      const latOff = ((h & 0xff) / 255 - 0.5) * 1.5;
      const lngOff = (((h >> 8) & 0xff) / 255 - 0.5) * 1.5;
      return [c[0] + latOff, c[1] + lngOff];
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeClusterIcon(bg: string, textColor: string) {
  return (cluster: any): L.DivIcon => {
    const count: number = cluster.getChildCount();
    const size = count < 10 ? 32 : count < 100 ? 40 : 48;
    const fontSize = count < 100 ? 13 : 11;
    return L.divIcon({
      html: `<div style="background:${bg};color:${textColor};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);font-family:Arial,sans-serif;line-height:1">${count}</div>`,
      className: '',
      iconSize: [size, size] as [number, number],
      iconAnchor: [size / 2, size / 2] as [number, number],
    });
  };
}

const createClusterCustomIcon = makeClusterIcon('rgba(59,130,246,0.92)', '#ffffff');
const createQueryClusterIcon  = makeClusterIcon('rgba(245,158,11,0.92)', '#000000');

const BASE_FIELDS = 'id,year,make,model,trim,listing_location,bat_location,location,gps_latitude,gps_longitude,primary_image_url';
const RICH_FIELDS = `${BASE_FIELDS},sale_price,asking_price,current_value,nuke_estimate,mileage,color,interior_color,engine_type,engine_size,horsepower,transmission,drivetrain,body_style,condition_rating,deal_score,heat_score`;

function buildOr(q: string): string {
  const escaped = q.replace(/'/g, "''");
  return ['make', 'model', 'trim', 'color', 'interior_color', 'engine_type', 'engine_code',
    'transmission', 'drivetrain', 'body_style', 'tire_spec_front', 'tire_spec_rear',
    'modifications', 'description', 'title', 'vin',
  ].map(c => `${c}.ilike.%${escaped}%`).join(',');
}

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
}

interface ColPin { id: string; name: string; slug: string; ig: string | null; country: string; city: string; lat: number; lng: number; totalInventory: number; }
interface BizPin { id: string; name: string; lat: number; lng: number; type: string | null; }

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

  return {
    id: v.id, year: v.year, make: v.make, model: v.model, trim: v.trim,
    lat, lng, loc: locStr,
    img: v.primary_image_url || null,
    price: v.sale_price || v.asking_price || v.current_value || v.nuke_estimate || null,
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
  };
}

function FlyTo({ center, zoom }: { center: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => { if (center) map.flyTo(center, zoom || 5, { duration: 0.8 }); }, [center]);
  return null;
}

const fmtPrice = (p: number) => '$' + p.toLocaleString();
const fmtMiles = (m: number) => m.toLocaleString() + ' mi';

function thumbUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.includes('/storage/v1/object/public/')) {
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=280&height=160&quality=80&resize=cover';
  }
  return url;
}

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
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [activeQuery, setActiveQuery] = useState('');

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

  useEffect(() => {
    supabase.from('businesses').select('id, business_name, latitude, longitude, entity_type')
      .not('latitude', 'is', null).not('longitude', 'is', null).limit(1000)
      .then(({ data }) => {
        if (data) setBiz(data.map((b: any) => ({ id: b.id, name: b.business_name || 'Business', lat: b.latitude, lng: b.longitude, type: b.entity_type })));
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setVehLoading(true);
      const all: VPin[] = [];
      const seen = new Set<string>();

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
          if (all.length % 5000 < 1000) {
            setVehicles([...all]);
          }
        }
      };

      await paginate(
        (q: any) => q.not('listing_location', 'is', null),
        80000,
      );
      if (!cancelled) setVehicles([...all]);

      await paginate(
        (q: any) => q.is('listing_location', null).not('bat_location', 'is', null).neq('bat_location', 'United States'),
        10000,
      );
      if (!cancelled) setVehicles([...all]);

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
        setFlyTarget([avgLat, avgLng]);
      }
    } catch (err) {
      console.error('Map query error:', err);
    } finally {
      setSearching(false);
    }
  }, [searchText]);

  const clearSearch = () => {
    setSearchText(''); setQueryResults([]); setQueryNoLoc([]);
    setQueryTotal(0); setFlyTarget(null); setActiveQuery('');
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

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer center={[35, -50]} zoom={3} style={{ height: '100%', width: '100%' }} zoomControl={true}>
        <TileLayer
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FlyTo center={flyTarget} />

        {showCollections && !hasQuery && collections.map((c, i) => (
          <Marker key={`c${i}`} position={[c.lat, c.lng]} icon={colIcon(c.country)}>
            <Popup>
              <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px', minWidth: 160 }}>
                <strong>{c.name}</strong><br />
                {c.city}, {c.country}<br />
                {c.totalInventory > 0 && <span style={{ color: '#3B82F6' }}>{c.totalInventory} vehicles</span>}
                {c.totalInventory > 0 && <br />}
                <a href={`/org/${c.slug}`} style={{ color: '#3B82F6' }}>View collection</a>
                {c.ig && <> · <a href={`https://instagram.com/${c.ig}`} target="_blank" rel="noreferrer" style={{ color: '#EC4899' }}>@{c.ig}</a></>}
              </div>
            </Popup>
          </Marker>
        ))}

        {showVehicles && !hasQuery && (
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={60}
            showCoverageOnHover={false}
            disableClusteringAtZoom={13}
            iconCreateFunction={createClusterCustomIcon}
          >
            {vehicles.map(v => (
              <Marker key={`v${v.id}`} position={[v.lat, v.lng]} icon={VEHICLE_ICON}>
                <Popup maxWidth={280} minWidth={260}><VehicleCard v={v} accent="#3B82F6" /></Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        )}

        {showBusinesses && !hasQuery && businesses.map(b => (
          <Marker key={`b${b.id}`} position={[b.lat, b.lng]} icon={BUSINESS_ICON}>
            <Popup>
              <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px' }}>
                <strong>{b.name}</strong><br />
                {b.type && <span style={{ color: 'var(--text-secondary)' }}>{b.type}</span>}{b.type && <br />}
                <a href={`/org/${b.id}`} style={{ color: '#22C55E' }}>View profile</a>
              </div>
            </Popup>
          </Marker>
        ))}

        {queryResults.length > 0 && (
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={50}
            showCoverageOnHover={false}
            disableClusteringAtZoom={13}
            iconCreateFunction={createQueryClusterIcon}
          >
            {queryResults.map(v => (
              <Marker key={`q${v.id}`} position={[v.lat, v.lng]} icon={QUERY_ICON}>
                <Popup maxWidth={280} minWidth={260}><VehicleCard v={v} accent="#F59E0B" /></Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        )}
      </MapContainer>

      <div style={{ position: 'absolute', top: 10, left: 54, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="red porsche, 1966 mustang, v8 swap, k03 tires..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ width: 340, padding: '6px 8px', fontSize: '11px', fontFamily: 'Arial, sans-serif', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          />
          <button onClick={handleSearch} disabled={searching} style={{ padding: '6px 12px', fontSize: '11px', fontFamily: 'Arial, sans-serif', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 600 }}>
            {searching ? '...' : 'Query'}
          </button>
          {activeQuery && (
            <button onClick={clearSearch} style={{ padding: '6px 8px', fontSize: '11px', fontFamily: 'Arial, sans-serif', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}>
              Clear
            </button>
          )}
        </div>
        {activeQuery && !searching && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', padding: '4px 8px', fontSize: '10px', color: 'var(--text-disabled)', fontFamily: 'Arial, sans-serif' }}>
            <strong style={{ color: '#F59E0B' }}>{queryTotal.toLocaleString()}</strong> match "{activeQuery}" — <strong>{queryResults.length.toLocaleString()}</strong> mapped
            {queryNoLoc.length > 0 && <>, <span style={{ color: 'var(--text-secondary)' }}>{queryNoLoc.length.toLocaleString()} no location</span></>}
          </div>
        )}
      </div>

      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, background: 'var(--bg)', padding: '8px 10px', border: '1px solid var(--border)', fontSize: '11px', fontFamily: 'Arial, sans-serif', color: 'var(--text)' }}>
        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-disabled)' }}>Layers</div>
        <LT label="Collections" color="#EC4899" checked={showCollections} set={setShowCollections} n={counts.collections} dim={hasQuery} />
        <LT label="Vehicles" color="#3B82F6" checked={showVehicles} set={setShowVehicles} n={counts.vehicles} dim={hasQuery} loading={vehLoading} />
        <LT label="Businesses" color="#22C55E" checked={showBusinesses} set={setShowBusinesses} n={counts.businesses} dim={hasQuery} />
        {activeQuery && <>
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
            <span style={{ color: '#F59E0B', fontWeight: 600 }}>Query</span>
            <span style={{ color: '#F59E0B', marginLeft: 'auto' }}>{counts.query.toLocaleString()}</span>
          </div>
        </>}
      </div>

      <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 1000, background: 'var(--bg)', padding: '4px 8px', border: '1px solid var(--border)', fontSize: '10px', fontFamily: 'Arial, sans-serif', color: 'var(--text-disabled)' }}>
        {hasQuery
          ? <>{counts.query.toLocaleString()} mapped / {queryTotal.toLocaleString()} total</>
          : <>{counts.total.toLocaleString()} items on map</>}
      </div>

      {queryNoLoc.length > 0 && (
        <div style={{ position: 'absolute', top: 80, left: 54, zIndex: 1000, width: 340, maxHeight: '50vh', overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', fontSize: '11px', fontFamily: 'Arial, sans-serif', color: 'var(--text)' }}>
          <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-disabled)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            No location ({queryNoLoc.length})
          </div>
          {queryNoLoc.slice(0, 50).map(r => (
            <a key={r.id} href={`/vehicle/${r.id}`} style={{ display: 'block', padding: '5px 8px', borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)' }}>
              {r.title}
              {r.loc && <span style={{ color: 'var(--text-disabled)', marginLeft: 8, fontSize: '10px' }}>{r.loc}</span>}
            </a>
          ))}
          {queryNoLoc.length > 50 && <div style={{ padding: '4px 8px', color: 'var(--text-disabled)', fontSize: '10px' }}>+{queryNoLoc.length - 50} more</div>}
        </div>
      )}
    </div>
  );
}

function LT({ label, color, checked, set, n, dim, loading }: {
  label: string; color: string; checked: boolean; set: (v: boolean) => void; n: number; dim?: boolean; loading?: boolean;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 0', opacity: dim ? 0.4 : 1 }}>
      <input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} />
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span>{label}</span>
      <span style={{ color: 'var(--text-secondary)', marginLeft: 'auto' }}>{loading ? '...' : n.toLocaleString()}</span>
    </label>
  );
}
