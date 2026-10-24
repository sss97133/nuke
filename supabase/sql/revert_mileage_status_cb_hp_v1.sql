update public.mileage_value_status set superseded_at=now() where run_id='mileage_status_cb_hp_v1_20261024' and superseded_at is null;
