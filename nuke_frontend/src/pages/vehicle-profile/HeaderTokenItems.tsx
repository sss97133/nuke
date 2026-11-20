import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { ItemList, StatusChip, Text, valueText, day } from '../../kit';
import type { FacetItem, TokenItems } from '../../kit/types';
import { ZipOutlineContent } from '../../components/map/ZipOutlineContent';
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
    {area && mapItem && <ZipOutlineContent location={mapItem} />}
  </>;
}

type PhysicalField = 'factory_color' | 'appearance';
const PHYSICAL: Record<PhysicalField, { role: string; relation: string }> = {
  factory_color: { role: 'cowl_tag_paint', relation: 'direct_code' },
  appearance: { role: 'visible_exterior_appearance', relation: 'direct_visual' },
};

/** One current, image-bound reading for a physical point; withheld unless the eligible gallery read is complete. */
function usePhysicalReading(vehicleId: string, field: PhysicalField) {
  const read = useFieldProvenance(vehicleId, field);
  const inventory = useVehicleImageEvidence(vehicleId);
  const provenance = read.data;
  const { role, relation } = PHYSICAL[field];
  const loading = read.isLoading || inventory.isLoading;
  const unavailable = !loading && (read.isError || inventory.isError || inventory.data?.complete !== true);
  const reading = !loading && !unavailable && provenance?.vehicle_id === vehicleId
    ? currentImageObservations(provenance, inventory.data!.images).find(row => row.claim_role === role && row.visual_relation === relation
      && (field === 'factory_color' ? !!row.value?.trim()
        : /\bhood\b/i.test(row.image_region?.label ?? '') && /\bscoop\b/i.test(row.image_region?.label ?? ''))) ?? null : null;
  const image = reading ? inventory.data!.images.find(row => row.id === reading.image_id && row.image_url === reading.image_url) ?? null : null;
  return { loading, unavailable, reading, image };
}
type PhysicalReading = ReturnType<typeof usePhysicalReading>;

/** Renditions only: the original object URL is never mounted or linked. */
function renditions(image: PhysicalReading['image'], size: 'thumbnail' | 'medium'): string[] {
  const urls = [optimizeImageUrl(image?.image_url, size), size === 'medium' ? image?.medium_url : null, image?.thumbnail_url]
    .filter((url): url is string => !!url && !url.includes('/storage/v1/object/public/'));
  return [...new Set(urls)];
}

const said = (item: FacetItem | undefined) => (item ? item.stated?.trim() || valueText(item.value, item.unit) : null);
const witnessThumb = (item: FacetItem | undefined) => {
  const thumb = item?.sources.find(source => source.witness?.kind === 'image' && source.witness.thumb)?.witness?.thumb;
  return thumb ? optimizeImageUrl(thumb, 'thumbnail') ?? null : null;
};

/** "X now · Y as built", in the reader's own values; a missing side is said, never filled. */
function nowAndBuilt(current: FacetItem | undefined, asBuilt: FacetItem | undefined): string | null {
  const now = said(current); const built = said(asBuilt);
  if (!now && !built) return null;
  return [now ? `${now} now` : 'current not on record', built ? `${built} as built` : 'as built not on record'].join(' · ');
}

/** One key point: its answer and best photo on one line; the cited line items open beneath it. */
function KeyPoint({ label, summary, status, thumb, children }: {
  label: string; summary: string; status?: FacetItem['status'] | null; thumb?: string | null; children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [thumb]);
  const line = <>
    {thumb && !failed ? <img className="k-item__thumb" src={thumb} alt="" width={40} height={40} loading="lazy" onError={() => setFailed(true)} />
      : <span className="k-item__thumb vp-key-point__blank" aria-hidden="true" />}
    <span className="vp-key-point__text"><Text role="label">{label}</Text><Text role="body">{summary}</Text></span>
    {status && <StatusChip status={status} />}
  </>;
  if (!children) return <li className="vp-key-point" data-point={label}><div className="vp-key-point__line">{line}</div></li>;
  return <li className="vp-key-point" data-point={label}><details>
    <summary className="vp-key-point__line">{line}</summary>
    <div className="vp-key-point__detail">{children}</div>
  </details></li>;
}

function PhysicalDetail({ field, point }: { field: PhysicalField; point: PhysicalReading }) {
  const [rendition, setRendition] = useState(0);
  const reading = point.reading!;
  useEffect(() => setRendition(0), [reading.image_id, reading.image_url]);
  const reference = reading.reference?.url;
  const region = reading.image_region?.label?.trim().replace(/[.\s]+$/, '');
  const imageSrc = renditions(point.image, 'medium')[rendition] ?? null;
  return <>
    {field === 'appearance' && <figure className="vp-tribute-point__figure">
      {imageSrc ? <img src={imageSrc} width={560} height={420} alt={region || 'Cited exterior photograph'}
        onError={() => setRendition(current => current + 1)} />
        : <Text role="caption" as="p">Photo rendition unavailable.</Text>}
      {region && <figcaption><Text role="caption">{region}.</Text></figcaption>}
    </figure>}
    {field === 'factory_color' && region && <Text role="caption" as="p">{region}.</Text>}
    {reading.limitation && <Text role="caption" as="p">Limitation: {reading.limitation}</Text>}
    {reference?.startsWith('https://') && <Text role="caption" as="p"><a href={reference} target="_blank" rel="noreferrer">{reading.reference?.title?.trim() || 'Decode reference'} ↗</a></Text>}
    <Text role="caption" as="p">{day(reading.observed_at)} · reading <code>{reading.observation_id}</code></Text>
  </>;
}

function PhysicalKeyPoint({ field, label, point, summary }: { field: PhysicalField; label: string; point: PhysicalReading; summary: (value: string | null) => string }) {
  if (point.loading) return <KeyPoint label={label} summary="Reading…" />;
  if (point.unavailable) return <KeyPoint label={label} summary="source read unavailable" />;
  if (!point.reading) return <KeyPoint label={label} summary="no qualifying cited reading" status="missing" />;
  return <KeyPoint label={label} summary={summary(point.reading.value?.trim() || null)} status="reading" thumb={renditions(point.image, 'thumbnail')[0] ?? null}>
    <PhysicalDetail field={field} point={point} />
  </KeyPoint>;
}

/**
 * What makes a tribute what it is, answer first: engine, factory paint, transmission and the visible exterior, each one
 * line in the reader's own values with its best photo, then the tag reproduction. Every line opens to its cited items;
 * a side the readers do not hold is said to be missing. The rule is the same for any vehicle flagged a tribute.
 */
function TributeEvidence({ vehicleId, items }: { vehicleId: string; items: TokenItems }) {
  const find = (dimension: string, key: string) => items[dimension]?.find(item => item.key === key);
  const trim = items.trim?.filter(item => ['trim.recorded', 'trim.tribute', 'trim.decode'].includes(item.key)) ?? [];
  const decode = find('trim', 'trim.decode');
  const engine = [find('engine', 'engine.as_built.engine'), find('engine', 'engine.current.displacement')].filter((item): item is FacetItem => !!item);
  const transmission = [find('transmission', 'transmission.as_built.type'), find('transmission', 'transmission.current.type')].filter((item): item is FacetItem => !!item);
  const engineLine = nowAndBuilt(find('engine', 'engine.current.displacement'), find('engine', 'engine.as_built.engine'));
  const transmissionLine = nowAndBuilt(find('transmission', 'transmission.current.type'), find('transmission', 'transmission.as_built.type'));
  const tagCode = said(find('paint', 'paint.as_built.code'));
  const paint = usePhysicalReading(vehicleId, 'factory_color');
  const exterior = usePhysicalReading(vehicleId, 'appearance');
  const decoded = said(decode);
  const code = typeof decode?.rule?.code === 'string' ? decode.rule.code : null;
  return <>
    {decoded && <Text role="body" as="p" className="vp-tribute-lead">Tribute: the VIN decodes to {decoded}{code ? ` (code ${code})` : ''}.</Text>}
    <ul className="vp-key-points">
      {engineLine ? <KeyPoint label="Engine" summary={engineLine} status={engine[engine.length - 1]?.status} thumb={witnessThumb(find('engine', 'engine.current.displacement'))}>
        <ItemList items={conciseItems(engine)} />
      </KeyPoint> : <KeyPoint label="Engine" summary="line items unavailable" status="missing" />}
      <PhysicalKeyPoint field="factory_color" label="Factory paint" point={paint}
        summary={value => [value, tagCode ? `tag code ${tagCode}` : null].filter(Boolean).join(' · ') || 'read from the cowl tag'} />
      {transmissionLine ? <KeyPoint label="Transmission" summary={transmissionLine} status={transmission[transmission.length - 1]?.status}
        thumb={witnessThumb(find('transmission', 'transmission.current.type'))}>
        <ItemList items={conciseItems(transmission)} />
      </KeyPoint> : <KeyPoint label="Transmission" summary="line items unavailable" status="missing" />}
      <PhysicalKeyPoint field="appearance" label="Hood and scoop" point={exterior}
        summary={value => [value, 'visible in the cited photo'].filter(Boolean).join(' · ')} />
    </ul>
    {paint.reading && <section className="vp-tribute-tag" aria-label="Cowl tag">
      <CowlTagExtract vehicleId={vehicleId} observationId={paint.reading.observation_id} sourceImageId={paint.reading.image_id} />
    </section>}
    {trim.length > 0 && <details className="vp-tribute-record">
      <summary><Text role="label">Trim record</Text></summary>
      <ItemList items={conciseItems(trim)} />
    </details>}
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
