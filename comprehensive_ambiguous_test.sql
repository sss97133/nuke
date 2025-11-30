-- ==========================================================================
-- COMPREHENSIVE TEST SUITE: Verify all ambiguous organization_id fixes
-- ==========================================================================

\echo '═══════════════════════════════════════════════════════════════════'
\echo 'COMPREHENSIVE AMBIGUOUS organization_id FIX VERIFICATION'
\echo '═══════════════════════════════════════════════════════════════════'
\echo ''

-- Test 1: Verify all functions execute without ambiguous errors
\echo 'Test 1: Function Execution Tests'
\echo '───────────────────────────────────────────────────────────────────'

DO $$
DECLARE
  v_test_vehicle_id UUID;
  v_test_user_id UUID;
  v_passed INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  SELECT id INTO v_test_vehicle_id FROM vehicles WHERE is_public = true LIMIT 1;
  SELECT id INTO v_test_user_id FROM auth.users LIMIT 1;
  
  IF v_test_vehicle_id IS NULL OR v_test_user_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: No test data available';
    RETURN;
  END IF;
  
  -- Test user_can_edit_vehicle
  BEGIN
    PERFORM user_can_edit_vehicle(v_test_vehicle_id, v_test_user_id);
    v_passed := v_passed + 1;
    RAISE NOTICE '✓ user_can_edit_vehicle: PASSED';
  EXCEPTION WHEN OTHERS THEN
    v_failed := v_failed + 1;
    RAISE NOTICE '✗ user_can_edit_vehicle: FAILED - %', SQLERRM;
    IF SQLERRM LIKE '%ambiguous%' THEN
      RAISE NOTICE '  ⚠️  AMBIGUOUS ERROR DETECTED!';
    END IF;
  END;
  
  -- Test vehicle_user_has_access
  BEGIN
    PERFORM vehicle_user_has_access(v_test_vehicle_id, v_test_user_id);
    v_passed := v_passed + 1;
    RAISE NOTICE '✓ vehicle_user_has_access: PASSED';
  EXCEPTION WHEN OTHERS THEN
    v_failed := v_failed + 1;
    RAISE NOTICE '✗ vehicle_user_has_access: FAILED - %', SQLERRM;
    IF SQLERRM LIKE '%ambiguous%' THEN
      RAISE NOTICE '  ⚠️  AMBIGUOUS ERROR DETECTED!';
    END IF;
  END;
  
  -- Test get_user_associations
  BEGIN
    PERFORM get_user_associations(v_test_user_id, v_test_vehicle_id);
    v_passed := v_passed + 1;
    RAISE NOTICE '✓ get_user_associations: PASSED';
  EXCEPTION WHEN OTHERS THEN
    v_failed := v_failed + 1;
    RAISE NOTICE '✗ get_user_associations: FAILED - %', SQLERRM;
    IF SQLERRM LIKE '%ambiguous%' THEN
      RAISE NOTICE '  ⚠️  AMBIGUOUS ERROR DETECTED!';
    END IF;
  END;
  
  -- Test calculate_edit_confidence
  BEGIN
    PERFORM calculate_edit_confidence(v_test_user_id, v_test_vehicle_id, 'make', 'user_input');
    v_passed := v_passed + 1;
    RAISE NOTICE '✓ calculate_edit_confidence: PASSED';
  EXCEPTION WHEN OTHERS THEN
    v_failed := v_failed + 1;
    RAISE NOTICE '✗ calculate_edit_confidence: FAILED - %', SQLERRM;
    IF SQLERRM LIKE '%ambiguous%' THEN
      RAISE NOTICE '  ⚠️  AMBIGUOUS ERROR DETECTED!';
    END IF;
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Test 1 Results: % passed, % failed', v_passed, v_failed;
END $$;

\echo ''
\echo 'Test 2: RLS Policy Syntax Verification'
\echo '───────────────────────────────────────────────────────────────────'

-- Test 2: Verify RLS policy can be evaluated
DO $$
DECLARE
  v_test_vehicle_id UUID;
  v_test_user_id UUID;
  v_result BOOLEAN;
BEGIN
  SELECT id INTO v_test_vehicle_id FROM vehicles LIMIT 1;
  SELECT id INTO v_test_user_id FROM auth.users LIMIT 1;
  
  IF v_test_vehicle_id IS NULL OR v_test_user_id IS NULL THEN
    RAISE NOTICE 'SKIPPED: No test data available';
    RETURN;
  END IF;
  
  BEGIN
    -- Simulate the organization membership check from RLS policy
    SELECT EXISTS (
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
    ) INTO v_result;
    
    RAISE NOTICE '✓ RLS policy organization check: PASSED (result: %)', v_result;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '✗ RLS policy check: FAILED - %', SQLERRM;
    IF SQLERRM LIKE '%ambiguous%' OR SQLERRM LIKE '%organization_id%' THEN
      RAISE NOTICE '  ⚠️  AMBIGUOUS ERROR IN RLS POLICY!';
    END IF;
  END;
END $$;

\echo ''
\echo 'Test 3: Function Definition Analysis'
\echo '───────────────────────────────────────────────────────────────────'

-- Test 3: Check for problematic JOIN patterns
SELECT 
  routine_name,
  CASE 
    WHEN routine_definition LIKE '%JOIN organization_contributors oc ON oc.organization_id = ov.organization_id%'
         AND routine_definition NOT LIKE '%ov.organization_id%'
    THEN '⚠️  HAS AMBIGUOUS JOIN'
    WHEN routine_definition LIKE '%JOIN organization_contributors%'
         AND routine_definition LIKE '%organization_id%'
         AND routine_definition LIKE '%ov.organization_id%'
    THEN '✓ OK (uses explicit alias)'
    ELSE '✓ OK'
  END as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_definition LIKE '%organization_contributors%'
  AND routine_definition LIKE '%organization_id%'
ORDER BY 
  CASE WHEN status LIKE '%⚠️%' THEN 0 ELSE 1 END,
  routine_name;

\echo ''
\echo 'Test 4: NULL Input Handling'
\echo '───────────────────────────────────────────────────────────────────'

DO $$
DECLARE
  v_passed INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  -- Test NULL inputs
  BEGIN
    PERFORM user_can_edit_vehicle(NULL, NULL);
    v_passed := v_passed + 1;
    RAISE NOTICE '✓ user_can_edit_vehicle(NULL, NULL): PASSED';
  EXCEPTION WHEN OTHERS THEN
    v_failed := v_failed + 1;
    RAISE NOTICE '✗ user_can_edit_vehicle(NULL, NULL): FAILED - %', SQLERRM;
  END;
  
  BEGIN
    PERFORM vehicle_user_has_access(NULL, NULL);
    v_passed := v_passed + 1;
    RAISE NOTICE '✓ vehicle_user_has_access(NULL, NULL): PASSED';
  EXCEPTION WHEN OTHERS THEN
    v_failed := v_failed + 1;
    RAISE NOTICE '✗ vehicle_user_has_access(NULL, NULL): FAILED - %', SQLERRM;
  END;
  
  BEGIN
    PERFORM get_user_associations(NULL, NULL);
    v_passed := v_passed + 1;
    RAISE NOTICE '✓ get_user_associations(NULL, NULL): PASSED';
  EXCEPTION WHEN OTHERS THEN
    v_failed := v_failed + 1;
    RAISE NOTICE '✗ get_user_associations(NULL, NULL): FAILED - %', SQLERRM;
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Test 4 Results: % passed, % failed', v_passed, v_failed;
END $$;

\echo ''
\echo 'Test 5: Count of Problematic Functions'
\echo '───────────────────────────────────────────────────────────────────'

SELECT 
  COUNT(*) FILTER (
    WHERE routine_definition LIKE '%JOIN organization_contributors oc ON oc.organization_id = ov.organization_id%'
      AND routine_definition NOT LIKE '%ov.organization_id%'
  ) as functions_with_ambiguous_joins,
  COUNT(*) as total_functions_checked
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_definition LIKE '%organization_contributors%'
  AND routine_definition LIKE '%organization_id%';

\echo ''
\echo '═══════════════════════════════════════════════════════════════════'
\echo 'TEST SUITE COMPLETE'
\echo '═══════════════════════════════════════════════════════════════════'

