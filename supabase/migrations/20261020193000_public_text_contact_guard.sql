-- Public comments and bios refuse phone numbers and e-mail addresses; people reach each other through Nuke.
--
-- post_work_request already refuses contact details in a work description (work_order_text_is_personal). The other
-- public text people write for each other took them as written (2026-10-19, rows with contact details / rows):
--   user_comments.comment_text 2/32 (record_interaction 'comment' from iOS, VehicleCommentsCard on the web),
--   vehicle_comments.comment_text 2/26, timeline_event_comments.comment_text 0/1 (CommentService),
--   vehicle_image_comments.comment_text 0/5 (ImageLightbox), profiles.bio 0/1 (profile settings).
-- All are readable by anyone.
--
-- After: public_text_contact_guard() runs before each insert, and before an update that changes the column, on those
-- five columns. It applies work_order_text_is_personal's detector to the text without its http(s) links (a link is not
-- a contact detail, and meme and image links carry long digit runs). A writer signed in through the API (authenticated
-- or anon) gets "Please don't share phone numbers or emails here — people reach you through Nuke" (23514); the service
-- role and system jobs (imports) have the details replaced by text_redact_contact instead. record_interaction returns
-- the same message as {ok: false, error: 'contact_details'} before writing a comment. Existing rows are not touched.
-- Contract: supabase/sql/test_public_text_contact_guard.sql.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $guard$
DECLARE v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v_hash
  FROM pg_proc WHERE oid = to_regprocedure('public.record_interaction(text,text,uuid,jsonb)');
  IF v_hash IS DISTINCT FROM 'KDc+zsUdsAJCAS5t45O1J/r39CqcMjNQcfgUeDBrTU8=' AND v_hash IS DISTINCT FROM 'gvZapQuNWHdOfLSOBByMIhuxyv93QOxqF7M3JDrHVoQ=' THEN
    RAISE EXCEPTION 'record_interaction differs from the 2026-10-19 read (%); not changing it', v_hash;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.text_shares_contact(p_text text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.work_order_text_is_personal(NULL, regexp_replace(p_text, 'https?://\S+', ' ', 'gi'))
$$;
COMMENT ON FUNCTION public.text_shares_contact(text) IS
  'True when the text, links removed, has what work_order_text_is_personal treats as contact details (an @ or a 10-digit phone number).';
REVOKE ALL ON FUNCTION public.text_shares_contact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.text_shares_contact(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_text_contact_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  col text;
  v_new text;
  patch jsonb := '{}'::jsonb;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    v_new := to_jsonb(NEW) ->> col;
    IF TG_OP = 'UPDATE' THEN
      CONTINUE WHEN v_new IS NOT DISTINCT FROM (to_jsonb(OLD) ->> col);
    END IF;
    CONTINUE WHEN NOT coalesce(public.text_shares_contact(v_new), false);
    IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'Please don''t share phone numbers or emails here — people reach you through Nuke'
        USING ERRCODE = '23514', HINT = 'contact_details';
    END IF;
    patch := patch || jsonb_build_object(col, public.text_redact_contact(v_new));
  END LOOP;
  IF patch <> '{}'::jsonb THEN
    NEW := jsonb_populate_record(NEW, patch);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.public_text_contact_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_public_text_contact_guard ON public.user_comments;
CREATE TRIGGER trg_public_text_contact_guard BEFORE INSERT OR UPDATE ON public.user_comments
  FOR EACH ROW EXECUTE FUNCTION public.public_text_contact_guard('comment_text');
DROP TRIGGER IF EXISTS trg_public_text_contact_guard ON public.vehicle_comments;
CREATE TRIGGER trg_public_text_contact_guard BEFORE INSERT OR UPDATE ON public.vehicle_comments
  FOR EACH ROW EXECUTE FUNCTION public.public_text_contact_guard('comment_text');
DROP TRIGGER IF EXISTS trg_public_text_contact_guard ON public.timeline_event_comments;
CREATE TRIGGER trg_public_text_contact_guard BEFORE INSERT OR UPDATE ON public.timeline_event_comments
  FOR EACH ROW EXECUTE FUNCTION public.public_text_contact_guard('comment_text');
DROP TRIGGER IF EXISTS trg_public_text_contact_guard ON public.vehicle_image_comments;
CREATE TRIGGER trg_public_text_contact_guard BEFORE INSERT OR UPDATE ON public.vehicle_image_comments
  FOR EACH ROW EXECUTE FUNCTION public.public_text_contact_guard('comment_text');
DROP TRIGGER IF EXISTS trg_public_text_contact_guard ON public.profiles;
CREATE TRIGGER trg_public_text_contact_guard BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.public_text_contact_guard('bio');

DO $edit$
DECLARE def text; anchor text; n integer;
BEGIN
  def := pg_get_functiondef('public.record_interaction(text,text,uuid,jsonb)'::regprocedure);
  IF position('contact_details' IN def) > 0 THEN RETURN; END IF;
  anchor := $a$IF length(v_text)=0 THEN RETURN jsonb_build_object('ok', false, 'error', 'empty'); END IF;$a$;
  n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
  IF n <> 1 THEN RAISE EXCEPTION 'record_interaction: anchor found % times', n; END IF;
  EXECUTE replace(def, anchor, anchor || $r$
    IF public.text_shares_contact(v_text) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'contact_details',
        'message', 'Please don''t share phone numbers or emails here — people reach you through Nuke');
    END IF;$r$);
END $edit$;

COMMIT;
