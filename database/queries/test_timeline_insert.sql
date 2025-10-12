-- Test a simple insert to see what's happening with the source column
INSERT INTO timeline_events (
    vehicle_id,
    user_id,
    event_type,
    source,
    title,
    event_date
) VALUES (
    (SELECT id FROM vehicles LIMIT 1),
    (SELECT user_id FROM vehicles LIMIT 1),
    'maintenance',
    'test_source',
    'Test Event',
    CURRENT_DATE
);
