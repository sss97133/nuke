-- revert data (no COMMIT)
update public.vehicle_sale_price_untrusted_marks set retired_at=now() where run_id='mecum_ask_price_kind_v1_20261025' and retired_at is null;
update public.vehicle_events set price_kind=null, price_kind_source=null where price_kind_source like 'mecum_ask_price_kind_v1_20261025%';
