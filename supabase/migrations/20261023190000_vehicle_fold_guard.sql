-- Pre-fold guards for shared-VIN vehicle folds.
-- vehicle_fold_guard(secondary, primary) returns {holds, soft, detail}; any hold means do not fold.
--   check_digit  17-char North American VIN (WMI 1-5), model year 1981-1999, invalid check digit
--   model        models not compatible (no containment, shared token, or shared alphanumeric stem)
--   overlap_live live periods overlap on different venues, unless a same-seller crosspost with shared photos
--   mileage      later record more than 20% and 5,000 below the earlier one (thousands-unit artifacts excluded)
--   color        different color families with no recorded repaint
--   replica      is_replica, or replica/clone/tribute/recreation keyword on either side
--   photo_color  both have photos, no identical URL/file hash/phash/dhash, and colors differ
-- soft 'no_photo_overlap' (photos on both sides, none shared, same color) is reported but does not hold.
-- Read-only: these functions change no data.

create or replace function public.vin_check_digit_valid(v text) returns boolean language sql immutable as $$
  select case when v !~ '^[A-HJ-NPR-Z0-9]{17}$' then null else (
    with c as (select i, substr(v,i,1) ch from generate_series(1,17) i),
    t as (select sum((case when ch ~ '[0-9]' then ch::int else
        (array[1,2,3,4,5,6,7,8,0,1,2,3,4,5,0,7,0,9,2,3,4,5,6,7,8,9])[ascii(ch)-64] end)
        * (array[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2])[i]) s from c)
    select substr(v,9,1) = case when s % 11 = 10 then 'X' else (s % 11)::text end from t) end
$$;

create or replace function public.fold_model_key(m text) returns text language sql stable as $$
  select nullif(lower(regexp_replace(translate(coalesce(m,''),'áàâäãéèêëíìîïóòôöõúùûüçñÁÀÂÄÉÈÊËÍÓÔÖÚÜÇÑ','aaaaaeeeeiiiiooooouuuucnAAAAEEEEIOOOUUCN'), '[^a-zA-Z0-9]', '', 'g')), '')
$$;

create or replace function public.fold_model_compatible(a text, b text) returns boolean language sql stable as $$
  with k as (select public.fold_model_key(a) ka, public.fold_model_key(b) kb),
  ta as (select t from regexp_split_to_table(lower(regexp_replace(translate(coalesce(a,''),'áàâäãéèêëíìîïóòôöõúùûüçñÁÀÂÄÉÈÊËÍÓÔÖÚÜÇÑ','aaaaaeeeeiiiiooooouuuucnAAAAEEEEIOOOUUCN'),'[-.]','','g')), '[^a-z0-9]+') t where length(t) >= 2),
  tb as (select t from regexp_split_to_table(lower(regexp_replace(translate(coalesce(b,''),'áàâäãéèêëíìîïóòôöõúùûüçñÁÀÂÄÉÈÊËÍÓÔÖÚÜÇÑ','aaaaaeeeeiiiiooooouuuucnAAAAEEEEIOOOUUCN'),'[-.]','','g')), '[^a-z0-9]+') t where length(t) >= 2)
  select ka is null or kb is null or position(ka in kb) > 0 or position(kb in ka) > 0
      or exists (select 1 from ta join tb using (t) where t !~ '^(s|se|gt|le|lx|ex|the|and|with|coupe|sedan|convertible|wagon|roadster|\d+speed|4wd|awd)$')
      -- shared alphanumeric stem: a 4+ char run containing a digit (635csi, rx7t, gb500) or a 5+ letter run
      or exists (select 1 from generate_series(1, greatest(length(ka)-3,1)) i
                 where (substr(ka,i,4) ~ '[0-9]' and substr(ka,i,4) ~ '[a-z]' and position(substr(ka,i,4) in kb) > 0)
                    or (length(ka) >= i+4 and substr(ka,i,5) !~ '(speed|coupe|sedan)' and position(substr(ka,i,5) in kb) > 0))
  from k
$$;

create or replace function public.fold_color_key(c text) returns text language sql immutable as $$
  select case
    when x is null or x ~ '^\s*$' then null
    when x ~ '(two[- ]tone|&| and |/)' and x !~ '^(silver/gray|brown/tan)$' then null  -- multi-color: not comparable
    when x ~ '(black|ebony|onyx|obsidian|jet)' then 'black'
    when x ~ '(white|ivory|cream|pearl white|alabaster|chalk)' then 'white'
    when x ~ '(silver|gray|grey|graphite|gunmetal|charcoal|titanium|platinum|pewter|quicksilver|anthracite)' then 'gray'
    when x ~ '(red|maroon|burgundy|bordeaux|wine|cherry|claret|rosso)' then 'red'
    when x ~ '(blue|navy|azure|teal|aqua|turquoise|blu)' then 'blue'
    when x ~ '(green|verde|olive|emerald|jade|lime)' then 'green'
    when x ~ '(yellow|giallo)' then 'yellow'
    when x ~ '(orange|copper)' then 'orange'
    when x ~ '(brown|tan|beige|bronze|mocha|champagne|sand|cognac|camel|gold)' then 'brown'
    when x ~ '(purple|violet|plum|aubergine)' then 'purple'
    else null end
  from (select lower(c) x) t
$$;

create or replace function public.vehicle_fold_guard(p_s uuid, p_o uuid) returns jsonb language plpgsql stable
  set search_path = public as $$
declare s record; o record; holds text[] := '{}'; soft text[] := '{}'; d jsonb := '{}';
  s_start timestamptz; s_end timestamptz; o_start timestamptz; o_end timestamptz; s_ven text; o_ven text;
  s_img int; o_img int; overlap boolean; s_ck text; o_ck text; repaint boolean; s_dt timestamptz; o_dt timestamptz;
  
begin
  select * into s from public.vehicles where id = p_s;
  select * into o from public.vehicles where id = p_o;

  -- (a) check digit: 17-char North American VIN (WMI 1-5), model year 1981-1999
  if length(coalesce(o.vin, s.vin)) = 17 and left(coalesce(o.vin, s.vin),1) ~ '[1-5]'
     and coalesce(s.year, o.year) between 1981 and 1999
     and public.vin_check_digit_valid(upper(coalesce(o.vin, s.vin))) is false then
    holds := holds || 'check_digit'::text;
  end if;

  -- (b) model compatible: one key contains the other, or the same first token
  if not public.fold_model_compatible(s.model, o.model) then
    holds := holds || 'model'::text; d := d || jsonb_build_object('models', jsonb_build_array(s.model, o.model));
  end if;

  -- (f) photos: identical URL, file hash or perceptual hash between the two sides
  -- secondary's images = its own plus any already repointed to the primary (open supersession rows)
  with o_all as materialized (select i.id, i.image_url, i.file_hash, i.phash, i.dhash,
                    exists (select 1 from public.superseded_rows r
                      where r.source_table = 'vehicle_images' and r.row_id = i.id and r.restored_at is null
                        and r.source->>'op' = 'repoint' and r.source->>'from' = p_s::text) as from_s
                  from public.vehicle_images i where i.vehicle_id = p_o),
       si as (select i.image_url, i.file_hash, i.phash, i.dhash from public.vehicle_images i where i.vehicle_id = p_s
              union all
              select image_url, file_hash, phash, dhash from o_all where from_s),
       oi as (select image_url, file_hash, phash, dhash from o_all where not from_s)
  select (select count(*) from si), (select count(*) from oi),
         exists (select 1 from si join oi on si.image_url = oi.image_url
                   or (si.file_hash is not null and si.file_hash = oi.file_hash)
                   or (si.phash is not null and si.phash = oi.phash)
                   or (si.dhash is not null and si.dhash = oi.dhash))
    into s_img, o_img, overlap;
  s_ck := public.fold_color_key(coalesce(s.color, s.color_family));
  o_ck := public.fold_color_key(coalesce(o.color, o.color_family));
  repaint := coalesce(s.description,'') ~* '(repaint|re-paint|refinish|respray|color change|colour change|repainted)'
          or coalesce(o.description,'') ~* '(repaint|re-paint|refinish|respray|color change|colour change|repainted)';
  d := d || jsonb_build_object('imgs', jsonb_build_array(s_img, o_img), 'overlap', overlap, 'colors', jsonb_build_array(s.color, o.color));
  if s_img > 0 and o_img > 0 and not overlap then
    if s_ck is not null and o_ck is not null and s_ck <> o_ck then holds := holds || 'photo_color'::text;
    else soft := soft || 'no_photo_overlap'::text; end if;
  end if;

  -- (d) impossible history: differing colors with no recorded repaint; sharp mileage drop over time
  if s_ck is not null and o_ck is not null and s_ck <> o_ck and not repaint then holds := holds || 'color'::text; end if;
  s_dt := coalesce(case when pg_input_is_valid(s.auction_end_date,'timestamptz') then s.auction_end_date::timestamptz end, s.sale_date::timestamptz, s.listing_posted_at);
  o_dt := coalesce(case when pg_input_is_valid(o.auction_end_date,'timestamptz') then o.auction_end_date::timestamptz end, o.sale_date::timestamptz, o.listing_posted_at);
  if s.mileage > 0 and o.mileage > 0 and s_dt is not null and o_dt is not null
     -- skip unit artifacts where one side is in thousands (69 vs 68,000)
     and not (abs(s.mileage * 1000 - o.mileage) <= greatest(o.mileage * 0.05, 1000)
           or abs(o.mileage * 1000 - s.mileage) <= greatest(s.mileage * 0.05, 1000)) then
    if (s_dt < o_dt and o.mileage < s.mileage * 0.8 and s.mileage - o.mileage > 5000)
    or (o_dt < s_dt and s.mileage < o.mileage * 0.8 and o.mileage - s.mileage > 5000) then
      holds := holds || 'mileage'::text; d := d || jsonb_build_object('mileage', jsonb_build_array(s.mileage, s_dt, o.mileage, o_dt));
    end if;
  end if;

  -- (c) overlapping live periods on different venues, unless a crosspost (same seller and shared photos)
  s_ven := lower(coalesce(s.canonical_platform, s.listing_source, s.auction_source, split_part(coalesce(s.listing_url, s.discovery_url,''),'/',3)));
  o_ven := lower(coalesce(o.canonical_platform, o.listing_source, o.auction_source, split_part(coalesce(o.listing_url, o.discovery_url,''),'/',3)));
  s_end := s_dt; o_end := o_dt;
  s_start := coalesce(s.listing_posted_at, s_end - interval '7 days'); o_start := coalesce(o.listing_posted_at, o_end - interval '7 days');
  if s_start is not null and o_start is not null and s_end is not null and o_end is not null
     and nullif(s_ven,'') is not null and nullif(o_ven,'') is not null and s_ven <> o_ven
     and s_start <= o_end and o_start <= s_end
     and not (overlap and lower(coalesce(s.seller_name, s.bat_seller,'')) <> ''
              and lower(coalesce(s.seller_name, s.bat_seller)) = lower(coalesce(o.seller_name, o.bat_seller,''))) then
    holds := holds || 'overlap_live'::text; d := d || jsonb_build_object('venues', jsonb_build_array(s_ven, o_ven), 'periods', jsonb_build_array(s_start, s_end, o_start, o_end));
  end if;

  -- (e) replica / clone / tribute on either side
  if coalesce(s.is_replica,false) or coalesce(o.is_replica,false)
     or concat_ws(' ', s.title, s.listing_title, s.bat_listing_title, s.model, s.replica_quote, o.title, o.listing_title, o.bat_listing_title, o.model, o.replica_quote)
        ~* '\m(replica|clone|tribute|recreation|re-creation|continuation|evocation|kit car|homage)\M'
     or left(coalesce(s.description,'') || ' ' || coalesce(o.description,''), 20000) ~* '\m(replica|clone|tribute|recreation|re-creation|kit car)\M' then
    holds := holds || 'replica'::text;
  end if;

  return jsonb_build_object('holds', to_jsonb(holds), 'soft', to_jsonb(soft), 'detail', d);
end $$;

revoke all on function public.vehicle_fold_guard(uuid, uuid) from public, anon, authenticated;
grant execute on function public.vehicle_fold_guard(uuid, uuid) to service_role;
