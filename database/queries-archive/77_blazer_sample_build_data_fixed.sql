-- Sample Build Data for 1977 Chevrolet K5 Blazer (Fixed)
-- This demonstrates the build management system with realistic restoration data

DO $$
DECLARE
    blazer_id UUID := 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
    build_id UUID;
    phase1_id UUID;
    phase2_id UUID;
    engine_cat_id UUID;
    trans_cat_id UUID;
    susp_cat_id UUID;
    body_cat_id UUID;
    supplier1_id UUID;
    supplier2_id UUID;
    supplier3_id UUID;
BEGIN
    -- Create suppliers for the build (with conflict handling)
    INSERT INTO suppliers (name, type, website) VALUES
    ('Classic Industries', 'vendor', 'https://classicindustries.com')
    ON CONFLICT (name, user_id) DO NOTHING;

    INSERT INTO suppliers (name, type, website) VALUES
    ('Summit Racing', 'marketplace', 'https://summitracing.com')
    ON CONFLICT (name, user_id) DO NOTHING;

    INSERT INTO suppliers (name, type) VALUES
    ('Precision Machine Shop', 'shop')
    ON CONFLICT (name, user_id) DO NOTHING;

    -- Get supplier IDs
    SELECT id INTO supplier1_id FROM suppliers WHERE name = 'Classic Industries' LIMIT 1;
    SELECT id INTO supplier2_id FROM suppliers WHERE name = 'Summit Racing' LIMIT 1;
    SELECT id INTO supplier3_id FROM suppliers WHERE name = 'Precision Machine Shop' LIMIT 1;

    -- Get category IDs
    SELECT id INTO engine_cat_id FROM part_categories WHERE name = 'Engine' LIMIT 1;
    SELECT id INTO trans_cat_id FROM part_categories WHERE name = 'Transmission' LIMIT 1;
    SELECT id INTO susp_cat_id FROM part_categories WHERE name = 'Suspension' LIMIT 1;
    SELECT id INTO body_cat_id FROM part_categories WHERE name = 'Body' LIMIT 1;

    -- Create main build project
    INSERT INTO vehicle_builds (
        vehicle_id,
        name,
        description,
        start_date,
        target_completion_date,
        status,
        total_budget,
        total_spent,
        total_hours_estimated,
        total_hours_actual,
        visibility_level,
        show_costs,
        is_public
    ) VALUES (
        blazer_id,
        '1977 K5 Blazer Frame-Off Restoration',
        'Complete frame-off restoration of a 1977 Chevrolet K5 Blazer. Original 350 V8 rebuild, TH350 transmission refresh, suspension upgrade, and full body restoration.',
        '2024-03-01',
        '2025-06-01',
        'in_progress',
        45000.00,
        32750.50,
        800,
        520,
        'public',
        true,
        true
    ) RETURNING id INTO build_id;

    -- Create build phases
    INSERT INTO build_phases (build_id, phase_number, name, description, subtotal, tax, total, status, payment_date)
    VALUES
    (build_id, 1, 'Initial Parts Order', 'Engine rebuild kit, transmission parts, suspension components', 12500.00, 1000.00, 13500.00, 'paid', '2024-03-15')
    RETURNING id INTO phase1_id;

    INSERT INTO build_phases (build_id, phase_number, name, description, subtotal, tax, total, status, payment_date)
    VALUES
    (build_id, 2, 'Body Work & Paint Prep', 'Sheet metal, body panels, paint supplies', 8750.00, 700.00, 9450.00, 'paid', '2024-05-20')
    RETURNING id INTO phase2_id;

    -- Engine Components
    INSERT INTO build_line_items (
        build_id, phase_id, category_id, supplier_id,
        name, description, quantity, unit_price, total_price,
        status, condition, days_to_install, date_ordered, date_received, date_installed
    ) VALUES
    (build_id, phase1_id, engine_cat_id, supplier1_id,
     'Small Block Chevy 350 Rebuild Kit', 'Complete rebuild kit with pistons, rings, bearings, gaskets',
     1, 875.00, 875.00, 'completed', 'new', 16, '2024-03-01', '2024-03-08', '2024-04-12'),

    (build_id, phase1_id, engine_cat_id, supplier2_id,
     'Edelbrock Performer Intake Manifold', 'RPM Air-Gap intake manifold for SBC',
     1, 285.00, 285.00, 'completed', 'new', 4, '2024-03-01', '2024-03-10', '2024-04-15'),

    (build_id, phase1_id, engine_cat_id, supplier2_id,
     'Holley 600CFM Carburetor', 'Vacuum secondary carburetor',
     1, 425.00, 425.00, 'completed', 'new', 6, '2024-03-01', '2024-03-10', '2024-04-16'),

    (build_id, phase1_id, engine_cat_id, supplier3_id,
     'Engine Machine Work', 'Block boring, deck surfacing, head work',
     1, 1850.00, 1850.00, 'completed', 'refurbished', 0, '2024-03-15', '2024-04-01', '2024-04-01');

    -- Transmission Components
    INSERT INTO build_line_items (
        build_id, phase_id, category_id, supplier_id,
        name, description, quantity, unit_price, total_price,
        status, condition, days_to_install, date_ordered, date_received
    ) VALUES
    (build_id, phase1_id, trans_cat_id, supplier1_id,
     'TH350 Rebuild Kit', 'Complete transmission rebuild kit',
     1, 165.00, 165.00, 'completed', 'new', 12, '2024-03-01', '2024-03-08'),

    (build_id, phase1_id, trans_cat_id, supplier2_id,
     'B&M Shift Kit', 'Automatic transmission shift improvement kit',
     1, 89.00, 89.00, 'completed', 'new', 2, '2024-03-01', '2024-03-08');

    -- Suspension Components
    INSERT INTO build_line_items (
        build_id, phase_id, category_id, supplier_id,
        name, description, quantity, unit_price, total_price,
        status, condition, days_to_install, date_ordered, date_received, date_installed
    ) VALUES
    (build_id, phase1_id, susp_cat_id, supplier2_id,
     'Rough Country 2" Lift Kit', 'Complete 2 inch suspension lift kit',
     1, 389.00, 389.00, 'completed', 'new', 8, '2024-03-01', '2024-03-12', '2024-04-20'),

    (build_id, phase1_id, susp_cat_id, supplier2_id,
     'Bilstein Shock Absorbers', 'Heavy duty shock absorbers (set of 4)',
     4, 125.00, 500.00, 'completed', 'new', 4, '2024-03-01', '2024-03-12', '2024-04-20');

    -- Body Components
    INSERT INTO build_line_items (
        build_id, phase_id, category_id, supplier_id,
        name, description, quantity, unit_price, total_price,
        status, condition, days_to_install, date_ordered, date_received
    ) VALUES
    (build_id, phase2_id, body_cat_id, supplier1_id,
     'Door Skin Set', 'Replacement door skins (driver and passenger)',
     2, 185.00, 370.00, 'in_progress', 'new', 6, '2024-05-01', '2024-05-15'),

    (build_id, phase2_id, body_cat_id, supplier1_id,
     'Tailgate Assembly', 'Complete tailgate with hardware',
     1, 650.00, 650.00, 'received', 'new', 4, '2024-05-01', '2024-05-20'),

    (build_id, phase2_id, body_cat_id, supplier1_id,
     'Front Fender Set', 'Left and right front fenders',
     2, 275.00, 550.00, 'ordered', 'new', 8, '2024-06-01', NULL);

    -- Add build tags
    INSERT INTO build_tags (build_id, tag) VALUES
    (build_id, 'frame-off'),
    (build_id, 'original-engine'),
    (build_id, '4x4'),
    (build_id, 'classic-truck'),
    (build_id, 'restoration');

    -- Add benchmark vehicles
    INSERT INTO build_benchmarks (
        build_id, source, listing_url, sale_price, sale_date,
        year, make, model, engine, transmission, modifications, notes
    ) VALUES
    (build_id, 'Bring a Trailer', 'https://bringatrailer.com/listing/1977-chevrolet-k5-blazer/',
     28500.00, '2024-02-15', 1977, 'Chevrolet', 'K5 Blazer', '350 V8', '3-Speed Auto',
     '2" lift, 33" tires', 'Similar condition, sold for reference'),

    (build_id, 'Barrett-Jackson', 'https://barrett-jackson.com/Events/Event/Details/1977-CHEVROLET-BLAZER-K5-4X4-242389',
     35000.00, '2024-01-20', 1977, 'Chevrolet', 'K5 Blazer', '350 V8', '4-Speed Manual',
     'Frame-off restoration', 'High-end restoration example');

    RAISE NOTICE 'Successfully created sample build data for 1977 Chevrolet K5 Blazer';
    RAISE NOTICE 'Build ID: %', build_id;
    RAISE NOTICE 'Total line items: %', (SELECT COUNT(*) FROM build_line_items WHERE build_id = build_id);
    RAISE NOTICE 'Total benchmarks: %', (SELECT COUNT(*) FROM build_benchmarks WHERE build_id = build_id);

END $$;