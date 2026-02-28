import React, { useState, useEffect, useCallback } from 'react';
import ImageGalleryV2 from '../../components/image/ImageGalleryV2';
import VehicleContributors from '../../components/VehicleContributors';
import { supabase } from '../../lib/supabase';
import type { VehicleImageGalleryProps } from './types';
import type { GeoImage } from '../../components/images/ImageLocationMap';

// Lazy-load map component -- only fetched when user clicks "Show Map"
const ImageLocationMap = React.lazy(
  () => import('../../components/images/ImageLocationMap')
);

const VehicleImageGallery: React.FC<VehicleImageGalleryProps> = ({
  vehicle,
  session,
  permissions,
  showMap,
  onToggleMap,
  onImageUpdate
}) => {
  const [geoImages, setGeoImages] = useState<GeoImage[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoChecked, setGeoChecked] = useState(false);

  // Show upload if user is logged in AND (has contributor access OR is verified owner OR is db uploader)
  const canUpload = Boolean(
    session?.user && (
      permissions.hasContributorAccess ||
      permissions.isVerifiedOwner ||
      permissions.isDbUploader ||
      session.user?.id === vehicle.user_id
    )
  );

  // Check for GPS-tagged images on mount (lightweight count-first approach)
  useEffect(() => {
    let cancelled = false;

    const checkGeoImages = async () => {
      try {
        // Quick count query first to see if any GPS data exists
        const { count, error } = await supabase
          .from('vehicle_images')
          .select('id', { count: 'exact', head: true })
          .eq('vehicle_id', vehicle.id)
          .not('latitude', 'is', null)
          .not('longitude', 'is', null);

        if (!cancelled && !error) {
          setGeoChecked(true);
          // If no GPS images, we know upfront -- no need to load full data
          if ((count ?? 0) === 0) {
            setGeoImages([]);
          }
        }
      } catch {
        if (!cancelled) setGeoChecked(true);
      }
    };

    checkGeoImages();
    return () => { cancelled = true; };
  }, [vehicle.id]);

  // Load full geo image data only when map is toggled on
  const loadGeoImages = useCallback(async () => {
    if (geoImages.length > 0) return; // Already loaded
    setGeoLoading(true);

    try {
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, medium_url, latitude, longitude, caption, exif_data, created_at')
        .eq('vehicle_id', vehicle.id)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .or('is_duplicate.is.null,is_duplicate.eq.false')
        .not('is_document', 'is', true)
        .order('created_at', { ascending: true })
        .limit(500);

      if (!error && data) {
        const mapped: GeoImage[] = data.map((row: any) => ({
          id: row.id,
          image_url: row.image_url,
          thumbnail_url: row.thumbnail_url,
          medium_url: row.medium_url,
          latitude: row.latitude,
          longitude: row.longitude,
          caption: row.caption,
          location_city: row.exif_data?.location?.city ?? null,
          location_state: row.exif_data?.location?.state ?? null,
          created_at: row.created_at,
        }));
        setGeoImages(mapped);
      }
    } catch (err) {
      console.warn('Failed to load geo images:', err);
    } finally {
      setGeoLoading(false);
    }
  }, [vehicle.id, geoImages.length]);

  // When map is toggled on, fetch geo data if needed
  useEffect(() => {
    if (showMap && geoImages.length === 0 && geoChecked) {
      loadGeoImages();
    }
  }, [showMap, geoChecked, loadGeoImages, geoImages.length]);

  // After checking, if count was 0, disable
  const geoDisabled = geoChecked && geoImages.length === 0 && !showMap && !geoLoading;

  const handleImageClick = useCallback((imageId: string) => {
    // Scroll to gallery and potentially open lightbox
    // For now, log click -- lightbox integration would require ImageGallery ref exposure
    console.debug('[ImageLocationMap] Marker clicked:', imageId);
  }, []);

  return (
    <div className="card" style={{ gridColumn: '2 / span 1' }}>
      <div className="card-body">
        {/* Map section -- rendered above gallery when active */}
        {showMap && (
          <div style={{ marginBottom: 16 }}>
            <React.Suspense
              fallback={
                <div
                  style={{
                    height: 400,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--surface, #1a1a2e)',
                    border: '1px solid var(--border, #333)',
                    color: 'var(--text-disabled, #666)',
                    fontSize: '11px',
                    fontFamily: 'Arial, sans-serif',
                  }}
                >
                  Loading map...
                </div>
              }
            >
              {geoLoading ? (
                <div
                  style={{
                    height: 400,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--surface, #1a1a2e)',
                    border: '1px solid var(--border, #333)',
                    color: 'var(--text-disabled, #666)',
                    fontSize: '11px',
                    fontFamily: 'Arial, sans-serif',
                  }}
                >
                  Loading geotagged images...
                </div>
              ) : (
                <ImageLocationMap
                  images={geoImages}
                  onImageClick={handleImageClick}
                  height={400}
                />
              )}
            </React.Suspense>
          </div>
        )}

        <ImageGalleryV2
          vehicleId={vehicle.id}
          vehicleYMM={{ year: vehicle.year, make: vehicle.make, model: vehicle.model }}
          onImagesUpdated={onImageUpdate}
          showUpload={canUpload}
        />

        {/* Contributors section */}
        <div className="mt-4">
          <VehicleContributors vehicleId={vehicle.id} />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              className="button button-small"
              onClick={onToggleMap}
              disabled={geoDisabled}
              title={
                geoDisabled
                  ? 'No GPS data available'
                  : showMap
                    ? 'Hide image location map'
                    : 'Show image locations on map'
              }
              style={geoDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              {showMap ? 'Hide Map' : 'Show Map'}
            </button>
            {geoDisabled && (
              <span
                style={{
                  fontSize: '10px',
                  color: 'var(--text-disabled, #666)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                No GPS data
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VehicleImageGallery;
