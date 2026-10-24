-- Wider cited rule set for receipt document kinds: chain and shop names in the page text,
-- part words in line items, cited vendor catalogs (receipt_vendor_specialties), and amount bounds.
-- vehicle_sale (the user is the seller, or a consignment / brokered sale) is proceeds, not spend,
-- so it is excluded from vehicle receipts and spend rollups.
alter table public.receipt_document_kind_rules
  add column if not exists amount_min numeric,
  add column if not exists amount_max numeric;
alter table public.receipt_document_kind_rules drop constraint if exists receipt_document_kind_rules_field_check;
alter table public.receipt_document_kind_rules add constraint receipt_document_kind_rules_field_check
  check (field in ('vendor','doctype','text','items','specialty'));
comment on column public.receipt_document_kind_rules.field is 'vendor, doctype, text (first 400 chars of OCR), items (line-item descriptions), or specialty (vendor or text matches a receipt_vendor_specialties.vendor_pattern; pattern unused).';

insert into public.receipt_document_kind_rules (rule_id, priority, kind, field, pattern, amount_min, amount_max) values
  ('vehicle_sale_seller',55,'vehicle_sale','text','seller:\s*(skylar williams|viva las vegas autos)',null,null),
  ('vehicle_sale_vendor',56,'vehicle_sale','vendor','\((sold to|brokered for)\y',null,null),
  ('consignment_contract',57,'vehicle_sale','vendor','consignment contract',null,null),
  ('vehicle_transport_order',58,'shipping','text','vehicle inspection report|bill of lading|consignor.{0,80}consignee',null,null),
  ('personal_travel_dining',90,'personal_purchase','text','\y(restaurant|hotel|bistro|brasserie|bar de|cafe|café|rubio.?s|subway|pizzeria|boulangerie)\y',null,null),
  ('personal_phone_pharmacy',91,'personal_purchase','text','at&t|verizon|t-mobile|\ypharmacy\y|\ycvs\y|walgreens',null,null),
  ('personal_firearms',92,'personal_purchase','text','gun doctor|\yfirearm|\yammo\y|ammunition',null,null),
  ('personal_retail_vendor',93,'personal_purchase','vendor','chrome hearts|marshalls|hobby lobby',null,null),
  ('parts_chain_text',100,'parts_service','text','carquest|\ycq of las|autozone|o.?reilly|napa auto|advance auto|pep boys|lesa.?s auto body|delmo speed|sms auto fabrics',null,null),
  ('parts_shop_text',101,'parts_service','text','\ytires?\y|muffler|\ysmog\y|upholster|auto fabric|plating|polishing|welding|machine shop|auto body|transmission|alignment',null,null),
  ('hardware_chain_text',102,'parts_service','text','true value|lowe.?s|home depot|ace hardware|harbor freight|cti industrial|\ylinde\y|great people, great products',null,null),
  ('catalog_specialty',103,'parts_service','specialty','',null,null),
  ('shipping_text',110,'shipping','text','ups store|\yusps\y|fedex|postnet|postnord|u-haul|packing slip',null,null),
  ('general_retail_text',111,'general_merchandise','text','walmart|\ytarget\y|best buy|amazon|\yebay\y|\yblick\y',null,null),
  ('part_words_items',120,'parts_service','items','\y(gaskets?|filters?|spark plugs?|brakes?|rotors?|calipers?|bearings?|hoses?|clamps?|bolts?|carb|carburetor|alternator|starter|radiator|thermostat|pulley|shocks?|bushings?|axle|u-joint|seals?|o-rings?|wiper|headlights?|fuses?|relay|terminals?|battery|coolant|antifreeze|primer|weatherstrip|harness|exhaust|manifold|pistons?|valves?|camshaft|crankshaft|sensor|fuel pump|water pump|injectors?|fittings?|sealant|grease|motor oil|5w-?30|10w-?30|10w-?40|20w-?50|brake fluid|wheel|lug|tie rod|ball joint|steering|differential|driveshaft|clutch|flywheel|emblem|bumper|fender|grille|tailgate|upholstery|carpet kit|seat cover)\y',null,null),
  ('part_words_text',121,'parts_service','text','\y(part ?(no|#|number)|core charge|core deposit|spark plugs?|brake pads?|oil filter|gasket|alternator|carburetor)\y',null,null),
  ('fuel_gallons_amount',130,'fuel','text','\y(gallons?|unleaded|diesel|pump ?#?\s*\d)\y',null,'250')
on conflict (rule_id) do nothing;

create or replace function public.receipt_doc_kind_excluded(k public.receipt_doc_kind)
returns boolean language sql immutable as $f$
  select coalesce(k::text in ('tax_form','financial_statement','insurance_document','letter_notice','personal_purchase','vehicle_sale'), false)
$f$;

create or replace function public.receipt_doc_items(p_id uuid, p_rx jsonb)
returns text language sql stable as $f$
  select left(coalesce(string_agg(d, ' | '), ''), 2000) from (
    select description d from public.receipt_items where receipt_id = p_id
    union all select description from public.line_items where receipt_id = p_id
    union all select x->>'description' from jsonb_array_elements(case when jsonb_typeof(p_rx #> '{data,line_items}') = 'array' then p_rx #> '{data,line_items}' else '[]'::jsonb end) x
  ) q where d is not null
$f$;

create or replace function public.receipt_classify_document(p_vendor text, p_doctype text, p_text text, p_items text, p_amount numeric)
returns jsonb language plpgsql stable as $f$
declare ru record; src text; m text; sp record;
begin
  for ru in select * from public.receipt_document_kind_rules order by priority, rule_id loop
    if ru.amount_min is not null and coalesce(p_amount,0) < ru.amount_min then continue; end if;
    if ru.amount_max is not null and coalesce(p_amount,0) > ru.amount_max then continue; end if;
    if ru.field = 'specialty' then
      select s.vendor_slug, s.vendor_pattern, s.citation_url into sp from public.receipt_vendor_specialties s
       where (coalesce(p_vendor,'') || ' ' || coalesce(p_text,'')) ~* s.vendor_pattern order by s.id limit 1;
      if found then
        return jsonb_build_object('kind', ru.kind, 'rule_id', ru.rule_id, 'field', ru.field, 'pattern', sp.vendor_pattern,
          'match', sp.vendor_slug, 'citation_url', sp.citation_url);
      end if;
      continue;
    end if;
    src := case ru.field when 'vendor' then coalesce(p_vendor,'') when 'doctype' then coalesce(p_doctype,'')
                         when 'items' then coalesce(p_items,'') else coalesce(p_text,'') end;
    m := substring(src from ('(?i)' || ru.pattern));
    if src ~* ru.pattern then
      return jsonb_build_object('kind', ru.kind, 'rule_id', ru.rule_id, 'field', ru.field, 'pattern', ru.pattern,
        'match', left(coalesce(m, ''), 120), 'amount_bounds', case when ru.amount_min is not null or ru.amount_max is not null then jsonb_build_object('min', ru.amount_min, 'max', ru.amount_max, 'amount', p_amount) end);
    end if;
  end loop;
  return jsonb_build_object('kind','unknown','rule_id',null);
end $f$;

create or replace function public.receipt_classify_document(p_vendor text, p_doctype text, p_text text)
returns jsonb language sql stable as $f$ select public.receipt_classify_document(p_vendor, p_doctype, p_text, null, null) $f$;

create or replace function public.receipts_set_document_kind()
returns trigger language plpgsql as $f$
declare c jsonb;
begin
  if coalesce(new.document_kind_rule,'') = 'manual' then return new; end if;
  c := public.receipt_classify_document(new.vendor_name,
         concat_ws(' ', new.raw_extraction->>'document_type', new.raw_json->>'document_type'),
         public.receipt_doc_text(new.raw_extraction, new.raw_json),
         public.receipt_doc_items(new.id, new.raw_extraction),
         coalesce(new.total_amount, new.total));
  if new.document_kind is distinct from (c->>'kind')::public.receipt_doc_kind then
    new.document_kind := (c->>'kind')::public.receipt_doc_kind;
    new.document_kind_rule := c->>'rule_id';
    new.document_kind_citation := c;
    new.document_kind_classified_at := now();
    new.document_kind_run_id := 'document_kind_trigger';
  end if;
  return new;
end $f$;
drop trigger if exists trg_receipts_document_kind on public.receipts;
create trigger trg_receipts_document_kind before insert or update of vendor_name, raw_extraction, raw_json, total_amount, total
  on public.receipts for each row execute function public.receipts_set_document_kind();
