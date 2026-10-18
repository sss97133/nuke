-- Enhanced Auto-Tagging System for 77 Blazer Build Images
-- This creates broader category-based tagging for better coverage

DO $$
DECLARE
    blazer_id UUID := 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
    target_build_id UUID;
    image_record RECORD;
    tag_count INTEGER := 0;
    category_mappings RECORD;
BEGIN
    -- Get the build ID
    SELECT id INTO target_build_id FROM vehicle_builds WHERE vehicle_id = blazer_id;

    RAISE NOTICE 'Starting enhanced auto-tagging for 77 Blazer';

    -- Create category-based tagging
    FOR category_mappings IN
        SELECT
            category,
            keywords,
            components
        FROM (VALUES
            ('Engine Bay', 'engine,motor,bay,hood,block,intake,radiator,alternator,starter,belt,pulley,hose,coolant,oil',
             ARRAY['LS3', 'Intake', 'Spark plugs', 'Ignition coil set', 'Throttle body', 'Radiator', 'Oil cooler', 'Starter', 'Upgraded alternator', 'Flexplate', 'Flexplate bolts', 'Fuel rails', 'Pulley kit', 'Radiator steam hoses', 'Radiator overflow', 'Fittings for engine coolant']),

            ('Transmission', 'transmission,trans,gearbox,shifter,converter,fluid,6l90',
             ARRAY['6L90', 'Torque converter bolts', '6L90 Rife', '6L90 M control', 'Trans fluid test', 'Trans cooler', '6L90 linkage', 'Trans cover', 'Transmission bushings', 'Dry ice transmission']),

            ('Transfer Case', 'transfer,case,4wd,4x4,shifter,linkage,205',
             ARRAY['205 T case', 'Case adapt', 'Case rebuild', 'Transfer case linkage', 'Case machine work']),

            ('Suspension', 'suspension,shock,spring,lift,sway,bar,shackle,steering,ball,joint',
             ARRAY['Lift kit', 'Rear shackles', 'Front shackles', 'Cross over bars', 'Cross over drop arm', 'Cross over ball joints', 'Drop sway bar', 'Steering box', 'Gearbox support']),

            ('Wheels & Tires', 'wheel,tire,rim,rubber,tread,balance,mount,lug,nut',
             ARRAY['Tires', 'Wheels', 'Wheel powder coat', 'Mount and balance', 'Lug nuts']),

            ('Brakes', 'brake,pad,disc,rotor,booster,line,fluid,caliper',
             ARRAY['Tesla brake booster', 'Brake line kit', 'Brake proportioning valve', 'E brake assembly', 'Billet adapter', 'Booster angle bracket', 'Brake pads front', 'Rear Disc brake kit']),

            ('Axles & Drivetrain', 'axle,differential,driveshaft,ujoint,cv,front,rear,4wd',
             ARRAY['Front axle rebuild', 'Rear axle rebuild', 'Cross over steering', 'Rear Driveshaft', 'Front driveshaft']),

            ('Body Work', 'body,paint,primer,rust,panel,rocker,bumper,fender,door,dent',
             ARRAY['Paint work round 1', 'Paint work round 2', 'Clear coat', 'Rocker panel repairs', 'Rust repair', 'Body mounts', 'Front bumper', 'Rear bumper', 'Dent pull', 'Body fasteners', 'Metallic red paint', 'Raptor liner', 'Under carriage repaint', 'Trim polish']),

            ('Interior', 'interior,seat,dash,carpet,console,upholstery,fabric,belt',
             ARRAY['Interior upholstery', 'Dash', 'Carpet', 'Seat belts', 'Center console restore', 'Dynamat', 'SMS fabric', 'Precision felt kit', 'Seat panels refurbish', 'LMC order', 'Vinyl fabric', 'Headliner material', 'Kick plates']),

            ('Electrical', 'wire,wiring,electrical,ecu,motec,led,light,alternator',
             ARRAY['Motec engine wiring M130', 'Motec body wiring PDM', 'Redrobright LED', 'Upgraded alternator']),

            ('Glass & Trim', 'windshield,window,glass,mirror,trim,rubber,weather,strip',
             ARRAY['Windshield', 'Side mirrors', 'Hood hinges', 'Windshield trim + rubber', 'Radiator support rubber kit']),

            ('Fuel System', 'fuel,gas,tank,pump,line,hose,filler,delivery',
             ARRAY['Fuel line kit', 'Fuel line frame clips', 'Fuel pump sending unit', 'Tank fillers']),

            ('Exhaust', 'exhaust,muffler,pipe,stainless,borla,catalytic',
             ARRAY['304 stainless Borla']),

            ('AC System', 'ac,air,conditioning,compressor,condenser,evaporator,refrigerant',
             ARRAY['AC Compressor', 'AC Condenser', 'AC Blower motor', 'AC lines', 'AC Evaporator', 'AC Accumulator', 'Additional AC parts', 'AC brackets']),

            ('Hardware & Misc', 'bolt,nut,washer,fastener,hardware,misc,mount,bracket',
             ARRAY['Bumper bolts', 'Hood heat shield', 'Owner badge', 'Sales Tax'])
        ) AS categories(category, keywords, components)
    LOOP
        RAISE NOTICE 'Processing category: %', category_mappings.category;

        -- Tag images based on category keywords
        FOR image_record IN
            SELECT id, filename, image_category, area, part, operation, labels, caption
            FROM vehicle_images
            WHERE vehicle_id = blazer_id
        LOOP
            DECLARE
                new_labels TEXT[] := COALESCE(image_record.labels, ARRAY[]::TEXT[]);
                search_text TEXT := LOWER(COALESCE(image_record.filename, '') || ' ' ||
                                         COALESCE(image_record.caption, '') || ' ' ||
                                         COALESCE(image_record.area, '') || ' ' ||
                                         COALESCE(image_record.part, '') || ' ' ||
                                         COALESCE(image_record.operation, '') || ' ' ||
                                         COALESCE(image_record.image_category, ''));
                should_tag_category BOOLEAN := FALSE;
                keyword TEXT;
                component TEXT;
            BEGIN
                -- Check if image matches category keywords
                FOREACH keyword IN ARRAY string_to_array(category_mappings.keywords, ',') LOOP
                    IF search_text ILIKE '%' || trim(keyword) || '%' THEN
                        should_tag_category := TRUE;
                        EXIT;
                    END IF;
                END LOOP;

                -- If image matches category, tag with relevant components
                IF should_tag_category THEN
                    FOREACH component IN ARRAY category_mappings.components LOOP
                        IF NOT (component = ANY(new_labels)) THEN
                            -- Add the component tag
                            new_labels := array_append(new_labels, component);
                            tag_count := tag_count + 1;
                        END IF;
                    END LOOP;

                    -- Update image with new tags
                    IF array_length(new_labels, 1) > COALESCE(array_length(image_record.labels, 1), 0) THEN
                        UPDATE vehicle_images
                        SET labels = new_labels,
                            updated_at = NOW()
                        WHERE id = image_record.id;

                        RAISE NOTICE 'Tagged % with % components from category %',
                            image_record.filename,
                            array_length(category_mappings.components, 1),
                            category_mappings.category;
                    END IF;
                END IF;
            END;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Enhanced auto-tagging complete! Applied % tags total', tag_count;

END $$;

-- Show results
SELECT
    'Enhanced Tagging Results' as report,
    COUNT(*) as total_images,
    COUNT(CASE WHEN labels IS NOT NULL AND array_length(labels, 1) > 0 THEN 1 END) as tagged_images,
    ROUND(AVG(COALESCE(array_length(labels, 1), 0))::numeric, 2) as avg_tags_per_image,
    SUM(COALESCE(array_length(labels, 1), 0)) as total_tags_applied
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

-- Show sample of tagged images
SELECT
    filename,
    image_category,
    array_length(labels, 1) as tag_count,
    (array_to_string(labels[1:5], ', ')) || CASE WHEN array_length(labels, 1) > 5 THEN '...' ELSE '' END as sample_tags
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
AND labels IS NOT NULL
AND array_length(labels, 1) > 0
ORDER BY array_length(labels, 1) DESC
LIMIT 10;