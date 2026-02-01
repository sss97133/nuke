/**
 * Deep Social Finder - Aggressively finds ALL social accounts
 * St. Barth tourism businesses WILL have social presence
 *
 * Strategies:
 * 1. Scrape their website for social links
 * 2. Google: "[name] st barth instagram"
 * 3. Google: "[name] saint barthelemy"
 * 4. Search Instagram directly
 * 5. Check Facebook page for linked Instagram
 * 6. Check TripAdvisor listing for social links
 * 7. Use Ollama to analyze and suggest handles
 */

import { chromium, Browser, Page } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLLAMA_URL = 'http://localhost:11434'

interface SocialProfiles {
  instagram?: string
  instagram_handle?: string
  facebook?: string
  tiktok?: string
  youtube?: string
  tripadvisor?: string
  google_maps?: string
}

async function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms))
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
  } catch {
    return ''
  }
}

function extractInstagramHandle(text: string): string | null {
  // Various patterns to find Instagram handles
  const patterns = [
    /instagram\.com\/([a-zA-Z0-9_.]{1,30})/i,
    /@([a-zA-Z0-9_.]{1,30})\s*(?:on\s+)?(?:instagram|insta)/i,
    /instagram[:\s]+@?([a-zA-Z0-9_.]{1,30})/i,
    /ig[:\s]+@?([a-zA-Z0-9_.]{1,30})/i,
  ]

  const blacklist = ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'about', 'legal', 'privacy', 'help', 'direct']

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match[1] && !blacklist.includes(match[1].toLowerCase())) {
      return match[1].toLowerCase()
    }
  }
  return null
}

async function scrapeWebsiteForSocial(page: Page, url: string): Promise<SocialProfiles> {
  const profiles: SocialProfiles = {}

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 })
    await delay(1000)

    // Get all links
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'))
      return anchors.map(a => (a as HTMLAnchorElement).href).filter(h => h.startsWith('http'))
    })

    // Also get text content for @mentions
    const bodyText = await page.evaluate(() => document.body.innerText)

    // Parse links
    for (const link of links) {
      if (link.includes('instagram.com/') && !profiles.instagram) {
        const handle = extractInstagramHandle(link)
        if (handle) {
          profiles.instagram = `https://instagram.com/${handle}`
          profiles.instagram_handle = handle
        }
      }
      if (link.includes('facebook.com/') && !profiles.facebook) {
        profiles.facebook = link.split('?')[0]
      }
      if (link.includes('tiktok.com/@') && !profiles.tiktok) {
        profiles.tiktok = link.split('?')[0]
      }
      if (link.includes('youtube.com/') && !profiles.youtube) {
        profiles.youtube = link.split('?')[0]
      }
      if (link.includes('tripadvisor.') && !profiles.tripadvisor) {
        profiles.tripadvisor = link.split('?')[0]
      }
      if (link.includes('google.com/maps') && !profiles.google_maps) {
        profiles.google_maps = link
      }
    }

    // Check body text for @mentions
    if (!profiles.instagram) {
      const handle = extractInstagramHandle(bodyText)
      if (handle) {
        profiles.instagram = `https://instagram.com/${handle}`
        profiles.instagram_handle = handle
      }
    }

  } catch (e: any) {
    console.log(`      Website error: ${e.message.slice(0, 50)}`)
  }

  return profiles
}

async function searchGoogle(page: Page, query: string): Promise<string[]> {
  try {
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    })
    await delay(1500)

    // Get all result links
    const links = await page.evaluate(() => {
      const results: string[] = []
      document.querySelectorAll('a').forEach(a => {
        const href = a.href
        if (href && !href.includes('google.com')) {
          results.push(href)
        }
      })
      return results
    })

    return links
  } catch {
    return []
  }
}

async function searchInstagramDirectly(page: Page, businessName: string): Promise<string | null> {
  try {
    // Clean business name for search
    const searchName = businessName
      .replace(/st\.?\s*barth?s?/i, '')
      .replace(/saint\s*barth/i, '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()

    await page.goto(`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(searchName + ' st barth')}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    })
    await delay(2000)

    // This might get blocked, fallback to Google
    const content = await page.content()
    const handle = extractInstagramHandle(content)
    return handle

  } catch {
    return null
  }
}

async function findSocialProfiles(page: Page, business: any): Promise<SocialProfiles> {
  const profiles: SocialProfiles = {}
  const name = business.business_name
  const city = business.city || ''

  console.log(`   📍 ${name}`)

  // Strategy 1: Check their website
  if (business.website) {
    console.log(`      🌐 Checking website...`)
    const websiteProfiles = await scrapeWebsiteForSocial(page, business.website)
    Object.assign(profiles, websiteProfiles)
  }

  // Strategy 2: Google search for Instagram
  if (!profiles.instagram) {
    console.log(`      🔍 Google: "${name} st barth instagram"`)
    const results = await searchGoogle(page, `${name} st barth instagram site:instagram.com`)

    for (const link of results) {
      if (link.includes('instagram.com/')) {
        const handle = extractInstagramHandle(link)
        if (handle) {
          profiles.instagram = `https://instagram.com/${handle}`
          profiles.instagram_handle = handle
          break
        }
      }
    }
  }

  // Strategy 3: Broader Google search
  if (!profiles.instagram) {
    console.log(`      🔍 Google: "${name} saint barthelemy"`)
    const results = await searchGoogle(page, `"${name}" saint barthelemy instagram OR @`)

    for (const link of results) {
      if (link.includes('instagram.com/')) {
        const handle = extractInstagramHandle(link)
        if (handle) {
          profiles.instagram = `https://instagram.com/${handle}`
          profiles.instagram_handle = handle
          break
        }
      }
    }
  }

  // Strategy 4: Try variations of the name
  if (!profiles.instagram) {
    // Remove common suffixes and try
    const simpleName = name
      .replace(/st\.?\s*barth?s?/i, '')
      .replace(/restaurant/i, '')
      .replace(/hotel/i, '')
      .replace(/beach/i, '')
      .trim()

    if (simpleName.length > 3) {
      console.log(`      🔍 Google: "${simpleName}" instagram`)
      const results = await searchGoogle(page, `"${simpleName}" instagram saint barthelemy`)

      for (const link of results) {
        if (link.includes('instagram.com/')) {
          const handle = extractInstagramHandle(link)
          if (handle) {
            profiles.instagram = `https://instagram.com/${handle}`
            profiles.instagram_handle = handle
            break
          }
        }
      }
    }
  }

  // Strategy 5: Use Ollama to suggest likely handles
  if (!profiles.instagram) {
    console.log(`      🤖 Asking Ollama for suggestions...`)
    const suggestion = await askOllama(`
A business in St. Barth called "${name}" in ${city || 'St Barth'}.
What would their Instagram handle likely be?
Just respond with the most likely handle, nothing else.
Examples: bonito.stbarth, shellona_stbarth, nikki_beach_stbarth
Your answer:`)

    const suggestedHandle = suggestion.trim().replace('@', '').toLowerCase()
    if (suggestedHandle && suggestedHandle.length > 3 && suggestedHandle.length < 30) {
      // Verify this handle exists
      console.log(`      🔍 Verifying @${suggestedHandle}...`)
      try {
        const response = await fetch(`https://www.instagram.com/${suggestedHandle}/`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        })
        if (response.ok) {
          const html = await response.text()
          if (!html.includes("Sorry, this page isn't available")) {
            profiles.instagram = `https://instagram.com/${suggestedHandle}`
            profiles.instagram_handle = suggestedHandle
          }
        }
      } catch {}
    }
  }

  // Log result
  if (profiles.instagram) {
    console.log(`      ✅ Found: @${profiles.instagram_handle}`)
  } else {
    console.log(`      ❌ No Instagram found`)
  }

  return profiles
}

async function main() {
  console.log('🔥 DEEP SOCIAL FINDER')
  console.log('Finding ALL social profiles for St. Barth businesses')
  console.log('═'.repeat(60))

  // Check Ollama
  let ollamaAvailable = false
  try {
    await fetch(`${OLLAMA_URL}/api/tags`)
    ollamaAvailable = true
    console.log('✅ Ollama available for smart suggestions')
  } catch {
    console.log('⚠️  Ollama not running - will skip AI suggestions')
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox']
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  })

  const page = await context.newPage()

  // Get businesses without Instagram (or with not_found)
  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, business_name, website, phone, city, metadata')
    .eq('metadata->>project', 'lofficiel-concierge')
    .or('metadata->>instagram.is.null,metadata->>instagram.eq.not_found')
    .order('business_name')

  if (error) {
    console.error('DB Error:', error)
    await browser.close()
    return
  }

  const total = businesses?.length || 0
  console.log(`\n📋 ${total} businesses need social profiles`)
  console.log('═'.repeat(60))

  let found = 0
  let failed = 0
  const startTime = Date.now()

  for (const [i, biz] of (businesses || []).entries()) {
    console.log(`\n[${i + 1}/${total}]`)

    try {
      const profiles = await findSocialProfiles(page, biz)

      // Update database
      const updatedMetadata = {
        ...biz.metadata,
        ...profiles,
        social_searched_at: new Date().toISOString(),
      }

      await supabase
        .from('businesses')
        .update({ metadata: updatedMetadata })
        .eq('id', biz.id)

      if (profiles.instagram) {
        found++
      } else {
        failed++
      }

    } catch (e: any) {
      console.log(`   ⚠️  Error: ${e.message}`)
      failed++
    }

    // Rate limit
    await delay(2000 + Math.random() * 1000)

    // Progress every 25
    if ((i + 1) % 25 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 60000)
      const rate = found / (i + 1) * 100
      console.log(`\n${'─'.repeat(60)}`)
      console.log(`📊 Progress: ${i + 1}/${total} | Found: ${found} (${rate.toFixed(0)}%) | ${elapsed}min`)
      console.log(`${'─'.repeat(60)}`)
    }
  }

  await browser.close()

  const totalTime = Math.round((Date.now() - startTime) / 60000)
  console.log('\n' + '═'.repeat(60))
  console.log('🎉 COMPLETE')
  console.log(`   Processed: ${total}`)
  console.log(`   Instagram found: ${found} (${(found/total*100).toFixed(1)}%)`)
  console.log(`   Not found: ${failed}`)
  console.log(`   Time: ${totalTime} minutes`)
  console.log('═'.repeat(60))
}

main().catch(console.error)
