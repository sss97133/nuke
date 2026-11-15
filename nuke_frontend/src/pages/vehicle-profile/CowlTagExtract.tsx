import { useQuery } from '@tanstack/react-query';
import { publicCowlTagExtract, publicCowlTagFields, sameReviewedImage } from './observationPrivacy';
import { currentImageObservations, useFieldProvenance } from './hooks/useFieldProvenance';
import { readImageWitnesses, useVehicleImageEvidence } from './hooks/useVehicleImageEvidence';
import { useAuthContext } from '../../contexts/AuthContext';
import CowlTagReproduction from './CowlTagReproduction';

/** Full plate reproduction from reviewed codes; never mounts the original image. */
export default function CowlTagExtract({ vehicleId, observationId, sourceImageId }: {
  vehicleId: string; observationId: string; sourceImageId: string | null;
}) {
  const read = useFieldProvenance(vehicleId, 'factory_color');
  const inventory = useVehicleImageEvidence(vehicleId);
  const { user, loading: authLoading } = useAuthContext();
  const image = inventory.data?.images.find(row => row.id === sourceImageId);
  const current = !read.isError && !inventory.isError && inventory.data?.complete === true
    && read.data?.vehicle_id === vehicleId && read.data.field === 'factory_color'
    && read.data.coverage?.status === 'complete_current_reader'
    && currentImageObservations(read.data, inventory.data.images).some(row =>
      row.observation_id === observationId && row.image_id === sourceImageId
      && row.claim_role === 'cowl_tag_paint' && row.visual_relation === 'direct_code');
  const witnesses = useQuery({
    queryKey: ['image-witnesses', vehicleId, sourceImageId, image?.image_url, user?.id ?? 'public'],
    enabled: !!current && !!sourceImageId && !authLoading,
    queryFn: async ({ signal }) => {
      const result = await readImageWitnesses(sourceImageId!, signal);
      if (result.error || !Array.isArray(result.data) || result.data.length >= 100) throw new Error('Tag readings unavailable');
      return result.data;
    },
    staleTime: 60_000,
  });
  if (read.isLoading || inventory.isLoading || authLoading || (current && witnesses.isPending)) return <p role="status">Opening cowl tag…</p>;
  if (!current) return <p>The cited source could not be checked against the current vehicle evidence.</p>;
  if (witnesses.isError || !witnesses.data || !image || !sourceImageId) return <p>Cowl tag readings are unavailable.</p>;
  const source = witnesses.data.filter((w: any) => w.witness_role === 'derived').map((w: any) => w.observation).find((row: any) => row?.id === observationId
    && row.vehicle_id === vehicleId && !row.is_superseded && !row.superseded_by
    && row.extraction_method === 'cowl_tag_decode_v1' && row.structured_data?.image_id === sourceImageId);
  if (!source || !publicCowlTagExtract(source.structured_data)
    || !sameReviewedImage(source.structured_data.reviewed_url, image.image_url)) return <p>Cowl tag readings are unavailable.</p>;
  const fields = publicCowlTagFields(witnesses.data, vehicleId, sourceImageId, image.image_url, source.structured_data.reviewed_sha256);
  if (fields.modelYear !== '73' || fields.plant !== 'N') return <p>A matching cowl tag reproduction layout is not available.</p>;
  return <figure className="cowl-tag-extract" aria-label="Cowl tag reproduction">
    <CowlTagReproduction {...fields} />
    <figcaption>Digital reproduction · body and sequence numbers masked.</figcaption>
  </figure>;
}
