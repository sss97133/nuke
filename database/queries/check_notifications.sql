-- Check if notifications were actually created
SELECT 
    n.*,
    u.email as user_email
FROM notifications n
LEFT JOIN auth.users u ON n.user_id = u.id
WHERE n.type = 'missing_image_dates'
ORDER BY n.created_at DESC;

-- Check which user is logged in (you need to check this in the app)
-- The notifications are tied to specific user_ids

-- If notifications exist, check the NotificationCenter component
-- It needs to fetch from the notifications table
