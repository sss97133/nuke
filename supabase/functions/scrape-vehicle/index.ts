import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
}

function isFacebookUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    return host === 'facebook.com' || host.endsWith('.facebook.com')
  } catch {
    return false
  }
}

function isFacebookMarketplaceUrl(url: string): boolean {
  const s = String(url || '')
  if (!isFacebookUrl(s)) return false
  return s.includes('/marketplace') || s.includes('/share/')
}

function parseFacebookListingId(url: string): string | null {
  const s = String(url || '')
  const m1 = s.match(/\/marketplace\/item\/(\d{5,})/i)
  if (m1?.[1]) return m1[1]
  const m2 = s.match(/[?&]item_id=(\d{5,})/i)
  if (m2?.[1]) return m2[1]
  return null
}

// Robust identity cleanup (prevents saving listing junk into make/model downstream).
function cleanModelName(raw: any): string | null {
  if (!raw) return null
  let s = String(raw).replace(/\s+/g, ' ').trim()
  if (!s) return null
  // L'Art de l'Automobile sometimes appends marketing/location fragments with asterisks:
  // "GTC4 Lusso V8 T *Available on the..." or "*Available in Geneva*".
  // Model should be just the model name; keep badges in metadata elsewhere.
  // Remove any balanced *...* segments (bounded) and any trailing unmatched "*..." segment.
  s = s.replace(/\s*\*[^*]{1,120}\*\s*/g, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/\s*\*[^*]{1,200}$/g, '').trim()
  // Remove common trailing "Available ..." fragments even when not wrapped in asterisks.
  s = s.replace(/\s+(available|available in|available on|disponible|available in switzerland|available in geneva)\b[\s\S]*$/i, '').trim()
  // Remove common “listing title junk”
  s = s.replace(/\s*-\s*\$[\d,]+(?:\.\d{2})?.*$/i, '').trim()
  s = s.replace(/\s*\(\s*Est\.\s*payment.*$/i, '').trim()
  s = s.replace(/\s*-\s*craigslist\b.*$/i, '').trim()
  // Remove trailing parenthetical location/dealer
  s = s.replace(/\s*\([^)]*\)\s*$/i, '').trim()
  if (!s || s.length > 140) return null
  return s
}

function cleanMakeName(raw: any): string | null {
  if (!raw) return null
  const s0 = String(raw).replace(/[/_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s0 || s0 === '*' || s0.length > 40) return null
  const lower = s0.toLowerCase()
  if (lower === 'chevy') return 'Chevrolet'
  if (lower === 'vw') return 'Volkswagen'
  if (lower === 'benz') return 'Mercedes'
  // Title-case-ish
  return s0
    .split(' ')
    .map((p) => (p.length <= 2 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()))
    .join(' ')
}

function normalizeImageUrls(urls: any[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of urls) {
    if (typeof raw !== 'string') continue
    let s = raw.trim()
    if (!s.startsWith('http')) continue
    // Prefer https (Cloudinary commonly returns http on older sites).
    if (s.startsWith('http://res.cloudinary.com/')) {
      s = 'https://' + s.slice('http://'.length)
    }
    const lower = s.toLowerCase()
    if (lower.includes('youtube.com')) continue
    if (lower.includes('logo') || lower.includes('icon') || lower.includes('avatar')) continue
    if (lower.endsWith('.svg')) continue
    // Craigslist thumbnails: 50x50c / other tiny thumbs
    if (lower.includes('_50x50')) continue
    if (lower.includes('94x63')) continue
    if (lower.includes('thumbnail')) continue
    if (!seen.has(s)) {
      out.push(s)
      seen.add(s)
    }
  }
  return out
}

function promoteBeverlyHillsCarClubImageUrl(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return s
  // Their gallery commonly uses suffixes like _s/_m/_l on jpgs; prefer large when possible.
  // Examples:
  // - .../1660/1660_main_l.jpg
  // - .../1660/1660_1_s.jpg  -> ..._l.jpg
  s = s.replace(/_(s|m)\.(jpg|jpeg|png)$/i, '_l.$2')
  return s
}

function extractBhccStockNoFromHtml(html: string): number | null {
  // BHCC exposes the numeric stock number reliably in the meta description:
  // "Used 1963 Alfa Romeo ... Stock # 17692 in Los Angeles, CA ..."
  const m = html.match(/Stock\s*#\s*(\d{1,10})/i)
  if (!m?.[1]) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

function parseBeverlyHillsCarClubListing(html: string, url: string): any {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Prefer the on-page H1 and meta description; BHCC pages are consistent here.
  const metaDesc =
    (doc?.querySelector('meta[name="description"]')?.getAttribute('content') || '')
      .replace(/\s+/g, ' ')
      .trim()

  const title =
    (doc?.querySelector('h1.listing-title')?.textContent || doc?.querySelector('h1')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()

  const priceText =
    (doc?.querySelector('.price')?.textContent || doc?.querySelector('[class*="price"]')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()

  const specs: Record<string, string> = {}
  const rows = Array.from(doc?.querySelectorAll('.listing-details-wrapper .detail-row') || [])
  for (const row of rows as any[]) {
    const label = (row.querySelector('.detail-label')?.textContent || '').replace(/\s+/g, ' ').replace(/:$/, '').trim()
    const value = (row.querySelector('.detail-value')?.textContent || '').replace(/\s+/g, ' ').trim()
    if (label && value) specs[label] = value
  }

  // Y/M/M: prefer explicit spec table; if missing, fall back to meta description and H1.
  let year = parseNumberLoose(specs['Year'] || '') || null
  let make = cleanMakeName(specs['Make']) || null
  let model = cleanModelName(specs['Model']) || null

  // VIN might be incomplete on some classic listings; still pass through if present.
  const vinRaw = (specs['VIN'] || specs['Vin'] || '').trim()
  const vin = vinRaw ? vinRaw.toUpperCase() : null

  const mileage = parseNumberLoose(specs['Mileage'] || specs['Miles'] || specs['Odometer'] || '') || null

  // Pull best-available images.
  const imageCandidates: string[] = []
  const galleryImgs = Array.from(doc?.querySelectorAll('.gallery-item img, .gallery img, img') || [])
  for (const img of galleryImgs as any[]) {
    const src = (img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy') || '').trim()
    if (!src) continue
    if (!src.includes('galleria_images')) continue
    imageCandidates.push(promoteBeverlyHillsCarClubImageUrl(src))
  }

  // Some BHCC pages include hi-res URLs in anchors.
  const galleryLinks = Array.from(doc?.querySelectorAll('a[href*="galleria_images"]') || [])
  for (const a of galleryLinks as any[]) {
    const href = (a.getAttribute('href') || '').trim()
    if (!href) continue
    imageCandidates.push(promoteBeverlyHillsCarClubImageUrl(href))
  }

  const images = normalizeImageUrls(imageCandidates)

  const description =
    (doc?.querySelector('.listing-description')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim() || null

  // Multi-word makes are common on BHCC. Prefer matching known multiword makes first.
  // (This is a pragmatic bridge until the OEM reference library is in place.)
  const MULTIWORD_MAKES = [
    'Mercedes-Benz',
    'Alfa Romeo',
    'Aston Martin',
    'Rolls-Royce',
    'Land Rover',
    'Range Rover',
    'Austin Healey',
    'Auto Union',
    'De Tomaso',
    'Willys Jeep',
  ]

  function parseYmmFromTitleLike(s: string): { year: number | null; make: string | null; model: string | null } {
    const cleaned = (s || '').replace(/\s+/g, ' ').trim()
    const m = cleaned.match(/^(\d{4})\s+(.+)$/)
    if (!m) return { year: null, make: null, model: null }
    const y = parseInt(m[1], 10)
    const rest = (m[2] || '').trim()
    if (!rest) return { year: Number.isFinite(y) ? y : null, make: null, model: null }

    for (const candidate of MULTIWORD_MAKES) {
      if (rest.toLowerCase().startsWith(candidate.toLowerCase() + ' ')) {
        const mm = rest.slice(candidate.length).trim()
        return {
          year: Number.isFinite(y) ? y : null,
          make: cleanMakeName(candidate),
          model: cleanModelName(mm),
        }
      }
    }

    const parts = rest.split(/\s+/).filter(Boolean)
    if (parts.length < 2) return { year: Number.isFinite(y) ? y : null, make: cleanMakeName(rest), model: null }
    const mk = parts[0]
    const mdl = parts.slice(1).join(' ')
    return {
      year: Number.isFinite(y) ? y : null,
      make: cleanMakeName(mk),
      model: cleanModelName(mdl),
    }
  }

  // Meta description is very reliable: "Used 1955 Mercedes-Benz 190SL Stock # 1068 ..."
  if ((!year || !make || !model) && metaDesc) {
    const md = metaDesc.match(/Used\s+(\d{4})\s+(.+?)\s+Stock\s*#\s*\d+/i)
    if (md?.[1] && md?.[2]) {
      const parsed = parseYmmFromTitleLike(`${md[1]} ${md[2]}`)
      year = year || parsed.year
      make = make || parsed.make
      model = model || parsed.model
    }
  }

  // If still missing, parse from H1 text.
  if ((!year || !make || !model) && title) {
    const parsed = parseYmmFromTitleLike(title)
    year = year || parsed.year
    make = make || parsed.make
    model = model || parsed.model
  }

  const bhcc_stockno = extractBhccStockNoFromHtml(html)

  return {
    source: 'beverlyhillscarclub',
    title,
    year: year || null,
    make: make || null,
    model: model || null,
    vin,
    asking_price: parseNumberLoose(priceText),
    mileage,
    images,
    thumbnail_url: images[0] || null,
    bhcc_stockno,
    specs,
    description,
  }
}

function parseNumberLoose(raw: string): number | null {
  const s = (raw || '').replace(/\u00a0/g, ' ').trim()
  if (!s) return null
  // Remove currency/units and keep digits.
  const digits = s.replace(/[^\d]/g, '')
  if (!digits) return null
  const n = parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

function parseYearFromText(raw: string): number | null {
  const m = String(raw || '').match(/\b(19|20)\d{2}\b/)
  if (!m?.[0]) return null
  const y = parseInt(m[0], 10)
  return Number.isFinite(y) ? y : null
}

function parseYmmFromTitleLike(raw: string): { year: number | null; make: string | null; model: string | null } {
  const cleaned = String(raw || '').replace(/\s+/g, ' ').trim()
  const m = cleaned.match(/^(\d{4})\s+(.+)$/)
  if (!m) return { year: null, make: null, model: null }

  const y = parseInt(m[1], 10)
  const rest = (m[2] || '').trim()
  if (!rest) return { year: Number.isFinite(y) ? y : null, make: null, model: null }

  const MULTIWORD_MAKES = ['Mercedes-Benz', 'Alfa Romeo', 'Aston Martin', 'Rolls-Royce', 'Land Rover', 'Range Rover']
  for (const candidate of MULTIWORD_MAKES) {
    if (rest.toLowerCase().startsWith(candidate.toLowerCase() + ' ')) {
      const mm = rest.slice(candidate.length).trim()
      return {
        year: Number.isFinite(y) ? y : null,
        make: cleanMakeName(candidate),
        model: cleanModelName(mm),
      }
    }
  }

  const parts = rest.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return { year: Number.isFinite(y) ? y : null, make: cleanMakeName(rest), model: null }
  const mk = parts[0]
  const mdl = parts.slice(1).join(' ')
  return {
    year: Number.isFinite(y) ? y : null,
    make: cleanMakeName(mk),
    model: cleanModelName(mdl),
  }
}

function splitLinesFromHtml(html: string): string[] {
  return (html || '')
    .replace(/\r/g, '')
    .split(/<br\s*\/?>/i)
    .map((x) => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function parseLartFiche(html: string, url: string): any {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const brand = doc?.querySelector('.carDetails-brand')?.textContent?.trim() || ''
  const modelRaw = doc?.querySelector('.carDetails-model')?.textContent?.trim() || ''
  const title = [brand, modelRaw].filter(Boolean).join(' ').trim()

  // Listing status: on sold listings, L'Art renders a badge (e.g. "Sold" / "Vendu")
  // inside the price block. This is more reliable than URL patterns.
  const soldBadgeText =
    (doc?.querySelector('.carDetail.-price .dataList-value--special')?.textContent ||
      doc?.querySelector('.dataList-value--special')?.textContent ||
      '').replace(/\s+/g, ' ').trim()
  const soldBadgeLower = soldBadgeText.toLowerCase()
  const isSold =
    soldBadgeLower === 'sold' ||
    soldBadgeLower === 'vendu' ||
    soldBadgeLower.includes('sold') ||
    soldBadgeLower.includes('vendu')

  // Hi-res images are in data-big/href; thumbnails are in src with Cloudinary transforms.
  const hiRes: string[] = []
  const thumbs: string[] = []
  const seenHi = new Set<string>()
  const seenTh = new Set<string>()
  const imgs = Array.from(doc?.querySelectorAll('img.carouselPicture') || [])
  for (const img of imgs as any[]) {
    const big = (img.getAttribute('data-big') || img.getAttribute('href') || '').trim()
    const src = (img.getAttribute('src') || '').trim()
    if (big && big.startsWith('http') && !seenHi.has(big)) {
      hiRes.push(big)
      seenHi.add(big)
    }
    if (src && src.startsWith('http') && !seenTh.has(src)) {
      thumbs.push(src)
      seenTh.add(src)
    }

    // Fallback: derive original Cloudinary URL from transformed thumbnail src.
    // Example:
    //   .../image/upload/c_fill,g_center,h_467,w_624/v172.../file.jpg
    // ->.../image/upload/v172.../file.jpg
    if (src && src.includes('res.cloudinary.com') && src.includes('/image/upload/')) {
      const httpsSrc = src.startsWith('http://res.cloudinary.com/') ? ('https://' + src.slice('http://'.length)) : src
      const m = httpsSrc.match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)([^/]+\/)?(v\d+\/.+)$/i)
      if (m && m[1] && m[3]) {
        const candidate = `${m[1]}${m[3]}`
        if (candidate.startsWith('http') && !seenHi.has(candidate)) {
          hiRes.push(candidate)
          seenHi.add(candidate)
        }
      }
    }
  }

  // Parse label/value pairs
  const dl = doc?.querySelector('dl.dataList')
  const dts = Array.from(dl?.querySelectorAll('dt') || [])
  const ddByLabel = new Map<string, any>()
  for (const dt of dts as any[]) {
    const label = (dt.textContent || '').replace(/\s+/g, ' ').trim()
    let dd = dt.nextElementSibling
    while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling
    if (label && dd) ddByLabel.set(label.toLowerCase(), dd)
  }

  const priceText = ddByLabel.get('prix')?.textContent || ''
  const mileageText = ddByLabel.get('km')?.textContent || ''
  const colorsText = ddByLabel.get('couleurs')?.textContent || ''
  const fuelText = ddByLabel.get('energie')?.textContent || ''
  const transmissionText = ddByLabel.get('boîte de vitesse')?.textContent || ddByLabel.get('boite de vitesse')?.textContent || ''
  const regDateText = ddByLabel.get('date de mise en circulation')?.textContent || ''

  const optionsDd = ddByLabel.get('options')
  const optionsHtml = optionsDd?.innerHTML || ''
  const options = splitLinesFromHtml(optionsHtml)

  const infoDd = ddByLabel.get('informations')
  const infoHtml = infoDd?.innerHTML || ''
  const infoParts = infoHtml.split(/<hr\s*\/?>/i)
  const frHtml = infoParts[0] || ''
  const enHtml = infoParts.slice(1).join('<hr>') || ''

  // Pull paragraphs in order from FR section
  const frDoc = new DOMParser().parseFromString(`<div>${frHtml}</div>`, 'text/html')
  const frParas = Array.from(frDoc?.querySelectorAll('p') || []).map((p: any) => (p.textContent || '').trim()).filter(Boolean)

  // First paragraph is typically bullet-ish (br-delimited in source); use HTML splitter for fidelity.
  const frBullets = splitLinesFromHtml(frHtml).slice(0, 20) // bounded

  // Service history: find the paragraph after "Suivi et entretien"
  let serviceHistory: string[] = []
  const followIdx = frParas.findIndex((p) => p.toLowerCase().includes('suivi') && p.toLowerCase().includes('entretien'))
  if (followIdx >= 0 && frParas[followIdx + 1]) {
    serviceHistory = frParas[followIdx + 1]
      .split(/\n|<br\s*\/?>/i)
      .map((x) => x.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }

  // Narrative description: take paragraphs after service history block.
  const narrativeStart = followIdx >= 0 ? Math.min(frParas.length, followIdx + 2) : 0
  const descriptionFr = frParas.slice(narrativeStart).join('\n\n').trim()

  const enDoc = new DOMParser().parseFromString(`<div>${enHtml}</div>`, 'text/html')
  const enParas = Array.from(enDoc?.querySelectorAll('p') || []).map((p: any) => (p.textContent || '').trim()).filter(Boolean)
  const descriptionEn = enParas.join('\n\n').trim()

  return {
    source: "lartdelautomobile",
    title,
    make: cleanMakeName(brand) || brand || null,
    model: cleanModelName(modelRaw) || modelRaw || null,
    // Status flags used by import queue to correctly tag dealer_inventory + org relationships
    listing_status: isSold ? 'sold' : 'in_stock',
    status: isSold ? 'sold' : null,
    sold: isSold,
    is_sold: isSold,
    sold_badge: soldBadgeText || null,
    asking_price: parseNumberLoose(priceText),
    mileage: parseNumberLoose(mileageText),
    // Also map into canonical vehicle fields used elsewhere (best-effort).
    fuel_type: fuelText ? fuelText.replace(/\s+/g, ' ').trim() : null,
    color: colorsText ? colorsText.replace(/\s+/g, ' ').trim() : null,
    colors: colorsText ? colorsText.replace(/\s+/g, ' ').trim() : null,
    fuel: fuelText ? fuelText.replace(/\s+/g, ' ').trim() : null,
    transmission: transmissionText ? transmissionText.replace(/\s+/g, ' ').trim() : null,
    registration_date: regDateText ? regDateText.replace(/\s+/g, ' ').trim() : null,
    options,
    info_bullets: frBullets,
    service_history: serviceHistory,
    description_fr: descriptionFr || null,
    description_en: descriptionEn || null,
    images_hi_res: hiRes,
    image_thumbnails: thumbs,
  }
}

async function tryFirecrawl(url: string, waitForMs: number = 4000): Promise<any | null> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY')
  if (!FIRECRAWL_API_KEY) return null

  const extractionSchema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      year: { type: 'number' },
      make: { type: 'string' },
      model: { type: 'string' },
      trim: { type: 'string' },
      vin: { type: 'string' },
      asking_price: { type: 'number' },
      price: { type: 'number' },
      mileage: { type: 'number' },
      location: { type: 'string' },
      description: { type: 'string' },
      thumbnail_url: { type: 'string' },
      images: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  }

  try {
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ['extract', 'html'],
        extract: { schema: extractionSchema },
        onlyMainContent: false,
        waitFor: waitForMs,
      }),
    })

    if (!firecrawlResponse.ok) {
      const errorText = await firecrawlResponse.text().catch(() => '')
      console.warn(`Firecrawl HTTP error ${firecrawlResponse.status}: ${errorText?.slice(0, 200) || ''}`)
      return null
    }

    const firecrawlData = await firecrawlResponse.json()
    if (!firecrawlData?.success) {
      console.warn(`Firecrawl failed: ${JSON.stringify(firecrawlData)?.slice(0, 300)}`)
      return null
    }

    const extract = firecrawlData?.data?.extract || null
    if (!extract || typeof extract !== 'object') return null
    return extract
  } catch (e: any) {
    console.warn(`Firecrawl exception: ${e?.message || String(e)}`)
    return null
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('Scraping URL:', url)

    // Robust path: Firecrawl structured extraction first (works better on JS-heavy dealer sites).
    const firecrawlExtract = await tryFirecrawl(url, isFacebookMarketplaceUrl(url) ? 10000 : 4000)

    let html = ''
    let doc: any = null

    // Fallback path: fetch and parse HTML
    // NOTE: Some sites (like lartdelautomobile.com) require HTML parsing even when Firecrawl returns extract,
    // because the page contains hi-res image URLs in data attributes.
    const needsHtmlParse = url.includes('lartdelautomobile.com') || url.includes('beverlyhillscarclub.com')
    if (!firecrawlExtract || needsHtmlParse) {
      if (isFacebookMarketplaceUrl(url) && !firecrawlExtract) {
        const hasKey = Boolean(Deno.env.get('FIRECRAWL_API_KEY'))
        const msg = hasKey
          ? 'Facebook Marketplace scraping failed via Firecrawl (no extract returned).'
          : 'Facebook Marketplace scraping requires FIRECRAWL_API_KEY to be set for this edge function.'
        return new Response(JSON.stringify({ success: false, error: msg, data: null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        })
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      html = await response.text()
      doc = new DOMParser().parseFromString(html, 'text/html')
    }

    // Basic data extraction (normalized output shape)
    const data: any = {
      success: true,
      source: 'Unknown',
      listing_url: url,
      discovery_url: url,
      title: firecrawlExtract?.title || doc?.querySelector('title')?.textContent || '',
      description: '', // Initialize with empty string to prevent undefined
      images: [],
      timestamp: new Date().toISOString(),
      year: null,
      make: null,
      model: null,
      asking_price: null,
      location: null,
      thumbnail_url: null,
      platform: isFacebookMarketplaceUrl(url) ? 'facebook_marketplace' : null,
      listing_id: isFacebookMarketplaceUrl(url) ? parseFacebookListingId(url) : null,
      _function_version: firecrawlExtract ? '2.1-firecrawl' : '2.1-html'  // Debug version identifier
    }

    // If Firecrawl returned structured fields, use them as the primary truth.
    if (firecrawlExtract) {
      data.source = isFacebookMarketplaceUrl(url) ? 'Facebook Marketplace' : 'Firecrawl'
      data.year = typeof firecrawlExtract.year === 'number' ? firecrawlExtract.year : null
      data.make = cleanMakeName(firecrawlExtract.make) || null
      data.model = cleanModelName(firecrawlExtract.model) || null
      data.vin = firecrawlExtract.vin ? String(firecrawlExtract.vin).toUpperCase() : null
      data.asking_price =
        typeof firecrawlExtract.asking_price === 'number'
          ? firecrawlExtract.asking_price
          : typeof firecrawlExtract.price === 'number'
            ? firecrawlExtract.price
            : null
      data.location = firecrawlExtract.location ? String(firecrawlExtract.location).trim() : null
      data.description = firecrawlExtract.description ? String(firecrawlExtract.description).trim() : ''
      data.thumbnail_url = firecrawlExtract.thumbnail_url ? String(firecrawlExtract.thumbnail_url).trim() : null

      const imgs = normalizeImageUrls([
        ...(data.thumbnail_url ? [data.thumbnail_url] : []),
        ...(Array.isArray(firecrawlExtract.images) ? firecrawlExtract.images : []),
      ])
      data.images = imgs
    }

    // If Firecrawl didn’t yield images (or it wasn’t used), use HTML extraction.
    if ((!data.images || data.images.length === 0) && html) {
      data.images = normalizeImageUrls(extractImageURLs(html))
    }

    // Site-specific: L'Art de l'Automobile (/fiche/*) has structured spec blocks + explicit hi-res image URLs.
    if (url.includes('lartdelautomobile.com/fiche/') && html) {
      const parsed = parseLartFiche(html, url)
      data.source = parsed.source
      data.title = parsed.title || data.title
      data.make = parsed.make || data.make
      data.model = parsed.model || data.model
      data.asking_price = parsed.asking_price ?? data.asking_price
      data.mileage = parsed.mileage ?? data.mileage
      data.listing_status = parsed.listing_status ?? data.listing_status
      data.status = parsed.status ?? data.status
      data.sold = parsed.sold ?? data.sold
      data.is_sold = parsed.is_sold ?? data.is_sold
      data.sold_badge = parsed.sold_badge ?? data.sold_badge
      // Prefer French narrative as canonical description, but keep structured fields for repackaging.
      data.description = (parsed.description_fr || '').trim() || data.description || ''
      data.description_fr = parsed.description_fr
      data.description_en = parsed.description_en
      data.options = parsed.options
      data.info_bullets = parsed.info_bullets
      data.service_history = parsed.service_history
      data.colors = parsed.colors
      data.fuel_type = parsed.fuel_type || parsed.fuel
      data.transmission = parsed.transmission
      data.registration_date = parsed.registration_date

      const hires = normalizeImageUrls(parsed.images_hi_res || [])
      const thumbs = normalizeImageUrls(parsed.image_thumbnails || [])
      if (hires.length > 0) {
        data.images = hires
        data.thumbnail_url = thumbs[0] || hires[0] || data.thumbnail_url
      }
      data.image_thumbnails = thumbs
    }

    // Site-specific: Beverly Hills Car Club uses explicit galleria_images URLs and a structured details panel.
    // Firecrawl often under-returns hi-res images here, so prefer HTML parsing when available.
    if (url.includes('beverlyhillscarclub.com') && html) {
      const parsed = parseBeverlyHillsCarClubListing(html, url)
      data.source = parsed.source
      data.title = parsed.title || data.title
      data.year = parsed.year ?? data.year
      data.make = parsed.make || data.make
      data.model = parsed.model || data.model
      data.vin = parsed.vin || data.vin
      data.asking_price = parsed.asking_price ?? data.asking_price
      data.mileage = parsed.mileage ?? data.mileage
      data.description = parsed.description || data.description || ''
      data.specs = parsed.specs
      data.bhcc_stockno = parsed.bhcc_stockno ?? data.bhcc_stockno
      if (Array.isArray(parsed.images) && parsed.images.length > 0) {
        data.images = parsed.images
        data.thumbnail_url = parsed.thumbnail_url || parsed.images[0] || data.thumbnail_url
      }

      // Dealer identity (critical for org extraction in process-import-queue when ingesting single listings).
      data.dealer_name = 'Beverly Hills Car Club'
      data.dealer_website = 'https://www.beverlyhillscarclub.com'
    }

    // Extract VIN from HTML - works for multiple sites
    const vinPatterns = [
      // Pattern 1: Dealer listings with <span class="valu">VIN</span> (Jordan Motorsports pattern)
      /<span[^>]*class="[^"]*valu[^"]*"[^>]*>([A-HJ-NPR-Z0-9]{17})<\/span>/i,
      // Pattern 2: Worldwide Vintage Autos format: <div class="spec-line vin">VIN 1Z8749S420546</div>
      /<div[^>]*class="[^"]*spec-line[^"]*vin[^"]*"[^>]*>VIN\s+([A-HJ-NPR-Z0-9]{17})/i,
      // Pattern 3: General VIN pattern with class containing "vin"
      /<[^>]*class="[^"]*vin[^"]*"[^>]*>[\s\S]*?VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
      // Pattern 4: Simple VIN: pattern
      /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
      // Pattern 5: Any 17-char alphanumeric near "VIN" text
      /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
    ]

    for (const pattern of vinPatterns) {
      const match = html ? html.match(pattern) : null
      if (match && match[1] && match[1].length === 17 && !/[IOQ]/.test(match[1])) {
        data.vin = match[1].toUpperCase()
        console.log(`VIN extracted: ${data.vin}`)
        break
      }
    }

    // Simple Craigslist detection and parsing
    if (url.includes('craigslist.org')) {
      data.source = 'Craigslist'

      // Extract title
      const titleElement = doc?.querySelector('h1 .postingtitletext')
      if (titleElement) {
        data.title = titleElement.textContent?.trim()
      }

      // Extract price
      const priceElement = doc?.querySelector('.price')
      if (priceElement) {
        const priceText = priceElement.textContent?.trim()
        const priceMatch = priceText?.match(/\$?([\d,]+)/)
        if (priceMatch) {
          data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
        }
      }

      // Extract location
      const locationElement = doc?.querySelector('.postingtitle .postingtitletext small')
      if (locationElement) {
        data.location = locationElement.textContent?.trim().replace(/[()]/g, '')
      }

      // Extract description
      const bodyElement = doc?.querySelector('#postingbody')
      if (bodyElement) {
        data.description = bodyElement.textContent?.trim() || ''
      }

      // Extract dealer information from listing (for multi-city dealers like Jordan Motorsports)
      const dealerInfo = extractDealerInfo(html, data.description || '', data.title || '')
      if (dealerInfo.name) {
        data.dealer_name = dealerInfo.name
      }
      if (dealerInfo.website) {
        data.dealer_website = dealerInfo.website
      }
      if (dealerInfo.phone) {
        data.dealer_phone = dealerInfo.phone
      }

      // Extract basic vehicle info from title
      if (data.title) {
        const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
        if (yearMatch) {
          data.year = parseInt(yearMatch[0])
        }

        // Simple make/model extraction
        const parts = data.title.split(' ')
        if (parts.length >= 3) {
          // Skip year if it's the first part
          let startIndex = 0
          if (parts[0] && parts[0].match(/\b(19|20)\d{2}\b/)) {
            startIndex = 1
          }
          if (parts[startIndex]) data.make = parts[startIndex]
          if (parts[startIndex + 1]) data.model = parts[startIndex + 1]
        }
      }

      console.log('Craigslist extraction results:', {
        title: data.title,
        year: data.year,
        make: data.make,
        model: data.model,
        price: data.asking_price,
        location: data.location
      })
    }

    // Final normalization pass (regardless of source)
    data.make = cleanMakeName(data.make) || data.make
    data.model = cleanModelName(data.model) || data.model

    // Facebook Marketplace: best-effort title/description parsing if Firecrawl fields are sparse.
    if (isFacebookMarketplaceUrl(url)) {
      data.source = data.source === 'Unknown' ? 'Facebook Marketplace' : data.source
      if ((!data.year || !data.make || !data.model) && data.title) {
        const titleNoPrice = String(data.title).replace(/\s*-\s*\$[\d,]+(?:\.\d{2})?.*$/i, '').trim()
        const parsed = parseYmmFromTitleLike(titleNoPrice)
        data.year = data.year || parsed.year
        data.make = data.make || parsed.make
        data.model = data.model || parsed.model
      }
      if (!data.year && data.description) {
        data.year = parseYearFromText(data.description)
      }
    }

    // Worldwide Vintage Autos detection and parsing
    if (url.includes('worldwidevintageautos.com')) {
      data.source = 'Worldwide Vintage Autos'

      // Extract title
      const titleElement = doc.querySelector('h1') || doc.querySelector('title')
      if (titleElement) {
        data.title = titleElement.textContent?.trim()
      }

      // Extract price
      const priceElement = doc.querySelector('.price') || doc.querySelector('[class*="price"]')
      if (priceElement) {
        const priceText = priceElement.textContent?.trim()
        const priceMatch = priceText?.match(/\$?([\d,]+)/)
        if (priceMatch) {
          data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
        }
      }

      // Extract description - look for description divs or meta descriptions
      const descriptionElement = doc.querySelector('[class*="description"]') || 
                                 doc.querySelector('[id*="description"]') ||
                                 doc.querySelector('meta[name="description"]')
      if (descriptionElement) {
        if (descriptionElement.tagName === 'META') {
          data.description = descriptionElement.getAttribute('content')?.trim() || ''
        } else {
          data.description = descriptionElement.textContent?.trim() || ''
        }
      }

      // Also try to extract from spec lines (common format on dealer sites)
      const specLines = doc.querySelectorAll('[class*="spec"]')
      let descriptionParts: string[] = []
      specLines.forEach(spec => {
        const text = spec.textContent?.trim()
        if (text && text.length > 0 && !text.includes('VIN') && !text.includes('Price')) {
          descriptionParts.push(text)
        }
      })
      if (descriptionParts.length > 0 && !data.description) {
        data.description = descriptionParts.join(' ')
      }

      // Extract year, make, model from title
      if (data.title) {
        const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
        if (yearMatch) {
          data.year = parseInt(yearMatch[0])
        }

        const parts = data.title.split(' ')
        if (parts.length >= 3) {
          let startIndex = 0
          if (parts[0] && parts[0].match(/\b(19|20)\d{2}\b/)) {
            startIndex = 1
          }
          if (parts[startIndex]) data.make = parts[startIndex]
          if (parts[startIndex + 1]) data.model = parts.slice(startIndex + 1).join(' ')
        }
      }

      // Try to extract engine/transmission from description
      if (data.description) {
        // Engine patterns: "L82 350 V8", "350 V8", "5.7L V8", etc.
        const engineMatch = data.description.match(/([A-Z0-9]+\s*\d+\.?\d*\s*[LV]?\s*V?\d+)/i)
        if (engineMatch) {
          data.engine_type = engineMatch[1].trim()
        }

        // Transmission patterns: "AUTO", "AUTOMATIC", "MANUAL", "4-SPEED", etc.
        const transMatch = data.description.match(/\b(AUTO|AUTOMATIC|MANUAL|\d+-SPEED)\b/i)
        if (transMatch) {
          data.transmission = transMatch[1].toUpperCase()
          if (data.transmission === 'AUTO') {
            data.transmission = 'AUTOMATIC'
          }
        }
      }

      console.log('Worldwide Vintage Autos extraction results:', {
        title: data.title,
        year: data.year,
        make: data.make,
        model: data.model,
        vin: data.vin,
        price: data.asking_price,
        description: data.description?.substring(0, 100),
        engine_type: data.engine_type,
        transmission: data.transmission,
        imageCount: data.images?.length || 0
      })
    }

    // Return BOTH shapes for compatibility:
    // - Legacy scrape-vehicle: { success: true, ...fields }
    // - Some scripts: { success: true, data: {...fields} }
    // Also include success inside nested data so existing frontend shim continues to work.
    const responseBody = {
      ...data,
      data: { ...data },
      _metadata: {
        firecrawlUsed: Boolean(firecrawlExtract),
        htmlLength: html ? html.length : 0,
        fetchMethod: firecrawlExtract ? 'firecrawl' : html ? 'direct' : 'none',
      },
    }

    console.log('scrape-vehicle response summary:', {
      success: responseBody.success,
      source: responseBody.source,
      year: responseBody.year,
      make: responseBody.make,
      model: responseBody.model,
      imageCount: Array.isArray(responseBody.images) ? responseBody.images.length : 0,
      platform: responseBody.platform,
    })

    return new Response(
      JSON.stringify(responseBody),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Error in scrape-vehicle:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
        data: null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// Helper function to extract image URLs
function extractImageURLs(html: string): string[] {
  const images: string[] = []
  const seen = new Set<string>()
  
  // Pattern 1: Standard img tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let match

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1]
    if (src && !src.startsWith('data:') && !src.includes('icon') && !src.includes('logo')) {
      // Convert relative URLs to absolute
      let fullUrl = src
      if (src.startsWith('//')) {
        fullUrl = 'https:' + src
      } else if (src.startsWith('/')) {
        continue // Skip relative URLs without base
      } else if (src.startsWith('http')) {
        fullUrl = src
      } else {
        continue
      }
      
      if (!seen.has(fullUrl)) {
        images.push(fullUrl)
        seen.add(fullUrl)
      }
    }
  }

  // Pattern 2: Data attributes (for galleries) - data-src, data-lazy-src, etc.
  const dataSrcPatterns = [
    /<[^>]+data-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-lazy-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-original=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-image=["']([^"']+)["'][^>]*>/gi,
  ]
  
  for (const pattern of dataSrcPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const src = match[1]
      if (src && src.startsWith('http') && !seen.has(src)) {
        images.push(src)
        seen.add(src)
      }
    }
  }

  // Pattern 3: Background images in style attributes
  const bgImageRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/gi
  while ((match = bgImageRegex.exec(html)) !== null) {
    const src = match[1]
    if (src && src.startsWith('http') && !seen.has(src)) {
      images.push(src)
      seen.add(src)
    }
  }

  // Pattern 4: JSON data in script tags (for gallery systems)
  const jsonImagePatterns = [
    /"image":\s*"([^"]+)"/gi,
    /"url":\s*"([^"]+\.(jpg|jpeg|png|webp))"/gi,
    /"src":\s*"([^"]+\.(jpg|jpeg|png|webp))"/gi,
    /images:\s*\[([^\]]+)\]/gi,
  ]
  
  for (const pattern of jsonImagePatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const src = match[1]
      if (src && src.startsWith('http') && !seen.has(src)) {
        images.push(src)
        seen.add(src)
      }
    }
  }

  // Pattern 5: Worldwide Vintage Autos specific - dealeraccelerate CDN patterns
  // They use patterns like: cdn.dealeraccelerate.com/worldwide/1/9741/606782/1920x1440/w/1979-chevrolet-corvette
  const dealerAcceleratePattern = /https?:\/\/cdn\.dealeraccelerate\.com\/[^"'\s<>]+\.(jpg|jpeg|png|webp)/gi
  while ((match = dealerAcceleratePattern.exec(html)) !== null) {
    const src = match[0]
    if (src && !seen.has(src)) {
      images.push(src)
      seen.add(src)
    }
  }

  // Filter out junk images (thumbnails, icons, etc.) but keep larger sizes
  const filtered = images.filter(img => {
    const lower = img.toLowerCase()
    // Keep full-size images, filter out small thumbnails
    const isThumbnail = lower.includes('94x63') || 
                       lower.includes('thumbnail') || 
                       lower.includes('thumb/') ||
                       lower.match(/\/\d+x\d+[xp]\//) // Small size patterns like /94x63xp/
    
    return !isThumbnail &&
           !lower.includes('icon') && 
           !lower.includes('logo') &&
           !lower.includes('placeholder') &&
           !lower.includes('youtube.com') // YouTube thumbnails
  })

  // Sort by size (prefer larger images first)
  return filtered.sort((a, b) => {
    const aSize = extractImageSize(a)
    const bSize = extractImageSize(b)
    return (bSize || 0) - (aSize || 0)
  })
}

// Helper to extract image size from URL for sorting
function extractImageSize(url: string): number | null {
  const sizeMatch = url.match(/(\d+)x(\d+)/)
  if (sizeMatch) {
    return parseInt(sizeMatch[1]) * parseInt(sizeMatch[2])
  }
  return null
}

/**
 * Extract dealer information from Craigslist listing
 * Detects dealers who post across multiple cities (like Jordan Motorsports)
 */
function extractDealerInfo(html: string, description: string, title: string): {
  name: string | null
  website: string | null
  phone: string | null
} {
  const combinedText = `${title} ${description}`.toLowerCase()
  const result: { name: string | null; website: string | null; phone: string | null } = {
    name: null,
    website: null,
    phone: null
  }

  // Extract website URLs from HTML (dealers often include their site)
  const websitePatterns = [
    // Full URLs: https://www.jordanmotorsport.com
    /https?:\/\/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:com|net|org|us|io|co))/gi,
    // Without protocol: www.jordanmotorsport.com or jordanmotorsport.com
    /(?:^|\s)(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:com|net|org|us|io|co))(?:\s|$|[^\w.])/gi
  ]

  for (const pattern of websitePatterns) {
    const matches = html.match(pattern) || combinedText.match(pattern)
    if (matches) {
      // Filter out common non-dealer domains
      const excludeDomains = ['craigslist', 'facebook', 'google', 'youtube', 'instagram', 'twitter']
      for (const match of matches) {
        const cleanUrl = match.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase()
        const domain = cleanUrl.split('/')[0]
        if (!excludeDomains.some(ex => domain.includes(ex))) {
          result.website = `https://${cleanUrl}`
          break
        }
      }
      if (result.website) break
    }
  }

  // Extract dealer name from common patterns
  // Pattern 1: Business name followed by phone or website
  const namePatterns = [
    // "Jordan Motorsports" or "JORDAN MOTORSPORTS"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:MOTORSPORTS?|MOTORS?|AUTO|CLASSICS?|COLLECTION|PERFORMANCE)/i,
    // Dealer name before phone: "Name (555) 123-4567"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\(?\s*(\d{3})\s*\)?\s*(\d{3})[-\s]?(\d{4})/,
    // Name with website: "Name www.domain.com"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:www\.)?[a-z0-9-]+\.[a-z]+/i,
    // Uppercase dealer names: "JORDAN MOTORSPORTS" or "DESERT PERFORMANCE"
    /\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\s+(?:MOTORSPORTS?|MOTORS?|AUTO|CLASSICS?|PERFORMANCE)/,
  ]

  for (const pattern of namePatterns) {
    const match = combinedText.match(pattern) || html.match(pattern)
    if (match && match[1]) {
      const name = match[1].trim()
      // Filter out common false positives
      if (name.length > 3 && 
          !['View', 'Click', 'Call', 'Visit', 'Contact', 'Location', 'Mileage'].includes(name)) {
        result.name = name
        // Extract phone if present in same match
        if (match[2] && match[3] && match[4]) {
          result.phone = `(${match[2]}) ${match[3]}-${match[4]}`
        }
        break
      }
    }
  }

  // Extract phone number (if not already extracted)
  if (!result.phone) {
    const phonePattern = /\(?\s*(\d{3})\s*\)?\s*[-.\s]?\s*(\d{3})\s*[-.\s]?\s*(\d{4})/
    const phoneMatch = combinedText.match(phonePattern)
    if (phoneMatch) {
      result.phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`
    }
  }

  // If we found a website but no name, try to extract name from domain
  if (result.website && !result.name) {
    const domainMatch = result.website.match(/https?:\/\/(?:www\.)?([^.]+)/)
    if (domainMatch) {
      const domainName = domainMatch[1].replace(/-/g, ' ')
      // Convert "jordanmotorsport" -> "Jordan Motorsport"
      result.name = domainName
        .split(/(?=[A-Z])/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    }
  }

  return result
}