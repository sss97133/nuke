// Dedicated extractor for Bring a Trailer
function extractFromBringATrailer() {
  // Title (usually at the top)
  const title = document.querySelector('h1.listing-title, h1')?.innerText.trim() || '';

  // Price (sold price, if available)
  let price = '';
  const priceNode = document.querySelector('.listing-auction-result .price, .auction-result .price');
  if (priceNode) price = priceNode.innerText.trim();
  else {
    // Try to find "Sold for USD $" or similar
    const soldText = Array.from(document.querySelectorAll('body *')).find(
      el => el.textContent && el.textContent.match(/Sold for (USD )?\$[\d,]+/)
    );
    if (soldText) price = soldText.textContent.match(/Sold for (USD )?\$[\d,]+/)[0];
  }

  // Main image gallery
  const images = Array.from(document.querySelectorAll('.gallery img, .listing-gallery img, .photo-gallery img'))
    .map(img => img.src)
    .filter(src => src && !src.includes('placeholder'));

  // Description (usually a big block of text)
  const descNode = document.querySelector('.listing-description, .auction-description, .description');
  const description = descNode ? descNode.innerText.trim() : '';

  // Key vehicle facts (try to extract from the "Make", "Model", etc. fields)
  function getFact(label) {
    const factLabel = Array.from(document.querySelectorAll('.listing-vehicle-attributes dt, dt'))
      .find(dt => dt.innerText.trim().toLowerCase() === label.toLowerCase());
    if (factLabel) {
      const dd = factLabel.nextElementSibling;
      if (dd && dd.tagName === 'DD') return dd.innerText.trim();
    }
    return '';
  }

  const make = getFact('Make');
  const model = getFact('Model');
  const year = title.match(/\b(19|20)\d{2}\b/) ? title.match(/\b(19|20)\d{2}\b/)[0] : '';
  const location = getFact('Location');
  const category = getFact('Category');
  const era = getFact('Era');
  const origin = getFact('Origin');

  // Auction info
  let auctionResult = '';
  const auctionResultNode = document.querySelector('.auction-result, .listing-auction-result');
  if (auctionResultNode) auctionResult = auctionResultNode.innerText.trim();

  // Return structured data
  return {
    site: 'Bring a Trailer',
    url: window.location.href,
    title,
    price,
    images,
    description,
    make,
    model,
    year,
    location,
    category,
    era,
    origin,
    auctionResult
  };
}

// Generic extractor for unknown sites
function extractGeneric() {
  const title = document.title;
  const images = Array.from(document.querySelectorAll('img')).map(img => img.src);
  const description = document.querySelector('meta[name="description"]')?.content || '';
  return {
    site: window.location.hostname,
    url: window.location.href,
    title,
    images,
    description
  };
}

// Dedicated extractor for Craigslist
function extractFromCraigslist() {
  // Title
  const title = document.querySelector('#titletextonly')?.innerText.trim() || document.title;

  // Price
  const price = document.querySelector('.price')?.innerText.trim() || '';

  // Images
  const images = Array.from(document.querySelectorAll('.slide img, .gallery img, img'))
    .map(img => img.src)
    .filter((src, idx, arr) => src && arr.indexOf(src) === idx);

  // Description
  const description = document.querySelector('#postingbody')?.innerText.replace(/^\s*QR Code Link to This Post\s*/i, '').trim() || '';

  // Location (city/region)
  const location = document.querySelector('.postingtitletext small')?.innerText.replace(/[()]/g, '').trim() || '';

  // Posting info (date, id)
  const postedDate = document.querySelector('time[datetime]')?.getAttribute('datetime') || '';
  let updatedDate = '';
  const timeTags = document.querySelectorAll('.postinginfo time');
  if (timeTags.length > 1) updatedDate = timeTags[1].getAttribute('datetime') || '';

  // Post ID
  let postId = '';
  const postIdNode = Array.from(document.querySelectorAll('.postinginfo')).find(el => el.innerText.includes('post id'));
  if (postIdNode) postId = postIdNode.innerText.match(/\d+/)?.[0] || '';

  // Parse vehicle facts
  const facts = {};
  Array.from(document.querySelectorAll('p.attrgroup span')).forEach(span => {
    const txt = span.innerText.trim();
    if (/^\d{4}\b/.test(txt)) facts.year = txt.match(/^\d{4}\b/)[0];
    if (/^odometer:/.test(txt)) facts.odometer = txt.replace('odometer:', '').trim();
    if (/^fuel:/.test(txt)) facts.fuel = txt.replace('fuel:', '').trim();
    if (/^title status:/.test(txt)) facts.title_status = txt.replace('title status:', '').trim();
    if (/^transmission:/.test(txt)) facts.transmission = txt.replace('transmission:', '').trim();
    // Try to catch make/model
    if (!facts.make && /^[a-zA-Z]{2,}/.test(txt) && !txt.includes(':')) {
      const parts = txt.split(' ');
      if (parts.length > 1) {
        facts.make = parts[1];
        facts.model = parts.slice(2).join(' ');
      }
    }
  });

  return {
    site: 'Craigslist',
    url: window.location.href,
    title,
    price,
    images,
    description,
    location,
    postedDate,
    updatedDate,
    postId,
    year: facts.year || '',
    make: facts.make || '',
    model: facts.model || '',
    odometer: facts.odometer || '',
    fuel: facts.fuel || '',
    title_status: facts.title_status || '',
    transmission: facts.transmission || ''
  };
}

// Dedicated extractor for Barn Finds
function extractFromBarnFinds() {
  // Title
  const title = document.querySelector('h1.entry-title')?.innerText.trim() || document.title;

  // Author
  const author = document.querySelector('.author.vcard, .author a, .author')?.innerText.trim() || '';

  // Post date
  let postDate = '';
  const dateNode = document.querySelector('time.entry-date, .entry-date, .post-date, .meta-date');
  if (dateNode) postDate = dateNode.getAttribute('datetime') || dateNode.innerText.trim();

  // Images (main gallery)
  const images = Array.from(document.querySelectorAll('.entry-content img, .post-content img, .gallery img'))
    .map(img => img.src)
    .filter((src, idx, arr) => src && arr.indexOf(src) === idx);

  // Description
  let description = '';
  const descNode = document.querySelector('.entry-content, .post-content, .content');
  if (descNode) description = descNode.innerText.trim();

  // Price (try to find in text)
  let price = '';
  const priceMatch = description.match(/\$[\d,]+/);
  if (priceMatch) price = priceMatch[0];

  // Vehicle facts (try to parse from title and description)
  let year = '';
  let make = '';
  let model = '';
  // Try to extract year, make, model from title
  const titleMatch = title.match(/(\d{4})\s+([A-Za-z]+)\s+([\w\-]+)/);
  if (titleMatch) {
    year = titleMatch[1];
    make = titleMatch[2];
    model = titleMatch[3];
  }

  return {
    site: 'Barn Finds',
    url: window.location.href,
    title,
    price,
    images,
    description,
    author,
    postDate,
    year,
    make,
    model
  };
}

// Dedicated extractor for KSL Cars
function extractFromKslCars() {
  // Title
  const title = document.querySelector('h1')?.innerText.trim() || document.title;

  // Price
  const price = document.querySelector('.price, .listing-price, .vehicle-info__price')?.innerText.trim() || '';

  // Images
  const images = Array.from(document.querySelectorAll('.photo-gallery img, .vehicle-gallery img, .image-gallery img, img.vehicle-image'))
    .map(img => img.src)
    .filter((src, idx, arr) => src && arr.indexOf(src) === idx);

  // Description
  let description = '';
  const descNode = document.querySelector('.description, .vehicle-description, .listing-description, [data-test="vehicle-description"]');
  if (descNode) description = descNode.innerText.trim();

  // Location
  let location = '';
  const locNode = document.querySelector('.seller-location, .location, .vehicle-info__location');
  if (locNode) location = locNode.innerText.trim();

  // Vehicle facts/specs
  const specs = {};
  Array.from(document.querySelectorAll('.vehicle-specs, .vehicle-specifications, .specs-list, .specs li, .vehicle-details__item')).forEach(node => {
    const txt = node.innerText.trim();
    if (/^Year/i.test(txt)) specs.year = txt.replace(/Year:?/i, '').trim();
    if (/^Make/i.test(txt)) specs.make = txt.replace(/Make:?/i, '').trim();
    if (/^Model/i.test(txt)) specs.model = txt.replace(/Model:?/i, '').trim();
    if (/^Trim/i.test(txt)) specs.trim = txt.replace(/Trim:?/i, '').trim();
    if (/^Mileage/i.test(txt)) specs.mileage = txt.replace(/Mileage:?/i, '').replace(/[,]/g, '').trim();
    if (/^Transmission/i.test(txt)) specs.transmission = txt.replace(/Transmission:?/i, '').trim();
    if (/^Fuel Type/i.test(txt)) specs.fuel_type = txt.replace(/Fuel Type:?/i, '').trim();
    if (/^VIN/i.test(txt)) specs.vin = txt.replace(/VIN:?/i, '').trim();
    if (/^Exterior Color/i.test(txt)) specs.exterior_color = txt.replace(/Exterior Color:?/i, '').trim();
    if (/^Interior Color/i.test(txt)) specs.interior_color = txt.replace(/Interior Color:?/i, '').trim();
    if (/^Title Type/i.test(txt)) specs.title_type = txt.replace(/Title Type:?/i, '').trim();
    if (/^Drive Type/i.test(txt)) specs.drive_type = txt.replace(/Drive Type:?/i, '').trim();
    if (/^Body/i.test(txt)) specs.body = txt.replace(/Body:?/i, '').trim();
    if (/^Cylinders/i.test(txt)) specs.cylinders = txt.replace(/Cylinders:?/i, '').trim();
    if (/^Liters/i.test(txt)) specs.liters = txt.replace(/Liters:?/i, '').trim();
    if (/^Stock Number/i.test(txt)) specs.stock_number = txt.replace(/Stock Number:?/i, '').trim();
  });

  // Seller type
  let seller_type = '';
  const sellerTypeNode = document.querySelector('.seller-type, .vehicle-info__seller-type');
  if (sellerTypeNode) seller_type = sellerTypeNode.innerText.trim();

  // VIN (if not found above)
  if (!specs.vin) {
    const vinNode = document.querySelector('[data-test="vin"]');
    if (vinNode) specs.vin = vinNode.innerText.trim();
  }

  return {
    site: 'KSL Cars',
    url: window.location.href,
    title,
    price,
    images,
    description,
    location,
    year: specs.year || '',
    make: specs.make || '',
    model: specs.model || '',
    trim: specs.trim || '',
    mileage: specs.mileage || '',
    transmission: specs.transmission || '',
    fuel_type: specs.fuel_type || '',
    vin: specs.vin || '',
    exterior_color: specs.exterior_color || '',
    interior_color: specs.interior_color || '',
    title_type: specs.title_type || '',
    drive_type: specs.drive_type || '',
    body: specs.body || '',
    cylinders: specs.cylinders || '',
    liters: specs.liters || '',
    stock_number: specs.stock_number || '',
    seller_type
  };
}

// Site detection
function getCurrentSite() {
  const url = window.location.href;
  if (url.includes('bringatrailer.com')) {
    return 'BringATrailer';
  }
  if (url.match(/https:\/\/.*\.craigslist\.org\//)) {
    return 'Craigslist';
  }
  if (url.includes('barnfinds.com')) {
    return 'BarnFinds';
  }
  if (url.includes('cars.ksl.com')) {
    return 'KslCars';
  }
  // Add more site checks here as needed
  return 'Unknown';
}

// Main extraction logic
function extractVehicleData() {
  const site = getCurrentSite();
  let rawData;
  
  // Extract raw data from the appropriate site
  switch (site) {
    case 'BringATrailer':
      rawData = extractFromBringATrailer();
      break;
    case 'Craigslist':
      rawData = extractFromCraigslist();
      break;
    case 'BarnFinds':
      rawData = extractFromBarnFinds();
      break;
    case 'KslCars':
      rawData = extractFromKslCars();
      break;
    default:
      rawData = extractGeneric();
  }
  
  // Transform raw data into Nuke's standardized vehicle data format
  return normalizeVehicleData(rawData, site);
}

// Normalize extracted data into a consistent format for Nuke's vehicle-centric architecture
function normalizeVehicleData(data, sourceSite) {
  // Ensure images are full URLs and unique
  const processedImages = (data.images || []).map(img => {
    // Convert relative URLs to absolute
    if (img && img.startsWith('/')) {
      return new URL(img, window.location.origin).toString();
    }
    return img;
  }).filter((url, index, self) => 
    // Remove duplicates and invalid URLs
    url && url.length > 10 && self.indexOf(url) === index
  );
  
  // Extract VIN (crucial for Nuke's vehicle identity)
  let vin = '';
  if (data.vin) {
    vin = data.vin;
  } else {
    // Try to extract VIN from description (common pattern: VIN: XXXXX)
    const description = data.description || '';
    const vinMatch = description.match(/\bVIN\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) {
      vin = vinMatch[1];
    }
  }
  
  // Handle price formatting consistently
  let price = '';
  if (data.price) {
    const priceValue = data.price.toString().replace(/[^0-9.]/g, '');
    if (priceValue) {
      price = parseFloat(priceValue);
    }
  }
  
  // Create normalized structure aligned with Nuke's vehicle identity concept
  return {
    // Core identity fields (for vehicle matching)
    vin: vin || '',
    make: data.make || '',
    model: data.model || '',
    year: data.year || '',
    
    // Secondary identity fields
    trim: data.trim || data.trim_level || '',
    engine: data.engine || data.engine_type || data.fuel || data.fuel_type || '',
    mileage: data.mileage || data.odometer || '',
    transmission: data.transmission || '',
    exterior_color: data.exterior_color || data.color || '',
    interior_color: data.interior_color || '',
    body_style: data.body_style || data.body || data.category || '',
    
    // Listing metadata
    price: price || '',
    currency: 'USD', // Default for now
    location: data.location || '',
    seller: data.seller || data.seller_type || data.author || '',
    source_url: data.url || window.location.href,
    source_site: sourceSite || data.site,
    title: data.title || document.title,
    listing_date: data.postedDate || data.post_date || new Date().toISOString(),
    
    // Evidence
    images: processedImages,
    description: data.description || '',
    
    // Original data (for Nuke's immutable record-keeping)
    raw_data: data
  };
}

// Save a hard copy of the current page as HTML
function savePageHtmlCopy() {
  const html = document.documentElement.outerHTML;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const filename = (document.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'vehidex_page') + '.html';
  chrome.runtime.sendMessage({ action: 'downloadHtmlCopy', url, filename });
}


// Listen for messages from the popup to trigger extraction and HTML save
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractVehicleData') {
    const data = extractVehicleData();
    const html = document.documentElement.outerHTML;
    sendResponse({ ...data, html }); // send back structured data and html copy
  }
});
