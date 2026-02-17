-- Phase 1: Fix normalize_make() + repair split makes
-- The function was referencing 'variants' column but the actual column is 'aliases'
-- Also: exact match instead of case-insensitive lookup

-- 1a. Fix normalize_make() to use aliases column with case-insensitive matching
CREATE OR REPLACE FUNCTION normalize_make(input_make TEXT)
RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    IF input_make IS NULL OR input_make = '' THEN
        RETURN input_make;
    END IF;

    -- Check if already a canonical name (case-insensitive)
    SELECT canonical_name INTO result
    FROM canonical_makes
    WHERE LOWER(canonical_name) = LOWER(input_make)
    LIMIT 1;

    IF result IS NOT NULL THEN
        RETURN result;
    END IF;

    -- Check aliases (case-insensitive)
    SELECT canonical_name INTO result
    FROM canonical_makes
    WHERE LOWER(input_make) = ANY(SELECT LOWER(a) FROM unnest(aliases) a)
    LIMIT 1;

    IF result IS NOT NULL THEN
        RETURN result;
    END IF;

    -- Return original if no match
    RETURN input_make;
END;
$$ LANGUAGE plpgsql STABLE;

-- 1b. Fix split makes
UPDATE vehicles SET make = 'Land Rover', model = REGEXP_REPLACE(model, '^Rover\s+', '')
  WHERE make = 'Land' AND model LIKE 'Rover%' AND deleted_at IS NULL;

UPDATE vehicles SET make = 'Alfa Romeo', model = REGEXP_REPLACE(model, '^Romeo\s+', '')
  WHERE make = 'Alfa' AND model LIKE 'Romeo%' AND deleted_at IS NULL;

UPDATE vehicles SET make = 'Aston Martin', model = REGEXP_REPLACE(model, '^Martin\s+', '')
  WHERE make = 'Aston' AND model LIKE 'Martin%' AND deleted_at IS NULL;

UPDATE vehicles SET make = 'Rolls-Royce', model = REGEXP_REPLACE(model, '^Royce\s+', '')
  WHERE make = 'Rolls' AND model LIKE 'Royce%' AND deleted_at IS NULL;

UPDATE vehicles SET make = 'De Tomaso', model = REGEXP_REPLACE(model, '^Tomaso\s+', '')
  WHERE make = 'De' AND model LIKE 'Tomaso%' AND deleted_at IS NULL;

UPDATE vehicles SET make = 'Austin-Healey', model = REGEXP_REPLACE(model, '^Healey\s+', '')
  WHERE make = 'Austin' AND model LIKE 'Healey%' AND deleted_at IS NULL;

UPDATE vehicles SET make = 'AM General', model = REGEXP_REPLACE(model, '^General\s+', '')
  WHERE make = 'AM' AND model LIKE 'General%' AND deleted_at IS NULL;

-- 1c. Fix normalize_all_makes_batch to use aliases column
CREATE OR REPLACE FUNCTION normalize_all_makes_batch(batch_limit INT DEFAULT 10000)
RETURNS TABLE (
    canonical_make TEXT,
    aliases_matched TEXT[],
    rows_affected BIGINT
) AS $$
BEGIN
    FOR canonical_make, aliases_matched, rows_affected IN
        SELECT
            cm.canonical_name,
            cm.aliases,
            (
                SELECT COUNT(*)
                FROM vehicles v
                WHERE LOWER(v.make) = ANY(SELECT LOWER(a) FROM unnest(cm.aliases) a)
                  AND LOWER(v.make) != LOWER(cm.canonical_name)
                  AND v.deleted_at IS NULL
            )
        FROM canonical_makes cm
        WHERE EXISTS (
            SELECT 1 FROM vehicles v
            WHERE LOWER(v.make) = ANY(SELECT LOWER(a) FROM unnest(cm.aliases) a)
              AND LOWER(v.make) != LOWER(cm.canonical_name)
              AND v.deleted_at IS NULL
            LIMIT 1
        )
    LOOP
        UPDATE vehicles
        SET make = canonical_make, updated_at = NOW()
        WHERE LOWER(make) = ANY(SELECT LOWER(a) FROM unnest(aliases_matched) a)
          AND LOWER(make) != LOWER(canonical_make)
          AND deleted_at IS NULL;

        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 1c. Run batch normalization
SELECT * FROM normalize_all_makes_batch(50000);

-- 1d. Backfill canonical_make_id for newly fixed records
UPDATE vehicles v SET canonical_make_id = cm.id
FROM canonical_makes cm
WHERE v.canonical_make_id IS NULL
  AND (LOWER(v.make) = LOWER(cm.canonical_name)
       OR LOWER(v.make) = ANY(SELECT LOWER(a) FROM unnest(cm.aliases) a))
  AND v.deleted_at IS NULL;
