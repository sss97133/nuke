-- Insert sample timeline events for testing
INSERT INTO vehicle_timeline_events (
    id, vehicle_id, event_type, title, description, event_date, 
    image_urls, metadata, created_at
) VALUES 
-- Recent events (last few days)
(
    gen_random_uuid(),
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    'maintenance',
    'Oil Change',
    'Regular maintenance - changed oil and filter',
    '2025-08-29'::date,
    ARRAY['https://via.placeholder.com/300x200/4CAF50/white?text=Oil+Change'],
    '{"creator_info": {"created_by": "Test User", "created_via": "web"}}'::jsonb,
    NOW() - INTERVAL '2 days'
),
(
    gen_random_uuid(),
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    'repair',
    'Brake Pad Replacement',
    'Replaced front brake pads due to wear',
    '2025-08-28'::date,
    ARRAY['https://via.placeholder.com/300x200/FF9800/white?text=Brake+Pads', 'https://via.placeholder.com/300x200/FF9800/white?text=Before+After'],
    '{"creator_info": {"created_by": "Test User", "created_via": "bulk_upload"}}'::jsonb,
    NOW() - INTERVAL '3 days'
),
(
    gen_random_uuid(),
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    'inspection',
    'Pre-trip Inspection',
    'Checked all systems before long drive',
    '2025-08-27'::date,
    ARRAY['https://via.placeholder.com/300x200/2196F3/white?text=Inspection'],
    '{"creator_info": {"created_by": "Test User", "created_via": "mobile"}}'::jsonb,
    NOW() - INTERVAL '4 days'
),
-- Multiple events on same day
(
    gen_random_uuid(),
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    'maintenance',
    'Tire Rotation',
    'Rotated tires for even wear',
    '2025-08-26'::date,
    ARRAY['https://via.placeholder.com/300x200/9C27B0/white?text=Tire+Rotation'],
    '{"creator_info": {"created_by": "Test User", "created_via": "web"}}'::jsonb,
    NOW() - INTERVAL '5 days'
),
(
    gen_random_uuid(),
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    'fuel',
    'Fuel Up',
    'Filled tank - 14.2 gallons',
    '2025-08-26'::date,
    NULL,
    '{"creator_info": {"created_by": "Test User", "created_via": "mobile"}}'::jsonb,
    NOW() - INTERVAL '5 days'
),
-- Older events for timeline depth
(
    gen_random_uuid(),
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    'repair',
    'Transmission Service',
    'Full transmission fluid change and filter replacement',
    '2025-08-15'::date,
    ARRAY['https://via.placeholder.com/300x200/F44336/white?text=Transmission', 'https://via.placeholder.com/300x200/F44336/white?text=Fluid+Change'],
    '{"creator_info": {"created_by": "Test User", "created_via": "web"}}'::jsonb,
    NOW() - INTERVAL '16 days'
),
(
    gen_random_uuid(),
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    'maintenance',
    'Air Filter Replacement',
    'Replaced cabin and engine air filters',
    '2025-08-10'::date,
    ARRAY['https://via.placeholder.com/300x200/607D8B/white?text=Air+Filter'],
    '{"creator_info": {"created_by": "Test User", "created_via": "bulk_upload"}}'::jsonb,
    NOW() - INTERVAL '21 days'
);

-- Insert sample work sessions
INSERT INTO work_sessions (
    id, user_id, vehicle_id, session_date, start_time, end_time, 
    duration_minutes, confidence_score, image_count, work_description, metadata
) VALUES 
(
    gen_random_uuid(),
    'c2cbd55a-ed7c-48c0-beb9-cc019efe7a16',
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    '2025-08-29'::date,
    '2025-08-29 09:00:00'::timestamptz,
    '2025-08-29 10:30:00'::timestamptz,
    90,
    0.95,
    5,
    'Oil change and basic maintenance check',
    '{"tools_used": ["socket_set", "oil_filter_wrench"], "parts_replaced": ["oil_filter", "drain_plug_gasket"]}'::jsonb
),
(
    gen_random_uuid(),
    'c2cbd55a-ed7c-48c0-beb9-cc019efe7a16',
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    '2025-08-28'::date,
    '2025-08-28 14:00:00'::timestamptz,
    '2025-08-28 16:45:00'::timestamptz,
    165,
    0.88,
    8,
    'Front brake pad replacement and rotor inspection',
    '{"tools_used": ["brake_caliper_tool", "torque_wrench"], "parts_replaced": ["brake_pads_front"]}'::jsonb
);

-- Insert sample user activities
INSERT INTO user_activities (
    id, user_id, activity_type, title, description, vehicle_id, 
    work_session_id, points_earned, difficulty_level, verification_status, 
    evidence_urls, metadata
) VALUES 
(
    gen_random_uuid(),
    'c2cbd55a-ed7c-48c0-beb9-cc019efe7a16',
    'work_session',
    'Oil Change Service',
    'Completed routine oil change with filter replacement',
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    (SELECT id FROM work_sessions WHERE work_description LIKE '%Oil change%' LIMIT 1),
    25,
    'basic',
    'verified',
    ARRAY['https://via.placeholder.com/300x200/4CAF50/white?text=Oil+Change+Complete'],
    '{"session_duration": 90, "confidence_score": 0.95}'::jsonb
),
(
    gen_random_uuid(),
    'c2cbd55a-ed7c-48c0-beb9-cc019efe7a16',
    'work_session',
    'Brake Pad Replacement',
    'Replaced worn front brake pads and inspected rotors',
    '68787257-27bc-4571-a17d-cc6c2ed60e75',
    (SELECT id FROM work_sessions WHERE work_description LIKE '%brake pad%' LIMIT 1),
    45,
    'intermediate',
    'verified',
    ARRAY['https://via.placeholder.com/300x200/FF9800/white?text=Brake+Work'],
    '{"session_duration": 165, "confidence_score": 0.88}'::jsonb
);
