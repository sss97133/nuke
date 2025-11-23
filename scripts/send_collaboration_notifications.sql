-- ==========================================================================
-- SEND COLLABORATION NOTIFICATIONS SCRIPT
-- ==========================================================================
-- Purpose: Send notifications to Viva collaborators to verify responsibilities
-- Run this script to initiate the collaboration verification process
-- ==========================================================================

-- Find Viva! Las Vegas Autos organization
DO $$
DECLARE
  v_viva_org_id UUID;
  v_notification_count INTEGER;
  v_org_name TEXT;
  v_total_vehicles INTEGER;
  v_needs_assignment INTEGER;
  v_invalid_vins INTEGER;
BEGIN
  -- Find Viva org
  SELECT id, business_name INTO v_viva_org_id, v_org_name
  FROM businesses
  WHERE business_name ILIKE '%viva%las%vegas%'
  LIMIT 1;
  
  IF v_viva_org_id IS NULL THEN
    RAISE NOTICE 'ERROR: Could not find Viva Las Vegas Autos organization';
    RETURN;
  END IF;
  
  RAISE NOTICE '==================================================';
  RAISE NOTICE 'COLLABORATION NOTIFICATION GENERATOR';
  RAISE NOTICE '==================================================';
  RAISE NOTICE 'Organization: % (ID: %)', v_org_name, v_viva_org_id;
  RAISE NOTICE '';
  
  -- Get inventory stats
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE responsible_party_user_id IS NULL),
    COUNT(*) FILTER (WHERE vin_is_valid = false)
  INTO v_total_vehicles, v_needs_assignment, v_invalid_vins
  FROM organization_vehicles ov
  JOIN vehicles v ON v.id = ov.vehicle_id
  WHERE ov.organization_id = v_viva_org_id
    AND ov.status = 'active';
  
  RAISE NOTICE 'Inventory Summary:';
  RAISE NOTICE '  Total active vehicles: %', v_total_vehicles;
  RAISE NOTICE '  Needs assignment: %', v_needs_assignment;
  RAISE NOTICE '  Invalid VINs: %', v_invalid_vins;
  RAISE NOTICE '';
  
  -- Get collaborators
  RAISE NOTICE 'Collaborators:';
  FOR v_org_name IN
    SELECT p.full_name || ' (' || oc.role || ')' as collaborator
    FROM organization_contributors oc
    JOIN profiles p ON p.id = oc.user_id
    WHERE oc.organization_id = v_viva_org_id
      AND oc.status = 'active'
    ORDER BY 
      CASE oc.role
        WHEN 'owner' THEN 1
        WHEN 'manager' THEN 2
        WHEN 'employee' THEN 3
        ELSE 4
      END
  LOOP
    RAISE NOTICE '  - %', v_org_name;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '--------------------------------------------------';
  RAISE NOTICE 'Sending notifications...';
  RAISE NOTICE '--------------------------------------------------';
  
  -- Send notifications
  SELECT send_collaboration_verification(v_viva_org_id)
  INTO v_notification_count;
  
  RAISE NOTICE '';
  RAISE NOTICE '✓ Sent % notifications', v_notification_count;
  RAISE NOTICE '';
  
  -- Show sample notifications created
  RAISE NOTICE 'Recent notifications:';
  FOR v_org_name IN
    SELECT 
      format(
        '  %s → %s: %s',
        p.full_name,
        v.year || ' ' || v.make || ' ' || v.model,
        cn.title
      ) as notification
    FROM collaboration_notifications cn
    JOIN profiles p ON p.id = cn.user_id
    JOIN vehicles v ON v.id = cn.vehicle_id
    WHERE cn.organization_id = v_viva_org_id
      AND cn.created_at > NOW() - INTERVAL '1 hour'
    ORDER BY cn.created_at DESC
    LIMIT 10
  LOOP
    RAISE NOTICE '%', v_org_name;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '==================================================';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '==================================================';
  RAISE NOTICE '1. Collaborators will receive notifications in-app';
  RAISE NOTICE '2. They can verify their responsibility or assign to others';
  RAISE NOTICE '3. Vehicles with invalid VINs are flagged as URGENT priority';
  RAISE NOTICE '4. Check /notifications in the app to see and act on notifications';
  RAISE NOTICE '';
  
END $$;

-- ==========================================================================
-- SHOW VEHICLES NEEDING ATTENTION
-- ==========================================================================

SELECT 
  year || ' ' || make || ' ' || model as vehicle,
  vin,
  CASE 
    WHEN vin_is_valid = false THEN '❌ INVALID VIN'
    WHEN vin IS NULL THEN '⚠️  NO VIN'
    ELSE '✓ Valid'
  END as vin_status,
  days_on_lot || ' days' as time_on_lot,
  CASE 
    WHEN responsible_party_user_id IS NULL THEN '⚠️  UNASSIGNED'
    ELSE '✓ Assigned'
  END as assignment_status,
  image_count || ' photos' as images,
  issues
FROM vehicles_needing_attention
WHERE organization_id = (
  SELECT id FROM businesses WHERE business_name ILIKE '%viva%las%vegas%' LIMIT 1
)
ORDER BY priority_score DESC
LIMIT 20;

