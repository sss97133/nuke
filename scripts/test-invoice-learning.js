/**
 * TEST INVOICE LEARNING SYSTEM
 * 
 * Tests the learn-from-invoice function with a real invoice
 * For the 1932 Ford Roadster with Motec system
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function testInvoiceLearning() {
  console.log('🧠 TESTING INVOICE LEARNING SYSTEM\n')

  // Step 1: Find 1932 Roadster vehicle
  console.log('📋 Step 1: Finding 1932 Roadster vehicle...')
  const { data: vehicles, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('year.eq.1932,year.eq.32')
    .ilike('model', '%roadster%')

  if (vehicleError) {
    console.error('❌ Error finding vehicle:', vehicleError)
    return
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('⚠️  No 1932 Roadster found. Creating test vehicle...')
    // Could create one, but for now just proceed without vehicle_id
  }

  const vehicle = vehicles?.[0]
  if (vehicle) {
    console.log(`✅ Found vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})`)
  } else {
    console.log('ℹ️  Proceeding without vehicle_id (will still learn from invoice)')
  }

  // Step 2: Check for existing invoice document
  console.log('\n📄 Step 2: Checking for invoice document...')
  
  // For testing, we'll use a document URL if provided, or prompt user
  const invoiceUrl = process.env.INVOICE_URL || process.argv[2]
  
  if (!invoiceUrl) {
    console.log(`
⚠️  No invoice URL provided.

Usage:
  node scripts/test-invoice-learning.js <invoice_url>

Or set INVOICE_URL environment variable.

Example:
  node scripts/test-invoice-learning.js https://storage.supabase.co/object/public/documents/invoice.pdf

For testing with the Desert Performance invoice, upload it first and provide the URL.
    `)
    return
  }

  console.log(`📎 Invoice URL: ${invoiceUrl}`)

  // Step 3: Create a test document record (or use existing)
  console.log('\n📝 Step 3: Creating/updating document record...')
  
  // Check if document exists
  const { data: existingDoc } = await supabase
    .from('documents')
    .select('id')
    .eq('file_url', invoiceUrl)
    .maybeSingle()

  let documentId = existingDoc?.id

  if (!documentId) {
    // Create document record
    const { data: newDoc, error: docError } = await supabase
      .from('documents')
      .insert({
        file_url: invoiceUrl,
        file_name: 'Desert Performance Invoice',
        file_type: invoiceUrl.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image',
        document_type: 'invoice',
        vehicle_id: vehicle?.id,
        uploaded_by: (await supabase.auth.getUser()).data.user?.id || null
      })
      .select('id')
      .single()

    if (docError) {
      console.error('❌ Error creating document:', docError)
      return
    }

    documentId = newDoc.id
    console.log(`✅ Created document record: ${documentId}`)
  } else {
    console.log(`✅ Using existing document: ${documentId}`)
  }

  // Step 4: Call learn-from-invoice function
  console.log('\n🧠 Step 4: Calling learn-from-invoice function...')
  
  const { data, error } = await supabase.functions.invoke('learn-from-invoice', {
    body: {
      document_id: documentId,
      vehicle_id: vehicle?.id,
      document_url: invoiceUrl,
      shop_name: 'Desert Performance',
      invoice_date: '2024-01-15' // Update with actual date
    }
  })

  if (error) {
    console.error('❌ Error calling function:', error)
    return
  }

  console.log('\n✅ INVOICE LEARNING COMPLETE!\n')
  console.log(JSON.stringify(data, null, 2))

  // Step 5: Verify learned data
  console.log('\n🔍 Step 5: Verifying learned data...')

  if (data.summary) {
    const { summary } = data

    // Check parts indexed
    if (summary.parts_indexed > 0) {
      console.log(`\n📦 Parts Indexed: ${summary.parts_indexed}`)
      if (summary.parts_details) {
        summary.parts_details.slice(0, 5).forEach((part: any) => {
          console.log(`   - ${part.part_number}: ${part.name} (${part.action})`)
        })
      }
    }

    // Check pricing learned
    if (summary.pricing_learned > 0) {
      console.log(`\n💰 Pricing Learned: ${summary.pricing_learned} parts`)
      if (summary.pricing_learned > 0) {
        const { data: pricing } = await supabase
          .from('invoice_learned_pricing')
          .select('part_number, brand, unit_price, shop_name')
          .eq('source_invoice_id', documentId)
          .limit(5)

        if (pricing) {
          pricing.forEach((p: any) => {
            console.log(`   - ${p.brand} ${p.part_number}: $${p.unit_price} (from ${p.shop_name})`)
          })
        }
      }
    }

    // Check systems learned
    if (summary.systems_learned > 0) {
      console.log(`\n🔧 Systems Learned: ${summary.systems_learned}`)
      if (summary.systems_details) {
        summary.systems_details.forEach((system: any) => {
          console.log(`   - ${system.system}: ${system.parts_count} parts`)
        })
      }
    }

    // Check labor learned
    if (summary.labor_learned > 0) {
      console.log(`\n⏱️  Labor Patterns Learned: ${summary.labor_learned}`)
      if (summary.labor_details) {
        summary.labor_details.forEach((labor: any) => {
          console.log(`   - ${labor.description}: ${labor.hours} hours`)
        })
      }
    }

    // Check brand mappings
    if (summary.brands_mapped > 0) {
      console.log(`\n🏷️  Brand Mappings: ${summary.brands_mapped} brands`)
      const { data: mappings } = await supabase
        .from('brand_supplier_mappings')
        .select('brand_name, supplier_name')
        .eq('supplier_name', 'Desert Performance')
        .limit(10)

      if (mappings) {
        mappings.forEach((m: any) => {
          console.log(`   - ${m.brand_name} → ${m.supplier_name}`)
        })
      }
    }
  }

  console.log('\n✅ Test complete!')
}

testInvoiceLearning().catch(console.error)

