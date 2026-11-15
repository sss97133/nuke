/** The cited photograph, under the same access and gallery rules as the profile. */
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import Link from '../../components/PrefetchLink';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/button';
import { Text } from '../../kit';
import { supabase } from '../../lib/supabase';
import { vehicleImageGallerySource } from '../../lib/vehicleImageColumns';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { webSourceUrl, readImageWitnesses } from './hooks/useVehicleImageEvidence';
import './vehicle-evidence-detail.css';

type Photo = { id: string; vehicle_id: string; image_url: string; medium_url?: string | null;
  thumbnail_url?: string | null; is_sensitive?: boolean | null; is_document?: boolean | null; doc_flag?: boolean | null; is_duplicate?: boolean | null; taken_at?: string | null; is_superseded?: boolean | null; superseded_by?: string | null };
type Vehicle = { id: string; year: number | null; make: string | null; model: string | null; trim: string | null };
type Reference = { id: string; label: string; at: string | null };
const REFERENCE_LABELS: Record<string, string> = {
  specification: 'Specification record', condition: 'Condition record', work_record: 'Work record',
  sale_result: 'Sale record', listing: 'Listing record', service: 'Service record',
};
const PHOTO_COLUMNS = 'id,vehicle_id,image_url,medium_url,thumbnail_url,taken_at,is_superseded,superseded_by,is_sensitive,is_document,doc_flag,is_duplicate';
function visiblePhoto(row: Photo | null, id: string, vehicleId: string): row is Photo {
  return !!row && !!webSourceUrl(row.image_url) && row.id === id && row.vehicle_id === vehicleId && !row.is_superseded && !row.superseded_by
    && row.is_sensitive !== true && row.is_document !== true && row.doc_flag !== true && row.is_duplicate !== true;
}
function dateLabel(value?: string | null) {
  if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
export function imageReferenceLinks(rows: unknown, vehicleId: string): Reference[] {
  if (!Array.isArray(rows)) return [];
  const links = new Map<string, Reference>();
  for (const row of rows) {
    const observation = row?.observation;
    if (!observation || observation.vehicle_id !== vehicleId || observation.is_superseded !== false
      || observation.superseded_by != null || typeof observation.id !== 'string' || typeof observation.kind !== 'string' || !Object.prototype.hasOwnProperty.call(REFERENCE_LABELS, observation.kind)) continue;
    links.set(observation.id, { id: observation.id, label: REFERENCE_LABELS[observation.kind], at: dateLabel(observation.observed_at) });
  }
  return [...links.values()];
}

const ImagePageContent: React.FC = () => {
  const { vehicleId, imageId } = useParams<{ vehicleId: string; imageId: string }>();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable' | 'error' | 'replaced'>('loading');
  const [replacement, setReplacement] = useState<string | null>(null);
  const [links, setLinks] = useState<Reference[]>([]);
  const [linksFailed, setLinksFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [rendition, setRendition] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false, expired = false, acceptedPhoto = false;
    const controller = new AbortController();
    const active = () => !cancelled && !expired;
    setVehicle(null); setPhoto(null); setLinks([]); setReplacement(null);
    setPhase('loading'); setLinksFailed(false); setRendition(0); setZoomed(false);
    const deadline = window.setTimeout(() => {
      expired = true; controller.abort();
      if (!cancelled) { if (acceptedPhoto) setLinksFailed(true); else setPhase('error'); }
    }, 10_000);
    const readGalleryPhoto = async (id: string) => {
      const source = await vehicleImageGallerySource();
      return supabase.from(source).select(PHOTO_COLUMNS).eq('id', id).eq('vehicle_id', vehicleId)
        .eq('vehicle_image_gallery_eligible', true).not('is_sensitive', 'is', true).not('is_document', 'is', true)
        .not('doc_flag', 'is', true).not('is_duplicate', 'is', true).abortSignal(controller.signal).maybeSingle();
    };
    void (async () => {
      try {
        if (!vehicleId || !imageId) { setPhase('unavailable'); return; }
        const vehicleRead = await supabase.from('vehicles').select('id,year,make,model,trim')
          .eq('id', vehicleId).abortSignal(controller.signal).maybeSingle();
        if (!active()) return;
        if (vehicleRead.error) throw Error('read');
        if (!vehicleRead.data || vehicleRead.data.id !== vehicleId) { setPhase('unavailable'); return; }
        setVehicle(vehicleRead.data as Vehicle);
        // Reference metadata can establish a historical replacement, never permission to show pixels.
        const reference = await supabase.from('vehicle_images').select('id,vehicle_id,is_superseded,superseded_by')
          .eq('id', imageId).eq('vehicle_id', vehicleId).abortSignal(controller.signal).maybeSingle();
        if (!active()) return;
        if (reference.error) throw Error('read');
        if (!reference.data || reference.data.id !== imageId || reference.data.vehicle_id !== vehicleId) { setPhase('unavailable'); return; }
        if (reference.data.is_superseded || reference.data.superseded_by) {
          setPhase('replaced');
          const next = reference.data.superseded_by;
          if (next && next !== imageId) {
            const nextRead = await readGalleryPhoto(next);
            if (!active()) return;
            if (nextRead.error) throw Error('read');
            if (visiblePhoto(nextRead.data as Photo | null, next, vehicleId)) setReplacement(next);
          }
          return;
        }
        const gallery = await readGalleryPhoto(imageId);
        if (!active()) return;
        if (gallery.error) throw Error('read');
        if (!visiblePhoto(gallery.data as Photo | null, imageId, vehicleId)) { setPhase('unavailable'); return; }
        acceptedPhoto = true;
        setPhoto(gallery.data as Photo); setPhase('ready');
        const witnesses = await readImageWitnesses(imageId, controller.signal, 'references');
        if (!active()) return;
        if (witnesses.error) setLinksFailed(true);
        else setLinks(imageReferenceLinks(witnesses.data, vehicleId));
      } catch {
        if (active()) { if (acceptedPhoto) setLinksFailed(true); else setPhase('error'); }
      } finally { window.clearTimeout(deadline); }
    })();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(deadline); };
  }, [vehicleId, imageId, attempt]);

  const label = vehicle ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ') : 'Vehicle';
  const taken = dateLabel(photo?.taken_at);
  const renditions = [...new Set([optimizeImageUrl(webSourceUrl(photo?.image_url), 'large'), photo?.medium_url, photo?.thumbnail_url]
    .map(url => webSourceUrl(url)).filter((url): url is string => !!url
      && (!/\.hei[cf](?:[?#]|$)/i.test(url) || url.includes('/storage/v1/render/image/'))))];
  const src = renditions[rendition] ?? null;
  const retry = () => setAttempt(value => value + 1);
  const toggleZoom = () => { setZoomed(value => !value); viewport.current?.scrollTo?.({ left: 0, top: 0 }); };
  return <main className="source-photo-page">
    <header className="source-photo-bar">
      <Link to={vehicleId ? `/vehicle/${vehicleId}` : '/vehicles'}>← {label}</Link>
      {taken && <Text role="caption" as="span"><time dateTime={photo!.taken_at!}>Taken {taken}</time></Text>}
      {phase === 'ready' && src && <Button type="button" variant="secondary" aria-pressed={zoomed}
        onClick={toggleZoom}>{zoomed ? 'Fit photo' : 'Zoom in'}</Button>}
    </header>
    {phase === 'loading' && <Text role="caption" as="p" aria-live="polite">Loading photo…</Text>}
    {phase === 'unavailable' && <div className="source-photo-message"><p>Photo unavailable.</p><Button variant="secondary" onClick={retry}>Try again</Button></div>}
    {phase === 'error' && <div className="source-photo-message"><p role="alert">Couldn’t load this photo.</p><Button variant="secondary" onClick={retry}>Try again</Button></div>}
    {phase === 'replaced' && <div className="source-photo-message"><p>This photo is no longer current.</p>
      {replacement && <Link to={`/vehicle/${vehicleId}/image/${replacement}`}>View replacement photo</Link>}</div>}
    {phase === 'ready' && <>
      {src ? <div ref={viewport} className={`source-photo-viewport${zoomed ? ' is-zoomed' : ''}`}
        role="region" aria-label="Photo viewer" tabIndex={zoomed ? 0 : -1}
        onKeyDown={event => { if (event.key === 'Escape') setZoomed(false); }}>
        <button type="button" className="source-photo-zoom" onClick={toggleZoom}
          aria-label={zoomed ? 'Fit photo to screen' : 'Zoom into photo'}>
          <img src={src} alt={`Photo of ${label}`} width={1200} height={900} decoding="async"
            onError={() => { setRendition(index => index + 1); setZoomed(false); }} />
        </button>
      </div> : <div className="source-photo-message"><p role="alert">Photo couldn’t be displayed.</p><Button variant="secondary" onClick={retry}>Try again</Button></div>}
      {links.length > 0 && <nav className="source-photo-references" aria-label="Related records">
        {links.map(link => <Link key={link.id} to={`/vehicle/${vehicleId}/observation/${link.id}`}>
          {link.label}{link.at ? ` · ${link.at}` : ''}</Link>)}
      </nav>}
      {linksFailed && <Button variant="secondary" onClick={retry}>Retry related records</Button>}
    </>}
  </main>;
};

/** Never carry a prior viewer's image across sign-out or a subject change. */
const ImagePage: React.FC = () => {
  const { user, loading } = useAuth();
  const { vehicleId, imageId } = useParams();
  if (loading) return <main className="source-photo-page"><Text role="caption" as="p">Loading photo…</Text></main>;
  return <ImagePageContent key={`${user?.id || 'public'}:${vehicleId}:${imageId}`} />;
};
export default ImagePage;
