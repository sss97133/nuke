// Universal Vehicle URL Scraper
// Supports multiple marketplace sites with intelligent data extraction

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Detect the source
  const source = detectSource(url);

  console.log(`Scraping ${source} URL:`, url);

  try {
    let scrapedData;

    // Route to appropriate scraper based on source
    switch (source) {
      case 'Bring a Trailer':
        scrapedData = await scrapeBATListing(url);
        break;
      case 'Facebook Marketplace':
        scrapedData = await scrapeFacebookMarketplace(url);
        break;
      case 'Craigslist':
        scrapedData = await scrapeCraigslist(url);
        break;
      case 'AutoTrader':
      case 'Cars.com':
      case 'Hagerty':
      case 'Classic.com':
        scrapedData = await scrapeGenericListing(url, source);
        break;
      default:
        scrapedData = await scrapeGenericListing(url, 'Generic');
    }

    return res.status(200).json({
      success: true,
      data: scrapedData,
      source: source,
      listing_url: url
    });

  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to scrape listing'
    });
  }
}

function detectSource(url) {
  if (url.includes('bringatrailer.com')) return 'Bring a Trailer';
  if (url.includes('facebook.com/marketplace')) return 'Facebook Marketplace';
  if (url.includes('craigslist.org')) return 'Craigslist';
  if (url.includes('autotrader.com')) return 'AutoTrader';
  if (url.includes('cars.com')) return 'Cars.com';
  if (url.includes('hagerty.com')) return 'Hagerty';
  if (url.includes('classic.com')) return 'Classic.com';
  return 'Generic';
}

// BAT scraper (reuse existing logic)
async function scrapeBATListing(url) {
  const response = await fetch('/api/scrape-bat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`BAT scraping failed: ${response.statusText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'BAT scraping failed');
  }

  return result.data;
}

// Facebook Marketplace scraper
async function scrapeFacebookMarketplace(url) {
  try {
    const listingId = extractFacebookListingId(url);

    // Try to fetch the page content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Extract data from HTML using various strategies
    let title = '';
    let price = null;
    let location = '';
    let description = '';
    let year = null;
    let make = null;
    let model = null;

    // Try to extract title from meta tags or page title
    const titleMatches = [
      html.match(/<meta property="og:title" content="([^"]+)"/i),
      html.match(/<title[^>]*>([^<]+)</i),
      html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
    ];

    for (const match of titleMatches) {
      if (match && match[1]) {
        title = match[1].replace(/\s+/g, ' ').trim();
        // Remove common Facebook suffixes
        title = title.replace(/\s*-\s*Facebook\s*Marketplace.*$/i, '');
        title = title.replace(/\s*\|\s*Facebook.*$/i, '');
        break;
      }
    }

    // Extract price
    const priceMatches = [
      html.match(/["']price["']\s*:\s*["']?\$?([0-9,]+)/i),
      html.match(/\$([0-9,]+)/g),
      html.match(/price[^>]*>.*?\$([0-9,]+)/i)
    ];

    if (priceMatches[1] && priceMatches[1].length > 0) {
      // Get the first price that looks reasonable for a vehicle (> $1000)
      for (const priceMatch of priceMatches[1]) {
        const priceNum = parseInt(priceMatch.replace(/[$,]/g, ''));
        if (priceNum > 1000) {
          price = priceNum;
          break;
        }
      }
    } else if (priceMatches[0] && priceMatches[0][1]) {
      price = parseInt(priceMatches[0][1].replace(/,/g, ''));
    }

    // Extract description from meta tags
    const descMatches = [
      html.match(/<meta property="og:description" content="([^"]+)"/i),
      html.match(/<meta name="description" content="([^"]+)"/i)
    ];

    for (const match of descMatches) {
      if (match && match[1]) {
        description = match[1].replace(/\s+/g, ' ').trim();
        break;
      }
    }

    // Extract year from title or description
    const yearMatch = (title + ' ' + description).match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      year = parseInt(yearMatch[0]);
    }

    // Try to extract make/model from title
    if (title) {
      const commonMakes = [
        'Toyota', 'Honda', 'Ford', 'Chevrolet', 'BMW', 'Mercedes', 'Audi', 'Volkswagen',
        'Nissan', 'Hyundai', 'Kia', 'Mazda', 'Subaru', 'Lexus', 'Acura', 'Infiniti',
        'Porsche', 'Ferrari', 'Lamborghini', 'Bentley', 'Rolls-Royce', 'Maserati',
        'Jaguar', 'Land Rover', 'Volvo', 'Saab', 'Mini', 'Jeep', 'Dodge', 'Ram',
        'Cadillac', 'Buick', 'GMC', 'Lincoln', 'Chrysler', 'Tesla', 'Lucid', 'Rivian'
      ];

      const titleWords = title.split(/\s+/);

      for (const word of titleWords) {
        const makeMatch = commonMakes.find(make =>
          word.toLowerCase() === make.toLowerCase()
        );
        if (makeMatch) {
          make = makeMatch;

          // Try to find model (usually next 1-2 words after make)
          const makeIndex = titleWords.findIndex(w =>
            w.toLowerCase() === make.toLowerCase()
          );
          if (makeIndex >= 0 && makeIndex < titleWords.length - 1) {
            const possibleModel = titleWords.slice(makeIndex + 1, makeIndex + 3).join(' ');
            // Remove year if it's part of the model
            model = possibleModel.replace(/\b(19|20)\d{2}\b/, '').trim();
          }
          break;
        }
      }
    }

    // Extract location if available
    const locationMatch = html.match(/location[^>]*>([^<]+)</i) ||
                         html.match(/"location"[^}]*"name":\s*"([^"]+)"/i);
    if (locationMatch && locationMatch[1]) {
      location = locationMatch[1].trim();
    }

    return {
      make: make,
      model: model,
      year: year,
      vin: null,
      mileage: null, // Could be extracted with more complex parsing
      color: null,
      transmission: null,
      sale_price: price,
      title: title || 'Facebook Marketplace listing',
      description: description || 'No description available',
      source: 'Facebook Marketplace',
      listing_id: listingId,
      location: location,
      images: [], // Would need more complex extraction
      relationship_suggestion: 'discovered',
      extraction_note: `Extracted from Facebook Marketplace HTML. Title: "${title}", Price: ${price ? `$${price}` : 'Not found'}`
    };

  } catch (error) {
    console.error('Facebook scraping error:', error);

    // Fallback to basic URL parsing
    const listingId = extractFacebookListingId(url);

    return {
      make: null,
      model: null,
      year: null,
      vin: null,
      mileage: null,
      color: null,
      transmission: null,
      sale_price: null,
      title: 'Facebook Marketplace listing',
      description: 'Could not extract data from Facebook Marketplace - manual entry required',
      source: 'Facebook Marketplace',
      listing_id: listingId,
      images: [],
      relationship_suggestion: 'discovered',
      extraction_note: `Facebook scraping failed: ${error.message}`
    };
  }
}

// Craigslist scraper
async function scrapeCraigslist(url) {
  try {
    // Craigslist is more scrapable but still has some anti-bot measures
    // This is a basic implementation - production would need more sophistication

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(' - craigslist', '') : '';

    // Extract price
    const priceMatch = html.match(/\$(\d{1,3}(?:,\d{3})*)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

    // Extract basic vehicle info from title
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : null;

    // Simple make/model extraction (basic)
    const titleWords = title.split(' ').filter(word => word.length > 2);
    let make = null, model = null;

    if (titleWords.length >= 2) {
      make = titleWords[1]; // Usually after year
      model = titleWords.slice(2).join(' ');
    }

    return {
      make: make,
      model: model,
      year: year ? parseInt(year) : null,
      title: title,
      sale_price: price,
      source: 'Craigslist',
      description: 'Craigslist listing - verify data accuracy',
      relationship_suggestion: 'discovered',
      images: [], // Would need more complex extraction
      extraction_note: 'Basic data extraction from Craigslist'
    };

  } catch (error) {
    throw new Error('Craigslist scraping failed: ' + error.message);
  }
}

// Generic scraper for other sites
async function scrapeGenericListing(url, source) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : '';

    // Basic year extraction
    const yearMatch = html.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : null;

    return {
      make: null,
      model: null,
      year: year ? parseInt(year) : null,
      title: title,
      source: source,
      description: `${source} listing - manual data entry recommended`,
      relationship_suggestion: 'discovered',
      images: [],
      extraction_note: `Basic data extraction from ${source}`
    };

  } catch (error) {
    throw new Error(`${source} scraping failed: ${error.message}`);
  }
}

function extractFacebookListingId(url) {
  const match = url.match(/\/marketplace\/item\/(\d+)/);
  return match ? match[1] : null;
}