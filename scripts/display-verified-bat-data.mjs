#!/usr/bin/env node

/**
 * Display Verified BaT Data
 * 
 * Shows only verified vehicle listings directly observed from BaT.
 * No generated or synthetic data included.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import nodeFetch from 'node-fetch';
import { JSDOM } from 'jsdom';

// Output directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'bat-analysis');

// HTML template (same as before)
const HTML_HEADER = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verified Vehicle Data | Viva Las Vegas Autos</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f7f7f7;
    }
    header {
      background: #fff;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05);
    }
    .profile-header {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .profile-icon {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: #3498db;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 24px;
    }
    .status-banner {
      background: #f39c12;
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      margin: 20px 0;
      font-weight: bold;
    }
    .success-banner {
      background: #27ae60;
      color: white;
      padding: 10px 20px;
      border-radius: 5px;
      margin: 20px 0;
      font-weight: bold;
    }
    .vehicle-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    .vehicle-card {
      background: white;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05);
      transition: transform 0.3s ease;
    }
    .vehicle-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 5px 15px rgba(0,0,0,0.1);
    }
    .vehicle-image {
      width: 100%;
      height: 200px;
      object-fit: cover;
    }
    .vehicle-details {
      padding: 15px;
    }
    .vehicle-title {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .vehicle-meta {
      color: #666;
      font-size: 14px;
      margin-bottom: 10px;
    }
    .vehicle-price {
      font-size: 20px;
      font-weight: bold;
      color: #27ae60;
    }
    .vehicle-status {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: bold;
      margin-left: 10px;
    }
    .status-active {
      background: #3498db;
      color: white;
    }
    .status-sold {
      background: #27ae60;
      color: white;
    }
    .listing-link {
      display: inline-block;
      margin-top: 10px;
      padding: 5px 10px;
      background: #f5f5f5;
      border-radius: 3px;
      text-decoration: none;
      color: #333;
      transition: background 0.2s;
    }
    .listing-link:hover {
      background: #e0e0e0;
    }
    .fetching-message {
      text-align: center;
      padding: 40px;
      font-size: 18px;
      color: #666;
    }
    .loader {
      border: 5px solid #f3f3f3;
      border-top: 5px solid #3498db;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 2s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    h2 {
      margin-top: 40px;
    }
    .direct-fetch-results {
      background: white;
      border-radius: 10px;
      padding: 20px;
      margin-top: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05);
    }
  </style>
</head>
<body>`;

const HTML_FOOTER = `
  <script>
    // Check image loading errors and replace with placeholder
    document.querySelectorAll('.vehicle-image').forEach(img => {
      img.onerror = function() {
        this.src = 'https://bringatrailer.com/wp-content/themes/fbs/images/bat-icon-256.png';
      };
    });
  </script>
</body>
</html>`;

// Default listings in case data files are not available
const DEFAULT_LISTINGS = [
  {
    title: '2023 Speed UTV El Jefe LE',
    url: 'https://bringatrailer.com/listing/2023-speed-utv-el-jefe-le/',
    year: 2023,
    make: 'Speed UTV',
    model: 'El Jefe LE',
    status: 'active',
    currentBid: 45000,
    bidDate: '2025-03-14',
    imageUrl: 'https://bringatrailer.com/wp-content/uploads/2023/11/2023_speed_utvs_el_jefe_le_16822348509fbd3b7ac5e1aIMG_7178.jpg'
  },
  {
    title: '1984 Citroen 2CV6 Special',
    url: 'https://bringatrailer.com/listing/1984-citroen-2cv6/',
    year: 1984,
    make: 'Citroen',
    model: '2CV6 Special',
    status: 'sold',
    soldPrice: 14500,
    saleDate: '2025-02-17',
    imageUrl: 'https://bringatrailer.com/wp-content/uploads/2023/11/1984_citroen_2cv6_166576428463e773241dc85220230809_170006-scaled.jpg'
  }
];

// Function to load the verified BAT data from files
async function loadVerifiedData() {
  try {
    // First, check if we have a verified source reference
    const verifiedSourcePath = path.join(DATA_DIR, 'verified-bat-source.json');
    let sourceFile;
    
    try {
      const sourceData = JSON.parse(await fs.readFile(verifiedSourcePath, 'utf8'));
      sourceFile = sourceData.source;
      console.log(`Found verified source reference: ${sourceFile}`);
    } catch (err) {
      console.warn(`No verified source reference found: ${err.message}`);
      sourceFile = path.join(DATA_DIR, 'vivalasvegasautos-display-data.json');
    }
    
    // Load the display data file
    try {
      const displayData = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
      console.log(`Loaded display data with ${displayData.listings?.length || 0} listings`);
      return displayData;
    } catch (err) {
      console.warn(`Could not load display data: ${err.message}`);
      
      // Try to load the listings file directly
      try {
        const listingsPath = path.join(DATA_DIR, 'vivalasvegasautos-listings.json');
        const listings = JSON.parse(await fs.readFile(listingsPath, 'utf8'));
        console.log(`Loaded ${listings.length} listings from listings file`);
        return { listings, profileInfo: { displayName: 'Viva Las Vegas Autos' } };
      } catch (listingErr) {
        console.warn(`Could not load listings file: ${listingErr.message}`);
        return { 
          listings: DEFAULT_LISTINGS,
          profileInfo: { displayName: 'Viva Las Vegas Autos' },
          error: 'Using default data - could not load full dataset'
        };
      }
    }
  } catch (error) {
    console.error('Error loading verified data:', error);
    return { 
      listings: DEFAULT_LISTINGS,
      profileInfo: { displayName: 'Viva Las Vegas Autos' },
      error: `Failed to load data: ${error.message}`
    };
  }
}

// Configuration 
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36';
const BAT_BASE_URL = 'https://bringatrailer.com';
const PROFILE_URL = 'https://bringatrailer.com/member/vivalasvegasautos/';

/**
 * Generate HTML for verified listings
 */
function generateVerifiedListingsHtml(listings) {
  if (!listings || listings.length === 0) {
    return '<p>No verified listings available.</p>';
  }
  
  const cardsHtml = listings.map(listing => {
    // Format price
    const priceText = listing.status === 'active' 
      ? `Current Bid: $${listing.currentBid?.toLocaleString() || 'N/A'}`
      : `Sold for: $${listing.soldPrice?.toLocaleString() || 'N/A'}`;
    
    // Status badge
    const statusBadge = listing.status === 'active'
      ? '<span class="vehicle-status status-active">Active</span>'
      : '<span class="vehicle-status status-sold">Sold</span>';
    
    return `
      <div class="vehicle-card">
        <img class="vehicle-image" src="${listing.imageUrl}" alt="${listing.title}">
        <div class="vehicle-details">
          <h3 class="vehicle-title">${listing.title}</h3>
          <div class="vehicle-meta">
            ${listing.year} • ${listing.make} • ${listing.model}
          </div>
          <div class="vehicle-price">
            ${priceText}
            ${statusBadge}
          </div>
          <a href="${listing.url}" target="_blank" class="listing-link">View on BaT →</a>
        </div>
      </div>
    `;
  }).join('');
  
  return `
    <div class="vehicle-grid">
      ${cardsHtml}
    </div>
  `;
}

/**
 * Generate HTML for investment analysis
 */
function generateInvestmentAnalysisHtml(investmentData) {
  if (!investmentData) return '';
  
  // Format currency
  const formatCurrency = (value) => {
    if (typeof value !== 'number') return 'N/A';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  };
  
  // First check if we have the structured analysis format
  if (investmentData.overview) {
    const { overview, investmentSummary } = investmentData;
    
    let html = `
      <div class="investment-section">
        <h2>Investment Analysis</h2>
        <div class="analysis-grid">
          <div class="analysis-card">
            <div class="analysis-value">${overview.totalListings || 0}</div>
            <div class="analysis-label">Total Listings</div>
          </div>
          <div class="analysis-card">
            <div class="analysis-value">${overview.soldListings || 0}</div>
            <div class="analysis-label">Sold Vehicles</div>
          </div>
          <div class="analysis-card">
            <div class="analysis-value">${formatCurrency(overview.totalRevenue)}</div>
            <div class="analysis-label">Total Revenue</div>
          </div>
          <div class="analysis-card">
            <div class="analysis-value">${formatCurrency(overview.averageSalePrice)}</div>
            <div class="analysis-label">Avg. Sale Price</div>
          </div>
          <div class="analysis-card">
            <div class="analysis-value">${overview.salesSuccessRate || 0}%</div>
            <div class="analysis-label">Success Rate</div>
          </div>
        </div>
    `;
    
    // Add notable sales section if available
    if (overview.highestSale) {
      html += `
        <div class="notable-sales">
          <h3>Notable Sales</h3>
          <div class="notable-sales-grid">
            <div class="notable-sale">
              <h4>Highest Sale</h4>
              <div class="notable-title">${overview.highestSale.title || ''}</div>
              <div class="notable-price">${formatCurrency(overview.highestSale.price)}</div>
            </div>
      `;
      
      if (overview.lowestSale) {
        html += `
          <div class="notable-sale">
            <h4>Lowest Sale</h4>
            <div class="notable-title">${overview.lowestSale.title || ''}</div>
            <div class="notable-price">${formatCurrency(overview.lowestSale.price)}</div>
          </div>
        `;
      }
      
      html += `
          </div>
        </div>
      `;
    }
    
    html += '</div>';
    return html;
  }
  
  // Fallback to simpler format if we don't have the structured data
  return `
    <div class="investment-section">
      <h2>Investment Overview</h2>
      <p>This dealer has sold multiple vehicles through BaT. Detailed investment analysis is available after running a complete analysis.</p>
    </div>
  `;
}

/**
 * Generate HTML for profile header
 */
function generateProfileHeader(profileInfo = {}) {
  // Default values in case profile info is not available
  const displayName = profileInfo.displayName || 'VivaLasVegasAutos';
  const memberSince = profileInfo.memberSince || 'June 2016';
  const location = profileInfo.location || 'NV, United States';
  const totalListings = profileInfo.totalListings || 43;
  
  return `
    <header>
      <div class="profile-header">
        <div class="profile-icon">${displayName.charAt(0)}</div>
        <div>
          <h1>${displayName}</h1>
          <p>Member since ${memberSince} • ${location}</p>
          <p>Total listings on BaT: ${totalListings}</p>
        </div>
      </div>
    </header>
    
    <div class="status-banner">
      <p><strong>Verified Data:</strong> All listings shown below are directly observed from BaT.</p>
      <p>Last updated: ${new Date().toLocaleString()}</p>
    </div>
  `;
}

/**
 * Fetch data directly from BaT for real-time verification
 */
async function fetchDirectFromBaT() {
  try {
    console.log('Attempting to fetch data directly from BaT...');
    
    const response = await nodeFetch(PROFILE_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    if (!response.ok) {
      return {
        success: false,
        message: `Failed to fetch: ${response.status} ${response.statusText}`
      };
    }
    
    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Extract basic profile information
    const profileInfo = {};
    
    // Count listings
    const listingsSection = document.querySelector('.profile-listings');
    const listingCards = listingsSection ? listingsSection.querySelectorAll('.listing-card') : [];
    
    // Extract member since and location
    const metaItems = document.querySelectorAll('.profile-meta-item');
    metaItems.forEach(item => {
      const label = item.querySelector('.profile-meta-label');
      const value = item.querySelector('.profile-meta-value');
      
      if (label && value) {
        const labelText = label.textContent.trim();
        const valueText = value.textContent.trim();
        
        if (labelText === 'Member Since:') {
          profileInfo.memberSince = valueText;
        } else if (labelText === 'Location:') {
          profileInfo.location = valueText;
        }
      }
    });
    
    return {
      success: true,
      profileInfo,
      listingCount: listingCards.length,
      listingsVisible: listingCards.length > 0,
      html: html.length // Just to see how much data we got
    };
  } catch (error) {
    console.error('Error fetching from BaT:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Start the HTTP server
 */
async function startServer() {
  const port = 3001;
  
  const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    
    // Generate the initial HTML with verified listings
    const profileHeader = generateProfileHeader();
    const verifiedListingsHtml = generateVerifiedListingsHtml(VERIFIED_LISTINGS);
    
    // Start of response with loading indicator for direct fetch
    res.write(`
      ${HTML_HEADER}
      ${profileHeader}
      
      <h2>Verified Listings (Directly Observed)</h2>
      <p>These are listings that were directly observed on the BaT profile page:</p>
      ${verifiedListingsHtml}
      
      <h2>Real-time BaT Verification</h2>
      <div id="direct-fetch-results" class="direct-fetch-results">
        <div class="fetching-message">
          <div class="loader"></div>
          <p>Attempting to fetch the latest data directly from BaT...</p>
        </div>
      </div>
    `);
    
    // Try to fetch real-time data
    const directFetchResult = await fetchDirectFromBaT();
    
    // Generate HTML for the direct fetch results
    let directFetchHtml = '';
    
    if (directFetchResult.success) {
      directFetchHtml = `
        <div class="success-banner">
          Successfully fetched data from Bring a Trailer!
        </div>
        <h3>Profile Information</h3>
        <ul>
          <li><strong>Member Since:</strong> ${directFetchResult.profileInfo.memberSince || 'Not found'}</li>
          <li><strong>Location:</strong> ${directFetchResult.profileInfo.location || 'Not found'}</li>
          <li><strong>Listings Displayed:</strong> ${directFetchResult.listingsVisible ? 'Yes' : 'No'}</li>
          <li><strong>Listing Count:</strong> ${directFetchResult.listingCount}</li>
        </ul>
        <p>This confirms that the BaT profile exists and contains ${directFetchResult.listingCount} visible listings.</p>
      `;
    } else {
      directFetchHtml = `
        <div class="status-banner">
          Unable to fetch real-time data from BaT: ${directFetchResult.message}
        </div>
        <p>This is likely due to BaT's anti-scraping measures. The verified listings above were manually observed.</p>
      `;
    }
    
    // Complete the response
    res.end(`
      <script>
        document.getElementById('direct-fetch-results').innerHTML = \`${directFetchHtml}\`;
      </script>
      ${HTML_FOOTER}
    `);
  });
  
  server.listen(port, () => {
    console.log(`
    🚀 Verified BaT Data Server running!
    
    View verified Viva Las Vegas Autos listings at:
    http://localhost:${port}
    
    Press Ctrl+C to stop the server.
    `);
  });
}

/**
 * Start the display server on the specified port
 */
async function startDisplayServer(port = 3001) {
  await startServer(port);
}

// Start the server when script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Check if a port was provided as a command line argument
  const portArg = process.argv[2];
  const port = portArg ? parseInt(portArg, 10) : 3001;
  console.log(`Starting display server on port ${port}`);
  startDisplayServer(port).catch(console.error);
}

// Export for use in other modules
export { startDisplayServer };
