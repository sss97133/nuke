import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY

async function scrapeForInstagram(url: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ['html'],
      }),
    })

    const data = await response.json()
    const html = data.data?.html || ''

    // Look for Instagram links
    const patterns = [
      /instagram\.com\/([a-zA-Z0-9_.]+)/g,
      /href="[^"]*instagram\.com\/([a-zA-Z0-9_.]+)"/g,
    ]

    for (const pattern of patterns) {
      const match = pattern.exec(html)
      if (match && match[1] && !['p', 'reel', 'stories'].includes(match[1])) {
        return `https://instagram.com/${match[1]}`
      }
    }

    return null
  } catch (e) {
    console.error(`Failed to scrape ${url}:`, e)
    return null
  }
}

async function enrichBusinesses(batchSize = 20, category?: string) {
  console.log('Fetching businesses to enrich...')

  let query = supabase
    .from('businesses')
    .select('id, business_name, website, metadata')
    .eq('metadata->>project', 'lofficiel-concierge')
    .not('website', 'is', null)
    .limit(batchSize)

  // Only get ones we haven't tried yet
  // We'll store instagram in metadata

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
  let notFound = 0

  for (const biz of businesses || []) {
    // Skip if already has instagram
    if (biz.metadata?.instagram) {
      console.log(`⏭️  ${biz.business_name} - already has Instagram`)
      continue
    }

    if (!biz.website) {
      console.log(`⏭️  ${biz.business_name} - no website`)
      continue
    }

    console.log(`🔍 ${biz.business_name} - checking ${biz.website}`)

    const instagram = await scrapeForInstagram(biz.website)

    const updatedMetadata = {
      ...biz.metadata,
      instagram: instagram || 'not_found',
      instagram_checked_at: new Date().toISOString(),
    }

    await supabase
      .from('businesses')
      .update({ metadata: updatedMetadata })
      .eq('id', biz.id)

    if (instagram) {
      console.log(`✅ Found: ${instagram}`)
      found++
    } else {
      console.log(`❌ Not found`)
      notFound++
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`\nDone! Found: ${found}, Not found: ${notFound}`)
}

// Run
const category = process.argv[2]
const batchSize = parseInt(process.argv[3] || '20')

enrichBusinesses(batchSize, category)
