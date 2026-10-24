-- revert run ae_end_date_receipt_v1_20261024: restore old (NULL) end dates, mark provenance rows superseded
update public.auction_events e set auction_end_date = p.old_end_date
from public.auction_event_end_date_provenance p
where p.run_id='ae_end_date_receipt_v1_20261024' and p.superseded_at is null and e.id=p.auction_event_id and e.auction_end_date = p.new_end_date;
update public.auction_event_end_date_provenance set superseded_at = now() where run_id='ae_end_date_receipt_v1_20261024' and superseded_at is null;
