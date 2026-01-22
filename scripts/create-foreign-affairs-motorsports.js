#!/usr/bin/env node
/**
 * Create Foreign Affairs Motorsports organization and link vehicles
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  console.log('🚀 Creating Foreign Affairs Motorsports organization\n')

  try {
    // Step 1: Check organizations table schema
    console.log('📋 Step 1: Checking organizations table schema...')
    // Query the table directly to understand structure
    const { data: sampleOrg, error: sampleError } = await supabase
      .from('organizations')
      .select('*')
      .limit(1)

    if (sampleError) {
      throw new Error(`Cannot query organizations: ${sampleError.message}`)
    }

    console.log('✅ Organizations table exists')
    if (sampleOrg && sampleOrg.length > 0) {
      console.log('   Available columns:', Object.keys(sampleOrg[0]).join(', '))
    }

    // Step 2: Create the business entity
    console.log('\n📋 Step 2: Creating Foreign Affairs Motorsports business...')

    // First check if businesses table exists
    const { data: sampleBusiness, error: businessCheckError } = await supabase
      .from('businesses')
      .select('*')
      .limit(1)

    if (businessCheckError) {
      console.log('⚠️  Businesses table may not exist, falling back to organizations table')
      console.log('   Error:', businessCheckError.message)
    } else if (sampleBusiness) {
      console.log('   Available columns in businesses:', Object.keys(sampleBusiness[0] || {}).join(', '))
    }

    const businessData = {
      business_name: 'Foreign Affairs Motorsports',
      business_type: 'dealer',
      website: 'https://foreignaffairsmotorsports.com/',
      description: 'Premier European automotive specialist in Pompano Beach, FL. Authorized dealer for Dinan, Akrapovic, and other performance brands.',
      specializations: ['European', 'Performance', 'Dinan', 'Akrapovic'],
      city: 'Pompano Beach',
      state: 'FL',
      country: 'USA',
      status: 'active',
      is_public: true,
      type: 'dealer',
      metadata: {
        bat_username: '2FAM',
        authorized_dealers: ['Dinan Motorsport', 'Akrapovic']
      }
    }

    let businessId

    const { data: businessResult, error: businessError } = await supabase
      .from('businesses')
      .insert(businessData)
      .select()

    if (businessError) {
      if (businessError.message.includes('duplicate') || businessError.code === '23505') {
        console.log('⚠️  Business already exists, fetching existing record...')
        const { data: existing, error: fetchError } = await supabase
          .from('businesses')
          .select('*')
          .eq('business_name', 'Foreign Affairs Motorsports')
          .single()

        if (fetchError) {
          throw new Error(`Cannot fetch existing business: ${fetchError.message}`)
        }

        console.log('✅ Found existing business:', existing.id)
        console.log('   Name:', existing.business_name)
        console.log('   Type:', existing.business_type)

        businessId = existing.id
      } else {
        throw new Error(`Cannot create business: ${businessError.message}`)
      }
    } else {
      console.log('✅ Business created successfully!')
      console.log('   ID:', businessResult[0].id)
      console.log('   Name:', businessResult[0].business_name)
      console.log('   Type:', businessResult[0].business_type)

      businessId = businessResult[0].id
    }

    // Step 3: Check organization_vehicles table structure and valid relationship types
    console.log('\n📋 Step 3: Checking organization_vehicles table structure...')
    const { data: sampleOrgVehicle, error: orgVehicleError } = await supabase
      .from('organization_vehicles')
      .select('*')
      .limit(1)

    if (!orgVehicleError && sampleOrgVehicle && sampleOrgVehicle.length > 0) {
      console.log('   Available columns:', Object.keys(sampleOrgVehicle[0]).join(', '))
    }

    // Get distinct relationship types currently in use
    const { data: existingTypes, error: typesError } = await supabase
      .from('organization_vehicles')
      .select('relationship_type')
      .limit(1000)

    if (!typesError && existingTypes) {
      const uniqueTypes = [...new Set(existingTypes.map(r => r.relationship_type))]
      console.log('   Existing relationship_type values:', uniqueTypes.join(', '))
    }

    // Step 4: Link vehicles from seller "2FAM"
    console.log('\n📋 Step 4: Linking vehicles from seller "2FAM"...')

    // First, get vehicles with bat_seller = '2FAM'
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, bat_seller, year, make, model')
      .eq('bat_seller', '2FAM')

    if (vehiclesError) {
      throw new Error(`Cannot query vehicles: ${vehiclesError.message}`)
    }

    console.log(`   Found ${vehicles.length} vehicles with seller "2FAM"`)

    if (vehicles.length === 0) {
      console.log('⚠️  No vehicles found with bat_seller = "2FAM"')
      return
    }

    // Show some examples
    console.log('\n   Sample vehicles:')
    vehicles.slice(0, 3).forEach(v => {
      console.log(`   - ${v.year} ${v.make} ${v.model} (${v.id})`)
    })

    // Verify the business exists
    const { data: businessVerify, error: businessVerifyError } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .single()

    if (businessVerifyError || !businessVerify) {
      throw new Error(`Business ${businessId} not found in database: ${businessVerifyError?.message}`)
    }

    console.log(`   ✅ Verified business exists: ${businessId}`)

    // Link each vehicle to the business
    // Note: Using 'sold_by' which is the valid relationship type in the current schema
    console.log(`   Using organization_id (business_id): ${businessId}`)

    const linkRecords = vehicles.map(v => ({
      vehicle_id: v.id,
      organization_id: businessId,
      relationship_type: 'sold_by',
      status: 'active'
    }))

    console.log('   Sample link record:', JSON.stringify(linkRecords[0], null, 2))

    // Try inserting one record first to see details
    console.log('\n   Attempting to insert first link...')
    const { data: testLink, error: testError } = await supabase
      .from('organization_vehicles')
      .insert(linkRecords[0])
      .select()

    if (testError) {
      console.log('\n   ❌ Test insert failed with detailed error:')
      console.log('   Error code:', testError.code)
      console.log('   Error message:', testError.message)
      console.log('   Error details:', JSON.stringify(testError.details, null, 2))
      console.log('   Error hint:', testError.hint)
      throw new Error(`Cannot link vehicles: ${testError.message}`)
    }

    console.log('   ✅ Test link successful, proceeding with batch insert')

    const { data: linkResult, error: linkError } = await supabase
      .from('organization_vehicles')
      .insert(linkRecords.slice(1))
      .select()

    if (linkError) {
      if (linkError.message.includes('duplicate') || linkError.code === '23505') {
        console.log('⚠️  Some or all vehicles already linked')

        // Count existing links
        const { count, error: countError } = await supabase
          .from('organization_vehicles')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', businessId)
          .eq('relationship_type', 'sold_by')

        if (!countError) {
          console.log(`   Existing links: ${count}`)
        }
      } else {
        throw new Error(`Cannot link vehicles: ${linkError.message}`)
      }
    } else {
      console.log(`✅ Successfully linked ${linkResult.length} vehicles to organization!`)
    }

    console.log('\n✨ Done!')

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

main()
