/**
 * Overnight Business Enrichment
 * Uses Playwright (headless) + Ollama for intelligent scraping
 *
 * Run: dotenvx run -- npx tsx scripts/concierge/enrich-overnight.ts
 */

import { chromium, Browser, Page } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLLAMA_URL = 'http://localhost:11434'

interface EnrichmentResult {
  instagram?: string
  facebook?: string
  tiktok?: string
  description?: string
  cuisine_type?: string
  price_range?: string
  photos?: string[]
  hours?: string
  phone_verified?: string
}

async function askOllama(prompt: string): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt,
        stream: false,
      }),
    })
    const data = await response.json()
    return data.response || ''
  } catch (e) {
    console.error('Ollama error:', e)
    return ''
  }
}

async function scrapeBusiness(page: Page, url: string): Promise<EnrichmentResult> {
  const result: EnrichmentResult = {}

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    // Get page content
    const content = await page.content()
    const text = await page.evaluate(() => document.body.innerText.slice(0, 5000))

    // Extract social links directly from HTML
    const socialLinks = await page.evaluate(() => {
      const links: string[] = []
      document.querySelectorAll('a[href]').forEach(a => {
        const href = (a as HTMLAnchorElement).href
        if (href.includes('instagram.com') ||
            href.includes('facebook.com') ||
            href.includes('tiktok.com')) {
          links.push(href)
        }
      })
      return links
    })

    // Parse social links
    for (const link of socialLinks) {
      if (link.includes('instagram.com/') && !result.instagram) {
        const match = link.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)
        if (match && !['p', 'reel', 'stories', 'explore'].includes(match[1])) {
          result.instagram = `https://instagram.com/${match[1]}`
        }
      }
      if (link.includes('facebook.com/') && !result.facebook) {
        result.facebook = link.split('?')[0]
      }
      if (link.includes('tiktok.com/') && !result.tiktok) {
        result.tiktok = link.split('?')[0]
      }
    }

    // Get images
    const images = await page.evaluate(() => {
      const imgs: string[] = []
      document.querySelectorAll('img').forEach(img => {
        if (img.src && img.naturalWidth > 200) {
          imgs.push(img.src)
        }
      })
      return imgs.slice(0, 5)
    })
    if (images.length > 0) {
      result.photos = images
    }

    // Use Ollama to extract structured info
    if (text.length > 100) {
      const ollamaPrompt = `Analyze this restaurant/business webpage text and extract:
1. Type of cuisine or service
2. Price range ($ to $$$$)
3. Brief description (1-2 sentences)
4. Operating hours if mentioned

Text:
${text.slice(0, 3000)}

Respond in JSON format only:
{"cuisine_type": "", "price_range": "", "description": "", "hours": ""}`

      const ollamaResponse = await askOllama(ollamaPrompt)

      try {
        // Try to parse JSON from response
        const jsonMatch = ollamaResponse.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          if (parsed.cuisine_type) result.cuisine_type = parsed.cuisine_type
          if (parsed.price_range) result.price_range = parsed.price_range
          if (parsed.description) result.description = parsed.description
          if (parsed.hours) result.hours = parsed.hours
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

  } catch (e: any) {
    console.error(`   Error scraping: ${e.message}`)
  }

  return result
}

async function searchGoogleForInstagram(page: Page, businessName: string): Promise<string | null> {
  try {
    const query = `${businessName} st barth instagram`
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    })

    // Look for Instagram link in results
    const instagram = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'))
      for (const link of links) {
        const href = link.href
        if (href.includes('instagram.com/')) {
          const match = href.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)
          if (match && !['p', 'reel', 'stories', 'explore', 'accounts'].includes(match[1])) {
            return match[1]
          }
        }
      }
      return null
    })

    return instagram
  } catch (e) {
    return null
  }
}

async function main() {
  console.log('🌙 Starting overnight enrichment...')
  console.log('━'.repeat(50))

  // Check Ollama
  try {
    await fetch(`${OLLAMA_URL}/api/tags`)
    console.log('✅ Ollama is running')
  } catch {
    console.log('⚠️  Ollama not running - will skip AI analysis')
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  })
  const page = await context.newPage()

  // Get all businesses to enrich
  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, business_name, website, phone, email, city, metadata')
    .eq('metadata->>project', 'lofficiel-concierge')
    .order('business_name')

  if (error) {
    console.error('DB Error:', error)
    await browser.close()
    return
  }

  console.log(`📋 Found ${businesses?.length || 0} businesses to process`)
  console.log('━'.repeat(50))

  let enriched = 0
  let instagramsFound = 0
  const startTime = Date.now()

  for (const [index, biz] of (businesses || []).entries()) {
    const progress = `[${index + 1}/${businesses?.length}]`
    console.log(`\n${progress} ${biz.business_name}`)

    const updates: EnrichmentResult = {}

    // Skip if already fully enriched
    if (biz.metadata?.instagram && biz.metadata?.enriched_complete) {
      console.log('   ⏭️  Already enriched')
      continue
    }

    // 1. Try website if available
    if (biz.website && !biz.metadata?.instagram) {
      console.log(`   🌐 Checking website: ${biz.website}`)
      const siteData = await scrapeBusiness(page, biz.website)
      Object.assign(updates, siteData)
    }

    // 2. If no Instagram found, try Google search
    if (!updates.instagram && !biz.metadata?.instagram) {
      console.log(`   🔍 Searching Google for Instagram...`)
      const handle = await searchGoogleForInstagram(page, biz.business_name)
      if (handle) {
        updates.instagram = `https://instagram.com/${handle}`
        console.log(`   ✅ Found: @${handle}`)
        instagramsFound++
      }
    }

    // 3. Update database
    if (Object.keys(updates).length > 0) {
      const updatedMetadata = {
        ...biz.metadata,
        ...updates,
        enriched_at: new Date().toISOString(),
        enriched_complete: true,
      }

      await supabase
        .from('businesses')
        .update({ metadata: updatedMetadata })
        .eq('id', biz.id)

      enriched++
      console.log(`   💾 Saved updates`)
    }

    // Rate limit - 3 seconds between businesses
    await new Promise(r => setTimeout(r, 3000))

    // Progress report every 50
    if ((index + 1) % 50 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000 / 60)
      console.log(`\n📊 Progress: ${index + 1} processed, ${enriched} enriched, ${instagramsFound} Instagrams found (${elapsed}min elapsed)`)
    }
  }

  await browser.close()

  const totalTime = Math.round((Date.now() - startTime) / 1000 / 60)
  console.log('\n' + '━'.repeat(50))
  console.log('✨ ENRICHMENT COMPLETE')
  console.log(`   Total processed: ${businesses?.length}`)
  console.log(`   Enriched: ${enriched}`)
  console.log(`   Instagrams found: ${instagramsFound}`)
  console.log(`   Time: ${totalTime} minutes`)
}

main().catch(console.error)
