import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { ItemList, Text } from '../../kit';
import type { FacetItem, TokenItems } from '../../kit/types';
import type { OneMapFocus } from '../../components/map/OneMap';

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

/** A header token's line items from vehicle_facet_items, as the profile read carries them. */
export default function HeaderTokenItems({ vehicleId, dimension, items }: { vehicleId: string; dimension: string; items?: TokenItems | null }) {
  if (dimension === 'location') return <LocationItems vehicleId={vehicleId} />;
  const list = items?.[dimension];
  if (!list?.length) return <Text role="caption" as="p">vehicle_facet_items read no line items for {dimension.replace(/_/g, ' ')}.</Text>;
  return <ItemList items={list} />;
}
