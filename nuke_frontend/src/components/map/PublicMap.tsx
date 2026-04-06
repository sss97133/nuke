import React, { useState, useEffect, useCallback } from 'react';
import MapGL, { Source, Layer, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '../../lib/supabase';
import { CARTO_DARK } from './constants';

// ── Types ────────────────────────────────────────────────────

interface OrgPin {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  type: string | null;
  color: string;
  logoUrl: string | null;
}

interface OrgDetail {
  id: string;
  name: string;
  business_type: string | null;
  website: string | null;
  description: string | null;
  brandColor: string | null;
  logoUrl: string | null;
  address: string | null;
  photos: string[];
  bannerUrl: string | null;
}

// ── Helpers ──────────────────────────────────────────────────

function hexToRgbStr(hex: string | null): string {
  if (!hex) return 'rgb(20,184,166)';
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return 'rgb(20,184,166)';
  return `rgb(${parseInt(m[0], 16)},${parseInt(m[1], 16)},${parseInt(m[2], 16)})`;
}

// ── Detail Panel ─────────────────────────────────────────────

function OrgDetailPanel({ orgId, slug, onClose }: { orgId: string; slug: string; onClose: () => void }) {
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);

      // Fetch org data
      const { data: org } = await supabase
        .from('organizations')
        .select('id, name, business_type, website, metadata, brand_design_language, slug')
        .eq('id', orgId)
        .single();

      if (cancelled || !org) { setLoading(false); return; }

      const bdl = org.brand_design_language as any;
      const meta = org.metadata as any;

      // Fetch assets by slug
      const orgSlug = org.slug || slug;
      const { data: assets } = await supabase
        .from('org_assets')
        .select('asset_type, asset_url')
        .eq('org_slug', orgSlug);

      // Fetch address
      const { data: locs } = await supabase
        .from('organization_locations')
        .select('street_address, city')
        .eq('organization_id', orgId)
        .eq('is_primary', true)
        .limit(1);

      if (cancelled) return;

      const photos = (assets || [])
        .filter((a: any) => a.asset_type === 'photo' || a.asset_type === 'banner')
        .map((a: any) => a.asset_url);

      const banner = (assets || []).find((a: any) => a.asset_type === 'banner');

      const addr = locs?.[0];
      const address = addr ? [addr.street_address, addr.city].filter(Boolean).join(', ') : null;

      setDetail({
        id: org.id,
        name: org.name || 'Unknown',
        business_type: org.business_type,
        website: org.website || meta?.website || null,
        description: meta?.description || null,
        brandColor: bdl?.colors?.primary || null,
        logoUrl: bdl?.logos?.svg || bdl?.logos?.primary_dark || bdl?.logos?.primary_light || null,
        address,
        photos,
        bannerUrl: banner?.asset_url || photos[0] || null,
      });
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [orgId, slug]);

  if (loading) {
    return (
      <div style={panelStyle}>
        <button onClick={onClose} style={closeBtnStyle}>×</button>
        <div style={{ padding: 20, color: 'rgba(255,255,255,0.5)', fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase' }}>
          Loading...
        </div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div style={panelStyle}>
      <button onClick={onClose} style={closeBtnStyle}>×</button>

      {/* Hero image */}
      {detail.bannerUrl && (
        <img
          src={detail.bannerUrl}
          alt=""
          style={{ width: '100%', height: 160, objectFit: 'cover' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      <div style={{ padding: '14px 16px' }}>
        {/* Logo */}
        {detail.logoUrl && (
          <div style={{ marginBottom: 10 }}>
            <img
              src={detail.logoUrl}
              alt=""
              style={{ maxHeight: 32, maxWidth: '70%', objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.85 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
        )}

        {/* Name */}
        <div style={{
          fontSize: 15, fontWeight: 700, letterSpacing: '0.5px',
          color: detail.brandColor || '#fff', marginBottom: 4,
        }}>
          {detail.name}
        </div>

        {/* Type */}
        {detail.business_type && (
          <div style={{
            display: 'inline-block', fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '1px', padding: '2px 6px', border: '1px solid rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.5)', marginBottom: 8,
          }}>
            {detail.business_type}
          </div>
        )}

        {/* Address */}
        {detail.address && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            {detail.address}
          </div>
        )}

        {/* Description */}
        {detail.description && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, marginBottom: 10 }}>
            {detail.description.slice(0, 200)}{detail.description.length > 200 ? '...' : ''}
          </div>
        )}

        {/* Website */}
        {detail.website && (
          <a
            href={detail.website}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block', fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '1px', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', textDecoration: 'none', marginBottom: 12,
            }}
          >
            Website
          </a>
        )}

        {/* Photo gallery */}
        {detail.photos.length > 1 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
              Photos ({detail.photos.length})
            </div>
            <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
              {detail.photos.slice(0, 6).map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt=""
                  style={{ width: 80, height: 56, objectFit: 'cover', flexShrink: 0 }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Open full profile */}
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
          <a
            href={`/org/${detail.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'rgba(255,255,255,0.4)', textDecoration: 'none', textTransform: 'uppercase' }}
          >
            Open Full Profile →
          </a>
        </div>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0, right: 0, bottom: 0,
  width: 320,
  background: 'rgba(10, 10, 18, 0.95)',
  backdropFilter: 'blur(8px)',
  borderLeft: '2px solid rgba(255,255,255,0.08)',
  overflowY: 'auto',
  zIndex: 1020,
  fontFamily: 'Arial, sans-serif',
};

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute', top: 8, right: 8, zIndex: 10,
  background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff',
  width: 24, height: 24, fontSize: 16, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

// ── Main Map ─────────────────────────────────────────────────

export default function PublicMap() {
  const [orgs, setOrgs] = useState<OrgPin[]>([]);
  const [selected, setSelected] = useState<OrgPin | null>(null);

  const params = new URLSearchParams(window.location.search);
  const initLat = parseFloat(params.get('lat') || '17.9');
  const initLng = parseFloat(params.get('lng') || '-62.833');
  const initZoom = parseFloat(params.get('zoom') || '14');

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug, latitude, longitude, business_type, brand_design_language')
        .not('latitude', 'is', null)
        .limit(5000);

      if (error) console.error('Org query error:', error);
      if (data) {
        console.log(`Loaded ${data.length} orgs with GPS`);
        setOrgs(data.map((b: any) => {
          const bdl = b.brand_design_language;
          return {
            id: b.id,
            slug: b.slug || '',
            name: b.name || 'Unknown',
            lat: b.latitude,
            lng: b.longitude,
            type: b.business_type,
            color: hexToRgbStr(bdl?.colors?.primary),
            logoUrl: bdl?.logos?.svg || bdl?.logos?.primary_dark || bdl?.logos?.primary_light || null,
          };
        }));
      }
    }
    load();
  }, []);

  const geojson = React.useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: orgs.map(o => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [o.lng, o.lat] },
      properties: { id: o.id, name: o.name, type: o.type || '', color: o.color },
    })),
  }), [orgs]);

  const handleClick = useCallback((e: any) => {
    const f = e.features?.[0];
    if (f) {
      const org = orgs.find(o => o.id === f.properties.id);
      if (org) setSelected(org);
    } else {
      setSelected(null);
    }
  }, [orgs]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <MapGL
        initialViewState={{ longitude: initLng, latitude: initLat, zoom: initZoom }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={CARTO_DARK}
        interactiveLayerIds={['org-circles']}
        onClick={handleClick}
      >
        <NavigationControl position="top-right" />

        {orgs.length > 0 && (
          <Source id="orgs" type="geojson" data={geojson}>
            <Layer
              id="org-circles"
              type="circle"
              paint={{
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 7, 17, 11],
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 1,
                'circle-stroke-color': 'rgba(255,255,255,0.4)',
                'circle-opacity': 0.85,
              }}
            />
            <Layer
              id="org-labels"
              type="symbol"
              minzoom={15}
              layout={{
                'text-field': ['get', 'name'],
                'text-size': 10,
                'text-offset': [1, 0],
                'text-anchor': 'left',
                'text-max-width': 12,
              }}
              paint={{
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(0,0,0,0.85)',
                'text-halo-width': 1.5,
              }}
            />
          </Source>
        )}
      </MapGL>

      {/* Detail panel */}
      {selected && (
        <OrgDetailPanel
          orgId={selected.id}
          slug={selected.slug}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
