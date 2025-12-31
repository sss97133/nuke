#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Complete workflow: Scrape org → Insert via MCP
 * 
 * This script demonstrates the complete workflow:
 * 1. Calls scrape-org Edge Function to extract data
 * 2. Uses MCP Supabase tools to insert organization and vehicles
 * 
 * Usage:
 *   deno run --allow-net --allow-env scripts/ingest-org-via-mcp.ts <website-url>
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

interface ScrapedOrg {
  business_name?: string;
  website?: string;
  description?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  logo_url?: string;
  metadata?: Record<string, any>;
}

interface ScrapedVehicle {
  year?: number;
  make?: string;
  model?: string;
  description?: string;
  image_urls?: string[];
  source_url?: string;
  price?: number;
  status?: string;
  vin?: string;
  metadata?: Record<string, any>;
}

interface ScrapeResponse {
  success: boolean;
  org: ScrapedOrg;
  vehicles: ScrapedVehicle[];
  stats: {
    org_fields_extracted: number;
    vehicles_found: number;
    vehicles_with_images: number;
  };
}

/**
 * Generate SQL for inserting organization via MCP
 */
function generateOrgInsertSQL(org: ScrapedOrg): string {
  return `
    INSERT INTO businesses (
      business_name, website, description, email, phone,
      address, city, state, zip_code, logo_url, metadata
    ) VALUES (
      ${org.business_name ? `'${org.business_name.replace(/'/g, "''")}'` : 'NULL'},
      ${org.website ? `'${org.website.replace(/'/g, "''")}'` : 'NULL'},
      ${org.description ? `'${org.description.replace(/'/g, "''")}'` : 'NULL'},
      ${org.email ? `'${org.email.replace(/'/g, "''")}'` : 'NULL'},
      ${org.phone ? `'${org.phone.replace(/'/g, "''")}'` : 'NULL'},
      ${org.address ? `'${org.address.replace(/'/g, "''")}'` : 'NULL'},
      ${org.city ? `'${org.city.replace(/'/g, "''")}'` : 'NULL'},
      ${org.state ? `'${org.state.replace(/'/g, "''")}'` : 'NULL'},
      ${org.zip_code ? `'${org.zip_code.replace(/'/g, "''")}'` : 'NULL'},
      ${org.logo_url ? `'${org.logo_url.replace(/'/g, "''")}'` : 'NULL'},
      ${org.metadata ? `'${JSON.stringify(org.metadata).replace(/'/g, "''")}'::jsonb` : "'{}'::jsonb"}
    )
    ON CONFLICT (website) DO UPDATE SET
      business_name = COALESCE(EXCLUDED.business_name, businesses.business_name),
      description = COALESCE(EXCLUDED.description, businesses.description),
      email = COALESCE(EXCLUDED.email, businesses.email),
      phone = COALESCE(EXCLUDED.phone, businesses.phone),
      address = COALESCE(EXCLUDED.address, businesses.address),
      city = COALESCE(EXCLUDED.city, businesses.city),
      state = COALESCE(EXCLUDED.state, businesses.state),
      zip_code = COALESCE(EXCLUDED.zip_code, businesses.zip_code),
      logo_url = COALESCE(EXCLUDED.logo_url, businesses.logo_url),
      metadata = businesses.metadata || EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING id;
  `.trim();
}

/**
 * Generate SQL for inserting vehicle via MCP
 */
function generateVehicleInsertSQL(vehicle: ScrapedVehicle, organizationId: string): string {
  // First insert/update vehicle
  const vehicleSQL = `
    INSERT INTO vehicles (
      year, make, model, description, vin, asking_price,
      discovery_url, origin_metadata
    ) VALUES (
      ${vehicle.year || 'NULL'},
      ${vehicle.make ? `'${vehicle.make.replace(/'/g, "''")}'` : 'NULL'},
      ${vehicle.model ? `'${vehicle.model.replace(/'/g, "''")}'` : 'NULL'},
      ${vehicle.description ? `'${vehicle.description.replace(/'/g, "''")}'` : 'NULL'},
      ${vehicle.vin ? `'${vehicle.vin.replace(/'/g, "''")}'` : 'NULL'},
      ${vehicle.price || 'NULL'},
      ${vehicle.source_url ? `'${vehicle.source_url.replace(/'/g, "''")}'` : 'NULL'},
      '${JSON.stringify({
        source: 'organization_scrape',
        ...vehicle.metadata,
        scraped_at: new Date().toISOString(),
      }).replace(/'/g, "''")}'::jsonb
    )
    ${vehicle.vin ? `ON CONFLICT (vin) DO UPDATE SET
      year = COALESCE(EXCLUDED.year, vehicles.year),
      make = COALESCE(EXCLUDED.make, vehicles.make),
      model = COALESCE(EXCLUDED.model, vehicles.model),
      description = COALESCE(EXCLUDED.description, vehicles.description),
      asking_price = COALESCE(EXCLUDED.asking_price, vehicles.asking_price),
      origin_metadata = vehicles.origin_metadata || EXCLUDED.origin_metadata,
      updated_at = NOW()
    ` : ''}
    RETURNING id;
  `.trim();

  // Then link to organization
  const linkSQL = `
    INSERT INTO organization_vehicles (
      organization_id, vehicle_id, relationship_type, status, auto_tagged, metadata
    )
    SELECT 
      '${organizationId}'::uuid,
      v.id,
      'inventory',
      ${vehicle.status === 'sold' ? "'past'" : "'active'"},
      true,
      '${JSON.stringify({
        source_url: vehicle.source_url,
        extracted_at: new Date().toISOString(),
        price: vehicle.price,
      }).replace(/'/g, "''")}'::jsonb
    FROM (${vehicleSQL}) v
    ON CONFLICT (organization_id, vehicle_id, relationship_type) DO UPDATE SET
      status = EXCLUDED.status,
      metadata = organization_vehicles.metadata || EXCLUDED.metadata,
      updated_at = NOW();
  `.trim();

  return linkSQL;
}

async function main() {
  const url = Deno.args[0];
  
  if (!url) {
    console.error('❌ Usage: deno run scripts/ingest-org-via-mcp.ts <website-url>');
    Deno.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    Deno.exit(1);
  }

  console.log('🚀 Starting organization ingestion workflow...\n');
  console.log(`📋 URL: ${url}\n`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Step 1: Scrape organization and vehicles
  console.log('📡 Step 1: Scraping organization data...');
  try {
    const { data, error } = await supabase.functions.invoke('scrape-org', {
      body: { url },
    });

    if (error) {
      throw new Error(`Edge Function error: ${error.message}`);
    }

    if (!data.success) {
      throw new Error(`Scraping failed: ${data.error || 'Unknown error'}`);
    }

    const response = data as ScrapeResponse;
    
    console.log(`✅ Scraped successfully:`);
    console.log(`   Organization: ${response.org.business_name || 'Unknown'}`);
    console.log(`   Vehicles found: ${response.vehicles.length}`);
    console.log(`   Fields extracted: ${response.stats.org_fields_extracted}\n`);

    // Step 2: Generate SQL for MCP insertion
    console.log('📝 Step 2: Generating SQL for MCP insertion...\n');
    
    // Organization SQL
    const orgSQL = generateOrgInsertSQL(response.org);
    console.log('📦 Organization SQL:');
    console.log(orgSQL);
    console.log('\n');

    // Vehicles SQL
    if (response.vehicles.length > 0) {
      console.log(`📦 Vehicle SQL (${response.vehicles.length} vehicles):\n`);
      response.vehicles.forEach((vehicle, idx) => {
        console.log(`-- Vehicle ${idx + 1}: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        // Note: organization_id will be from org insert result
        const vehicleSQL = generateVehicleInsertSQL(vehicle, 'ORGANIZATION_ID_PLACEHOLDER');
        console.log(vehicleSQL.replace('ORGANIZATION_ID_PLACEHOLDER', '${org_id}'));
        console.log('\n');
      });
    }

    console.log('\n✅ SQL generation complete!');
    console.log('\n📋 Next steps:');
    console.log('   1. Execute the organization SQL via MCP: mcp_supabase_execute_sql');
    console.log('   2. Replace ${org_id} with the returned organization ID');
    console.log('   3. Execute vehicle SQL statements via MCP');
    console.log('\n💡 Or use the MCP tools directly to insert the data programmatically\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}

