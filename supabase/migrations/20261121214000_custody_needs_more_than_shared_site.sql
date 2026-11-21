-- A shared site never assigns a car to one organization: the custody reader and the timeline-event linker.
--
-- Reader added: organization_vehicles_custody(vehicle ids) -> at most one custody organization per vehicle. The web
-- garage card's "at <organization>" (nuke_frontend/src/hooks/garageCustody.ts) read organization_vehicles directly and
-- chose in page code; the choice moves here so web and iOS read one rule.
-- Writer changed: link_org_from_timeline_event (trigger on timeline_events).
--
-- Measured 2026-11-21 (scripts/data/q.sh) on the 138 garage vehicles of the class price store:
--   - 14 cards showed a custody organization. All 14 organizations sit at one site that three organizations share
--     (two with coordinates 30 m apart, one with the same street address and none); 4 of the 14 rest on a
--     link marked confirmed (user_confirmed), 10 do not. With this rule (run inline the same day) 4 cards name an
--     organization, the 4 confirmed ones; the other 10 name none.
--   - 3 of the 10 are service_provider links written at one instant (2026-10-17 16:59:25Z) by this trigger, after
--     one bulk update set organization_id on 57 photo-derived "forensic_image_bundle" events on those 3 cars. Those
--     events were bundled from photos taken at the shared site; their metadata still names a different shop. The
--     trigger inserts every link as status active with auto_tagged = false, so a location inference reached the card
--     as if a person had made it (the card hides only auto_tagged links that nobody confirmed). The bulk update's
--     writer is not in this repository (inferred: a hand-applied repoint of a removed organization's references).
--   - 20261016203000 already ruled that a GPS match at a shared site proposes nothing ("a shared site names a place,
--     not an organization"); this applies the same rule to links that reach the garage card by other paths.
--   - Across the database, 2,024 of 5,759 organizations have another organization within 150 m or at the same street
--     address (same day).
--
-- Rules:
--   organization_site_is_shared(org): another organization has a point (organizations coordinates or an
--     organization_locations point) within 150 m of one of this organization's points, or the same street address.
--   organization_vehicles_custody: a custody relationship (work_location, storage, service_provider, upholstery,
--     painter, fabricator, current_consignment), active, not rejected, not ended; an auto_tagged link counts only when
--     a person confirmed it; at a shared site a link counts only when a person confirmed it or a receipt matched it.
--     Lower rank wins (the order above), then a car currently in service. This is stricter than "address alone": an
--     unconfirmed link made by hand at a shared site is also left out until confirmed (the origin of most such rows is
--     not recorded, so the reader cannot tell a hand-made link from an inferred one).
--   link_org_from_timeline_event: a link it writes from a photo-derived event (source naming forensic/image/photo/
--     vision/gps/ai, or metadata forensic_source / ai_generated) is auto_tagged, an inference to confirm; a link from a
--     receipt, purchase or typed event stays as before. It never reactivates a link a person rejected.
-- No organization_vehicles row is edited by this migration.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.organization_site_is_shared(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pts as (
    select o.id as org, o.latitude::float8 as lat, o.longitude::float8 as lon,
           nullif(regexp_replace(regexp_replace(lower(coalesce(o.address, '')), '\m(street)\M', 'st', 'g'), '[^a-z0-9]', '', 'g'), '') as addr
      from organizations o
    union all
    select l.organization_id, l.latitude::float8, l.longitude::float8,
           nullif(regexp_replace(regexp_replace(lower(coalesce(l.street_address, '')), '\m(street)\M', 'st', 'g'), '[^a-z0-9]', '', 'g'), '')
      from organization_locations l
  ),
  mine as (select * from pts where org = p_organization_id)
  select exists (
    select 1 from mine m join pts p on p.org <> m.org
     where (m.lat is not null and m.lon is not null and p.lat is not null and p.lon is not null
            and p.lat between m.lat - 0.00135 and m.lat + 0.00135
            and p.lon between m.lon - 0.00135 / greatest(cos(radians(m.lat)), 0.1)
                          and m.lon + 0.00135 / greatest(cos(radians(m.lat)), 0.1))
        or (m.addr ~ '^[0-9]' and p.addr = m.addr)
  );
$function$;

COMMENT ON FUNCTION public.organization_site_is_shared(uuid) IS
  'True when another organization has a point within 150 m of one of this organization''s points (organizations coordinates, organization_locations) or the same street address. A place shared by several organizations does not name one of them.';

REVOKE ALL ON FUNCTION public.organization_site_is_shared(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organization_site_is_shared(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.organization_vehicles_custody(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, organization_id uuid, organization_name text, relationship_type text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with kinds(kind, rank) as (
    values ('work_location', 0), ('storage', 1), ('service_provider', 2), ('upholstery', 3),
           ('painter', 4), ('fabricator', 5), ('current_consignment', 6)
  ),
  links as (
    select ov.vehicle_id, ov.organization_id, ov.relationship_type, ov.service_status,
           coalesce(ov.user_confirmed, false) as confirmed, coalesce(ov.receipt_match_count, 0) > 0 as receipted,
           k.rank, coalesce(o.business_name, o.name, o.legal_name) as org_name
      from organization_vehicles ov
      join kinds k on k.kind = ov.relationship_type
      join organizations o on o.id = ov.organization_id
     where ov.vehicle_id = any(p_vehicle_ids[1:500])
       and ov.status = 'active'
       and not coalesce(ov.user_rejected, false)
       and (ov.end_date is null or ov.end_date > current_date)
       -- a GPS or receipt guess stays out until a person confirms it
       and not (coalesce(ov.auto_tagged, false) and not coalesce(ov.user_confirmed, false))
       and nullif(btrim(coalesce(o.business_name, o.name, o.legal_name, '')), '') is not null
  ),
  orgs as (select distinct organization_id from links),
  shared as (select organization_id, public.organization_site_is_shared(organization_id) as is_shared from orgs)
  select distinct on (l.vehicle_id) l.vehicle_id, l.organization_id, l.org_name, l.relationship_type
    from links l join shared s using (organization_id)
   -- at a shared site the place does not say which organization: a person's confirmation or a receipt must
   where not s.is_shared or l.confirmed or l.receipted
   order by l.vehicle_id, l.rank, (l.service_status = 'currently_in_service') desc nulls last, l.org_name;
$function$;

COMMENT ON FUNCTION public.organization_vehicles_custody(uuid[]) IS
  'At most one custody organization per vehicle (up to 500 ids): active custody-kind organization_vehicles links, not rejected or ended; auto_tagged only when confirmed; at a shared site (organization_site_is_shared) only when confirmed or receipt-matched. Read by the garage card''s "at <organization>".';

REVOKE ALL ON FUNCTION public.organization_vehicles_custody(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organization_vehicles_custody(uuid[]) TO anon, authenticated, service_role;

-- The trigger: a link derived from a photo-derived event's organization is an inference, so it is written auto_tagged
-- (profile evidence trust 0.4 instead of 0.6, signal confidence 0.7 instead of 0.9); a rejected link stays rejected. Body otherwise as live (20251205_link_orgs_from_timeline_events.sql).
CREATE OR REPLACE FUNCTION public.link_org_from_timeline_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public, extensions'
AS $function$
DECLARE
  v_org_id UUID;
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    INSERT INTO public.organization_vehicles (organization_id, vehicle_id, relationship_type, status, auto_tagged, linked_by_user_id, start_date)
    VALUES (NEW.organization_id, NEW.vehicle_id,
      CASE WHEN NEW.event_type IN ('work_completed','service','repair','maintenance') THEN 'service_provider'
           WHEN NEW.event_type = 'purchase' THEN 'seller'
           WHEN NEW.event_type = 'sale' THEN 'buyer'
           ELSE 'service_provider' END,
      'active',
      -- photo-derived (bundled or read from images): the link is the trigger's inference from where photos were taken
      (coalesce(NEW.source, '') ~* '(forensic|image|photo|vision|gps|ai[_ -]|^ai)'
       OR coalesce(NEW.metadata ->> 'forensic_source', '') = 'true'
       OR coalesce(NEW.metadata ->> 'ai_generated', '') = 'true'),
      NEW.user_id, NEW.event_date)
    ON CONFLICT (organization_id, vehicle_id, relationship_type)
    DO UPDATE SET status = 'active', start_date = LEAST(public.organization_vehicles.start_date, NEW.event_date), updated_at = NOW()
      WHERE NOT coalesce(public.organization_vehicles.user_rejected, false);
  END IF;
  IF NEW.service_provider_name IS NOT NULL AND NEW.organization_id IS NULL THEN
    BEGIN
      SELECT id INTO v_org_id FROM public.businesses
      WHERE similarity(LOWER(business_name), LOWER(NEW.service_provider_name)) > 0.5
      ORDER BY similarity(LOWER(business_name), LOWER(NEW.service_provider_name)) DESC LIMIT 1;
      IF v_org_id IS NOT NULL THEN
        UPDATE public.timeline_events SET organization_id = v_org_id WHERE id = NEW.id;
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    WHEN undefined_function THEN NULL;
    END;
  END IF;
  RETURN NEW;
END;
$function$;
