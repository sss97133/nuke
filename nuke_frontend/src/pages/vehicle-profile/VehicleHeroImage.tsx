import React, { useState, useEffect, useCallback } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import MobileImageGallery from '../../components/image/MobileImageGallery';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BadgePortal } from '../../components/badges/BadgePortal';
import { openVehiclePhoto, openVehiclePhotoByUrl } from './VehiclePhotoLightbox';
import { useVehicleImageEvidence, relatedFieldImages } from './hooks/useVehicleImageEvidence';

interface VehicleHeroImageProps {
  overlayNode?: React.ReactNode;
}

function ContextualHero({ vehicleId, field, label, onClear }: { vehicleId: string; field: string; label: string; onClear: () => void }) {
  const inventory = useVehicleImageEvidence(vehicleId, field);
  const [index, setIndex] = useState(0);
  const images = relatedFieldImages(inventory.data?.images || [], field);
  const image = images[index % (images.length || 1)];
  return <section className="vp-context-hero" aria-label={`${label} photographs of this vehicle`}>
    <div className="vp-context-hero__head"><span>{label} · related areas</span><button type="button" onClick={onClear}>All photos</button></div>
    {image ? <>
      <button type="button" className="vp-context-hero__photo" onClick={() => openVehiclePhoto(image.id)} aria-label={`Open ${label} photograph ${index + 1}`}>
        <img src={image.medium_url || image.image_url} alt={`${label} · ${(image.vehicle_zone || '').replace(/_/g, ' ')}`} width={1260} height={840} />
      </button>
      <div className="vp-context-hero__thumbnails">{images.map((item, position) => <button key={item.id} type="button" aria-label={`Show ${label} photograph ${position + 1}`} aria-pressed={position === index} onClick={() => setIndex(position)}>
        <img src={item.thumbnail_url || item.medium_url || item.image_url} alt="" width={64} height={48} loading="lazy" />
      </button>)}</div>
    </> : <p role="status">{inventory.isPending ? 'Reading related photographs…' : inventory.isError ? 'Related photographs could not be read.' : 'No related image areas are indexed in the records read.'}</p>}
    {inventory.data && !inventory.data.complete && <p className="vp-context-hero__note">Showing {inventory.data.images.length} of {inventory.data.total ?? 'unknown'} available photographs.</p>}
  </section>;
}

const VehicleHeroImage: React.FC<VehicleHeroImageProps> = ({ overlayNode }) => {
  const { leadImageUrl, heroMeta, vehicleId, galleryFilter, setGalleryFilter } = useVehicleProfile();
  // Fill the profile frame; Fit and the photo viewer retain the complete image.
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('cover');
  const [showGallery, setShowGallery] = useState(false);
  const isMobile = useIsMobile();

  const getSupabaseRenderUrl = (publicObjectUrl: string, width: number, quality = 90): string | null => {
    try {
      const url = String(publicObjectUrl || '').trim();
      if (!url) return null;
      const marker = '/storage/v1/object/public/';
      const idx = url.indexOf(marker);
      if (idx < 0) return null;
      const base = url.slice(0, idx);
      const path = url.slice(idx + marker.length).split('?')[0];
      if (!path) return null;
      // resize=contain required — Supabase /render/image defaults to resize=cover which crops portrait iPhone photos.
      return `${base}/storage/v1/render/image/public/${path}?width=${width}&quality=${quality}&resize=contain`;
    } catch {
      return null;
    }
  };

  const { vehicle } = useVehicleProfile();
  const v = vehicle as any;

  // The canonical reader has screened the lead image. Gallery URLs have not
  // passed that selection and must not re-promote a rejected document on error.
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());
  const [fullLoaded, setFullLoaded] = useState(false);
  const candidates = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of [leadImageUrl]) {
      const s = u ? String(u).trim() : '';
      if (!s || s === 'undefined' || s === 'null' || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }, [leadImageUrl]);
  const src = candidates.find((u) => !failedUrls.has(u)) || '';
  const handleHeroError = useCallback(() => {
    if (!src) return;
    setFailedUrls((prev) => {
      const next = new Set(prev);
      next.add(src);
      return next;
    });
    setFullLoaded(false);
  }, [src]);
  useEffect(() => { setFullLoaded(false); }, [src]);

  // Build srcset + heroSrc unconditionally (no-photo branch ignores them).
  // Skip Supabase render endpoint for hero — it strips EXIF orientation,
  // causing landscape photos to display as portrait. Browsers handle EXIF
  // orientation natively (image-orientation: from-image is default in all
  // modern browsers). Use original URL for correct orientation.
  const imgUrl = src;
  const srcset420 = getSupabaseRenderUrl(imgUrl, 420);
  const srcset840 = getSupabaseRenderUrl(imgUrl, 840);
  const srcset1260 = getSupabaseRenderUrl(imgUrl, 1260);
  const srcSetAttr = (srcset420 && srcset840 && srcset1260)
    ? `${srcset420} 420w, ${srcset840} 840w, ${srcset1260} 1260w`
    : undefined;
  const heroSrc = srcset840 || imgUrl;
  // Thumbnail-then-full: a ~2KB 64px render paints near-instantly underneath
  // the full-size image, so the hero is never a black box while the real
  // frame decodes.
  const heroThumbSrc = getSupabaseRenderUrl(imgUrl, 64, 40);

  // Preload the static lead until the viewer selects a photo topic.
  useEffect(() => {
    if (galleryFilter?.field) return;
    if (!heroSrc || typeof document === 'undefined') return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = heroSrc;
    if (srcSetAttr) (link as any).imagesrcset = srcSetAttr;
    (link as any).imagesizes = '(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 1260px';
    (link as any).fetchPriority = 'high';
    document.head.appendChild(link);
    return () => {
      try { document.head.removeChild(link); } catch { /* noop */ }
    };
  }, [heroSrc, srcSetAttr, galleryFilter?.field]);

  if (vehicleId && galleryFilter?.field) return <ContextualHero key={`${vehicleId}:${galleryFilter.field}:${galleryFilter.label}`}
    vehicleId={vehicleId} field={galleryFilter.field} label={galleryFilter.label || galleryFilter.field.replace(/_/g, ' ')} onClear={() => setGalleryFilter(null)} />;

  if (!src || src === 'undefined' || src === 'null') {
    // No photo: show spec card with clickable badges (zero dead ends)
    return (
      <div style={{
        width: '100%',
        height: 'var(--h-hero, 420px)',
        backgroundColor: 'var(--text)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          color: 'var(--text-disabled)',
          maxWidth: '400px',
        }}>
          {/* Vehicle identity */}
          <div style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.5px',
            color: 'var(--surface)',
            textAlign: 'center',
          }}>
            {[v?.year, v?.make, v?.model].filter(Boolean).join(' ') || 'VEHICLE'}
          </div>

          {/* Badge portals — every piece of data is explorable */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
            {v?.year && <BadgePortal dimension="year" value={v.year} label={String(v.year)} variant="source" />}
            {v?.make && <BadgePortal dimension="make" value={v.make} label={String(v.make).toUpperCase()} variant="source" />}
            {v?.model && <BadgePortal dimension="model" value={v.model} modelMake={v.make} label={String(v.model).toUpperCase()} variant="source" />}
            {v?.body_style && <BadgePortal dimension="body_style" value={v.body_style} label={String(v.body_style).toUpperCase()} variant="status" />}
            {v?.transmission && (
              <BadgePortal
                dimension="transmission"
                value={v.transmission}
                label={String(v.transmission).toUpperCase()}
                variant="status"
              />
            )}
          </div>

          <span style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '8px',
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase' as const,
            marginTop: '4px',
          }}>
            {candidates.length > 0 ? 'PHOTO UNAVAILABLE' : 'NO PHOTO'} · EXPLORE BY BADGE
          </span>
        </div>
      </div>
    );
  }

  // Build metadata parts (only render fields that exist)
  const metaParts: string[] = [];
  if (heroMeta?.camera) metaParts.push(heroMeta.camera);
  if (heroMeta?.location) metaParts.push(heroMeta.location);
  if (heroMeta?.date) metaParts.push(heroMeta.date);

  return (
    <>
      <div>
        <div style={{ overflow: 'hidden' }}>
          {/* hero-media-slot: static image now, carousel/livestream later */}
          <div className="hero-media-slot">
            <div
              style={{
                width: '100%',
                height: 'var(--h-hero, 420px)',
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: 'var(--bg)',
                cursor: 'pointer',
              }}
              onClick={() => {
                if (isMobile) setShowGallery(true);
                else if (src) openVehiclePhotoByUrl(src);
              }}
            >
              {/* Dark backdrop in contain mode — solid color, not blurred image.
                  CSS background-image doesn't reliably respect EXIF orientation,
                  and the blur effect looks bad on portrait images. */}
              {fitMode === 'contain' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'var(--bg)',
                  }}
                />
              )}

              {/* Image — fixed frame, toggle between contain and cover.
                  Speed: eager+async+fetchpriority=high on LCP candidate.
                  srcset/sizes lets mobile pull a 420w variant. */}
              {heroThumbSrc && !fullLoaded && (
                <img
                  src={heroThumbSrc}
                  alt=""
                  aria-hidden
                  loading="eager"
                  decoding="async"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: fitMode,
                    objectPosition: 'center',
                    filter: 'blur(6px)',
                  }}
                />
              )}
                <img
                  src={heroSrc}
                  srcSet={srcSetAttr}
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 1260px"
                  alt=""
                  loading="eager"
                  decoding="async"
                  onLoad={() => setFullLoaded(true)}
                  onError={handleHeroError}
                  {...({ fetchpriority: 'high' } as any)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: fitMode,
                    objectPosition: 'center',
                  }}
                />

              {/* Overlay (auction banners etc) */}
              {overlayNode && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 }}>{overlayNode}</div>
              )}

              {/* Retain access to the complete original composition. */}
              <button
                onClick={e => { e.stopPropagation(); setFitMode(m => m === 'cover' ? 'contain' : 'cover'); }}
                type="button"
                className="vp-photo-fit"
                aria-label={fitMode === 'cover' ? 'Fit whole photo' : 'Fill photo area'}
              >
                {fitMode === 'cover' ? 'FIT' : 'FILL'}
              </button>
            </div>
          </div>

          {/* Metadata bar removed — clean hero like BaT */}
        </div>
      </div>

      {isMobile && showGallery && (
        <MobileImageGallery
          key={vehicleId}
          vehicleId={vehicleId}
          leadImageUrl={leadImageUrl}
          onClose={() => setShowGallery(false)}
        />
      )}
    </>
  );
};

export default VehicleHeroImage;
