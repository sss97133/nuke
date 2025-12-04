-- AUTO SERVICE EXECUTION TRIGGERS
-- Automatically queue services when vehicle data changes

-- ============================================================================
-- HELPER: Check which auto-services can run for a vehicle
-- ============================================================================

CREATE OR REPLACE FUNCTION check_auto_services(p_vehicle_id UUID)
RETURNS TABLE (
  service_key TEXT,
  service_name TEXT,
  can_execute BOOLEAN,
  missing_fields TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    si.service_key,
    si.service_name,
    (
      -- Check if service should auto-execute
      CASE 
        WHEN si.trigger_mode != 'auto' THEN false
        WHEN NOT si.is_enabled THEN false
        WHEN EXISTS (
          -- Already executed successfully?
          SELECT 1 FROM service_executions se
          WHERE se.vehicle_id = p_vehicle_id
          AND se.service_key = si.service_key
          AND se.status IN ('completed', 'executing', 'queued')
        ) THEN false
        ELSE (
          -- Check if required fields are present
          array_length(get_missing_fields(p_vehicle_id, si.required_fields), 1) IS NULL
          OR array_length(get_missing_fields(p_vehicle_id, si.required_fields), 1) = 0
        )
      END
    ) as can_execute,
    get_missing_fields(p_vehicle_id, si.required_fields) as missing_fields
  FROM service_integrations si
  WHERE si.is_enabled = true
  AND si.trigger_mode = 'auto'
  AND si.is_free = true;  -- Only auto-execute free services
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- TRIGGER FUNCTION: Queue auto-services when VIN added/updated
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_auto_services()
RETURNS TRIGGER AS $$
DECLARE
  service_record RECORD;
  queued_count INT := 0;
BEGIN
  -- Only proceed if this is a new vehicle or VIN was added/changed
  IF (TG_OP = 'INSERT') OR 
     (TG_OP = 'UPDATE' AND NEW.vin IS NOT NULL AND (OLD.vin IS NULL OR OLD.vin != NEW.vin)) THEN
    
    RAISE NOTICE 'Checking auto-services for vehicle %', NEW.id;
    
    -- Queue all eligible auto services
    FOR service_record IN 
      SELECT * FROM check_auto_services(NEW.id) WHERE can_execute = true
    LOOP
      RAISE NOTICE 'Queuing service: %', service_record.service_key;
      
      INSERT INTO service_executions (
        vehicle_id,
        service_key,
        trigger_type,
        status,
        request_data
      ) VALUES (
        NEW.id,
        service_record.service_key,
        'auto',
        'queued',
        jsonb_build_object(
          'vin', NEW.vin,
          'year', NEW.year,
          'make', NEW.make,
          'model', NEW.model,
          'mileage', NEW.mileage,
          'triggered_by', 'vehicle_insert_update',
          'triggered_at', NOW()
        )
      )
      ON CONFLICT DO NOTHING;  -- Prevent duplicate queuing
      
      queued_count := queued_count + 1;
    END LOOP;
    
    IF queued_count > 0 THEN
      RAISE NOTICE 'Queued % auto-services for vehicle %', queued_count, NEW.id;
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on vehicles table
DROP TRIGGER IF EXISTS vehicle_auto_services_trigger ON vehicles;
CREATE TRIGGER vehicle_auto_services_trigger
AFTER INSERT OR UPDATE OF vin, year, make, model ON vehicles
FOR EACH ROW
EXECUTE FUNCTION trigger_auto_services();

-- ============================================================================
-- TRIGGER FUNCTION: Track SPID form completion
-- ============================================================================

CREATE OR REPLACE FUNCTION track_spid_form_completion()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO vehicle_form_completions (
    vehicle_id,
    form_type,
    status,
    completeness_pct,
    fields_extracted,
    source_id,
    source_type,
    provider,
    extracted_at
  ) VALUES (
    NEW.vehicle_id,
    'spid',
    'complete',
    100,  -- SPID is always 100% if extracted
    jsonb_build_object(
      'vin', (NEW.vin IS NOT NULL),
      'build_date', (NEW.build_date IS NOT NULL),
      'paint_code_exterior', (NEW.paint_code_exterior IS NOT NULL),
      'paint_code_interior', (NEW.paint_code_interior IS NOT NULL),
      'engine_code', (NEW.engine_code IS NOT NULL),
      'transmission_code', (NEW.transmission_code IS NOT NULL),
      'axle_ratio', (NEW.axle_ratio IS NOT NULL),
      'rpo_codes', (NEW.rpo_codes IS NOT NULL AND array_length(NEW.rpo_codes, 1) > 0)
    ),
    NEW.image_id,
    'spid_image',
    'GM Factory',
    NEW.extracted_at
  )
  ON CONFLICT (vehicle_id, form_type) 
  DO UPDATE SET
    status = 'complete',
    completeness_pct = 100,
    fields_extracted = EXCLUDED.fields_extracted,
    updated_at = NOW();
    
  -- Also store as field evidence
  IF NEW.vin IS NOT NULL THEN
    INSERT INTO vehicle_field_evidence (
      vehicle_id, field_name, value_text, source_type, source_id,
      confidence_score, extraction_model
    ) VALUES (
      NEW.vehicle_id, 'vin', NEW.vin, 'spid_sheet', NEW.image_id,
      NEW.extraction_confidence, NEW.extraction_model
    ) ON CONFLICT (vehicle_id, field_name, source_type, source_id) DO NOTHING;
  END IF;
  
  IF NEW.paint_code_exterior IS NOT NULL THEN
    INSERT INTO vehicle_field_evidence (
      vehicle_id, field_name, value_text, source_type, source_id,
      confidence_score, extraction_model
    ) VALUES (
      NEW.vehicle_id, 'paint_code_exterior', NEW.paint_code_exterior, 'spid_sheet', NEW.image_id,
      NEW.extraction_confidence, NEW.extraction_model
    ) ON CONFLICT (vehicle_id, field_name, source_type, source_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on vehicle_spid_data
DROP TRIGGER IF EXISTS spid_form_completion_tracker ON vehicle_spid_data;
CREATE TRIGGER spid_form_completion_tracker
AFTER INSERT OR UPDATE ON vehicle_spid_data
FOR EACH ROW
EXECUTE FUNCTION track_spid_form_completion();

-- ============================================================================
-- SCHEDULED JOB: Process queued services every 5 minutes
-- ============================================================================

-- Note: This requires pg_cron extension
-- In Supabase, you can enable this via Dashboard → Database → Extensions

-- DROP EXISTING IF ANY
SELECT cron.unschedule('process-service-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-service-queue'
);

-- Schedule service orchestrator to run every 5 minutes
SELECT cron.schedule(
  'process-service-queue',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  SELECT
    net.http_post(
      url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/service-orchestrator',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body:=jsonb_build_object('limit', 20)
    ) as request_id;
  $$
);

SELECT 'Auto-service triggers and scheduled jobs created' as status;

