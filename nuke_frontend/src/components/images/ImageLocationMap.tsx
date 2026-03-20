import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons (same pattern as UnifiedMap)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// @ts-expect-error - Leaflet internal property access needed to fix default icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

/** Image with GPS coordinates for map display */
export interface GeoImage {
  id: string;
  image_url: string;
  thumbnail_url?: string | null;
  medium_url?: string | null;
  latitude: number;
  longitude: number;
  caption?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  created_at?: string | null;
}

interface ImageLocationMapProps {
  images: GeoImage[];
  /** Called when a marker is clicked -- parent can open a lightbox */
  onImageClick?: (imageId: string) => void;
  /** Map height in pixels (default 400) */
  height?: number;
}

// Small dot marker — minimal footprint, data-point aesthetic
const IMAGE_DOT = L.divIcon({
  className: '',
  html: `<div style="background:var(--info);width:5px;height:5px;border:1px solid rgba(255,255,255,.7)"></div>`,
  iconSize: [5, 5],
  iconAnchor: [2.5, 2.5],
  popupAnchor: [0, -3],
});

// Cluster icon -- matches project dark/utilitarian aesthetic
function createClusterIcon(cluster: any): L.DivIcon {
  const count: number = cluster.getChildCount();
  const size = count < 10 ? 20 : count < 100 ? 26 : 32;
  const fontSize = count < 100 ? 10 : 8;
  return L.divIcon({
    html: `<div style="
      background:rgba(59,130,246,0.9);
      color:#fff;
      width:${size}px;
      height:${size}px;
      border-radius:0;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:${fontSize}px;
      font-weight:700;
      border:2px solid #fff;
      box-shadow:none;
      font-family:Arial,sans-serif;
      line-height:1;
    ">${count}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Supabase storage render URL for small thumbnails */
function thumbUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes('/storage/v1/object/public/')) {
    return url.replace(
      '/storage/v1/object/public/',
      '/storage/v1/render/image/public/'
    ) + '?width=120&height=80&quality=70&resize=cover';
  }
  return url;
}

/** Auto-fit map bounds to contain all markers */
function FitBounds({ images }: { images: GeoImage[] }) {
  const map = useMap();

  React.useEffect(() => {
    if (images.length === 0) return;

    if (images.length === 1) {
      map.setView([images[0].latitude, images[0].longitude], 14);
      return;
    }

    const bounds = L.latLngBounds(
      images.map((img) => [img.latitude, img.longitude] as [number, number])
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [images, map]);

  return null;
}

const ImageLocationMap: React.FC<ImageLocationMapProps> = ({
  images,
  onImageClick,
  height = 400,
}) => {
  // Compute centroid for initial center
  const center = useMemo<[number, number]>(() => {
    if (images.length === 0) return [39.8, -98.6]; // US center fallback
    const avgLat = images.reduce((s, i) => s + i.latitude, 0) / images.length;
    const avgLng = images.reduce((s, i) => s + i.longitude, 0) / images.length;
    return [avgLat, avgLng];
  }, [images]);

  if (images.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface, #1a1a2e)',
          border: '1px solid var(--border, #333)',
          color: 'var(--text-disabled, #666)',
          fontSize: '12px',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        No images with GPS coordinates
      </div>
    );
  }

  return (
    <div
      style={{
        height,
        width: '100%',
        position: 'relative',
        border: '1px solid var(--border, #333)',
      }}
    >
      {/* Image count badge */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 1000,
          background: 'var(--bg, #0d0d1a)',
          border: '1px solid var(--border, #333)',
          padding: '3px 8px',
          fontSize: '10px',
          fontFamily: 'Arial, sans-serif',
          color: 'var(--text-secondary, #999)',
        }}
      >
        {images.length} geotagged image{images.length !== 1 ? 's' : ''}
      </div>

      <MapContainer
        center={center}
        zoom={10}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FitBounds images={images} />

        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          showCoverageOnHover={false}
          disableClusteringAtZoom={15}
          iconCreateFunction={createClusterIcon}
        >
          {images.map((img) => {
            const thumb =
              thumbUrl(img.thumbnail_url) ||
              thumbUrl(img.medium_url) ||
              thumbUrl(img.image_url);

            const locationLabel = [img.location_city, img.location_state]
              .filter(Boolean)
              .join(', ');

            return (
              <Marker
                key={img.id}
                position={[img.latitude, img.longitude]}
                icon={IMAGE_DOT}
                eventHandlers={{
                  click: () => onImageClick?.(img.id),
                }}
              >
                <Tooltip
                  direction="top"
                  offset={[0, -8]}
                  opacity={1}
                  className="image-map-tooltip"
                >
                  <div
                    style={{
                      width: 140,
                      fontFamily: 'Arial, sans-serif',
                      fontSize: '10px',
                      background: '#1a1a2e',
                      color: 'var(--border)',
                      padding: 0, }}
                  >
                    {thumb && (
                      <img
                        src={thumb}
                        alt=""
                        style={{
                          width: '100%',
                          height: 80,
                          objectFit: 'cover',
                          display: 'block',
                          background: '#111',
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    {locationLabel && (
                      <div style={{ padding: '3px 5px', color: 'var(--text-disabled)' }}>
                        {locationLabel}
                      </div>
                    )}
                    {img.created_at && (
                      <div
                        style={{
                          padding: '0 5px 3px',
                          color: 'var(--text-secondary)',
                          fontSize: '9px',
                        }}
                      >
                        {new Date(img.created_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </Tooltip>
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>

      {/* Override leaflet tooltip styling for dark theme */}
      <style>{`
        .image-map-tooltip {
          background: #1a1a2e !important;
          border: 1px solid #333 !important;
          border-radius: 0 !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        .image-map-tooltip::before {
          border-top-color: #333 !important;
        }
        .image-map-tooltip .leaflet-tooltip-top::before {
          border-top-color: #333 !important;
        }
      `}</style>
    </div>
  );
};

export default ImageLocationMap;
