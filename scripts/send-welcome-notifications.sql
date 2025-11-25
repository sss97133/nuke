-- ==========================================================================
-- SEND WELCOME NOTIFICATIONS TO ALL ORGANIZATIONS
-- ==========================================================================
-- Purpose: Send "Welcome to N-Zero" test notifications to all org members
-- ==========================================================================

DO $$
DECLARE
  v_org RECORD;
  v_user RECORD;
  v_notification_id UUID;
  v_user_notification_id UUID;
  v_count INTEGER := 0;
BEGIN
  -- Loop through all organizations
  FOR v_org IN
    SELECT DISTINCT b.id, b.business_name
    FROM businesses b
    WHERE EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = b.id
    )
    ORDER BY b.business_name
  LOOP
    RAISE NOTICE 'Processing organization: % (%)', v_org.business_name, v_org.id;
    
    -- Loop through all members of this organization
    FOR v_user IN
      SELECT 
        oc.user_id, 
        oc.role, 
        u.email,
        CASE oc.role
          WHEN 'owner' THEN 1
          WHEN 'co_founder' THEN 2
          WHEN 'board_member' THEN 3
          WHEN 'manager' THEN 4
          ELSE 5
        END as role_priority
      FROM organization_contributors oc
      JOIN auth.users u ON u.id = oc.user_id
      WHERE oc.organization_id = v_org.id
      GROUP BY oc.user_id, oc.role, u.email
      ORDER BY role_priority
    LOOP
      -- Create notification in user_notifications (inbox)
      INSERT INTO user_notifications (
        user_id,
        type,
        title,
        message,
        organization_id,
        metadata,
        is_read,
        created_at
      ) VALUES (
        v_user.user_id,
        'welcome',
        'Welcome to N-Zero!',
        format('Welcome to N-Zero, %s! We''re excited to have %s as part of our platform. Get started by exploring your organization dashboard and connecting with other members.', 
          v_org.business_name,
          v_org.business_name
        ),
        v_org.id,
        jsonb_build_object(
          'notification_type', 'welcome',
          'organization_id', v_org.id,
          'organization_name', v_org.business_name,
          'user_role', v_user.role
        ),
        FALSE,
        NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_user_notification_id;
      
      IF v_user_notification_id IS NOT NULL THEN
        v_count := v_count + 1;
        RAISE NOTICE '  Sent to user: % (role: %)', v_user.email, v_user.role;
      END IF;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE 'Total notifications sent: %', v_count;
END $$;

-- Verify notifications were created
SELECT 
  COUNT(*) as total_notifications,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT organization_id) as unique_organizations,
  COUNT(*) FILTER (WHERE is_read = FALSE) as unread,
  COUNT(*) FILTER (WHERE type = 'welcome') as welcome_notifications
FROM user_notifications
WHERE type = 'welcome'
  AND created_at > NOW() - INTERVAL '1 minute';

-- Show sample notifications
SELECT 
  un.id,
  un.user_id,
  b.business_name,
  un.title,
  un.message,
  un.is_read,
  un.created_at
FROM user_notifications un
LEFT JOIN businesses b ON b.id = un.organization_id
WHERE un.type = 'welcome'
  AND un.created_at > NOW() - INTERVAL '1 minute'
ORDER BY un.created_at DESC
LIMIT 10;

