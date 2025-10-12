-- Add logo_url field to tool_brands table for storing brand logos
ALTER TABLE tool_brands 
ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Add description for the column
COMMENT ON COLUMN tool_brands.logo_url IS 'URL or path to the brand logo image';

-- Insert/Update logos for common tool brands
UPDATE tool_brands 
SET logo_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Snap-on_Logo.svg/320px-Snap-on_Logo.svg.png'
WHERE LOWER(name) LIKE '%snap%on%' OR LOWER(name) = 'snap-on';

UPDATE tool_brands 
SET logo_url = 'https://www.mactools.com/content/dam/global/logos/mac-tools-logo.svg'
WHERE LOWER(name) LIKE '%mac%tool%' OR LOWER(name) = 'mac tools';

UPDATE tool_brands 
SET logo_url = 'https://www.matcotools.com/content/dam/matco/common/logos/matco-logo.svg'
WHERE LOWER(name) LIKE '%matco%';

-- Add more brand logos as we collect them
UPDATE tool_brands 
SET logo_url = 'https://www.cornwelltools.com/media/wysiwyg/cornwell-logo.svg'
WHERE LOWER(name) LIKE '%cornwell%';

UPDATE tool_brands 
SET logo_url = 'https://www.craftsman.com/NA/craftsman/img/craftsman-logo.svg'
WHERE LOWER(name) LIKE '%craftsman%';

UPDATE tool_brands 
SET logo_url = 'https://www.milwaukeetool.com/-/media/Images/Site/Milwaukee/Header/Logo.png'
WHERE LOWER(name) LIKE '%milwaukee%';

UPDATE tool_brands 
SET logo_url = 'https://www.dewalt.com/NA/common/img/dewalt-logo.svg'
WHERE LOWER(name) LIKE '%dewalt%';

UPDATE tool_brands 
SET logo_url = 'https://www.makitatools.com/templates/makita/images/makita-logo.svg'
WHERE LOWER(name) LIKE '%makita%';

UPDATE tool_brands 
SET logo_url = 'https://www.ridgid.com/us/en/media/ridgid-logo.svg'
WHERE LOWER(name) LIKE '%ridgid%';

-- Create a function to get brand logo with fallback
CREATE OR REPLACE FUNCTION get_brand_logo(brand_name TEXT)
RETURNS TEXT AS $$
BEGIN
    -- First try to get from tool_brands table
    RETURN (
        SELECT logo_url 
        FROM tool_brands 
        WHERE LOWER(name) = LOWER(brand_name) 
        OR LOWER(name) LIKE '%' || LOWER(brand_name) || '%'
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT ON tool_brands TO authenticated;
GRANT SELECT ON tool_brands TO anon;
