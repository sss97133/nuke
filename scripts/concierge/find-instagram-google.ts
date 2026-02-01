import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Use DuckDuckGo HTML (no API key needed)
async function searchDuckDuckGo(query: string): Promise<string | null> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    })
    const html = await response.text()

    // Look for Instagram links in results
    const match = html.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)
    if (match && match[1] && !['p', 'reel', 'stories', 'explore'].includes(match[1])) {
      return match[1]
    }
    return null
  } catch (e) {
    console.error('Search error:', e)
    return null
  }
}

async function enrichBusinesses(batchSize = 20, category?: string) {
  console.log('Fetching businesses to enrich...')

  let query = supabase
    .from('businesses')
    .select('id, business_name, city, metadata')
    .eq('metadata->>project', 'lofficiel-concierge')
    .limit(batchSize)

  if (category) {
    query = query.ilike('metadata->>category_fr', `%${category}%`)
  }

  const { data: businesses, error } = await query

  if (error) {
    console.error('Error fetching:', error)
    return
  }

  console.log(`Processing ${businesses?.length || 0} businesses...`)

  let found = 0
  let skipped = 0

  for (const biz of businesses || []) {
    // Skip if already has instagram
    if (biz.metadata?.instagram && biz.metadata.instagram !== 'not_found') {
      skipped++
      continue
    }

    const searchQuery = `${biz.business_name} st barth instagram site:instagram.com`
    console.log(`🔍 ${biz.business_name}`)

    const handle = await searchDuckDuckGo(searchQuery)

    if (handle) {
      const instagram = `https://instagram.com/${handle}`
      const updatedMetadata = {
        ...biz.metadata,
        instagram,
        instagram_handle: handle,
        instagram_found_at: new Date().toISOString(),
      }

      await supabase
        .from('businesses')
        .update({ metadata: updatedMetadata })
        .eq('id', biz.id)

      console.log(`   ✅ @${handle}`)
      found++
    } else {
      console.log(`   ❌ not found`)
    }

    // Rate limit - be nice to DDG
    await new Promise(r => setTimeout(r, 2000))
  }

  console.log(`\n✨ Done! Found: ${found}, Skipped: ${skipped}`)
}

// Run
const category = process.argv[2]
const batchSize = parseInt(process.argv[3] || '20')

enrichBusinesses(batchSize, category)
