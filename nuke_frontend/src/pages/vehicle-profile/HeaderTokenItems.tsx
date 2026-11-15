import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { ItemList, Text, valueText } from '../../kit';
import type { FacetItem, TokenItems } from '../../kit/types';
import { ZipOutlineDialog } from '../../components/map/ZipOutlineDialog';
import { zipAreaRequest } from '../../components/map/zipAreaGeometry';
import { useFieldProvenance, currentImageObservations } from './hooks/useFieldProvenance';
import { useVehicleImageEvidence } from './hooks/useVehicleImageEvidence';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import CowlTagExtract from './CowlTagExtract';

/** Show an item's answer once; source identity and clock remain visible beneath it. */
function conciseItems(items: FacetItem[]): FacetItem[] {
  const cleaned = items.map(item => {
    const answer = valueText(item.value, item.unit)?.trim().toLowerCase();
    if (!answer) return item;
    return { ...item, sources: item.sources.map(source => {
      const said = source.value_label ?? (typeof source.value === 'string' ? source.value : valueText(source.value));
      return said?.trim().toLowerCase() === answer ? { ...source, value: null, value_label: null } : source;
    }) };
  });
  const simple = (item: FacetItem) => !item.stated && !item.rule && !item.equation && !item.needed
    && !item.sides?.length && !item.candidates?.length && !item.examined?.length && !item.availability?.length;
  const result: FacetItem[] = [];
  for (const item of cleaned) {
    const answer = valueText(item.value, item.unit);
    const duplicate = answer && simple(item) && ['established', 'reading'].includes(item.status)
      ? result.find(previous => simple(previous) && previous.status === item.status && previous.unit === item.unit
        && previous.facet !== item.facet && [previous.facet, item.facet].every(facet => facet === 'current' || facet === 'decode')
        && valueText(previous.value, previous.unit) === answer) : null;
    if (duplicate) duplicate.sources = [...duplicate.sources, ...item.sources];
    else result.push(item);
  }
  return result;
}

const isUnlinkedTitle = (item: FacetItem) => ['model.title', 'body_style.title'].includes(item.key) && item.status === 'missing';

/** Location is read when its token opens: its sources are photo areas, which the profile read does not carry. */
function LocationItems({ vehicleId }: { vehicleId: string }) {
  const [mapOpen, setMapOpen] = useState(false);
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
  const mapItem = read.data.find(item => item.key === 'location.map');
  const area = mapItem && zipAreaRequest(mapItem);
  return <>
    <ItemList items={conciseItems(read.data)} />
    {area && <button type="button" className="vp-financial-action" onClick={() => setMapOpen(true)}>View ZIP {area.zip} area map</button>}
    {mapOpen && mapItem && <ZipOutlineDialog location={mapItem} onClose={() => setMapOpen(false)} />}
  </>;
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
    <strong>{field === 'factory_color' ? 'Cowl tag' : label}</strong>
    {field === 'factory_color'
      ? <><CowlTagExtract vehicleId={vehicleId} observationId={reading.observation_id} sourceImageId={reading.image_id} />
        <p>{label}: {reading.value}</p></>
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
    <ItemList items={conciseItems(trim)} />
    <Text role="label" as="h3">Engine, as built and current</Text>
    {engine.length ? <ItemList items={conciseItems(engine)} /> : <Text role="caption" as="p">Engine line items unavailable.</Text>}
    <PhysicalPoint vehicleId={vehicleId} field="factory_color" label="Factory paint"
      role="cowl_tag_paint" relation="direct_code" />
    <Text role="label" as="h3">Transmission, as built and current</Text>
    {transmission.length ? <ItemList items={conciseItems(transmission)} /> : <Text role="caption" as="p">Transmission line items unavailable.</Text>}
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
  if (dimension === 'model') {
    const body = items?.body_style ?? [];
    const titleUnlinked = [...list, ...body].some(isUnlinkedTitle);
    const bodyDetails = body.filter(item => !isUnlinkedTitle(item));
    return <>
      <ItemList items={conciseItems(list.filter(item => !isUnlinkedTitle(item)))} />
      {bodyDetails.length > 0 && <section><Text role="label" as="h3">Body style</Text><ItemList items={conciseItems(bodyDetails)} /></section>}
      {titleUnlinked && <Text role="caption" as="p">No linked title evidence.</Text>}
    </>;
  }
  return <>
    <ItemList items={conciseItems(list)} />
  </>;
}
