/**
 * Fast photo scraper - targets businesses with websites but no photos
 * Focuses on getting OG images and hero photos quickly
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function scrapePhotos(page: any, url: string): Promise<string[]> {
  const photos: string[] = []

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await new Promise(r => setTimeout(r, 1000))

    const images = await page.evaluate(() => {
      const imgs: string[] = []
      const seen = new Set<string>()

      // OG image first
      const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
      if (ogImage && ogImage.startsWith('http')) {
        imgs.push(ogImage)
        seen.add(ogImage)
      }

      // Large images
      document.querySelectorAll('img').forEach(img => {
        const imgEl = img as HTMLImageElement
        const src = imgEl.src || imgEl.getAttribute('data-src') || ''
        if (src && src.startsWith('http') && !seen.has(src)) {
          if (imgEl.naturalWidth > 300 || src.includes('hero') || src.includes('banner')) {
            if (!src.includes('logo') && !src.includes('icon') && !src.includes('avatar')) {
              imgs.push(src)
              seen.add(src)
            }
          }
        }
      })

      return imgs.slice(0, 3)
    })

    return images
  } catch {
    return []
  }
}

async function main() {
  console.log('📸 FAST PHOTO SCRAPER')
  console.log('═'.repeat(50))

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  // Get businesses with websites but no photos
  const { data: businesses } = await supabase
    .from('businesses')
    .select('id, business_name, website, metadata')
    .eq('metadata->>project', 'lofficiel-concierge')
    .not('website', 'is', null)
    .is('metadata->>photos', null)
    .limit(100)

  console.log(`\n🎯 ${businesses?.length || 0} businesses to scrape\n`)

  let found = 0
  for (const [i, biz] of (businesses || []).entries()) {
    if (!biz.website) continue

    process.stdout.write(`[${i+1}/${businesses?.length}] ${biz.business_name.slice(0, 30)}...`)

    const photos = await scrapePhotos(page, biz.website)

    if (photos.length > 0) {
      await supabase
        .from('businesses')
        .update({
          metadata: {
            ...biz.metadata,
            photos,
            photos_scraped_at: new Date().toISOString(),
          }
        })
        .eq('id', biz.id)

      found++
      console.log(` ✅ ${photos.length} photos`)
    } else {
      console.log(' ❌')
    }

    await new Promise(r => setTimeout(r, 500))
  }

  await browser.close()

  console.log('\n' + '═'.repeat(50))
  console.log(`✨ Done! Found photos for ${found} businesses`)
}

main().catch(console.error)
