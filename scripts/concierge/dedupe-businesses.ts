/**
 * Deduplicate businesses by business_name
 * Keeps the entry with the most metadata
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('🧹 DEDUPLICATING BUSINESSES')
  console.log('═'.repeat(60))

  // Get ALL businesses with pagination
  const allBusinesses: any[] = []
  let offset = 0
  const limit = 1000

  while (true) {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, business_name, website, phone, email, metadata')
      .eq('metadata->>project', 'lofficiel-concierge')
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error:', error)
      return
    }

    if (!data || data.length === 0) break
    allBusinesses.push(...data)
    console.log(`   Fetched ${allBusinesses.length} records...`)
    offset += limit
    if (data.length < limit) break
  }

  const businesses = allBusinesses
  console.log(`📋 Total businesses: ${businesses?.length}`)

  // Group by business_name
  const groups: Record<string, typeof businesses> = {}
  for (const biz of businesses || []) {
    const name = biz.business_name
    if (!groups[name]) groups[name] = []
    groups[name].push(biz)
  }

  // Find duplicates
  const duplicateGroups = Object.entries(groups).filter(([_, items]) => items.length > 1)
  console.log(`🔍 Found ${duplicateGroups.length} business names with duplicates`)

  let deleted = 0
  let kept = 0

  for (const [name, items] of duplicateGroups) {
    // Score each entry by completeness
    const scored = items.map(biz => {
      let score = 0
      if (biz.website) score += 10
      if (biz.phone) score += 5
      if (biz.email) score += 5
      if (biz.metadata) {
        const m = biz.metadata
        if (m.instagram) score += 20
        if (m.facebook) score += 10
        if (m.investigated_at) score += 15
        if (m.enriched_complete) score += 10
        if (m.business_type) score += 5
        // Count metadata keys
        score += Object.keys(m).length
      }
      return { biz, score }
    })

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)

    // Keep the best one
    const [best, ...rest] = scored
    kept++

    // Merge metadata from duplicates into best (only if missing)
    let mergedMetadata = { ...best.biz.metadata }
    for (const { biz } of rest) {
      if (biz.metadata) {
        for (const [key, value] of Object.entries(biz.metadata)) {
          if (value && !mergedMetadata[key]) {
            mergedMetadata[key] = value
          }
        }
      }
      // Also copy fields if missing
      if (!best.biz.website && biz.website) {
        await supabase
          .from('businesses')
          .update({ website: biz.website })
          .eq('id', best.biz.id)
      }
      if (!best.biz.phone && biz.phone) {
        await supabase
          .from('businesses')
          .update({ phone: biz.phone })
          .eq('id', best.biz.id)
      }
    }

    // Update best with merged metadata
    await supabase
      .from('businesses')
      .update({ metadata: mergedMetadata })
      .eq('id', best.biz.id)

    // Delete the duplicates
    const idsToDelete = rest.map(r => r.biz.id)
    const { error: deleteError } = await supabase
      .from('businesses')
      .delete()
      .in('id', idsToDelete)

    if (deleteError) {
      console.log(`   ⚠️ Error deleting ${name}: ${deleteError.message}`)
    } else {
      deleted += idsToDelete.length
      if (rest.length > 2) {
        console.log(`   ✓ ${name}: kept 1, deleted ${rest.length}`)
      }
    }
  }

  console.log('')
  console.log('═'.repeat(60))
  console.log('✨ DEDUPLICATION COMPLETE')
  console.log(`   Kept: ${kept} businesses`)
  console.log(`   Deleted: ${deleted} duplicates`)

  // Final count
  const { count } = await supabase
    .from('businesses')
    .select('id', { count: 'exact', head: true })
    .eq('metadata->>project', 'lofficiel-concierge')

  console.log(`   Final count: ${count}`)
}

main().catch(console.error)
