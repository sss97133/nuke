-- Migration: Normalize make case inconsistencies
-- Problem: "Chevrolet" and "chevrolet" are stored separately
-- Solution: Direct updates with proper case standardization

-- First, create a mapping table of canonical makes
CREATE TABLE IF NOT EXISTS canonical_makes (
    id SERIAL PRIMARY KEY,
    canonical_name TEXT NOT NULL UNIQUE,
    variants TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert canonical makes and their variants
INSERT INTO canonical_makes (canonical_name, variants) VALUES
    ('Chevrolet', ARRAY['chevrolet', 'chevy', 'Chevy', 'CHEVROLET']),
    ('Ford', ARRAY['ford', 'FORD']),
    ('BMW', ARRAY['bmw', 'Bmw']),
    ('Porsche', ARRAY['porsche', 'PORSCHE']),
    ('Mercedes-Benz', ARRAY['mercedes', 'Mercedes', 'mercedes-benz', 'MERCEDES-BENZ', 'Mercedes Benz', 'mercedes benz']),
    ('Toyota', ARRAY['toyota', 'TOYOTA']),
    ('Honda', ARRAY['honda', 'HONDA']),
    ('Volkswagen', ARRAY['volkswagen', 'vw', 'VW', 'Vw', 'VOLKSWAGEN']),
    ('Audi', ARRAY['audi', 'AUDI']),
    ('Ferrari', ARRAY['ferrari', 'FERRARI']),
    ('Lamborghini', ARRAY['lamborghini', 'LAMBORGHINI']),
    ('Nissan', ARRAY['nissan', 'NISSAN']),
    ('Mazda', ARRAY['mazda', 'MAZDA']),
    ('Subaru', ARRAY['subaru', 'SUBARU']),
    ('Lexus', ARRAY['lexus', 'LEXUS']),
    ('Acura', ARRAY['acura', 'ACURA']),
    ('Infiniti', ARRAY['infiniti', 'INFINITI']),
    ('Jaguar', ARRAY['jaguar', 'JAGUAR']),
    ('Land Rover', ARRAY['land rover', 'Land rover', 'LAND ROVER', 'landrover']),
    ('Bentley', ARRAY['bentley', 'BENTLEY']),
    ('Rolls-Royce', ARRAY['rolls-royce', 'Rolls Royce', 'rolls royce', 'ROLLS-ROYCE']),
    ('Aston Martin', ARRAY['aston martin', 'Aston martin', 'ASTON MARTIN']),
    ('McLaren', ARRAY['mclaren', 'MCLAREN']),
    ('Maserati', ARRAY['maserati', 'MASERATI']),
    ('Alfa Romeo', ARRAY['alfa romeo', 'Alfa romeo', 'ALFA ROMEO']),
    ('Fiat', ARRAY['fiat', 'FIAT']),
    ('Volvo', ARRAY['volvo', 'VOLVO']),
    ('Saab', ARRAY['saab', 'SAAB']),
    ('Dodge', ARRAY['dodge', 'DODGE']),
    ('Plymouth', ARRAY['plymouth', 'PLYMOUTH']),
    ('Pontiac', ARRAY['pontiac', 'PONTIAC']),
    ('Buick', ARRAY['buick', 'BUICK']),
    ('Cadillac', ARRAY['cadillac', 'CADILLAC']),
    ('Lincoln', ARRAY['lincoln', 'LINCOLN']),
    ('Mercury', ARRAY['mercury', 'MERCURY']),
    ('Oldsmobile', ARRAY['oldsmobile', 'OLDSMOBILE']),
    ('Studebaker', ARRAY['studebaker', 'STUDEBAKER']),
    ('Packard', ARRAY['packard', 'PACKARD']),
    ('Duesenberg', ARRAY['duesenberg', 'DUESENBERG']),
    ('Auburn', ARRAY['auburn', 'AUBURN']),
    ('Cord', ARRAY['cord', 'CORD'])
ON CONFLICT (canonical_name) DO NOTHING;

-- Create index for faster variant lookups
CREATE INDEX IF NOT EXISTS idx_canonical_makes_variants ON canonical_makes USING GIN (variants);

-- Create a function to normalize a single make
CREATE OR REPLACE FUNCTION normalize_make(input_make TEXT)
RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    -- Check if already canonical
    SELECT canonical_name INTO result
    FROM canonical_makes
    WHERE canonical_name = input_make;

    IF result IS NOT NULL THEN
        RETURN result;
    END IF;

    -- Check if it's a variant
    SELECT canonical_name INTO result
    FROM canonical_makes
    WHERE input_make = ANY(variants);

    IF result IS NOT NULL THEN
        RETURN result;
    END IF;

    -- Return original if no match
    RETURN input_make;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a view to check make case variants
CREATE OR REPLACE VIEW make_case_variants AS
SELECT
    LOWER(make) as normalized_make,
    array_agg(DISTINCT make ORDER BY make) as variants,
    SUM(count) as total_count
FROM (
    SELECT make, COUNT(*) as count
    FROM vehicles
    WHERE make IS NOT NULL AND deleted_at IS NULL
    GROUP BY make
) sub
GROUP BY LOWER(make)
HAVING COUNT(*) > 1
ORDER BY total_count DESC;

-- Create a function to run batch normalization
CREATE OR REPLACE FUNCTION normalize_all_makes_batch(batch_limit INT DEFAULT 10000)
RETURNS TABLE (
    canonical_make TEXT,
    variants_updated TEXT[],
    rows_affected BIGINT
) AS $$
BEGIN
    FOR canonical_make, variants_updated, rows_affected IN
        SELECT
            cm.canonical_name,
            cm.variants,
            (
                SELECT COUNT(*)
                FROM vehicles v
                WHERE v.make = ANY(cm.variants)
                AND v.deleted_at IS NULL
            )
        FROM canonical_makes cm
        WHERE EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.make = ANY(cm.variants)
            AND v.deleted_at IS NULL
            LIMIT 1
        )
    LOOP
        -- Update this batch
        UPDATE vehicles
        SET make = canonical_make, updated_at = NOW()
        WHERE make = ANY(variants_updated)
        AND deleted_at IS NULL;

        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT ON canonical_makes TO authenticated, anon;
GRANT SELECT ON make_case_variants TO authenticated, anon;
GRANT EXECUTE ON FUNCTION normalize_make(TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION normalize_all_makes_batch(INT) TO service_role;

-- Add comments
COMMENT ON TABLE canonical_makes IS 'Reference table of canonical make names and their variant spellings';
COMMENT ON FUNCTION normalize_make(TEXT) IS 'Returns the canonical form of a vehicle make name';
COMMENT ON FUNCTION normalize_all_makes_batch(INT) IS 'Normalizes all vehicle makes to canonical form. Call with: SELECT * FROM normalize_all_makes_batch();';
COMMENT ON VIEW make_case_variants IS 'Shows make names that have multiple case variants';

-- Note: Run normalize_all_makes_batch() manually after migration to apply changes
-- Example: SELECT * FROM normalize_all_makes_batch();
