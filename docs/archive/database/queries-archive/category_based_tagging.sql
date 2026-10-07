-- Category-Based Auto-Tagging for 77 Blazer Images
-- Since images have sparse metadata, assign relevant build components based on image category

DO $$
DECLARE
    blazer_id UUID := 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
    target_build_id UUID;
    tag_count INTEGER := 0;
    category_record RECORD;
BEGIN
    -- Get the build ID
    SELECT id INTO target_build_id FROM vehicle_builds WHERE vehicle_id = blazer_id;

    RAISE NOTICE 'Starting category-based tagging for 752 Blazer images';

    -- Define category mappings for different image types
    FOR category_record IN
        SELECT
            image_cat,
            relevant_components,
            description
        FROM (VALUES
            ('exterior',
             ARRAY['Paint work round 1', 'Paint work round 2', 'Clear coat', 'Metallic red paint',
                   'Body fasteners', 'Front bumper', 'Rear bumper', 'Windshield', 'Side mirrors',
                   'Tires', 'Wheels', 'Wheel powder coat', 'Hood hinges', 'Trim polish',
                   'Rocker panel repairs', 'Rust repair', 'Dent pull', 'Under carriage repaint',
                   'Raptor liner', 'Body mounts', 'Radiator support rubber kit', 'Owner badge'],
             'Exterior shots - body work, paint, wheels, trim, bumpers'),

            ('interior',
             ARRAY['Interior upholstery', 'Dash', 'Carpet', 'Seat belts', 'Center console restore',
                   'Dynamat', 'SMS fabric', 'Precision felt kit', 'Seat panels refurbish',
                   'Vinyl fabric', 'Headliner material', 'Kick plates', 'LMC order'],
             'Interior shots - seats, dashboard, carpet, console, upholstery'),

            ('engine',
             ARRAY['LS3', 'Intake', 'Spark plugs', 'Ignition coil set', 'Throttle body', 'Radiator',
                   'Oil cooler', 'Starter', 'Upgraded alternator', 'Flexplate', 'Fuel rails',
                   'Pulley kit', 'Radiator steam hoses', 'Radiator overflow', 'Motec engine wiring M130',
                   'Fittings for engine coolant', 'Fluids'],
             'Engine bay - LS3 motor, wiring, cooling, fuel delivery'),

            ('transmission',
             ARRAY['6L90', 'Torque converter bolts', '6L90 Rife', '6L90 M control', 'Trans fluid test',
                   'Trans cooler', '6L90 linkage', 'Trans cover', 'Transmission bushings',
                   'Dry ice transmission'],
             'Transmission - 6L90 auto, torque converter, cooling'),

            ('suspension',
             ARRAY['Lift kit', 'Rear shackles', 'Front shackles', 'Cross over bars',
                   'Cross over drop arm', 'Cross over ball joints', 'Drop sway bar',
                   'Steering box', 'Gearbox support'],
             'Suspension - lift kit, shackles, steering components'),

            ('undercarriage',
             ARRAY['Front axle rebuild', 'Rear axle rebuild', 'Cross over steering',
                   'Rear Driveshaft', 'Front driveshaft', '205 T case', 'Case adapt',
                   'Case rebuild', 'Transfer case linkage', '304 stainless Borla',
                   'Tesla brake booster', 'Brake line kit', 'E brake assembly'],
             'Undercarriage - axles, drivetrain, transfer case, exhaust, brakes'),

            ('progress',
             ARRAY['Disassembly', 'Rolling chassis assembly', 'Powder Coat', '110 hours assembly',
                   'Installation - Joey', 'Paint - Tommy', 'Case machine work'],
             'Progress/work shots - disassembly, assembly, labor'),

            ('parts',
             ARRAY['AC Compressor', 'AC Condenser', 'AC Blower motor', 'AC lines', 'AC Evaporator',
                   'Fuel line kit', 'Fuel pump sending unit', 'Tank fillers', 'Brake pads front',
                   'Rear Disc brake kit', 'Bumper bolts', 'Hood heat shield', 'Lug nuts'],
             'Parts shots - individual components, AC system, fuel system'),

            ('general',
             ARRAY['Initial Purchase & shipping', 'Sales Tax', 'Motec body wiring PDM',
                   'Redrobright LED', 'Additional AC parts', 'AC brackets'],
             'General/miscellaneous shots')
        ) AS mappings(image_cat, relevant_components, description)
    LOOP
        DECLARE
            updated_images INTEGER := 0;
        BEGIN
            -- Update all images of this category with relevant build components
            WITH image_updates AS (
                UPDATE vehicle_images
                SET labels = CASE
                    WHEN labels IS NULL THEN category_record.relevant_components
                    ELSE array_cat(labels, category_record.relevant_components)
                END,
                updated_at = NOW()
                WHERE vehicle_id = blazer_id
                AND image_category = category_record.image_cat
                AND (labels IS NULL OR array_length(labels, 1) < 5) -- Only tag if not heavily tagged already
                RETURNING id
            )
            SELECT COUNT(*) INTO updated_images FROM image_updates;

            tag_count := tag_count + (updated_images * array_length(category_record.relevant_components, 1));

            RAISE NOTICE 'Tagged % % images with % components: %',
                updated_images,
                category_record.image_cat,
                array_length(category_record.relevant_components, 1),
                category_record.description;
        END;
    END LOOP;

    RAISE NOTICE 'Category-based tagging complete! Applied approximately % tags across all images', tag_count;

END $$;

-- Show final statistics
SELECT
    'Final Tagging Results' as report,
    COUNT(*) as total_images,
    COUNT(CASE WHEN labels IS NOT NULL AND array_length(labels, 1) > 0 THEN 1 END) as tagged_images,
    ROUND(AVG(COALESCE(array_length(labels, 1), 0))::numeric, 2) as avg_tags_per_image,
    SUM(COALESCE(array_length(labels, 1), 0)) as total_tags_applied
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

-- Show breakdown by image category
SELECT
    image_category,
    COUNT(*) as image_count,
    COUNT(CASE WHEN labels IS NOT NULL THEN 1 END) as tagged_count,
    ROUND(AVG(COALESCE(array_length(labels, 1), 0))::numeric, 1) as avg_tags
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
GROUP BY image_category
ORDER BY image_count DESC;