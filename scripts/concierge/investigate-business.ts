/**
 * 🔍 BUSINESS INVESTIGATOR
 *
 * Sur mesure discovery - understand WHAT it is first,
 * then ask the RIGHT questions for that business type.
 *
 * 5 W's Framework:
 * - WHO: Owner, staff, notable guests
 * - WHAT: Services, specialties, unique offerings
 * - WHERE: Location, views, access, nearby attractions
 * - WHEN: Hours, seasons, availability, best times
 * - WHY: What makes them special, reputation, reviews
 */

import { chromium, Page } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const OLLAMA_URL = 'http://localhost:11434'

// Business type definitions with specific questions
const BUSINESS_PROFILES = {
  villa: {
    keywords: ['villa', 'location', 'rental', 'property', 'maison'],
    questions: {
      who: ['Owner/agency?', 'Property manager?'],
      what: ['Bedrooms?', 'Pool?', 'Ocean view?', 'Staff included?', 'Amenities?'],
      where: ['Region?', 'Beach proximity?', 'Privacy level?', 'Sunset/sunrise views?'],
      when: ['Min stay?', 'Peak season rates?', 'Off-season rates?'],
      why: ['Unique features?', 'Celebrity guests?', 'Awards?'],
    },
    extract: ['bedrooms', 'bathrooms', 'pool', 'view', 'beach_distance', 'region', 'price_range', 'amenities'],
  },
  restaurant: {
    keywords: ['restaurant', 'dining', 'cuisine', 'chef', 'gastronomie'],
    questions: {
      who: ['Chef name?', 'Notable diners?'],
      what: ['Cuisine type?', 'Signature dishes?', 'Dress code?'],
      where: ['View?', 'Indoor/outdoor?', 'Parking?'],
      when: ['Hours?', 'Reservations needed?', 'Best nights?'],
      why: ['Awards?', 'Reviews?', 'What makes it special?'],
    },
    extract: ['cuisine_type', 'price_range', 'chef_name', 'dress_code', 'view', 'atmosphere', 'reservation_required'],
  },
  beach_club: {
    keywords: ['beach', 'plage', 'club', 'lounge'],
    questions: {
      who: ['Crowd type?', 'DJ/entertainment?'],
      what: ['Loungers?', 'Water sports?', 'Food service?'],
      where: ['Which beach?', 'Parking?', 'Boat access?'],
      when: ['Hours?', 'Events?', 'Best days?'],
      why: ['Vibe?', 'Famous for?'],
    },
    extract: ['beach_name', 'vibe', 'services', 'price_range', 'best_for', 'music_style'],
  },
  yacht: {
    keywords: ['yacht', 'boat', 'bateau', 'charter', 'nautique', 'marine'],
    questions: {
      who: ['Captain?', 'Crew size?'],
      what: ['Boat type?', 'Capacity?', 'Equipment?'],
      where: ['Destinations?', 'Pickup location?'],
      when: ['Availability?', 'Day trips vs multi-day?'],
      why: ['Special experiences?', 'Reviews?'],
    },
    extract: ['boat_type', 'capacity', 'crew_included', 'destinations', 'price_day', 'equipment'],
  },
  chef: {
    keywords: ['chef', 'traiteur', 'catering', 'private chef'],
    questions: {
      who: ['Chef background?', 'Training?'],
      what: ['Cuisine style?', 'Dietary accommodations?', 'Menu options?'],
      where: ['Service area?', 'Kitchen requirements?'],
      when: ['Lead time?', 'Events vs regular?'],
      why: ['Specialties?', 'Notable clients?'],
    },
    extract: ['cuisine_style', 'price_per_person', 'specialties', 'dietary_options', 'min_guests'],
  },
  spa: {
    keywords: ['spa', 'massage', 'wellness', 'beauty', 'soin'],
    questions: {
      who: ['Therapists?', 'Certifications?'],
      what: ['Treatments?', 'Products used?'],
      where: ['Hotel spa or standalone?', 'Home visits?'],
      when: ['Hours?', 'Advance booking?'],
      why: ['Signature treatments?', 'Unique approach?'],
    },
    extract: ['treatments', 'price_range', 'brands', 'home_service', 'specialties'],
  },
  boutique: {
    keywords: ['boutique', 'shop', 'mode', 'fashion', 'jewelry', 'bijoux'],
    questions: {
      who: ['Brands carried?', 'Owner/designer?'],
      what: ['Product types?', 'Price range?', 'Unique items?'],
      where: ['Location?', 'Nearby shops?'],
      when: ['Hours?', 'Seasonal collections?'],
      why: ['Known for?', 'Celebrity shoppers?'],
    },
    extract: ['brands', 'product_types', 'price_range', 'style', 'unique_offerings'],
  },
  transport: {
    keywords: ['car', 'voiture', 'transfer', 'taxi', 'rent', 'location'],
    questions: {
      who: ['Driver included?'],
      what: ['Vehicle types?', 'Fleet size?'],
      where: ['Pickup/dropoff?', 'Island-wide?'],
      when: ['Availability?', 'Advance booking?'],
      why: ['Reviews?', 'Reliability?'],
    },
    extract: ['vehicle_types', 'driver_included', 'price_day', 'airport_transfer'],
  },
}

async function askOllama(prompt: string, expectJson = false): Promise<any> {
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
    const text = data.response || ''

    if (expectJson) {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      return jsonMatch ? JSON.parse(jsonMatch[0]) : null
    }
    return text.trim()
  } catch {
    return expectJson ? null : ''
  }
}

function identifyBusinessType(name: string, category: string): string {
  const combined = `${name} ${category}`.toLowerCase()

  for (const [type, profile] of Object.entries(BUSINESS_PROFILES)) {
    for (const keyword of profile.keywords) {
      if (combined.includes(keyword)) {
        return type
      }
    }
  }
  return 'general'
}

async function investigateBusiness(page: Page, business: any): Promise<any> {
  const name = business.business_name
  const category = business.metadata?.category_fr || ''
  const businessType = identifyBusinessType(name, category)
  const profile = BUSINESS_PROFILES[businessType as keyof typeof BUSINESS_PROFILES]

  console.log(`\n🔍 INVESTIGATING: ${name}`)
  console.log(`   Type: ${businessType.toUpperCase()}`)

  const findings: any = {
    business_type: businessType,
    investigated_at: new Date().toISOString(),
  }

  // PHASE 1: Gather raw information
  let rawInfo = ''

  // 1a. Scrape their website if available
  if (business.website) {
    console.log(`   📄 Reading website...`)
    try {
      await page.goto(business.website, { waitUntil: 'networkidle', timeout: 20000 })
      rawInfo += await page.evaluate(() => document.body.innerText.slice(0, 8000))

      // Extract social links while we're here
      const socials = await page.evaluate(() => {
        const links: any = {}
        document.querySelectorAll('a[href]').forEach(a => {
          const href = (a as HTMLAnchorElement).href
          if (href.includes('instagram.com/')) {
            const match = href.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)
            if (match && !['p', 'reel', 'stories'].includes(match[1])) {
              links.instagram = `https://instagram.com/${match[1]}`
            }
          }
          if (href.includes('facebook.com/')) links.facebook = href.split('?')[0]
          if (href.includes('tripadvisor.')) links.tripadvisor = href.split('?')[0]
        })
        return links
      })
      Object.assign(findings, socials)

      // Extract high-quality photos from website
      const photos = await page.evaluate(() => {
        const imgs: string[] = []
        const seen = new Set<string>()

        // Priority 1: Open Graph image
        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
        if (ogImage && !seen.has(ogImage)) {
          imgs.push(ogImage)
          seen.add(ogImage)
        }

        // Priority 2: Hero/banner images
        document.querySelectorAll('img').forEach(img => {
          const imgEl = img as HTMLImageElement
          const src = imgEl.src || imgEl.getAttribute('data-src') || ''
          if (src && !seen.has(src) && imgEl.naturalWidth > 400 && imgEl.naturalHeight > 300) {
            if (!src.includes('logo') && !src.includes('icon') && !src.includes('sprite') && !src.includes('avatar')) {
              imgs.push(src)
              seen.add(src)
            }
          }
        })

        return imgs.slice(0, 5)
      })

      if (photos.length > 0) {
        findings.photos = photos
        console.log(`      📸 Found ${photos.length} photos`)
      }

    } catch (e: any) {
      console.log(`      ⚠️ Website error: ${e.message.slice(0, 40)}`)
    }
  }

  // 1b. Google search for more context
  console.log(`   🔍 Researching online...`)
  try {
    await page.goto(
      `https://www.google.com/search?q="${encodeURIComponent(name)}" saint barthelemy`,
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    )
    await new Promise(r => setTimeout(r, 1500))

    const searchText = await page.evaluate(() => document.body.innerText.slice(0, 4000))
    rawInfo += '\n\nGoogle results:\n' + searchText

    // Look for Instagram in search results
    if (!findings.instagram) {
      const igLink = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'))
        for (const link of links) {
          if (link.href.includes('instagram.com/')) {
            const match = link.href.match(/instagram\.com\/([a-zA-Z0-9_.]+)/)
            if (match && !['p', 'reel', 'stories', 'explore'].includes(match[1])) {
              return `https://instagram.com/${match[1]}`
            }
          }
        }
        return null
      })
      if (igLink) findings.instagram = igLink
    }

  } catch {}

  // PHASE 2: Analyze with Ollama
  if (rawInfo.length > 200 && profile) {
    console.log(`   🤖 Analyzing with AI...`)

    const extractFields = profile.extract.join(', ')
    const analysisPrompt = `
You are analyzing a ${businessType} business in St. Barthélemy called "${name}".

Here is information gathered about them:
${rawInfo.slice(0, 5000)}

Extract the following fields: ${extractFields}

Also answer:
- What makes this business special or unique?
- What type of clientele do they target?
- Price positioning (budget/mid/luxury/ultra-luxury)?

Respond ONLY with a JSON object containing the extracted fields and your analysis.
Example format:
{
  "cuisine_type": "French-Caribbean",
  "price_range": "luxury",
  "unique_factor": "Beachfront sunset views",
  "target_clientele": "Couples and special occasions",
  ...
}
`

    const analysis = await askOllama(analysisPrompt, true)
    if (analysis) {
      Object.assign(findings, analysis)
      console.log(`   ✨ Extracted ${Object.keys(analysis).length} data points`)
    }
  }

  // PHASE 3: Find Instagram if still missing
  if (!findings.instagram) {
    console.log(`   📸 Searching for Instagram...`)

    // Try specific Instagram search
    try {
      await page.goto(
        `https://www.google.com/search?q=${encodeURIComponent(name + ' st barth site:instagram.com')}`,
        { waitUntil: 'domcontentloaded', timeout: 10000 }
      )
      await new Promise(r => setTimeout(r, 1000))

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
        findings.instagram = `https://instagram.com/${igHandle}`
        findings.instagram_handle = igHandle
        console.log(`   ✅ Found: @${igHandle}`)
      }
    } catch {}
  }

  // Log findings summary
  const keyFindings = Object.entries(findings)
    .filter(([k, v]) => v && k !== 'investigated_at')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 30) : v}`)
    .slice(0, 5)

  if (keyFindings.length > 0) {
    console.log(`   📋 Key findings: ${keyFindings.join(', ')}`)
  }

  return findings
}

async function main() {
  console.log('═'.repeat(70))
  console.log('🕵️  ST. BARTH BUSINESS INVESTIGATOR')
  console.log('   Sur mesure discovery - understanding each business deeply')
  console.log('═'.repeat(70))

  // Check Ollama
  let ollamaOk = false
  try {
    await fetch(`${OLLAMA_URL}/api/tags`)
    ollamaOk = true
    console.log('✅ Ollama ready for AI analysis')
  } catch {
    console.log('⚠️  Ollama not running - limited analysis')
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1280, height: 720 },
  })
  const page = await context.newPage()

  // Get businesses - prioritize tourist-facing ones
  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, business_name, website, phone, city, metadata')
    .eq('metadata->>project', 'lofficiel-concierge')
    .or(
      'metadata->>category_fr.ilike.%RESTAURANT%,' +
      'metadata->>category_fr.ilike.%HOTEL%,' +
      'metadata->>category_fr.ilike.%VILLA%,' +
      'metadata->>category_fr.ilike.%YACHT%,' +
      'metadata->>category_fr.ilike.%PLAGE%,' +
      'metadata->>category_fr.ilike.%SPA%,' +
      'metadata->>category_fr.ilike.%CHEF%,' +
      'metadata->>category_fr.ilike.%BOUTIQUE%'
    )
    .is('metadata->>investigated_at', null)
    .order('business_name')

  if (error) {
    console.error('DB Error:', error)
    await browser.close()
    return
  }

  console.log(`\n📋 ${businesses?.length || 0} tourist-facing businesses to investigate`)
  console.log('─'.repeat(70))

  const startTime = Date.now()
  let processed = 0
  let enriched = 0

  for (const biz of businesses || []) {
    try {
      const findings = await investigateBusiness(page, biz)

      // Update database
      const updatedMetadata = {
        ...biz.metadata,
        ...findings,
      }

      await supabase
        .from('businesses')
        .update({ metadata: updatedMetadata })
        .eq('id', biz.id)

      processed++
      if (findings.instagram || Object.keys(findings).length > 3) {
        enriched++
      }

    } catch (e: any) {
      console.log(`   ❌ Error: ${e.message}`)
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 3000))

    // Progress report
    if (processed % 20 === 0) {
      const mins = Math.round((Date.now() - startTime) / 60000)
      console.log(`\n${'─'.repeat(70)}`)
      console.log(`📊 ${processed} processed | ${enriched} enriched | ${mins}min elapsed`)
      console.log(`${'─'.repeat(70)}`)
    }
  }

  await browser.close()

  const totalMins = Math.round((Date.now() - startTime) / 60000)
  console.log('\n' + '═'.repeat(70))
  console.log('✨ INVESTIGATION COMPLETE')
  console.log(`   Processed: ${processed}`)
  console.log(`   Enriched: ${enriched}`)
  console.log(`   Duration: ${totalMins} minutes`)
  console.log('═'.repeat(70))
}

main().catch(console.error)
