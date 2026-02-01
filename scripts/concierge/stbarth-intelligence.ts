/**
 * ST. BARTH INTELLIGENCE DASHBOARD
 * Comprehensive overview of the island's service landscape
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface CategoryStats {
  category: string
  count: number
  with_instagram: number
  with_website: number
  with_phone: number
  investigated: number
}

async function main() {
  console.log('═'.repeat(70))
  console.log('🏝️  ST. BARTHÉLEMY INTELLIGENCE REPORT')
  console.log('═'.repeat(70))
  console.log('')

  // Get all businesses with full metadata
  const allBusinesses: any[] = []
  let offset = 0
  const limit = 1000

  while (true) {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('metadata->>project', 'lofficiel-concierge')
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error:', error)
      break
    }

    if (!data || data.length === 0) break
    allBusinesses.push(...data)
    offset += limit
    if (data.length < limit) break
  }

  console.log(`📊 TOTAL BUSINESSES: ${allBusinesses.length}`)
  console.log('')

  // Category breakdown
  const categories: Record<string, CategoryStats> = {}

  for (const biz of allBusinesses) {
    const cat = biz.metadata?.category_fr || 'UNCATEGORIZED'
    if (!categories[cat]) {
      categories[cat] = {
        category: cat,
        count: 0,
        with_instagram: 0,
        with_website: 0,
        with_phone: 0,
        investigated: 0
      }
    }

    categories[cat].count++
    if (biz.metadata?.instagram && biz.metadata.instagram !== 'not_found') {
      categories[cat].with_instagram++
    }
    if (biz.website) categories[cat].with_website++
    if (biz.phone) categories[cat].with_phone++
    if (biz.metadata?.investigated_at) categories[cat].investigated++
  }

  // Tourism sectors
  const tourismCategories = [
    'HOTELS', 'RESTAURANTS', 'CHEFS PRIVES', 'LOCATION D\'AUTOMOBILES',
    'TAXIS', 'MANAGEMENT DE VILLAS', 'AGENCES IMMOBILIERES',
    'YACHT', 'PLAGE', 'SPA', 'BOUTIQUE'
  ]

  console.log('─'.repeat(70))
  console.log('🎯 TOURISM-FACING SECTORS')
  console.log('─'.repeat(70))
  console.log('')
  console.log('Category'.padEnd(35) + 'Count'.padStart(6) + '  IG%'.padStart(6) + '  Web%'.padStart(7))
  console.log('─'.repeat(55))

  let totalTourism = 0
  const sorted = Object.values(categories).sort((a, b) => b.count - a.count)

  for (const stat of sorted) {
    // Check if tourism-related
    const isTourism = tourismCategories.some(tc =>
      stat.category.toUpperCase().includes(tc)
    )

    if (isTourism || stat.count >= 10) {
      const igPct = stat.count > 0 ? Math.round(stat.with_instagram / stat.count * 100) : 0
      const webPct = stat.count > 0 ? Math.round(stat.with_website / stat.count * 100) : 0

      console.log(
        stat.category.slice(0, 34).padEnd(35) +
        stat.count.toString().padStart(6) +
        (igPct + '%').padStart(6) +
        (webPct + '%').padStart(7)
      )

      if (isTourism) totalTourism += stat.count
    }
  }

  console.log('')

  // Key market statistics
  console.log('─'.repeat(70))
  console.log('📈 MARKET INTELLIGENCE')
  console.log('─'.repeat(70))
  console.log('')

  // Hotels
  const hotels = allBusinesses.filter(b =>
    b.metadata?.category_fr?.includes('HOTEL')
  )
  console.log(`🏨 HOTELS: ${hotels.length}`)
  console.log(`   (Industry data: ~25 hotels, ~850 total rooms)`)
  console.log('')

  // Restaurants
  const restaurants = allBusinesses.filter(b =>
    b.metadata?.category_fr?.includes('RESTAURANT') ||
    b.metadata?.business_type === 'restaurant'
  )
  console.log(`🍽️  RESTAURANTS: ${restaurants.length}`)
  console.log('')

  // Villas
  const villaManagers = allBusinesses.filter(b =>
    b.metadata?.category_fr?.includes('VILLA') ||
    b.metadata?.category_fr?.includes('IMMOBIL')
  )
  console.log(`🏠 VILLA MANAGEMENT/AGENCIES: ${villaManagers.length}`)
  console.log(`   (Industry data: ~400 rental villas available)`)
  console.log('')

  // Transportation
  const taxis = allBusinesses.filter(b =>
    b.metadata?.category_fr?.includes('TAXI')
  )
  const carRentals = allBusinesses.filter(b =>
    b.metadata?.category_fr?.includes('LOCATION') &&
    b.metadata?.category_fr?.includes('AUTO')
  )
  console.log(`🚗 TRANSPORTATION:`)
  console.log(`   Taxis: ${taxis.length}`)
  console.log(`   Car Rentals: ${carRentals.length}`)
  console.log('')

  // Private Chefs
  const chefs = allBusinesses.filter(b =>
    b.metadata?.category_fr?.includes('CHEF')
  )
  console.log(`👨‍🍳 PRIVATE CHEFS: ${chefs.length}`)
  console.log('')

  // Boutiques
  const boutiques = allBusinesses.filter(b =>
    b.metadata?.category_fr?.includes('VETEMENT') ||
    b.metadata?.category_fr?.includes('BIJOU') ||
    b.metadata?.category_fr?.includes('BOUTIQUE')
  )
  console.log(`👗 BOUTIQUES/FASHION: ${boutiques.length}`)
  console.log('')

  // Enrichment status
  console.log('─'.repeat(70))
  console.log('🔍 ENRICHMENT STATUS')
  console.log('─'.repeat(70))
  console.log('')

  const withInstagram = allBusinesses.filter(b =>
    b.metadata?.instagram && b.metadata.instagram !== 'not_found'
  ).length
  const investigated = allBusinesses.filter(b =>
    b.metadata?.investigated_at
  ).length
  const withWebsite = allBusinesses.filter(b => b.website).length
  const withPhone = allBusinesses.filter(b => b.phone).length

  console.log(`   Has Instagram: ${withInstagram} (${Math.round(withInstagram/allBusinesses.length*100)}%)`)
  console.log(`   Investigated: ${investigated} (${Math.round(investigated/allBusinesses.length*100)}%)`)
  console.log(`   Has Website: ${withWebsite} (${Math.round(withWebsite/allBusinesses.length*100)}%)`)
  console.log(`   Has Phone: ${withPhone} (${Math.round(withPhone/allBusinesses.length*100)}%)`)
  console.log('')

  // External market data
  console.log('─'.repeat(70))
  console.log('🌍 EXTERNAL MARKET DATA (2023-2024)')
  console.log('─'.repeat(70))
  console.log('')
  console.log('   Annual Visitors: ~312,000 (2023)')
  console.log('   - Hotels/Villas: ~70,000')
  console.log('   - Boat arrivals: ~130,000')
  console.log('   - Day trips: ~112,000')
  console.log('')
  console.log('   Superyachts (>24m): 1,112 docked at Gustavia (2023)')
  console.log('   Boat licenses: 623 (1 per 17 residents)')
  console.log('')
  console.log('   GDP Breakdown:')
  console.log('   - Tourism: 68%')
  console.log('   - Construction: 24%')
  console.log('   - Other: 8%')
  console.log('')
  console.log('   GDP per capita: €42,700 (12% above mainland France)')
  console.log('')

  console.log('═'.repeat(70))
  console.log('📋 NEXT STEPS FOR ENRICHMENT')
  console.log('═'.repeat(70))
  console.log('')
  console.log('1. Run overnight investigation for 334 tourist-facing businesses')
  console.log('2. Deep social finder for remaining 2,459 businesses')
  console.log('3. Cross-reference with TripAdvisor/Google reviews')
  console.log('4. Map "tribes" by analyzing Instagram followers/following')
  console.log('5. Scrape La Collectivité for construction permits')
  console.log('')
}

main().catch(console.error)
