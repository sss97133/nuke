-- Auto-Tagging System for 77 Blazer Build Images
-- This script automatically tags images based on build line items and intelligent keyword matching

DO $$
DECLARE
    blazer_id UUID := 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
    target_build_id UUID;
    image_record RECORD;
    component_record RECORD;
    tag_count INTEGER := 0;

    -- Define keyword mappings for intelligent tagging
    keyword_mappings TEXT[][] := ARRAY[
        -- Engine Related
        ['LS3', 'engine,v8,ls,motor,block'],
        ['Intake', 'intake,manifold,air'],
        ['Spark plugs', 'ignition,plugs,spark'],
        ['Flexplate', 'flexplate,transmission,connection'],
        ['Ignition coil', 'ignition,coil,electrical'],
        ['Throttle body', 'throttle,fuel,intake'],
        ['Radiator', 'cooling,radiator,coolant'],
        ['Oil cooler', 'oil,cooling,lines'],
        ['Starter', 'starter,electrical,engine'],
        ['Upgraded alternator', 'alternator,electrical,charging'],

        -- Transmission
        ['6L90', 'transmission,auto,6l90,trans'],
        ['Torque converter', 'converter,transmission,torque'],
        ['Trans cooler', 'transmission,cooling,lines'],
        ['205 T case', 'transfer,case,4wd,drivetrain'],

        -- Suspension & Steering
        ['Lift kit', 'suspension,lift,springs,shocks'],
        ['Steering box', 'steering,gearbox,wheel'],
        ['Cross over', 'steering,linkage,crossover'],
        ['Drop sway bar', 'sway,bar,suspension,stabilizer'],
        ['Front shackles', 'shackles,suspension,front'],
        ['Rear shackles', 'shackles,suspension,rear'],

        -- Wheels & Tires
        ['Tires', 'tires,wheels,rubber,tread'],
        ['Wheels', 'wheels,rims,aluminum,steel'],
        ['Mount and balance', 'mounting,balancing,wheels,tires'],
        ['Wheel powder coat', 'powder,coat,wheels,finishing'],
        ['Lug nuts', 'lug,nuts,wheels,hardware'],

        -- Brakes
        ['Tesla brake booster', 'brake,booster,vacuum,tesla'],
        ['Brake line kit', 'brake,lines,fluid,hydraulic'],
        ['Brake pads', 'brake,pads,disc,stopping'],
        ['Rear Disc brake', 'rear,brake,disc,rotor'],
        ['E brake', 'emergency,brake,parking,hand'],

        -- Axles & Drivetrain
        ['Front axle rebuild', 'front,axle,differential,4wd'],
        ['Rear axle rebuild', 'rear,axle,differential,housing'],
        ['Front driveshaft', 'driveshaft,front,u-joint,cv'],
        ['Rear Driveshaft', 'driveshaft,rear,u-joint,yoke'],

        -- Body Work
        ['Paint work', 'paint,body,finish,color'],
        ['Clear coat', 'clear,coat,paint,finish'],
        ['Rocker panel', 'rocker,panel,body,rust'],
        ['Rust repair', 'rust,repair,body,metal'],
        ['Body mounts', 'body,mounts,rubber,frame'],
        ['Front bumper', 'front,bumper,chrome,protection'],
        ['Rear bumper', 'rear,bumper,chrome,tailgate'],
        ['Windshield', 'windshield,glass,front,window'],
        ['Side mirrors', 'mirrors,side,door,visibility'],
        ['Hood', 'hood,bonnet,front,engine'],

        -- Interior
        ['Interior upholstery', 'interior,seats,upholstery,fabric'],
        ['Dash', 'dashboard,instrument,panel,interior'],
        ['Carpet', 'carpet,floor,interior,mat'],
        ['Seat belts', 'seatbelt,safety,interior,harness'],
        ['Center console', 'console,center,interior,storage'],
        ['Dynamat', 'sound,damping,interior,insulation'],

        -- Electrical
        ['Motec', 'motec,ecu,wiring,electrical,engine'],
        ['Redrobright LED', 'led,lights,electrical,bright'],

        -- Fuel System
        ['Fuel pump', 'fuel,pump,tank,delivery'],
        ['Fuel line', 'fuel,line,hose,delivery'],
        ['Tank fillers', 'fuel,tank,filler,cap'],

        -- Exhaust
        ['Borla', 'exhaust,borla,muffler,stainless'],

        -- AC System
        ['AC Compressor', 'ac,air,conditioning,compressor'],
        ['AC Condenser', 'ac,condenser,cooling,refrigerant'],
        ['AC lines', 'ac,lines,refrigerant,hoses']
    ];
BEGIN
    -- Get the build ID
    SELECT id INTO target_build_id FROM vehicle_builds WHERE vehicle_id = blazer_id;

    RAISE NOTICE 'Starting auto-tagging process for 77 Blazer (Build ID: %)', target_build_id;

    -- Process each image
    FOR image_record IN
        SELECT id, filename, image_category, area, part, operation, labels, caption
        FROM vehicle_images
        WHERE vehicle_id = blazer_id
    LOOP
        DECLARE
            new_labels TEXT[] := COALESCE(image_record.labels, ARRAY[]::TEXT[]);
            filename_lower TEXT := LOWER(COALESCE(image_record.filename, ''));
            caption_lower TEXT := LOWER(COALESCE(image_record.caption, ''));
            area_lower TEXT := LOWER(COALESCE(image_record.area, ''));
            part_lower TEXT := LOWER(COALESCE(image_record.part, ''));
            operation_lower TEXT := LOWER(COALESCE(image_record.operation, ''));
            search_text TEXT := filename_lower || ' ' || caption_lower || ' ' || area_lower || ' ' || part_lower || ' ' || operation_lower;
        BEGIN
            -- Check each build component against image metadata
            FOR component_record IN
                SELECT name FROM build_line_items bli WHERE bli.build_id = target_build_id
            LOOP
                DECLARE
                    component_lower TEXT := LOWER(component_record.name);
                    keywords TEXT := '';
                    keyword TEXT;
                    should_tag BOOLEAN := FALSE;
                BEGIN
                    -- Direct name match
                    IF search_text ILIKE '%' || component_lower || '%' THEN
                        should_tag := TRUE;
                    END IF;

                    -- Check keyword mappings
                    FOR i IN 1..array_length(keyword_mappings, 1) LOOP
                        IF LOWER(keyword_mappings[i][1]) = component_lower THEN
                            keywords := keyword_mappings[i][2];
                            EXIT;
                        END IF;
                    END LOOP;

                    -- Check each keyword if we found mappings
                    IF keywords != '' AND NOT should_tag THEN
                        FOREACH keyword IN ARRAY string_to_array(keywords, ',') LOOP
                            IF search_text ILIKE '%' || trim(keyword) || '%' THEN
                                should_tag := TRUE;
                                EXIT;
                            END IF;
                        END LOOP;
                    END IF;

                    -- Add tag if not already present
                    IF should_tag AND NOT (component_record.name = ANY(new_labels)) THEN
                        new_labels := array_append(new_labels, component_record.name);
                        tag_count := tag_count + 1;

                        RAISE NOTICE 'Tagged image % with component: %',
                            image_record.filename, component_record.name;
                    END IF;
                END;
            END LOOP;

            -- Update the image with new labels if any were added
            IF array_length(new_labels, 1) > COALESCE(array_length(image_record.labels, 1), 0) THEN
                UPDATE vehicle_images
                SET labels = new_labels,
                    updated_at = NOW()
                WHERE id = image_record.id;
            END IF;
        END;
    END LOOP;

    RAISE NOTICE 'Auto-tagging complete! Applied % tags across all images', tag_count;

    -- Show summary of tagged images
    RAISE NOTICE 'Summary of tagged images:';
    FOR image_record IN
        SELECT
            image_category,
            COUNT(*) as image_count,
            AVG(COALESCE(array_length(labels, 1), 0)) as avg_tags
        FROM vehicle_images
        WHERE vehicle_id = blazer_id AND labels IS NOT NULL
        GROUP BY image_category
        ORDER BY image_count DESC
    LOOP
        RAISE NOTICE '  %: % images with avg %.1f tags each',
            image_record.image_category,
            image_record.image_count,
            image_record.avg_tags;
    END LOOP;

END $$;

-- Show final statistics
SELECT
    'Tagging Results' as report,
    COUNT(*) as total_images,
    COUNT(CASE WHEN labels IS NOT NULL AND array_length(labels, 1) > 0 THEN 1 END) as tagged_images,
    ROUND(AVG(COALESCE(array_length(labels, 1), 0))::numeric, 2) as avg_tags_per_image,
    SUM(COALESCE(array_length(labels, 1), 0)) as total_tags_applied
FROM vehicle_images
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';