/**
 * Cloud-optimized enrichment for GitHub Actions
 * Runs in 25-min batches, picks up where it left off
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BATCH_SIZE = 50  // Smaller batches for cloud
const MAX_RUNTIME_MS = 25 * 60 * 1000  // 25 minutes max

async function scrapeData(page: any, name: string, website?: string): Promise<any> {
  const data: any = {}

  if (website) {
    try {
      await page.goto(website, { waitUntil: 'domcontentloaded', timeout: 10000 })
      await new Promise(r => setTimeout(r, 600))

      const result = await page.evaluate(() => {
        const photos: string[] = []
        const seen = new Set<string>()
        let instagram: string | null = null

        // OG image
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
        if (ogImage?.startsWith('http')) {
          photos.push(ogImage)
          seen.add(ogImage)
        }

        // Large images
        document.querySelectorAll('img').forEach(img => {
          const imgEl = img as HTMLImageElement
          const src = imgEl.src || imgEl.getAttribute('data-src') || ''
          if (src?.startsWith('http') && !seen.has(src) && imgEl.naturalWidth > 150) {
            if (!src.includes('logo') && !src.includes('icon') && !src.includes('avatar')) {
              photos.push(src)
              seen.add(src)
            }
          }
        })

        // Instagram link
        document.querySelectorAll('a[href*="instagram.com"]').forEach(link => {
          if (!instagram) {
            const href = (link as HTMLAnchorElement).href
            const match = href.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)
            if (match && !['p', 'reel', 'stories', 'explore'].includes(match[1])) {
              instagram = `https://instagram.com/${match[1]}`
            }
          }
        })

        return { photos: photos.slice(0, 3), instagram }
      })

      if (result.photos.length > 0) data.photos = result.photos
      if (result.instagram) data.instagram = result.instagram

    } catch {}
  }

  // Google search for Instagram if not found
  if (!data.instagram) {
    try {
      await page.goto(
        `https://www.google.com/search?q=${encodeURIComponent(name + ' st barth instagram')}`,
        { waitUntil: 'domcontentloaded', timeout: 8000 }
      )
      await new Promise(r => setTimeout(r, 800))

      const ig = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'))
        for (const link of links) {
          if (link.href.includes('instagram.com/')) {
            const match = link.href.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)
            if (match && !['p', 'reel', 'stories', 'explore', 'accounts'].includes(match[1])) {
              return `https://instagram.com/${match[1]}`
            }
          }
        }
        return null
      })

      if (ig) data.instagram = ig
    } catch {}
  }

  return data
}

async function main() {
  const startTime = Date.now()
  console.log('🚀 CLOUD ENRICHMENT START')
  console.log('═'.repeat(50))

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  })
  const page = await context.newPage()

  let totalProcessed = 0
  let totalEnriched = 0

  while (true) {
    // Check runtime limit
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log('\n⏰ Time limit reached, stopping gracefully')
      break
    }

    // Get next batch
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

    console.log(`\n📦 Processing ${businesses.length} businesses\n`)

    for (const biz of businesses) {
      if (biz.metadata?.photos && biz.metadata?.instagram) continue

      // Runtime check mid-batch
      if (Date.now() - startTime > MAX_RUNTIME_MS) break

      process.stdout.write(`${biz.business_name.slice(0, 35).padEnd(35)} `)

      const data = await scrapeData(page, biz.business_name, biz.website)

      const hasNew = (data.photos && !biz.metadata?.photos) || (data.instagram && !biz.metadata?.instagram)

      if (hasNew) {
        const updatedMetadata = {
          ...biz.metadata,
          ...(data.photos && !biz.metadata?.photos ? { photos: data.photos } : {}),
          ...(data.instagram && !biz.metadata?.instagram ? { instagram: data.instagram } : {}),
          enriched_at: new Date().toISOString(),
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
      await new Promise(r => setTimeout(r, 400))
    }
  }

  await browser.close()

  // Log final stats
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

  const { count: remaining } = await supabase
    .from('businesses')
    .select('*', { count: 'exact', head: true })
    .eq('metadata->>project', 'lofficiel-concierge')
    .not('website', 'is', null)
    .or('metadata->>photos.is.null,metadata->>instagram.is.null')

  console.log('\n' + '═'.repeat(50))
  console.log('📊 ENRICHMENT COMPLETE')
  console.log(`   This run: ${totalEnriched} enriched / ${totalProcessed} processed`)
  console.log(`   Total with photos: ${withPhotos}`)
  console.log(`   Total with Instagram: ${withInstagram}`)
  console.log(`   Still remaining: ${remaining}`)
  console.log('═'.repeat(50))
}

main().catch(console.error)
