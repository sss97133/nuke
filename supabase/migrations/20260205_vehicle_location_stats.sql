-- Function to aggregate vehicles by state for map visualization
CREATE OR REPLACE FUNCTION vehicle_stats_by_state()
RETURNS TABLE(state_code text, vehicle_count bigint, total_value bigint, avg_price bigint)
LANGUAGE sql STABLE
AS $$
  WITH normalized AS (
    SELECT
      CASE
        -- Normalize state names to 2-letter codes
        WHEN UPPER(TRIM(state)) IN ('CA', 'CALIFORNIA') THEN 'CA'
        WHEN UPPER(TRIM(state)) IN ('FL', 'FLORIDA') THEN 'FL'
        WHEN UPPER(TRIM(state)) IN ('NY', 'NEW YORK') THEN 'NY'
        WHEN UPPER(TRIM(state)) IN ('TX', 'TEXAS') THEN 'TX'
        WHEN UPPER(TRIM(state)) IN ('PA', 'PENNSYLVANIA') THEN 'PA'
        WHEN UPPER(TRIM(state)) IN ('IL', 'ILLINOIS') THEN 'IL'
        WHEN UPPER(TRIM(state)) IN ('OH', 'OHIO') THEN 'OH'
        WHEN UPPER(TRIM(state)) IN ('GA', 'GEORGIA') THEN 'GA'
        WHEN UPPER(TRIM(state)) IN ('NC', 'NORTH CAROLINA') THEN 'NC'
        WHEN UPPER(TRIM(state)) IN ('MI', 'MICHIGAN') THEN 'MI'
        WHEN UPPER(TRIM(state)) IN ('NJ', 'NEW JERSEY') THEN 'NJ'
        WHEN UPPER(TRIM(state)) IN ('VA', 'VIRGINIA') THEN 'VA'
        WHEN UPPER(TRIM(state)) IN ('WA', 'WASHINGTON') THEN 'WA'
        WHEN UPPER(TRIM(state)) IN ('AZ', 'ARIZONA') THEN 'AZ'
        WHEN UPPER(TRIM(state)) IN ('MA', 'MASSACHUSETTS') THEN 'MA'
        WHEN UPPER(TRIM(state)) IN ('TN', 'TENNESSEE') THEN 'TN'
        WHEN UPPER(TRIM(state)) IN ('IN', 'INDIANA') THEN 'IN'
        WHEN UPPER(TRIM(state)) IN ('MO', 'MISSOURI') THEN 'MO'
        WHEN UPPER(TRIM(state)) IN ('MD', 'MARYLAND') THEN 'MD'
        WHEN UPPER(TRIM(state)) IN ('WI', 'WISCONSIN') THEN 'WI'
        WHEN UPPER(TRIM(state)) IN ('CO', 'COLORADO') THEN 'CO'
        WHEN UPPER(TRIM(state)) IN ('MN', 'MINNESOTA') THEN 'MN'
        WHEN UPPER(TRIM(state)) IN ('SC', 'SOUTH CAROLINA') THEN 'SC'
        WHEN UPPER(TRIM(state)) IN ('AL', 'ALABAMA') THEN 'AL'
        WHEN UPPER(TRIM(state)) IN ('LA', 'LOUISIANA') THEN 'LA'
        WHEN UPPER(TRIM(state)) IN ('KY', 'KENTUCKY') THEN 'KY'
        WHEN UPPER(TRIM(state)) IN ('OR', 'OREGON') THEN 'OR'
        WHEN UPPER(TRIM(state)) IN ('OK', 'OKLAHOMA') THEN 'OK'
        WHEN UPPER(TRIM(state)) IN ('CT', 'CONNECTICUT') THEN 'CT'
        WHEN UPPER(TRIM(state)) IN ('UT', 'UTAH') THEN 'UT'
        WHEN UPPER(TRIM(state)) IN ('IA', 'IOWA') THEN 'IA'
        WHEN UPPER(TRIM(state)) IN ('NV', 'NEVADA') THEN 'NV'
        WHEN UPPER(TRIM(state)) IN ('AR', 'ARKANSAS') THEN 'AR'
        WHEN UPPER(TRIM(state)) IN ('MS', 'MISSISSIPPI') THEN 'MS'
        WHEN UPPER(TRIM(state)) IN ('KS', 'KANSAS') THEN 'KS'
        WHEN UPPER(TRIM(state)) IN ('NM', 'NEW MEXICO') THEN 'NM'
        WHEN UPPER(TRIM(state)) IN ('NE', 'NEBRASKA') THEN 'NE'
        WHEN UPPER(TRIM(state)) IN ('ID', 'IDAHO') THEN 'ID'
        WHEN UPPER(TRIM(state)) IN ('WV', 'WEST VIRGINIA') THEN 'WV'
        WHEN UPPER(TRIM(state)) IN ('HI', 'HAWAII') THEN 'HI'
        WHEN UPPER(TRIM(state)) IN ('NH', 'NEW HAMPSHIRE') THEN 'NH'
        WHEN UPPER(TRIM(state)) IN ('ME', 'MAINE') THEN 'ME'
        WHEN UPPER(TRIM(state)) IN ('MT', 'MONTANA') THEN 'MT'
        WHEN UPPER(TRIM(state)) IN ('RI', 'RHODE ISLAND') THEN 'RI'
        WHEN UPPER(TRIM(state)) IN ('DE', 'DELAWARE') THEN 'DE'
        WHEN UPPER(TRIM(state)) IN ('SD', 'SOUTH DAKOTA') THEN 'SD'
        WHEN UPPER(TRIM(state)) IN ('ND', 'NORTH DAKOTA') THEN 'ND'
        WHEN UPPER(TRIM(state)) IN ('AK', 'ALASKA') THEN 'AK'
        WHEN UPPER(TRIM(state)) IN ('VT', 'VERMONT') THEN 'VT'
        WHEN UPPER(TRIM(state)) IN ('WY', 'WYOMING') THEN 'WY'
        WHEN UPPER(TRIM(state)) IN ('DC', 'DISTRICT OF COLUMBIA') THEN 'DC'
        WHEN LENGTH(TRIM(state)) = 2 THEN UPPER(TRIM(state))
        ELSE NULL
      END as state_code,
      COALESCE(sale_price, sold_price, 0) as price
    FROM vehicles
    WHERE deleted_at IS NULL
      AND state IS NOT NULL
      AND (sale_price > 0 OR sold_price > 0)
  )
  SELECT
    state_code,
    COUNT(*)::bigint as vehicle_count,
    SUM(price)::bigint as total_value,
    (SUM(price) / NULLIF(COUNT(*), 0))::bigint as avg_price
  FROM normalized
  WHERE state_code IS NOT NULL
  GROUP BY state_code
  ORDER BY total_value DESC;
$$;

-- Also extract state from listing_location for vehicles without state
CREATE OR REPLACE FUNCTION vehicle_stats_by_location()
RETURNS TABLE(state_code text, vehicle_count bigint, total_value bigint)
LANGUAGE sql STABLE
AS $$
  WITH extracted AS (
    SELECT
      -- Extract state from "City, State ZIP" format
      CASE
        WHEN listing_location ~ ', [A-Za-z]+ [0-9]{5}' THEN
          UPPER(TRIM(REGEXP_REPLACE(
            REGEXP_REPLACE(listing_location, '.*, ([A-Za-z ]+) [0-9]{5}.*', '\1'),
            '(California|Florida|Texas|New York|Pennsylvania|Illinois|Ohio|Georgia|North Carolina|Michigan|New Jersey|Virginia|Washington|Arizona|Massachusetts|Tennessee|Indiana|Missouri|Maryland|Wisconsin|Colorado|Minnesota|South Carolina|Alabama|Louisiana|Kentucky|Oregon|Oklahoma|Connecticut|Utah|Iowa|Nevada|Arkansas|Mississippi|Kansas|New Mexico|Nebraska|Idaho|West Virginia|Hawaii|New Hampshire|Maine|Montana|Rhode Island|Delaware|South Dakota|North Dakota|Alaska|Vermont|Wyoming)',
            CASE
              WHEN '\1' = 'California' THEN 'CA'
              WHEN '\1' = 'Florida' THEN 'FL'
              WHEN '\1' = 'Texas' THEN 'TX'
              WHEN '\1' = 'New York' THEN 'NY'
              WHEN '\1' = 'Pennsylvania' THEN 'PA'
              WHEN '\1' = 'Illinois' THEN 'IL'
              WHEN '\1' = 'Ohio' THEN 'OH'
              WHEN '\1' = 'Georgia' THEN 'GA'
              WHEN '\1' = 'North Carolina' THEN 'NC'
              WHEN '\1' = 'Michigan' THEN 'MI'
              WHEN '\1' = 'New Jersey' THEN 'NJ'
              WHEN '\1' = 'Virginia' THEN 'VA'
              WHEN '\1' = 'Washington' THEN 'WA'
              WHEN '\1' = 'Arizona' THEN 'AZ'
              WHEN '\1' = 'Massachusetts' THEN 'MA'
              WHEN '\1' = 'Tennessee' THEN 'TN'
              WHEN '\1' = 'Indiana' THEN 'IN'
              WHEN '\1' = 'Missouri' THEN 'MO'
              WHEN '\1' = 'Maryland' THEN 'MD'
              WHEN '\1' = 'Wisconsin' THEN 'WI'
              WHEN '\1' = 'Colorado' THEN 'CO'
              WHEN '\1' = 'Minnesota' THEN 'MN'
              WHEN '\1' = 'Oregon' THEN 'OR'
              WHEN '\1' = 'Nevada' THEN 'NV'
              WHEN '\1' = 'Connecticut' THEN 'CT'
              ELSE '\1'
            END
          )))
        ELSE NULL
      END as state_code,
      COALESCE(sale_price, sold_price, 0) as price
    FROM vehicles
    WHERE deleted_at IS NULL
      AND listing_location IS NOT NULL
      AND state IS NULL
      AND (sale_price > 0 OR sold_price > 0)
  )
  SELECT
    state_code,
    COUNT(*)::bigint,
    SUM(price)::bigint
  FROM extracted
  WHERE state_code IS NOT NULL AND LENGTH(state_code) = 2
  GROUP BY state_code;
$$;
