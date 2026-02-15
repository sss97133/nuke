/**
 * Vehicle Data Enrichment Pipeline
 *
 * Re-scrapes vehicles using DEDICATED extractors (no AI/LLM cost).
 * Calls the source-specific extractor edge function for each vehicle URL.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/enrich-vehicles-batch.ts --source mecum --limit 50
 *   dotenvx run -- npx tsx scripts/enrich-vehicles-batch.ts --source barrett-jackson --limit 50
 *   dotenvx run -- npx tsx scripts/enrich-vehicles-batch.ts --source mecum --dry-run
 *
 * Sources with dedicated extractors:
 *   mecum           → extract-mecum
 *   barrett-jackson → extract-barrett-jackson
 *   carsandbids     → extract-cars-and-bids-core  (NOTE: old C&B pages return 404)
 *   bat             → bat-simple-extract
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const args = process.argv.slice(2)
const getArg = (flag: string): string | undefined => {
  const idx = args.indexOf(flag)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
}

const SOURCE_FILTER = getArg('--source') || null
const BATCH_SIZE = parseInt(getArg('--batch-size') || '10')
const LIMIT = parseInt(getArg('--limit') || '10000')
const DRY_RUN = args.includes('--dry-run')
const DELAY_MS = parseInt(getArg('--delay') || '2000')
const MIN_MISSING = parseInt(getArg('--min-missing') || '2')

// Map discovery_source to the dedicated extractor edge function
const SOURCE_TO_EXTRACTOR: Record<string, string> = {
  'mecum': 'extract-mecum',
  'barrett-jackson': 'extract-barrett-jackson',
  'carsandbids': 'extract-cars-and-bids-core',
  'bat': 'bat-simple-extract',
  'bat_core': 'bat-simple-extract',
}

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
}

interface Vehicle {
  id: string
  year: number | null
  make: string | null
  model: string | null
  discovery_url: string
  vin: string | null
  sale_price: number | null
  color: string | null
  mileage: number | null
  description: string | null
  transmission: string | null
  body_style: string | null
}

async function fetchCandidates(offset: number): Promise<Vehicle[]> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_enrichment_candidates`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_source: SOURCE_FILTER,
      p_limit: BATCH_SIZE,
      p_offset: offset,
      p_min_missing: MIN_MISSING,
    }),
    signal: AbortSignal.timeout(90000),
  })

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    console.error(`Query failed: ${resp.status} - ${errBody.substring(0, 200)}`)
    return []
  }

  return resp.json()
}

function getExtractorForUrl(url: string): string | null {
  if (url.includes('mecum.com')) return SOURCE_TO_EXTRACTOR['mecum']
  if (url.includes('barrett-jackson.com')) return SOURCE_TO_EXTRACTOR['barrett-jackson']
  if (url.includes('carsandbids.com')) return SOURCE_TO_EXTRACTOR['carsandbids']
  if (url.includes('bringatrailer.com')) return SOURCE_TO_EXTRACTOR['bat']
  return null
}

async function enrichVehicle(vehicle: Vehicle): Promise<{
  success: boolean
  fieldsAdded: string[]
  error?: string
}> {
  const extractor = getExtractorForUrl(vehicle.discovery_url)

  if (!extractor) {
    return { success: false, fieldsAdded: [], error: 'No dedicated extractor for this URL' }
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${extractor}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: vehicle.discovery_url }),
      signal: AbortSignal.timeout(90000),
    })

    if (!resp.ok) {
      const text = await resp.text()
      return { success: false, fieldsAdded: [], error: `HTTP ${resp.status}: ${text.substring(0, 200)}` }
    }

    const result = await resp.json()

    if (!result.success) {
      return { success: false, fieldsAdded: [], error: result.error || 'extraction failed' }
    }

    // Check what fields were actually filled by re-querying the DB
    const checkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/vehicles?id=eq.${result.vehicle_id || vehicle.id}&select=vin,sale_price,color,mileage,description,transmission,body_style`,
      { headers, signal: AbortSignal.timeout(5000) }
    )
    if (checkResp.ok) {
      const [updated] = await checkResp.json()
      if (updated) {
        const fieldsAdded: string[] = []
        if (!vehicle.vin && updated.vin) fieldsAdded.push('vin')
        if (!vehicle.sale_price && updated.sale_price) fieldsAdded.push('price')
        if (!vehicle.color && updated.color) fieldsAdded.push('color')
        if (!vehicle.mileage && updated.mileage) fieldsAdded.push('mileage')
        if (!vehicle.description && updated.description) fieldsAdded.push('description')
        if (!vehicle.transmission && updated.transmission) fieldsAdded.push('transmission')
        if (!vehicle.body_style && updated.body_style) fieldsAdded.push('body_style')
        return { success: true, fieldsAdded }
      }
    }

    return { success: true, fieldsAdded: result.fields_updated || [] }
  } catch (err) {
    return { success: false, fieldsAdded: [], error: String(err).substring(0, 200) }
  }
}

async function main() {
  if (!SOURCE_FILTER) {
    console.error('ERROR: --source is required (mecum, barrett-jackson, carsandbids, bat)')
    process.exit(1)
  }

  const extractor = SOURCE_TO_EXTRACTOR[SOURCE_FILTER]
  if (!extractor) {
    console.error(`ERROR: No dedicated extractor for source "${SOURCE_FILTER}"`)
    console.error('Available sources:', Object.keys(SOURCE_TO_EXTRACTOR).join(', '))
    process.exit(1)
  }

  console.log('═'.repeat(60))
  console.log('VEHICLE DATA ENRICHMENT PIPELINE')
  console.log('═'.repeat(60))
  console.log(`Source: ${SOURCE_FILTER} → ${extractor}`)
  console.log(`Batch size: ${BATCH_SIZE}`)
  console.log(`Limit: ${LIMIT}`)
  console.log(`Min missing fields: ${MIN_MISSING}`)
  console.log(`Delay: ${DELAY_MS}ms`)
  console.log(`Dry run: ${DRY_RUN}`)
  console.log('═'.repeat(60))

  let totalProcessed = 0
  let totalEnriched = 0
  let totalFieldsAdded = 0
  let totalErrors = 0
  let offset = 0
  const fieldCounts: Record<string, number> = {}
  const startTime = Date.now()

  while (totalProcessed < LIMIT) {
    const candidates = await fetchCandidates(offset)

    if (candidates.length === 0) {
      console.log('\nNo more candidates.')
      break
    }

    offset += candidates.length

    for (const vehicle of candidates) {
      if (totalProcessed >= LIMIT) break

      const label = `${vehicle.year} ${vehicle.make} ${vehicle.model}`.substring(0, 40).padEnd(40)
      process.stdout.write(`[${totalProcessed + 1}] ${label} `)

      if (DRY_RUN) {
        const missing: string[] = []
        if (!vehicle.vin) missing.push('vin')
        if (!vehicle.sale_price) missing.push('price')
        if (!vehicle.color) missing.push('color')
        if (!vehicle.mileage) missing.push('miles')
        if (!vehicle.description) missing.push('desc')
        if (!vehicle.transmission) missing.push('trans')
        if (!vehicle.body_style) missing.push('body')
        console.log(`SKIP (missing: ${missing.join(', ')})`)
        totalProcessed++
        continue
      }

      const result = await enrichVehicle(vehicle)

      if (result.success) {
        if (result.fieldsAdded.length > 0) {
          totalEnriched++
          totalFieldsAdded += result.fieldsAdded.length
          for (const f of result.fieldsAdded) {
            fieldCounts[f] = (fieldCounts[f] || 0) + 1
          }
          console.log(`+${result.fieldsAdded.length} (${result.fieldsAdded.join(', ')})`)
        } else {
          console.log('= (no new data on page)')
        }
      } else {
        totalErrors++
        console.log(`ERR: ${result.error?.substring(0, 80)}`)
      }

      totalProcessed++

      if (totalProcessed < LIMIT) {
        await new Promise(r => setTimeout(r, DELAY_MS))
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
    const rate = totalProcessed > 0 ? (totalProcessed / ((Date.now() - startTime) / 3600000)).toFixed(0) : '0'
    console.log(`  --- ${totalProcessed} processed, ${totalEnriched} enriched, ${totalErrors} errors (${elapsed}s, ~${rate}/hr) ---`)
  }

  console.log('\n' + '═'.repeat(60))
  console.log('ENRICHMENT COMPLETE')
  console.log('═'.repeat(60))
  console.log(`Total processed: ${totalProcessed}`)
  console.log(`Total enriched:  ${totalEnriched}`)
  console.log(`Fields added:    ${totalFieldsAdded}`)
  console.log(`Errors:          ${totalErrors}`)
  console.log(`Duration:        ${((Date.now() - startTime) / 1000).toFixed(0)}s`)
  if (Object.keys(fieldCounts).length > 0) {
    console.log('\nFields filled:')
    for (const [field, count] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field.padEnd(15)} ${count}`)
    }
  }
  console.log('═'.repeat(60))
}

main().catch(console.error)
