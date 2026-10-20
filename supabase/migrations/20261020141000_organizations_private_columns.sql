-- organizations.tax_id and business_license were readable by anon and by signed-in strangers on every public
-- organization: the table-level SELECT grant covers all columns and RLS only filters rows. Replace it with a
-- SELECT grant on every other column. Editors read the two through organization_private_fields_read.
-- A column added after this migration is not readable by anon or authenticated until a migration grants it.
-- businesses runs as its caller and names every column, so it keeps its shape and returns NULL for the two.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

REVOKE SELECT ON TABLE public.organizations FROM PUBLIC, anon, authenticated;
DO $privileges$
DECLARE
  v_all text;
  v_public text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum),
         string_agg(quote_ident(attname), ', ' ORDER BY attnum) FILTER (WHERE attname NOT IN ('tax_id', 'business_license'))
  INTO v_all, v_public
  FROM pg_attribute
  WHERE attrelid = 'public.organizations'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%s) ON public.organizations FROM PUBLIC, anon, authenticated', v_all);
  EXECUTE format('GRANT SELECT (%s) ON public.organizations TO anon, authenticated', v_public);
END;
$privileges$;

CREATE OR REPLACE VIEW public.businesses WITH (security_invoker = true) AS
SELECT id,
    business_name,
    legal_name,
    business_type,
    industry_focus,
    email,
    phone,
    website,
    address,
    city,
    state,
    zip_code,
    country,
    description,
    specializations,
    services_offered,
    years_in_business,
    employee_count,
    accepts_dropoff,
    offers_mobile_service,
    has_lift,
    has_paint_booth,
    has_dyno,
    has_alignment_rack,
    hourly_rate_min,
    hourly_rate_max,
    service_radius_miles,
    total_projects_completed,
    total_vehicles_worked,
    average_project_rating,
    total_reviews,
    repeat_customer_rate,
    on_time_completion_rate,
    is_verified,
    verification_date,
    verification_level,
    status,
    is_public,
    estimated_value,
    is_for_sale,
    asking_price,
    NULL::text AS business_license,
    NULL::text AS tax_id,
    registration_state,
    registration_date,
    created_at,
    updated_at,
    latitude,
    longitude,
    discovered_by,
    logo_url,
    banner_url,
    total_vehicles,
    total_images,
    total_events,
    current_value,
    is_tradable,
    stock_symbol,
    uploaded_by,
    labor_rate,
    currency,
    tax_rate,
    search_keywords,
    search_vector,
    data_signals,
    ui_config,
    intelligence_last_updated,
    has_team_data,
    dealer_license,
    geographic_key,
    discovered_via,
    metadata,
    source_url,
    member_since,
    total_listings,
    total_bids,
    total_comments,
    total_auction_wins,
    total_success_stories,
    primary_focus,
    total_sold,
    gross_margin_pct,
    inventory_turnover,
    avg_days_to_sell,
    project_completion_rate,
    repeat_customer_count,
    gmv,
    receipt_count,
    listing_count,
    total_projects,
    incorporation_jurisdiction,
    year_incorporated,
    naics_code,
    revenue_declaration_date,
    is_sec_filer,
    cik_number,
    latest_form_d_date,
    latest_form_c_date,
    risk_factors,
    intellectual_property,
    target_market_description,
    slug,
    social_links,
    inventory_url,
    total_inventory,
    last_inventory_sync,
    scrape_source_id,
    is_active,
    legacy_org_id,
    hours_of_operation,
    service_type,
    service_description,
    powers_other_orgs,
    powered_by_org_id,
    parking_rate_per_day,
    entity_type,
    legal_structure,
    entity_attributes,
    enrichment_status,
    last_enriched_at,
    enrichment_sources,
    brands_carried
   FROM public.organizations;

NOTIFY pgrst, 'reload schema';
COMMIT;
