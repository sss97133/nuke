/**
 * Targeted enrichment for tourism businesses (hotels, restaurants, chefs)
 * Gets photos and Instagram specifically for customer-facing services
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function scrapeBusinessData(page: any, name: string, website?: string): Promise<any> {
  const data: any = {}

  // Try website first
  if (website) {
    try {
      await page.goto(website, { waitUntil: 'domcontentloaded', timeout: 15000 })
      await new Promise(r => setTimeout(r, 1000))

      // Get photos
      const photos = await page.evaluate(() => {
        const imgs: string[] = []
        const seen = new Set<string>()

        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
        if (ogImage && ogImage.startsWith('http')) {
          imgs.push(ogImage)
          seen.add(ogImage)
        }

        document.querySelectorAll('img').forEach(img => {
          const imgEl = img as HTMLImageElement
          const src = imgEl.src || imgEl.getAttribute('data-src') || ''
          if (src && src.startsWith('http') && !seen.has(src) && imgEl.naturalWidth > 200) {
            if (!src.includes('logo') && !src.includes('icon')) {
              imgs.push(src)
              seen.add(src)
            }
          }
        })

        return imgs.slice(0, 3)
      })

      if (photos.length > 0) data.photos = photos

      // Get Instagram from website
      const instagram = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="instagram.com"]'))
        for (const link of links) {
          const href = (link as HTMLAnchorElement).href
          const match = href.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)
          if (match && !['p', 'reel', 'stories', 'explore'].includes(match[1])) {
            return `https://instagram.com/${match[1]}`
          }
        }
        return null
      })

      if (instagram) data.instagram = instagram

    } catch (e) {
      // Website failed, continue to Google
    }
  }

  // Google search for Instagram if not found
  if (!data.instagram) {
    try {
      await page.goto(
        `https://www.google.com/search?q=${encodeURIComponent(name + ' st barth instagram site:instagram.com')}`,
        { waitUntil: 'domcontentloaded', timeout: 10000 }
      )
      await new Promise(r => setTimeout(r, 1500))

      const igHandle = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'))
        for (const link of links) {
          if (link.href.includes('instagram.com/')) {
            const match = link.href.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)
            if (match && !['p', 'reel', 'stories', 'explore', 'accounts'].includes(match[1])) {
              return match[1]
            }
          }
        }
        return null
      })

      if (igHandle) {
        data.instagram = `https://instagram.com/${igHandle}`
      }
    } catch {}
  }

  return data
}

async function main() {
  console.log('🎯 TOURISM BUSINESS ENRICHMENT')
  console.log('═'.repeat(50))

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  })
  const page = await context.newPage()

  // Get hotels, restaurants, chefs without complete data
  const { data: businesses } = await supabase
    .from('businesses')
    .select('*')
    .eq('metadata->>project', 'lofficiel-concierge')
    .or('metadata->>category_fr.ilike.%RESTAURANT%,metadata->>category_fr.ilike.%HOTEL%,metadata->>category_fr.ilike.%CHEF%,metadata->>category_fr.ilike.%PLAGE%,metadata->>category_fr.ilike.%YACHT%,metadata->>category_fr.ilike.%BATEAU%')
    .or('metadata->>photos.is.null,metadata->>instagram.is.null')
    .limit(50)

  console.log(`\n📋 ${businesses?.length || 0} tourism businesses to enrich\n`)

  let enriched = 0
  for (const [i, biz] of (businesses || []).entries()) {
    // Skip if already has both photos and instagram
    if (biz.metadata?.photos && biz.metadata?.instagram) continue

    process.stdout.write(`[${i+1}/${businesses?.length}] ${biz.business_name.slice(0, 35).padEnd(35)}`)

    const data = await scrapeBusinessData(page, biz.business_name, biz.website)

    if (Object.keys(data).length > 0) {
      await supabase
        .from('businesses')
        .update({
          metadata: {
            ...biz.metadata,
            ...data,
            enriched_at: new Date().toISOString(),
          }
        })
        .eq('id', biz.id)

      enriched++
      const found = []
      if (data.photos) found.push(`${data.photos.length} photos`)
      if (data.instagram) found.push(`@${data.instagram.split('/').pop()}`)
      console.log(` ✅ ${found.join(', ')}`)
    } else {
      console.log(' ❌')
    }

    await new Promise(r => setTimeout(r, 2000))
  }

  await browser.close()

  console.log('\n' + '═'.repeat(50))
  console.log(`✨ Enriched ${enriched} tourism businesses`)
}

main().catch(console.error)
