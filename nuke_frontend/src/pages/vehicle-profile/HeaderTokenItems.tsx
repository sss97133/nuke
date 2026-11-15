import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { ItemList, Text } from '../../kit';
import type { FacetItem, TokenItems } from '../../kit/types';
import type { OneMapFocus } from '../../components/map/OneMap';
import { useFieldProvenance, currentImageObservations } from './hooks/useFieldProvenance';
import { useVehicleImageEvidence } from './hooks/useVehicleImageEvidence';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

const OneMap = React.lazy(() => import('../../components/map/OneMap'));

/** The map item's area as a OneMap focus: its county outline and the area's centroid. Area grain only, never a point. */
function mapFocus(item: FacetItem): OneMapFocus | null {
  const v = item.value as { label?: string; county_fips?: string; bounds?: { county_fips?: string; geojson?: string }; centroid?: { lat: number; lng: number } } | null;
  const fips = v?.bounds?.county_fips ?? v?.county_fips;
  if (!fips) return null;
  return { countyFips: fips, geojsonPath: v?.bounds?.geojson ?? null, centroid: v?.centroid ?? null, label: v?.label ?? null };
}

function LocationMap({ item }: { item: FacetItem }) {
  const focus = React.useMemo(() => mapFocus(item), [item]);
  if (!focus) return null;
  return <React.Suspense fallback={<div className="om om--focus" aria-busy="true" />}><OneMap focus={focus} /></React.Suspense>;
}

/** Location is read when its token opens: its sources are photo areas, which the profile read does not carry. */
function LocationItems({ vehicleId }: { vehicleId: string }) {
  const read = useQuery({
    queryKey: ['vehicle_facet_items', vehicleId, 'location'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('vehicle_facet_items', { p_vehicle_id: vehicleId, p_dimension: 'location' });
      if (error) throw error;
      return (data ?? []) as FacetItem[];
    },
    staleTime: 5 * 60_000,
  });
  if (read.isPending) return <Text role="caption" as="p" aria-busy="true">Reading location…</Text>;
  if (read.isError) return <Text role="caption" as="p" aria-live="polite">Location read failed: {read.error instanceof Error ? read.error.message : 'unknown error'}</Text>;
  return <ItemList items={read.data} after={item => item.key === 'location.map' ? <LocationMap item={item} /> : null} />;
}

function PhysicalPoint({ vehicleId, field, label, role, relation }: {
  vehicleId: string; field: 'factory_color' | 'appearance'; label: string; role: string; relation: string;
}) {
  const read = useFieldProvenance(vehicleId, field);
  const inventory = useVehicleImageEvidence(vehicleId);
  const [rendition, setRendition] = useState(0);
  const provenance = read.data;
  const reading = provenance?.vehicle_id === vehicleId && inventory.data?.complete === true
    ? currentImageObservations(provenance, inventory.data.images).find(row => row.claim_role === role && row.visual_relation === relation
      && (field === 'factory_color' ? !!row.value?.trim()
        : /\bhood\b/i.test(row.image_region?.label ?? '') && /\bscoop\b/i.test(row.image_region?.label ?? ''))) : null;
  useEffect(() => setRendition(0), [reading?.image_id, reading?.image_url]);
  if (read.isLoading || inventory.isLoading) return <Text role="caption" as="p">Reading {label.toLowerCase()} evidence…</Text>;
  if (read.isError || inventory.isError || inventory.data?.complete !== true) return <Text role="caption" as="p">{label}: source read unavailable.</Text>;
  if (!reading) return <Text role="caption" as="p">{label}: no qualifying cited reading.</Text>;
  const reference = reading.reference?.url;
  const image = inventory.data.images.find(row => row.id === reading.image_id && row.image_url === reading.image_url);
  const renditions = [optimizeImageUrl(image?.image_url, 'medium'), image?.medium_url, image?.thumbnail_url]
    .filter((url): url is string => !!url && !url.includes('/storage/v1/object/public/'));
  const imageSrc = [...new Set(renditions)][rendition] ?? null;
  const region = reading.image_region?.label?.trim().replace(/[.\s]+$/, '');
  return <div className="vp-tribute-point">
    <strong>{field === 'factory_color' ? 'Cowl-tag extract' : label}</strong>
    {field === 'factory_color'
      ? <p>{label}: {reading.value} · interpreted photo reading</p>
      : <figure className="vp-tribute-point__figure">
        {imageSrc ? <img src={imageSrc} width={560} height={420} alt={region || 'Cited hood and scoop photograph'}
          onError={() => setRendition(current => current + 1)} />
          : <Text role="caption" as="p">Photo rendition unavailable.</Text>}
        <figcaption>{region || 'Hood and scoop visible'}. Photo alone does not establish Ram Air intake function or factory originality.</figcaption>
      </figure>}
    {reference?.startsWith('https://') && <a href={reference} target="_blank" rel="noreferrer">Decode reference ↗</a>}
    {reading.limitation && <Text role="caption" as="p">{reading.limitation}</Text>}
    <Text role="caption" as="p">Source reading ID: <code>{reading.observation_id}</code></Text>
  </div>;
}

function TributeEvidence({ vehicleId, items }: { vehicleId: string; items: TokenItems }) {
  const trim = items.trim?.filter(item => ['trim.recorded', 'trim.tribute', 'trim.decode'].includes(item.key)) ?? [];
  const engine = items.engine?.filter(item => item.key === 'engine.as_built.engine' || item.key === 'engine.current.displacement') ?? [];
  const transmission = items.transmission?.filter(item => item.key === 'transmission.as_built.type' || item.key === 'transmission.current.type') ?? [];
  return <>
    <ItemList items={trim} />
    <Text role="label" as="h3">Engine, as built and current</Text>
    {engine.length ? <ItemList items={engine} /> : <Text role="caption" as="p">Engine line items unavailable.</Text>}
    <PhysicalPoint vehicleId={vehicleId} field="factory_color" label="Factory paint"
      role="cowl_tag_paint" relation="direct_code" />
    <Text role="label" as="h3">Transmission, as built and current</Text>
    {transmission.length ? <ItemList items={transmission} /> : <Text role="caption" as="p">Transmission line items unavailable.</Text>}
    <PhysicalPoint vehicleId={vehicleId} field="appearance" label="Hood and scoop"
      role="visible_exterior_appearance" relation="direct_visual" />
  </>;
}

/** A header token's line items from vehicle_facet_items, as the profile read carries them. */
export default function HeaderTokenItems({ vehicleId, dimension, items, isReplica = false }: { vehicleId: string; dimension: string; items?: TokenItems | null; isReplica?: boolean }) {
  if (dimension === 'location') return <LocationItems vehicleId={vehicleId} />;
  if (dimension === 'trim' && isReplica && items?.trim?.length) return <TributeEvidence vehicleId={vehicleId} items={items} />;
  const list = items?.[dimension];
  if (!list?.length) return <Text role="caption" as="p">vehicle_facet_items read no line items for {dimension.replace(/_/g, ' ')}.</Text>;
  return <ItemList items={list} />;
}
