/**
 * FB Marketplace DOM Extractor for Claude in Chrome
 *
 * Run this via mcp__claude-in-chrome__javascript_tool on any
 * facebook.com/marketplace/item/{id}/ page (logged in or out).
 *
 * Returns the exact shape needed for ingest_marketplace_listing / direct mode.
 *
 * Data extraction priority:
 *   1. Relay store JSON (most structured, logged-in only)
 *   2. Visible DOM elements (universal)
 *   3. og: meta tags (fallback)
 */
(function extractFBMarketplaceListing() {
  "use strict";

  const result = {
    facebook_id: null,
    url: null,
    title: null,
    price: null,
    description: null,
    location: null,
    parsed_year: null,
    parsed_make: null,
    parsed_model: null,
    mileage: null,
    exterior_color: null,
    interior_color: null,
    transmission: null,
    fuel_type: null,
    image_url: null,
    all_images: [],
    seller_name: null,
    contact_info: null,
    status: "active",
    _extraction_method: [],
  };

  // ── facebook_id from URL ──────────────────────────────────────────────────
  const urlMatch = location.href.match(/marketplace\/item\/([A-Za-z0-9_]+)/);
  if (!urlMatch) {
    return { error: "Not a FB Marketplace listing page", url: location.href };
  }
  result.facebook_id = urlMatch[1];
  result.url = `https://www.facebook.com/marketplace/item/${result.facebook_id}/`;

  // ── Make map for normalization ────────────────────────────────────────────
  const MAKE_MAP = {
    chevy: "Chevrolet", chevrolet: "Chevrolet", ford: "Ford", dodge: "Dodge",
    gmc: "GMC", toyota: "Toyota", honda: "Honda", nissan: "Nissan",
    mazda: "Mazda", subaru: "Subaru", mitsubishi: "Mitsubishi",
    jeep: "Jeep", ram: "Ram", chrysler: "Chrysler", plymouth: "Plymouth",
    pontiac: "Pontiac", buick: "Buick", oldsmobile: "Oldsmobile",
    cadillac: "Cadillac", lincoln: "Lincoln", mercury: "Mercury",
    amc: "AMC", studebaker: "Studebaker", datsun: "Datsun",
    volkswagen: "Volkswagen", vw: "Volkswagen", porsche: "Porsche",
    mercedes: "Mercedes-Benz", "mercedes-benz": "Mercedes-Benz",
    bmw: "BMW", audi: "Audi", volvo: "Volvo", saab: "Saab",
    jaguar: "Jaguar", triumph: "Triumph", mg: "MG",
    "alfa romeo": "Alfa Romeo", alfa: "Alfa Romeo", fiat: "Fiat",
    ferrari: "Ferrari", maserati: "Maserati", lamborghini: "Lamborghini",
    lexus: "Lexus", acura: "Acura", infiniti: "Infiniti",
    hyundai: "Hyundai", kia: "Kia", international: "International",
    willys: "Willys", delorean: "DeLorean", shelby: "Shelby",
    "land rover": "Land Rover", mini: "Mini",
  };

  function parseTitle(title) {
    const r = { year: null, make: null, model: null };
    if (!title) return r;

    // Strip leading price junk and FB's middot/bullet separators
    const cleaned = title
      .replace(/[·•—–|]/g, " ")
      .replace(/&#x[0-9a-fA-F]+;/g, " ")
      .replace(/^\$[\d,]+\s*/g, "")
      .replace(/[A-Z][a-z]+,\s*[A-Z]{2}.*$/g, "")
      .replace(/\d+[Kk]\s*miles.*$/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const yearMatch = cleaned.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
    r.year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    if (!r.year) return r;

    const afterYear = cleaned.split(String(r.year))[1]?.trim() || "";
    const words = afterYear.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return r;

    const rawMake = words[0].toLowerCase();
    r.make = MAKE_MAP[rawMake] ||
      words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();

    const stopWords = [
      "pickup", "truck", "sedan", "coupe", "wagon", "van", "suv",
      "convertible", "hatchback", "cab", "door", "bed", "ton", "series",
      "runs", "drives", "project", "restored", "original", "clean", "rare",
    ];
    const modelParts = [];
    for (let i = 1; i < Math.min(words.length, 5); i++) {
      const lower = words[i].toLowerCase();
      if (stopWords.includes(lower)) break;
      if (/^[A-Z][a-z]+,$/.test(words[i])) break;
      modelParts.push(words[i]);
      if (modelParts.length >= 2) break;
    }
    r.model = modelParts.length > 0 ? modelParts.join(" ") : null;
    return r;
  }

  // ── 1. Try Relay Store (logged-in pages embed structured data) ────────────
  function tryRelayStore() {
    try {
      // FB embeds relay data in script tags as require("RelayPrefetchedStreamCache")
      // or in __RELAY_STORE__ or in data-sjs attributes
      const scripts = document.querySelectorAll("script[type='application/json']");
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          // Walk the tree looking for marketplace_listing or product_item
          const found = findListingInTree(data, 3);
          if (found) return found;
        } catch (e) { /* skip unparseable scripts */ }
      }

      // Also check require("ScheduledServerJS").handle calls
      const allScripts = document.querySelectorAll("script:not([src])");
      for (const script of allScripts) {
        const text = script.textContent || "";
        // Look for marketplace_listing_title in raw text
        if (text.includes("marketplace_listing_title")) {
          const titleMatch = text.match(/"marketplace_listing_title"\s*:\s*"([^"]+)"/);
          const priceMatch = text.match(/"amount"\s*:\s*"([\d.]+)"/);
          const cityMatch = text.match(/"city"\s*:\s*"([^"]+)"/);
          const stateMatch = text.match(/"state"\s*:\s*"([^"]+)"/);
          if (titleMatch) {
            return {
              title: decodeUnicodeEscapes(titleMatch[1]),
              price: priceMatch ? parseFloat(priceMatch[1]) : null,
              location: cityMatch && stateMatch
                ? `${decodeUnicodeEscapes(cityMatch[1])}, ${stateMatch[1]}`
                : null,
            };
          }
        }
      }
    } catch (e) { /* relay store not available */ }
    return null;
  }

  function findListingInTree(obj, maxDepth) {
    if (maxDepth <= 0 || !obj || typeof obj !== "object") return null;
    if (obj.marketplace_listing_title) {
      return {
        title: obj.marketplace_listing_title,
        price: obj.listing_price?.amount ? parseFloat(obj.listing_price.amount) : null,
        location: obj.location?.reverse_geocode
          ? `${obj.location.reverse_geocode.city || ""}, ${obj.location.reverse_geocode.state || ""}`.trim()
          : null,
        description: obj.redacted_description?.text || obj.description?.text || null,
        seller_name: obj.marketplace_listing_seller?.name || null,
        image_uri: obj.primary_listing_photo?.image?.uri || null,
        all_image_uris: obj.listing_photos?.edges?.map(e => e?.node?.image?.uri).filter(Boolean) || [],
        vehicle_info: obj.vehicle_info || null,
        is_sold: obj.is_sold || false,
        is_pending: obj.is_pending || false,
      };
    }
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        for (const item of obj[key]) {
          const found = findListingInTree(item, maxDepth - 1);
          if (found) return found;
        }
      } else if (typeof obj[key] === "object") {
        const found = findListingInTree(obj[key], maxDepth - 1);
        if (found) return found;
      }
    }
    return null;
  }

  function decodeUnicodeEscapes(s) {
    return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
  }

  // ── 2. DOM extraction (works logged-in and partially logged-out) ──────────
  function extractFromDOM() {
    const data = {};

    // Title: first large heading or span in the main content area
    // FB uses role="main" for listing content
    const main = document.querySelector("[role='main']") || document.body;

    // Title — often the first prominent text element
    // FB Marketplace uses <span> inside heading-like divs
    const titleCandidates = main.querySelectorAll("span");
    for (const span of titleCandidates) {
      const text = span.textContent?.trim();
      if (!text || text.length < 8 || text.length > 200) continue;
      // Title typically has year + make pattern
      if (/\b(19[2-9]\d|20[0-3]\d)\b/.test(text) && text.split(/\s+/).length >= 2) {
        // Check it's not a tiny font / metadata span
        const style = window.getComputedStyle(span);
        const fontSize = parseFloat(style.fontSize);
        if (fontSize >= 16) {
          data.title = text;
          break;
        }
      }
    }

    // Price — look for $X,XXX pattern in prominent position
    const pricePattern = /^\$[\d,]+$/;
    for (const span of titleCandidates) {
      const text = span.textContent?.trim();
      if (!text) continue;
      if (pricePattern.test(text)) {
        const style = window.getComputedStyle(span);
        const fontSize = parseFloat(style.fontSize);
        if (fontSize >= 18) {
          data.price = parseInt(text.replace(/[$,]/g, ""), 10);
          break;
        }
      }
    }
    // Also check for "Free" or "$0"
    if (!data.price) {
      for (const span of titleCandidates) {
        const text = span.textContent?.trim();
        if (text === "Free") { data.price = 0; break; }
      }
    }

    // Description — typically in a longer text block, often after "Description" or "Seller's description"
    const descHeaders = [...main.querySelectorAll("span")].filter(el => {
      const t = el.textContent?.trim().toLowerCase();
      return t === "description" || t === "seller's description" || t === "details";
    });
    for (const header of descHeaders) {
      // Walk up to the section container, then find the next text block
      let parent = header.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        const nextSibling = parent.nextElementSibling;
        if (nextSibling) {
          const descText = nextSibling.textContent?.trim();
          if (descText && descText.length > 20) {
            data.description = descText;
            break;
          }
        }
        parent = parent.parentElement;
      }
      if (data.description) break;
    }

    // If no description found via header, look for the longest text block
    if (!data.description) {
      let longestText = "";
      const allDivs = main.querySelectorAll("div, span");
      for (const el of allDivs) {
        if (el.children.length > 3) continue; // skip containers
        const text = el.textContent?.trim();
        if (text && text.length > longestText.length && text.length > 50 && text.length < 5000) {
          // Avoid navigation text, button labels
          if (!text.includes("Marketplace") || text.length > 200) {
            longestText = text;
          }
        }
      }
      if (longestText.length > 80) data.description = longestText;
    }

    // Location — look for "City, ST" pattern near the price
    for (const span of titleCandidates) {
      const text = span.textContent?.trim();
      if (!text) continue;
      const locMatch = text.match(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z]{2})$/);
      if (locMatch) {
        data.location = text;
        break;
      }
    }

    // Seller name — look for profile link near "Seller" text
    const sellerSection = [...main.querySelectorAll("span")].find(el =>
      el.textContent?.trim().toLowerCase() === "seller"
    );
    if (sellerSection) {
      let parent = sellerSection.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        const links = parent.querySelectorAll("a[href*='/marketplace/profile/'], a[href*='/user/']");
        if (links.length > 0) {
          data.seller_name = links[0].textContent?.trim();
          break;
        }
        parent = parent.parentElement;
      }
    }

    // Images — gather all scontent/fbcdn images from img tags
    const images = new Set();
    const allImgs = document.querySelectorAll("img[src*='scontent'], img[src*='fbcdn']");
    for (const img of allImgs) {
      const src = img.src;
      if (!src) continue;
      // Filter out tiny images, emojis, profile pics
      if (src.includes("emoji") || src.includes("_s.") || src.includes("_t.")) continue;
      if (src.includes("profile") || src.includes("rsrc.php")) continue;
      // Check natural dimensions — listing images are typically 600px+
      if (img.naturalWidth > 0 && img.naturalWidth < 100) continue;
      images.add(src);
    }
    // Also check background images in style attributes (FB carousel uses these)
    const bgDivs = main.querySelectorAll("div[style*='background-image']");
    for (const div of bgDivs) {
      const bg = div.style.backgroundImage;
      const bgMatch = bg.match(/url\("?(https:\/\/[^")\s]+)"?\)/);
      if (bgMatch && (bgMatch[1].includes("scontent") || bgMatch[1].includes("fbcdn"))) {
        images.add(bgMatch[1]);
      }
    }
    data.all_images = [...images];
    data.image_url = data.all_images[0] || null;

    // Vehicle details section — FB sometimes shows structured attributes
    const detailLabels = ["condition", "mileage", "transmission", "fuel type",
      "exterior color", "interior color", "body style", "clean title"];
    const spans = main.querySelectorAll("span");
    for (const span of spans) {
      const text = span.textContent?.trim().toLowerCase();
      if (!text) continue;

      for (const label of detailLabels) {
        if (text === label) {
          // The value is usually the next sibling span or in the parent's next sibling
          let valueEl = span.parentElement?.nextElementSibling ||
            span.nextElementSibling;
          if (!valueEl) {
            // Try parent's parent's next sibling
            valueEl = span.parentElement?.parentElement?.nextElementSibling;
          }
          const value = valueEl?.textContent?.trim();
          if (!value) continue;

          switch (label) {
            case "mileage":
              const miles = parseInt(value.replace(/[^\d]/g, ""), 10);
              if (miles > 0 && miles < 1000000) data.mileage = miles;
              break;
            case "transmission":
              data.transmission = value.toLowerCase();
              break;
            case "fuel type":
              data.fuel_type = value.toLowerCase();
              break;
            case "exterior color":
              data.exterior_color = value;
              break;
            case "interior color":
              data.interior_color = value;
              break;
          }
        }
      }
    }

    return data;
  }

  // ── 3. Meta tag fallback ──────────────────────────────────────────────────
  function extractFromMeta() {
    const data = {};
    const ogTitle = document.querySelector("meta[property='og:title']")?.content;
    const ogDesc = document.querySelector("meta[property='og:description']")?.content;
    const ogImage = document.querySelector("meta[property='og:image']")?.content;

    if (ogTitle) data.title = ogTitle;
    if (ogDesc) data.description = ogDesc;
    if (ogImage) data.image_url = ogImage;
    return data;
  }

  // ── Merge all sources ─────────────────────────────────────────────────────
  const relay = tryRelayStore();
  const dom = extractFromDOM();
  const meta = extractFromMeta();

  // Priority: relay > DOM > meta for each field
  function pick(field, ...sources) {
    for (const src of sources) {
      if (src && src[field] != null && src[field] !== "") return src[field];
    }
    return null;
  }

  result.title = pick("title", relay, dom, meta);
  result.price = pick("price", relay, dom);
  result.description = pick("description", relay, dom, meta);
  result.location = pick("location", relay, dom);
  result.seller_name = pick("seller_name", relay, dom);
  result.image_url = pick("image_url", relay, dom, meta);

  // Images: merge all sources, dedupe
  const allImgs = new Set();
  if (result.image_url) allImgs.add(result.image_url);
  if (relay?.all_image_uris) relay.all_image_uris.forEach(u => allImgs.add(u));
  if (dom?.all_images) dom.all_images.forEach(u => allImgs.add(u));
  if (meta?.image_url) allImgs.add(meta.image_url);
  result.all_images = [...allImgs].slice(0, 20);
  if (!result.image_url && result.all_images.length > 0) {
    result.image_url = result.all_images[0];
  }

  // Structured vehicle details (prefer DOM structured fields, fall back to relay vehicle_info)
  result.mileage = dom?.mileage || null;
  result.exterior_color = dom?.exterior_color || null;
  result.interior_color = dom?.interior_color || null;
  result.transmission = dom?.transmission || null;
  result.fuel_type = dom?.fuel_type || null;

  // If relay has vehicle_info (rare but valuable)
  if (relay?.vehicle_info) {
    const vi = relay.vehicle_info;
    if (vi.year && !result.parsed_year) result.parsed_year = vi.year;
    if (vi.make && !result.parsed_make) result.parsed_make = vi.make;
    if (vi.model && !result.parsed_model) result.parsed_model = vi.model;
    if (vi.mileage?.value && !result.mileage) {
      result.mileage = parseInt(vi.mileage.value, 10);
    }
    if (vi.exterior_color && !result.exterior_color) {
      result.exterior_color = vi.exterior_color;
    }
    if (vi.interior_color && !result.interior_color) {
      result.interior_color = vi.interior_color;
    }
    if (vi.transmission && !result.transmission) {
      result.transmission = vi.transmission.toLowerCase();
    }
    if (vi.fuel_type && !result.fuel_type) {
      result.fuel_type = vi.fuel_type.toLowerCase();
    }
  }

  // Parse year/make/model from title if not from vehicle_info
  if (result.title && !result.parsed_year) {
    const parsed = parseTitle(result.title);
    result.parsed_year = parsed.year;
    result.parsed_make = parsed.make;
    result.parsed_model = parsed.model;
  }

  // Extract mileage from description if not found elsewhere
  if (!result.mileage && result.description) {
    const mileagePatterns = [
      /(\d{1,3}(?:,\d{3})*)\s*(?:miles?|mi)\b/i,
      /(\d+)[Kk]\s*(?:miles?|mi)?\b/,
      /mileage[:\s]*(\d{1,3}(?:,\d{3})*)/i,
    ];
    for (const p of mileagePatterns) {
      const m = result.description.match(p);
      if (m) {
        const raw = m[1].replace(/,/g, "");
        result.mileage = m[0].toLowerCase().includes("k")
          ? parseInt(raw, 10) * 1000
          : parseInt(raw, 10);
        break;
      }
    }
  }

  // Status: check if sold or pending
  if (relay?.is_sold) result.status = "sold";
  else if (relay?.is_pending) result.status = "pending";

  // Track which extraction methods yielded data
  if (relay) result._extraction_method.push("relay_store");
  if (Object.keys(dom).length > 0) result._extraction_method.push("dom");
  if (Object.keys(meta).length > 0) result._extraction_method.push("meta_tags");

  // Clean up internal field before returning
  const output = { ...result };
  delete output._extraction_method;
  output._meta = {
    extraction_methods: result._extraction_method,
    extracted_at: new Date().toISOString(),
    page_url: location.href,
    fields_found: Object.entries(output).filter(
      ([k, v]) => v != null && k !== "_meta" && v !== "active"
    ).length,
  };

  return output;
})();
