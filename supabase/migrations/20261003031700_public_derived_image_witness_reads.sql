-- Existing ImagePage reads the typed bridge as its caller. RLS previously had
-- no SELECT policy, so even a public observation with a public image vanished.
-- This adds no writer, model invocation, vision verdict or privacy bypass.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE POLICY public_derived_image_witness_read
ON public.observation_witnesses
FOR SELECT TO anon, authenticated
USING (
  witness_role = 'derived'
  AND EXISTS (
    SELECT 1
    FROM public.vehicle_observations o
    JOIN public.vehicle_images i
      ON i.id = observation_witnesses.image_id
      AND i.vehicle_id = o.vehicle_id
    JOIN public.vehicles v ON v.id = o.vehicle_id AND v.is_public IS TRUE
    WHERE o.id = observation_witnesses.observation_id
      AND coalesce(o.is_superseded, false) = false
      AND o.structured_data->>'image_id' = i.id::text
      AND public.observation_is_public(o.kind, o.structured_data)
      AND coalesce(i.is_sensitive, false) = false
      AND public.vehicle_image_gallery_eligible(i)
  )
);

COMMENT ON POLICY public_derived_image_witness_read ON public.observation_witnesses IS
'Caller-invoker SELECT only for derived image links: both parent rows must independently pass their existing RLS, share a public vehicle, and the observation must name this exact image. Requires unsuperseded public observation and nonsensitive canonical gallery-eligible image. Manual primary/context/supersession attestations, private vehicles, sensitive/document/rejected/mismatched images and nonpublic observation payloads remain hidden. Visibility is not acceptance or a correctness verdict; unaccepted model testimony retains its qualification.';

NOTIFY pgrst, 'reload schema';
