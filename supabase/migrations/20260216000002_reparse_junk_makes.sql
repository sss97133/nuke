-- Phase 2: Re-parse ~80K junk-make vehicles from titles
-- Many vehicles have makes like "33k-Mile", "No-Reserve", "Modified" etc
-- because the BaT title parser naively took the first word as make

-- 2a. Create repair function
CREATE OR REPLACE FUNCTION repair_junk_make_vehicles(p_batch_limit INT DEFAULT 50000)
RETURNS TABLE (
    total_found BIGINT,
    repaired BIGINT,
    marked_memorabilia BIGINT,
    unrecoverable BIGINT
) AS $$
DECLARE
    v_rec RECORD;
    v_title TEXT;
    v_clean TEXT;
    v_year INT;
    v_make TEXT;
    v_model TEXT;
    v_cm_id UUID;
    v_found BIGINT := 0;
    v_repaired BIGINT := 0;
    v_memorabilia BIGINT := 0;
    v_unrecoverable BIGINT := 0;
BEGIN
    FOR v_rec IN
        SELECT id, make, model,
               COALESCE(bat_listing_title, listing_title, title) as raw_title
        FROM vehicles
        WHERE deleted_at IS NULL
          AND (
            make ~* '^\d+k?-?(mile|speed)' OR
            make ~* '-powered$|-owned$' OR
            make ~* '^(modified|illuminated|supercharged|fuel-injected|no-reserve|euro|gray-market|original-owner|one-family-owned|unrestored|turbocharged|restored|refreshed|track-prepped)' OR
            make ~* '^\d+[x×]\d+' OR
            make IN ('Bonhams', 'Rm', 'RM', 'Gooding', 'No', 'Modified', 'Euro', 'Illuminated') OR
            make ~* '^(barn-find|low-mileage|one-owner|two-owner|dealer-collection|street-legal)' OR
            make ~* '^\d{4}$'
          )
        LIMIT p_batch_limit
    LOOP
        v_found := v_found + 1;
        v_title := v_rec.raw_title;

        IF v_title IS NULL OR v_title = '' THEN
            v_unrecoverable := v_unrecoverable + 1;
            CONTINUE;
        END IF;

        -- Check for memorabilia/non-vehicle items
        IF v_title ~* '(neon sign|illuminated sign|porcelain sign|metal sign|dealer sign|showroom sign|memorabilia|scale model|diecast|poster|brochure|literature|manual|book)' THEN
            UPDATE vehicles
            SET listing_kind = 'memorabilia', updated_at = NOW()
            WHERE id = v_rec.id;
            v_memorabilia := v_memorabilia + 1;
            CONTINUE;
        END IF;

        -- Strip known prefixes from title
        v_clean := v_title;
        v_clean := REGEXP_REPLACE(v_clean, '^No Reserve:\s*', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^\d+k-Mile\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^\d+-Mile\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^\d+k-Kilometer\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Modified\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Euro-Spec\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Euro\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Gray-Market\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Supercharged\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Turbocharged\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Fuel-Injected\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Original-Owner\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^One-Family-Owned\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^One-Owner\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Two-Owner\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Unrestored\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Restored\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Refreshed\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Barn-Find\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Low-Mileage\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Track-Prepped\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Street-Legal\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^Dealer-Collection\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^\d+-Speed\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^\S+-Powered\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^\S+-Owned\s+', '', 'i');
        -- Strip again if double prefix
        v_clean := REGEXP_REPLACE(v_clean, '^No Reserve:\s*', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^\d+k-Mile\s+', '', 'i');
        v_clean := REGEXP_REPLACE(v_clean, '^\d+-Mile\s+', '', 'i');

        -- Extract year
        v_year := NULL;
        IF v_clean ~ '(19|20)\d{2}' THEN
            v_year := (REGEXP_MATCH(v_clean, '((19|20)\d{2})'))[1]::INT;
            v_clean := REGEXP_REPLACE(v_clean, '(19|20)\d{2}\s*', '', 'g');
        END IF;

        v_clean := TRIM(v_clean);

        -- Try 2-word make match first (e.g. "Land Rover", "Alfa Romeo")
        v_make := NULL;
        v_cm_id := NULL;
        IF v_clean ~ '^\S+\s+\S+' THEN
            SELECT cm.canonical_name, cm.id INTO v_make, v_cm_id
            FROM canonical_makes cm
            WHERE LOWER(SUBSTRING(v_clean FROM '^\S+\s+\S+')) = ANY(SELECT LOWER(a) FROM unnest(cm.aliases) a)
               OR LOWER(SUBSTRING(v_clean FROM '^\S+\s+\S+')) = LOWER(cm.canonical_name)
            LIMIT 1;

            IF v_make IS NOT NULL THEN
                v_model := TRIM(SUBSTRING(v_clean FROM LENGTH(SUBSTRING(v_clean FROM '^\S+\s+\S+')) + 1));
            END IF;
        END IF;

        -- Try 1-word make match
        IF v_make IS NULL AND v_clean ~ '^\S+' THEN
            SELECT cm.canonical_name, cm.id INTO v_make, v_cm_id
            FROM canonical_makes cm
            WHERE LOWER(SUBSTRING(v_clean FROM '^\S+')) = ANY(SELECT LOWER(a) FROM unnest(cm.aliases) a)
               OR LOWER(SUBSTRING(v_clean FROM '^\S+')) = LOWER(cm.canonical_name)
            LIMIT 1;

            IF v_make IS NOT NULL THEN
                v_model := TRIM(SUBSTRING(v_clean FROM LENGTH(SUBSTRING(v_clean FROM '^\S+')) + 1));
            END IF;
        END IF;

        IF v_make IS NOT NULL THEN
            -- Successful repair
            UPDATE vehicles
            SET make = v_make,
                model = CASE WHEN v_model != '' THEN v_model ELSE model END,
                year = COALESCE(v_year, year),
                canonical_make_id = COALESCE(v_cm_id, canonical_make_id),
                updated_at = NOW()
            WHERE id = v_rec.id;
            v_repaired := v_repaired + 1;
        ELSE
            v_unrecoverable := v_unrecoverable + 1;
        END IF;
    END LOOP;

    total_found := v_found;
    repaired := v_repaired;
    marked_memorabilia := v_memorabilia;
    unrecoverable := v_unrecoverable;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- 2b. Handle known non-make entries that are actually Chevrolet Corvettes etc
UPDATE vehicles
SET make = 'Chevrolet', model = 'Corvette ' || COALESCE(model, ''), updated_at = NOW()
WHERE make = 'Corvette' AND deleted_at IS NULL;

UPDATE vehicles
SET make = 'Chevrolet', model = 'Camaro ' || COALESCE(model, ''), updated_at = NOW()
WHERE make = 'Camaro' AND deleted_at IS NULL;

UPDATE vehicles
SET make = 'Ford', model = 'Mustang ' || COALESCE(model, ''), updated_at = NOW()
WHERE make = 'Mustang' AND deleted_at IS NULL;

-- 2c. Run the junk-make repair
SELECT * FROM repair_junk_make_vehicles(100000);

-- 2d. Re-run canonical_make_id backfill for all repaired records
UPDATE vehicles v SET canonical_make_id = cm.id
FROM canonical_makes cm
WHERE v.canonical_make_id IS NULL
  AND (LOWER(v.make) = LOWER(cm.canonical_name)
       OR LOWER(v.make) = ANY(SELECT LOWER(a) FROM unnest(cm.aliases) a))
  AND v.deleted_at IS NULL;
