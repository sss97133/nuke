/**
 * Craigslist HTML Parser
 * Extracts structured data from saved Craigslist listing HTML files
 */

import * as cheerio from 'cheerio';
import * as path from 'path';

export interface CraigslistListing {
  // Core identity
  title: string;
  postId: string;
  originalUrl: string | null;

  // Pricing and location
  price: number | null;
  location: string | null;

  // Vehicle details from attributes
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  odometer: number | null;
  condition: string | null;
  cylinders: string | null;
  drive: string | null;
  fuel: string | null;
  paintColor: string | null;
  size: string | null;
  titleStatus: string | null;
  transmission: string | null;
  type: string | null;

  // Content
  description: string;

  // Dates
  postedDate: Date | null;
  updatedDate: Date | null;

  // Media
  imageUrls: string[];
  localImagePaths: string[];

  // Location data
  latitude: number | null;
  longitude: number | null;
  mapAddress: string | null;

  // Additional metadata
  repostOf: string | null;
  attributes: Record<string, string>;
}

export function parseHtml(html: string, filePath: string): CraigslistListing {
  const $ = cheerio.load(html);

  // Extract original URL from HTML comment
  const originalUrl = extractOriginalUrl(html);

  // Extract post ID
  const postId = extractPostId($, html, originalUrl);

  // Extract title
  const title = $('#titletextonly').text().trim() ||
    $('title').text().trim() ||
    path.basename(filePath, path.extname(filePath));

  // Extract price
  const price = extractPrice($);

  // Extract location from <small> after price in title
  const location = extractLocation($);

  // Extract description
  const description = extractDescription($);

  // Extract dates
  const { postedDate, updatedDate } = extractDates($);

  // Extract images
  const { imageUrls, localImagePaths } = extractImages($, html, filePath);

  // Extract GPS coordinates
  const { latitude, longitude, mapAddress } = extractGpsData($);

  // Extract all attributes from attrgroup
  const attributes = extractAttributes($);

  // Parse vehicle details from attributes and title
  const vehicleDetails = parseVehicleDetails(attributes, title);

  // Extract repost_of if present
  const repostOf = extractRepostOf(html);

  return {
    title,
    postId,
    originalUrl,
    price,
    location,
    ...vehicleDetails,
    description,
    postedDate,
    updatedDate,
    imageUrls,
    localImagePaths,
    latitude,
    longitude,
    mapAddress,
    repostOf,
    attributes,
  };
}

function extractOriginalUrl(html: string): string | null {
  // Look for <!-- saved from url=(XXXX)https://... -->
  const match = html.match(/<!--\s*saved from url=\(\d+\)(https?:\/\/[^\s]+)\s*-->/i);
  return match ? match[1] : null;
}

function extractPostId($: cheerio.CheerioAPI, html: string, originalUrl: string | null): string {
  // Try JavaScript variable first
  const pidMatch = html.match(/var\s+pID\s*=\s*["']?(\d+)["']?/);
  if (pidMatch) return pidMatch[1];

  // Try buttonPostingID
  const buttonMatch = html.match(/var\s+buttonPostingID\s*=\s*["']?(\d+)["']?/);
  if (buttonMatch) return buttonMatch[1];

  // Try postinginfo
  const postingInfo = $('.postinginfo').text();
  const postingMatch = postingInfo.match(/post id:\s*(\d+)/i);
  if (postingMatch) return postingMatch[1];

  // Try extracting from URL
  if (originalUrl) {
    const urlMatch = originalUrl.match(/\/(\d+)\.html/);
    if (urlMatch) return urlMatch[1];
  }

  return `unknown-${Date.now()}`;
}

function extractPrice($: cheerio.CheerioAPI): number | null {
  const priceText = $('.price').first().text().trim();
  if (!priceText) return null;

  // Remove $ and commas, parse as number
  const cleaned = priceText.replace(/[$,]/g, '');
  const price = parseInt(cleaned, 10);
  return isNaN(price) ? null : price;
}

function extractLocation($: cheerio.CheerioAPI): string | null {
  // Location is in <small> tag after price in postingtitletext
  const small = $('.postingtitletext small').text().trim();
  if (small) {
    // Remove parentheses
    return small.replace(/^\(|\)$/g, '').trim() || null;
  }

  // Try breadcrumbs
  const area = $('.crumb.area a').text().trim();
  return area || null;
}

function extractDescription($: cheerio.CheerioAPI): string {
  const postingBody = $('#postingbody');

  // Remove QR code container
  postingBody.find('.print-qrcode-container').remove();

  // Get text content
  let text = postingBody.text().trim();

  // Clean up extra whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

function extractDates($: cheerio.CheerioAPI): { postedDate: Date | null; updatedDate: Date | null } {
  let postedDate: Date | null = null;
  let updatedDate: Date | null = null;

  // Find all time.timeago elements
  $('time.timeago').each((_, el) => {
    const datetime = $(el).attr('datetime');
    if (!datetime) return;

    const date = new Date(datetime);
    if (isNaN(date.getTime())) return;

    const text = $(el).parent().text().toLowerCase();
    if (text.includes('posted')) {
      postedDate = date;
    } else if (text.includes('updated')) {
      updatedDate = date;
    } else if (!postedDate) {
      postedDate = date;
    }
  });

  return { postedDate, updatedDate };
}

function extractImages($: cheerio.CheerioAPI, html: string, filePath: string): {
  imageUrls: string[];
  localImagePaths: string[];
} {
  const imageUrls: string[] = [];
  const localImagePaths: string[] = [];

  // Extract from imgList JavaScript variable
  const imgListMatch = html.match(/var\s+imgList\s*=\s*(\[[\s\S]*?\]);/);
  if (imgListMatch) {
    try {
      const imgList = JSON.parse(imgListMatch[1]);
      for (const img of imgList) {
        if (img.url) {
          imageUrls.push(img.url);
        }
      }
    } catch {
      // JSON parse failed, try regex extraction
      const urlMatches = imgListMatch[1].matchAll(/"url"\s*:\s*"([^"]+)"/g);
      for (const match of urlMatches) {
        imageUrls.push(match[1]);
      }
    }
  }

  // Also look for local images in _files folder
  const baseDir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const filesDir = path.join(baseDir, `${baseName}_files`);

  // Find images referenced in the HTML that point to local files
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (src && (src.includes('_files/') || src.startsWith('./'))) {
      // Resolve relative path
      const localPath = path.resolve(baseDir, src);
      if (!localImagePaths.includes(localPath)) {
        localImagePaths.push(localPath);
      }
    }
  });

  return { imageUrls, localImagePaths };
}

function extractGpsData($: cheerio.CheerioAPI): {
  latitude: number | null;
  longitude: number | null;
  mapAddress: string | null;
} {
  const mapDiv = $('#map');
  let latitude: number | null = null;
  let longitude: number | null = null;

  const latStr = mapDiv.attr('data-latitude');
  const lonStr = mapDiv.attr('data-longitude');

  if (latStr) {
    const lat = parseFloat(latStr);
    if (!isNaN(lat)) latitude = lat;
  }
  if (lonStr) {
    const lon = parseFloat(lonStr);
    if (!isNaN(lon)) longitude = lon;
  }

  // Extract map address
  const mapAddress = $('.mapaddress').first().text().trim() || null;

  return { latitude, longitude, mapAddress };
}

function extractAttributes($: cheerio.CheerioAPI): Record<string, string> {
  const attributes: Record<string, string> = {};

  // Parse attribute groups
  $('p.attrgroup span').each((_, el) => {
    const text = $(el).text().trim();

    // Check if it's a label: value pair
    const colonIndex = text.indexOf(':');
    if (colonIndex > 0) {
      const label = text.substring(0, colonIndex).trim().toLowerCase();
      const value = $(el).find('b').text().trim() || text.substring(colonIndex + 1).trim();
      if (label && value) {
        attributes[label] = value;
      }
    } else {
      // It might be the vehicle make/model/year line
      const boldText = $(el).find('b').text().trim();
      if (boldText) {
        attributes['vehicle_title'] = boldText;
      }
    }
  });

  return attributes;
}

function parseVehicleDetails(attributes: Record<string, string>, title: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  odometer: number | null;
  condition: string | null;
  cylinders: string | null;
  drive: string | null;
  fuel: string | null;
  paintColor: string | null;
  size: string | null;
  titleStatus: string | null;
  transmission: string | null;
  type: string | null;
} {
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;

  // Try to extract year/make/model from vehicle_title attribute or title
  const vehicleTitle = attributes['vehicle_title'] || title;
  const yearMatch = vehicleTitle.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }

  // Try to extract make and model
  // Common makes to look for
  const makes = [
    'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick',
    'Oldsmobile', 'Cadillac', 'GMC', 'Chrysler', 'Jeep', 'AMC', 'Mercury',
    'Lincoln', 'Toyota', 'Honda', 'Nissan', 'Datsun', 'Mazda', 'Volkswagen',
    'VW', 'Porsche', 'BMW', 'Mercedes', 'Audi', 'Volvo', 'Jaguar', 'MG',
    'Triumph', 'Austin', 'Healey', 'Fiat', 'Alfa', 'Ferrari', 'Lamborghini',
    'Corvette', 'Mustang', 'Camaro', 'Charger', 'Challenger', 'Cuda', 'Barracuda',
    'Willys', 'International', 'Studebaker', 'Hudson', 'Nash', 'Packard',
  ];

  // Normalize make names
  const makeMap: Record<string, string> = {
    'chevy': 'Chevrolet',
    'vw': 'Volkswagen',
    'alfa': 'Alfa Romeo',
    'cuda': 'Plymouth',
    'barracuda': 'Plymouth',
    'corvette': 'Chevrolet',
    'mustang': 'Ford',
    'camaro': 'Chevrolet',
    'charger': 'Dodge',
    'challenger': 'Dodge',
  };

  const titleLower = vehicleTitle.toLowerCase();
  for (const m of makes) {
    if (titleLower.includes(m.toLowerCase())) {
      make = makeMap[m.toLowerCase()] || m;
      // Try to extract model after make
      const makeIndex = titleLower.indexOf(m.toLowerCase());
      const afterMake = vehicleTitle.substring(makeIndex + m.length).trim();
      const modelMatch = afterMake.match(/^[\s-]*([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)/);
      if (modelMatch) {
        model = modelMatch[1].trim();
      }
      break;
    }
  }

  return {
    year,
    make,
    model,
    vin: attributes['vin'] || null,
    odometer: attributes['odometer'] ? parseInt(attributes['odometer'].replace(/\D/g, ''), 10) || null : null,
    condition: attributes['condition'] || null,
    cylinders: attributes['cylinders'] || null,
    drive: attributes['drive'] || null,
    fuel: attributes['fuel'] || null,
    paintColor: attributes['paint color'] || null,
    size: attributes['size'] || null,
    titleStatus: attributes['title status'] || null,
    transmission: attributes['transmission'] || null,
    type: attributes['type'] || null,
  };
}

function extractRepostOf(html: string): string | null {
  const match = html.match(/var\s+repost_of\s*=\s*(\d+)/);
  return match ? match[1] : null;
}

// Export for testing
export {
  extractOriginalUrl,
  extractPostId,
  extractPrice,
  extractLocation,
  extractDescription,
  extractDates,
  extractImages,
  extractGpsData,
  extractAttributes,
  parseVehicleDetails,
};
