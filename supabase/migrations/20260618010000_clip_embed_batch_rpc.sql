-- Phase 4(c) fix: drive the CLIP embedder from a selection RPC instead of a raw PostgREST
-- is.null query. The old query returned engine rows whose image_url was '' (empty) — the embedder
-- skipped them, a whole batch came back empty, and `if not rows: break` quit before reaching the
-- HTTP rows behind them; worse, empty-url rows re-matched is.null every pass (would loop forever).
-- This returns ONLY null-embedding active rows that have a USABLE image source (non-empty http
-- url OR a local file path), ordered + bounded, so the drainer converges and never stalls on
-- orphan rows. image_observations is ~17K rows; the PK join to vehicle_images is fast when bounded.
create or replace function get_clip_embed_batch(p_limit int default 100)
returns table(obs_id uuid, image_url text, storage_path text)
language sql stable security definer set search_path = public as $$
  select io.id, vi.image_url, vi.storage_path
  from image_observations io
  join vehicle_images vi on vi.id = io.image_id
  where io.embedding_clip_vitb32 is null
    and io.is_active
    and (nullif(vi.image_url,'') is not null or vi.storage_path like '/Users/%')
  order by io.id
  limit greatest(1, least(p_limit, 500));
$$;
grant execute on function get_clip_embed_batch(int) to service_role;
