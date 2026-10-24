-- Additive only. (1) Lets odometer rows be retired instead of deleted. (2) Lets duplicate readings of one receipt be
-- marked against a canonical receipt, and catches new duplicates automatically via a content key.

alter table public.auction_event_listing_mileage
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text,
  add column if not exists retired_run_id text;
create index if not exists aelm_active_idx on public.auction_event_listing_mileage (auction_event_id) where retired_at is null;

alter table public.receipts
  add column if not exists content_key text,
  add column if not exists duplicate_of uuid references public.receipts(id) on delete set null,
  add column if not exists duplicate_reason text,
  add column if not exists duplicate_run_id text;
create index if not exists receipts_content_key_idx on public.receipts (content_key);
create index if not exists receipts_duplicate_of_idx on public.receipts (duplicate_of) where duplicate_of is not null;

-- same user + same vendor (letters/digits only) + same amount + same original file name (upload-time prefix stripped)
create or replace function public.receipt_content_key(p_user uuid, p_vendor text, p_amount numeric, p_file text)
returns text language sql immutable as $$
  select case when coalesce(regexp_replace(coalesce(p_file,''),'^[0-9]{10,}_',''),'') = '' then null
    else md5(coalesce(p_user::text,'') || '|' || lower(regexp_replace(coalesce(p_vendor,''),'[^a-zA-Z0-9]','','g'))
             || '|' || coalesce(p_amount::text,'') || '|' || regexp_replace(p_file,'^[0-9]{10,}_','')) end
$$;

create or replace function public.receipts_flag_duplicate()
returns trigger language plpgsql as $$
begin
  new.content_key := public.receipt_content_key(new.user_id, new.vendor_name, coalesce(new.total_amount, new.total), new.file_name);
  if new.duplicate_of is null and new.content_key is not null then
    select r.id into new.duplicate_of from public.receipts r
     where r.content_key = new.content_key and r.id <> new.id and r.duplicate_of is null
     order by r.created_at, r.id limit 1;
    if new.duplicate_of is not null then
      new.duplicate_reason := coalesce(new.duplicate_reason, 'auto: same user, vendor, amount and original file name');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_receipts_flag_duplicate on public.receipts;
create trigger trg_receipts_flag_duplicate before insert or update of user_id, vendor_name, total_amount, total, file_name
  on public.receipts for each row execute function public.receipts_flag_duplicate();
