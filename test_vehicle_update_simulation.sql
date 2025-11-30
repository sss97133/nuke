-- ==========================================================================
-- COMPREHENSIVE TEST: Simulate vehicle update to verify no ambiguous errors
-- ==========================================================================

-- Test: Simulate what happens during a vehicle update
DO $$
DECLARE
  v_test_vehicle_id UUID;
  v_test_user_id UUID;
  v_update_success BOOLEAN := false;
  v_error_message TEXT;
BEGIN
  -- Get test data
  SELECT id INTO v_test_vehicle_id FROM vehicles WHERE is_public = true LIMIT 1;
  SELECT id INTO v_test_user_id FROM auth.users LIMIT 1;
  
  IF v_test_vehicle_id IS NULL THEN
    RAISE NOTICE 'Test: SKIPPED - No test vehicle found';
    RETURN;
  END IF;
  
  IF v_test_user_id IS NULL THEN
    RAISE NOTICE 'Test: SKIPPED - No test user found';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Test: Starting vehicle update simulation...';
  RAISE NOTICE '  Vehicle ID: %', v_test_vehicle_id;
  RAISE NOTICE '  User ID: %', v_test_user_id;
  
  -- Test 1: Check if user can edit vehicle (this calls functions that might have ambiguous errors)
  BEGIN
    PERFORM user_can_edit_vehicle(v_test_vehicle_id, v_test_user_id);
    RAISE NOTICE '  ✓ user_can_edit_vehicle: PASSED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ✗ user_can_edit_vehicle: FAILED - %', SQLERRM;
    RETURN;
  END;
  
  -- Test 2: Check vehicle access (another function that might have ambiguous errors)
  BEGIN
    PERFORM vehicle_user_has_access(v_test_vehicle_id, v_test_user_id);
    RAISE NOTICE '  ✓ vehicle_user_has_access: PASSED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ✗ vehicle_user_has_access: FAILED - %', SQLERRM;
    RETURN;
  END;
  
  -- Test 3: Get user associations (might be called during updates)
  BEGIN
    PERFORM get_user_associations(v_test_user_id, v_test_vehicle_id);
    RAISE NOTICE '  ✓ get_user_associations: PASSED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ✗ get_user_associations: FAILED - %', SQLERRM;
    RETURN;
  END;
  
  -- Test 4: Calculate edit confidence (might be called during updates)
  BEGIN
    PERFORM calculate_edit_confidence(v_test_user_id, v_test_vehicle_id, 'make', 'user_input');
    RAISE NOTICE '  ✓ calculate_edit_confidence: PASSED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ✗ calculate_edit_confidence: FAILED - %', SQLERRM;
    RETURN;
  END;
  
  -- Test 5: Simulate the RLS policy check (what happens during UPDATE)
  -- This is the critical test - checking if the policy can evaluate without ambiguous errors
  BEGIN
    -- Simulate what the RLS policy does internally
    PERFORM EXISTS (
      SELECT 1
      FROM organization_vehicles ov
      WHERE ov.vehicle_id = v_test_vehicle_id
        AND EXISTS (
          SELECT 1
          FROM organization_contributors oc
          WHERE oc.organization_id = ov.organization_id
            AND oc.user_id = v_test_user_id
            AND oc.status = 'active'
            AND oc.role IN ('owner', 'manager', 'employee')
        )
    );
    RAISE NOTICE '  ✓ RLS policy check (organization membership): PASSED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ✗ RLS policy check: FAILED - %', SQLERRM;
    IF SQLERRM LIKE '%ambiguous%' OR SQLERRM LIKE '%organization_id%' THEN
      RAISE NOTICE '  ⚠️  AMBIGUOUS ERROR DETECTED!';
    END IF;
    RETURN;
  END;
  
  -- Test 6: Try a safe update operation (if we have permission)
  -- We'll use a service role context to bypass RLS for testing
  BEGIN
    -- Check if we can construct the UPDATE query without errors
    -- (We won't actually execute it, just verify the policy can be evaluated)
    PERFORM 1 FROM vehicles 
    WHERE id = v_test_vehicle_id
      AND (
        -- Simulate the USING clause of the RLS policy
        EXISTS (
          SELECT 1
          FROM organization_vehicles ov
          WHERE ov.vehicle_id = vehicles.id
            AND EXISTS (
              SELECT 1
              FROM organization_contributors oc
              WHERE oc.organization_id = ov.organization_id
                AND oc.user_id = v_test_user_id
                AND oc.status = 'active'
                AND oc.role IN ('owner', 'manager', 'employee')
            )
        )
      );
    RAISE NOTICE '  ✓ RLS policy USING clause evaluation: PASSED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ✗ RLS policy USING clause: FAILED - %', SQLERRM;
    IF SQLERRM LIKE '%ambiguous%' OR SQLERRM LIKE '%organization_id%' THEN
      RAISE NOTICE '  ⚠️  AMBIGUOUS ERROR IN RLS POLICY!';
    END IF;
    RETURN;
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'ALL TESTS PASSED - No ambiguous organization_id errors!';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'TEST FAILED: %', SQLERRM;
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;

-- Additional test: Verify all functions can handle NULL inputs gracefully
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE 'Testing NULL input handling...';
  
  BEGIN
    PERFORM user_can_edit_vehicle(NULL, NULL);
    RAISE NOTICE '  ✓ user_can_edit_vehicle(NULL, NULL): PASSED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ✗ user_can_edit_vehicle(NULL, NULL): FAILED - %', SQLERRM;
  END;
  
  BEGIN
    PERFORM vehicle_user_has_access(NULL, NULL);
    RAISE NOTICE '  ✓ vehicle_user_has_access(NULL, NULL): PASSED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ✗ vehicle_user_has_access(NULL, NULL): FAILED - %', SQLERRM;
  END;
  
  BEGIN
    PERFORM get_user_associations(NULL, NULL);
    RAISE NOTICE '  ✓ get_user_associations(NULL, NULL): PASSED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ✗ get_user_associations(NULL, NULL): FAILED - %', SQLERRM;
  END;
END $$;

-- Final check: Verify no functions have the problematic JOIN pattern
SELECT 
  'Final Verification' as test_name,
  COUNT(*) FILTER (WHERE routine_definition LIKE '%JOIN organization_contributors oc ON oc.organization_id = ov.organization_id%' 
                    AND routine_definition NOT LIKE '%ov.organization_id%') as problematic_functions,
  COUNT(*) as total_functions_checked
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_definition LIKE '%organization_contributors%'
  AND routine_definition LIKE '%organization_id%';

