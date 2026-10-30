-- One source can retain its qualified native identifier reading without
-- inventing a second same-car witness. No subjects, memberships or model read.
SET lock_timeout='3s';
SET statement_timeout='10s';
DO $guard$ DECLARE definition text; hash text; BEGIN
 definition:=pg_get_functiondef('ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb)'::regprocedure);
 hash:=encode(sha256(convert_to(definition,'UTF8')),'base64');
 IF hash='IQAwLsv4Hwj/uVa9oNAkOhAfkq2fyS+rCdfs6IrPK30=' THEN RETURN; END IF;
 IF hash<>'jqrkLkMNGL+08bfuEkVFZskTyahGg3IVMsdVAbdYi84=' THEN RAISE EXCEPTION 'Protected image intake owner drifted'; END IF;
 definition:=replace(definition,$old$       OR (v_reading AND (jsonb_array_length(v_envelope -> 'inputs') NOT BETWEEN 2 AND 3$old$,$new$       OR (v_reading AND (jsonb_array_length(v_envelope -> 'inputs') NOT BETWEEN 1 AND 3
         OR (jsonb_array_length(v_envelope -> 'inputs') = 1 AND (
           jsonb_array_length(v_envelope -> 'subjects') <> 0
           OR v_envelope #>> '{raw_model_reading,kind}' IS DISTINCT FROM 'on_device_identity_read_v1'
           OR v_envelope ->> 'provider' IS DISTINCT FROM 'Apple Vision (on-device)'
           OR coalesce(v_envelope #>> '{raw_model_reading,identity_method_version}','') !~ '^vehicle-identity-context-fold-v3:[A-Za-z0-9._:-]{1,80}$'
           OR v_envelope ->> 'model' IS DISTINCT FROM v_envelope #>> '{raw_model_reading,identity_method_version}'
           OR v_envelope #>> '{raw_model_reading,identity_run_id}' IS DISTINCT FROM v_envelope ->> 'run_key'
           OR NOT pg_input_is_valid(v_envelope ->> 'run_key','uuid')))$new$);
 EXECUTE definition;
END $guard$;
