/**
 * Firecrawl-based enrichment - faster, serverless-compatible
 * Use when Firecrawl credits available (Feb 2+)
 */

import { createClient } from '@supabase/supabase-js'
import FirecrawlApp from '@mendable/firecrawl-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! })

const BATCH_SIZE = 100

async function enrichFromWebsite(url: string, name: string): Promise<{ photos?: string[], instagram?: string }> {
  const data: { photos?: string[], instagram?: string } = {}

  try {
    const result = await firecrawl.scrapeUrl(url, {
      formats: ['html'],
      timeout: 15000,
    })

    if (!result.success || !result.html) return data

    const html = result.html

    // Extract OG image
    const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/)

    if (ogMatch?.[1]?.startsWith('http')) {
      data.photos = [ogMatch[1]]
    }

    // Extract Instagram link
    const igMatch = html.match(/href=["']https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)["']/)
    if (igMatch?.[1] && !['p', 'reel', 'stories', 'explore', 'accounts'].includes(igMatch[1])) {
      data.instagram = `https://instagram.com/${igMatch[1]}`
    }

    // Extract large images from img tags if no OG image
    if (!data.photos) {
      const imgMatches = html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi)
      const photos: string[] = []
      for (const match of imgMatches) {
        const src = match[1]
        if (src?.startsWith('http') && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar')) {
          // Check for size hints in URL or attributes
          if (src.includes('hero') || src.includes('banner') || src.includes('main') ||
              match[0].includes('width="') || src.match(/[?&]w=\d{3,}/)) {
            photos.push(src)
            if (photos.length >= 3) break
          }
        }
      }
      if (photos.length > 0) data.photos = photos
    }

  } catch (e) {
    // Scrape failed, continue
  }

  return data
}

async function searchInstagram(name: string): Promise<string | null> {
  try {
    // Use Firecrawl to search Google
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(name + ' st barth instagram site:instagram.com')}`
    const result = await firecrawl.scrapeUrl(searchUrl, {
      formats: ['html'],
      timeout: 10000,
    })

    if (!result.success || !result.html) return null

    const igMatch = result.html.match(/href=["'][^"']*instagram\.com\/([a-zA-Z0-9_.]+)["']/)
    if (igMatch?.[1] && !['p', 'reel', 'stories', 'explore', 'accounts'].includes(igMatch[1])) {
      return `https://instagram.com/${igMatch[1]}`
    }
  } catch {}

  return null
}

async function main() {
  console.log('🔥 FIRECRAWL ENRICHMENT')
  console.log('═'.repeat(50))

  let totalProcessed = 0
  let totalEnriched = 0
  let batch = 0

  while (true) {
    batch++

    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('metadata->>project', 'lofficiel-concierge')
      .not('website', 'is', null)
      .or('metadata->>photos.is.null,metadata->>instagram.is.null')
      .limit(BATCH_SIZE)

    if (error || !businesses || businesses.length === 0) {
      console.log('✅ No more businesses to enrich!')
      break
    }

    console.log(`\n📦 BATCH ${batch}: ${businesses.length} businesses\n`)

    for (const [i, biz] of businesses.entries()) {
      if (biz.metadata?.photos && biz.metadata?.instagram) continue

      process.stdout.write(`[${i+1}/${businesses.length}] ${biz.business_name.slice(0, 35).padEnd(35)} `)

      let data = await enrichFromWebsite(biz.website, biz.business_name)

      // Search for Instagram if not found on website
      if (!data.instagram && !biz.metadata?.instagram) {
        const ig = await searchInstagram(biz.business_name)
        if (ig) data.instagram = ig
      }

      const hasNew = (data.photos && !biz.metadata?.photos) || (data.instagram && !biz.metadata?.instagram)

      if (hasNew) {
        const updatedMetadata = {
          ...biz.metadata,
          ...(data.photos && !biz.metadata?.photos ? { photos: data.photos } : {}),
          ...(data.instagram && !biz.metadata?.instagram ? { instagram: data.instagram } : {}),
          enriched_at: new Date().toISOString(),
          enriched_via: 'firecrawl',
        }

        await supabase
          .from('businesses')
          .update({ metadata: updatedMetadata })
          .eq('id', biz.id)

        totalEnriched++
        const found = []
        if (data.photos && !biz.metadata?.photos) found.push(`${data.photos.length}📷`)
        if (data.instagram && !biz.metadata?.instagram) found.push(`@${data.instagram.split('/').pop()?.slice(0, 12)}`)
        console.log(`✅ ${found.join(' ')}`)
      } else {
        console.log('−')
      }

      totalProcessed++

      // Rate limit - Firecrawl has limits
      await new Promise(r => setTimeout(r, 200))
    }

    console.log(`\n📊 Batch ${batch}: ${totalEnriched} enriched total`)
  }

  // Final stats
  const { count: withPhotos } = await supabase
    .from('businesses')
    .select('*', { count: 'exact', head: true })
    .eq('metadata->>project', 'lofficiel-concierge')
    .not('metadata->>photos', 'is', null)

  const { count: withInstagram } = await supabase
    .from('businesses')
    .select('*', { count: 'exact', head: true })
    .eq('metadata->>project', 'lofficiel-concierge')
    .not('metadata->>instagram', 'is', null)

  console.log('\n' + '═'.repeat(50))
  console.log('🔥 FIRECRAWL ENRICHMENT COMPLETE')
  console.log(`   Processed: ${totalProcessed}`)
  console.log(`   Enriched: ${totalEnriched}`)
  console.log(`   Total with photos: ${withPhotos}`)
  console.log(`   Total with Instagram: ${withInstagram}`)
  console.log('═'.repeat(50))
}

main().catch(console.error)
