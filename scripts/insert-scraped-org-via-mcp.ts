#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Insert scraped organization and vehicle data via MCP Supabase tools
 * 
 * Usage:
 *   deno run --allow-net --allow-env scripts/insert-scraped-org-via-mcp.ts <scrape-response-json>
 * 
 * Or pipe from scrape function:
 *   curl -X POST ... | deno run --allow-net --allow-env scripts/insert-scraped-org-via-mcp.ts
 */

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

async function insertOrgViaMCP(org: ScrapedOrg): Promise<string | null> {
  // Check if org already exists by website
  const checkQuery = `
    SELECT id FROM businesses 
    WHERE website = $1
    LIMIT 1;
  `;
  
  // Note: This is a placeholder - in real implementation, you'd use MCP tools
  // For now, we'll generate SQL that can be executed via MCP
  console.log('📝 Generated SQL for organization insertion:');
  
  const insertQuery = `
    INSERT INTO businesses (
      business_name, website, description, email, phone,
      address, city, state, zip_code, logo_url, metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
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
  `;
  
  const values = [
    org.business_name || null,
    org.website || null,
    org.description || null,
    org.email || null,
    org.phone || null,
    org.address || null,
    org.city || null,
    org.state || null,
    org.zip_code || null,
    org.logo_url || null,
    JSON.stringify(org.metadata || {}),
  ];
  
  console.log('SQL Query:', insertQuery);
  console.log('Values:', values);
  
  // Return SQL for manual execution or MCP tool execution
  return `EXECUTE_VIA_MCP: ${insertQuery}`;
}

async function insertVehicleViaMCP(
  vehicle: ScrapedVehicle,
  organizationId: string
): Promise<string | null> {
  console.log(`📝 Generated SQL for vehicle insertion: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  
  // First, check if vehicle exists (by VIN or year/make/model)
  let vehicleId: string | null = null;
  
  if (vehicle.vin) {
    const checkVinQuery = `SELECT id FROM vehicles WHERE vin = $1 LIMIT 1;`;
    console.log('Check VIN query:', checkVinQuery, [vehicle.vin]);
  }
  
  if (!vehicleId && vehicle.year && vehicle.make && vehicle.model) {
    const checkYmmQuery = `
      SELECT id FROM vehicles 
      WHERE year = $1 AND make = $2 AND model = $3
      LIMIT 1;
    `;
    console.log('Check YMM query:', checkYmmQuery, [vehicle.year, vehicle.make, vehicle.model]);
  }
  
  // Insert or update vehicle
  const insertVehicleQuery = `
    INSERT INTO vehicles (
      year, make, model, description, vin, asking_price,
      discovery_url, origin_metadata
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8
    )
    ON CONFLICT (vin) DO UPDATE SET
      year = COALESCE(EXCLUDED.year, vehicles.year),
      make = COALESCE(EXCLUDED.make, vehicles.make),
      model = COALESCE(EXCLUDED.model, vehicles.model),
      description = COALESCE(EXCLUDED.description, vehicles.description),
      asking_price = COALESCE(EXCLUDED.asking_price, vehicles.asking_price),
      origin_metadata = vehicles.origin_metadata || EXCLUDED.origin_metadata,
      updated_at = NOW()
    RETURNING id;
  `;
  
  const vehicleValues = [
    vehicle.year || null,
    vehicle.make || null,
    vehicle.model || null,
    vehicle.description || null,
    vehicle.vin || null,
    vehicle.price || null,
    vehicle.source_url || null,
    JSON.stringify({
      source: 'organization_scrape',
      ...vehicle.metadata,
      scraped_at: new Date().toISOString(),
    }),
  ];
  
  console.log('Vehicle SQL:', insertVehicleQuery);
  console.log('Vehicle values:', vehicleValues);
  
  // Link vehicle to organization
  const linkOrgQuery = `
    INSERT INTO organization_vehicles (
      organization_id, vehicle_id, relationship_type, status, auto_tagged, metadata
    ) VALUES (
      $1, $2, $3, $4, true, $5
    )
    ON CONFLICT (organization_id, vehicle_id, relationship_type) DO UPDATE SET
      status = EXCLUDED.status,
      metadata = organization_vehicles.metadata || EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING id;
  `;
  
  console.log('Link org query:', linkOrgQuery);
  
  return `EXECUTE_VIA_MCP: ${insertVehicleQuery} then ${linkOrgQuery}`;
}

async function main() {
  // Read input from stdin or file
  const input = Deno.args[0] || await Deno.stdin.readText();
  
  if (!input) {
    console.error('❌ No input provided');
    console.error('Usage: deno run scripts/insert-scraped-org-via-mcp.ts <json>');
    Deno.exit(1);
  }
  
  let data: ScrapeResponse;
  try {
    data = JSON.parse(input);
  } catch (e) {
    console.error('❌ Invalid JSON:', e);
    Deno.exit(1);
  }
  
  if (!data.success || !data.org) {
    console.error('❌ Invalid scrape response');
    Deno.exit(1);
  }
  
  console.log('🚀 Processing scraped data via MCP...\n');
  
  // Step 1: Insert organization
  console.log('📦 Step 1: Inserting organization...');
  const orgId = await insertOrgViaMCP(data.org);
  
  if (!orgId) {
    console.error('❌ Failed to get organization ID');
    Deno.exit(1);
  }
  
  console.log(`✅ Organization ID: ${orgId}\n`);
  
  // Step 2: Insert vehicles
  console.log(`📦 Step 2: Inserting ${data.vehicles.length} vehicles...`);
  
  for (const vehicle of data.vehicles) {
    await insertVehicleViaMCP(vehicle, orgId);
  }
  
  console.log(`\n✅ Processed ${data.vehicles.length} vehicles`);
  console.log('\n📋 Next steps:');
  console.log('   1. Review the SQL queries above');
  console.log('   2. Execute them via MCP Supabase tools');
  console.log('   3. Or use the MCP CLI to run the SQL');
}

if (import.meta.main) {
  main().catch(console.error);
}

