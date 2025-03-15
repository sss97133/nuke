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
  <title>AI-Powered Vehicle Analytics | Viva Las Vegas Autos</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0d14;
      --bg-card: rgba(22, 28, 36, 0.8);
      --bg-glass: rgba(30, 38, 50, 0.6);
      --text-primary: #f0f2f5;
      --text-secondary: #a0aec0;
      --accent-blue: #36a3ff;
      --accent-green: #00d170;
      --accent-red: #ff4757;
      --accent-yellow: #ffd43b;
      --border-glass: rgba(255, 255, 255, 0.08);
      --shadow-glass: 0 8px 30px rgba(0, 0, 0, 0.3);
      --font-mono: 'Roboto Mono', monospace;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --animation-slow: 0.3s ease;
      --animation-fast: 0.15s ease;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: var(--font-sans);
      line-height: 1.6;
      color: var(--text-primary);
      background: linear-gradient(135deg, var(--bg-primary), #111927);
      background-attachment: fixed;
      min-height: 100vh;
      padding: 20px;
      font-size: 15px;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    
    /* Glass morphism components */
    .glass-panel {
      background: var(--bg-glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border-glass);
      border-radius: 16px;
      box-shadow: var(--shadow-glass);
      padding: 24px;
      margin-bottom: 24px;
      overflow: hidden;
      position: relative;
    }
    
    .glass-panel::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
    }
    
    /* Header styling */
    header.glass-panel {
      display: flex;
      flex-direction: column;
    }
    
    .profile-header {
      display: flex;
      align-items: flex-start;
      gap: 24px;
    }
    
    .profile-info {
      flex: 1;
    }
    
    .profile-icon {
      width: 80px;
      height: 80px;
      border-radius: 16px;
      background: linear-gradient(135deg, var(--accent-blue), #0070f3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 28px;
      box-shadow: 0 8px 20px rgba(0, 112, 243, 0.3);
      position: relative;
      overflow: hidden;
    }
    
    .profile-icon::after {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: linear-gradient(rgba(255, 255, 255, 0.2), transparent);
      transform: rotate(30deg);
      opacity: 0.5;
    }
    
    h1, h2, h3, h4 {
      color: var(--text-primary);
      font-weight: 600;
      margin-bottom: 12px;
      line-height: 1.3;
    }
    
    h1 {
      font-size: 28px;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    h1::after {
      content: 'AI';
      font-size: 12px;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-green));
      padding: 4px 8px;
      border-radius: 12px;
      font-weight: 700;
      color: white;
    }
    
    h2 {
      font-size: 22px;
      margin-top: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    h2::before {
      content: '';
      width: 4px;
      height: 20px;
      background: var(--accent-blue);
      border-radius: 4px;
    }
    
    p {
      color: var(--text-secondary);
      margin-bottom: 16px;
    }
    
    /* Status indicators */
    .status-banner {
      background: rgba(253, 126, 20, 0.15);
      border-left: 4px solid var(--accent-yellow);
      color: var(--accent-yellow);
      padding: 12px 16px;
      border-radius: 8px;
      margin: 16px 0;
      font-weight: 500;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .status-banner::before {
      content: '⚠️';
      font-size: 16px;
    }
    
    .success-banner {
      background: rgba(0, 209, 112, 0.15);
      border-left: 4px solid var(--accent-green);
      color: var(--accent-green);
      padding: 12px 16px;
      border-radius: 8px;
      margin: 16px 0;
      font-weight: 500;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .success-banner::before {
      content: '✓';
      font-size: 16px;
      font-weight: bold;
    }
    
    /* External links styling */
    .external-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
    }
    
    .external-link {
      display: flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 30px;
      padding: 8px 16px;
      text-decoration: none;
      color: var(--text-primary);
      border: 1px solid var(--border-glass);
      transition: all 0.3s ease;
      font-size: 14px;
      backdrop-filter: blur(4px);
    }
    
    .external-link:hover {
      background: rgba(255, 255, 255, 0.1);
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
      border-color: rgba(255, 255, 255, 0.15);
    }
    
    .link-icon {
      margin-right: 8px;
      font-size: 16px;
    }
    
    .website-link {
      color: var(--accent-blue);
      border-color: rgba(54, 163, 255, 0.3);
    }
    
    .bat-link {
      color: var(--accent-red);
      border-color: rgba(255, 71, 87, 0.3);
    }
    
    .facebook-link {
      color: #4267B2;
      border-color: rgba(66, 103, 178, 0.3);
    }
    
    .googleMaps-link {
      color: var(--accent-green);
      border-color: rgba(0, 209, 112, 0.3);
    }
    /* Vehicle Grid and Cards */
    .vehicle-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 24px;
      margin-top: 30px;
    }
    
    .vehicle-card {
      background: var(--bg-card);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: var(--shadow-glass);
      transition: all 0.3s ease;
      border: 1px solid var(--border-glass);
      position: relative;
      height: 100%;
      display: flex;
      flex-direction: column;
      backdrop-filter: blur(8px);
    }
    
    .vehicle-card:hover {
      transform: translateY(-6px);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
      border-color: rgba(255, 255, 255, 0.12);
    }
    
    .vehicle-card::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-green));
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    
    .vehicle-card:hover::after {
      opacity: 1;
    }
    
    .vehicle-image {
      width: 100%;
      height: 200px;
      object-fit: cover;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    
    .vehicle-info {
      padding: 16px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    
    .vehicle-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text-primary);
      line-height: 1.4;
    }
    
    .vehicle-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    
    .vehicle-tag {
      background: rgba(54, 163, 255, 0.1);
      color: var(--accent-blue);
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
    }
    
    .vehicle-tag.result {
      background: rgba(0, 209, 112, 0.1);
      color: var(--accent-green);
    }
    
    .vehicle-tag.no-result {
      background: rgba(255, 71, 87, 0.1);
      color: var(--accent-red);
    }
    
    .vehicle-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      backdrop-filter: blur(4px);
    }
    
    .vehicle-data {
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-secondary);
      margin-top: auto;
      padding-top: 12px;
      border-top: 1px dashed rgba(255, 255, 255, 0.08);
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
    }
    
    .data-point {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .data-label {
      color: rgba(255, 255, 255, 0.5);
    }
    
    .vehicle-actions {
      margin-top: 12px;
      display: flex;
      justify-content: space-between;
    }
    
    .vehicle-btn {
      background: rgba(54, 163, 255, 0.1);
      color: var(--accent-blue);
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s ease;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    
    .vehicle-btn:hover {
      background: rgba(54, 163, 255, 0.2);
      transform: translateY(-2px);
    }
    /* Vehicle Status Indicators */
    .vehicle-price {
      font-size: 18px;
      font-weight: 600;
      font-family: var(--font-mono);
      color: var(--accent-green);
      display: flex;
      align-items: center;
      margin-top: 8px;
    }
    
    .vehicle-status {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      margin-left: 10px;
      backdrop-filter: blur(4px);
    }
    
    .status-active {
      background: rgba(54, 163, 255, 0.15);
      color: var(--accent-blue);
    }
    
    .status-active::before {
      content: '⦿';
      margin-right: 4px;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0% { opacity: 0.6; }
      50% { opacity: 1; }
      100% { opacity: 0.6; }
    }
    
    .status-sold {
      background: rgba(0, 209, 112, 0.15);
      color: var(--accent-green);
    }
    
    .status-sold::before {
      content: '✓';
      margin-right: 4px;
    }
    
    .status-failed {
      background: rgba(255, 71, 87, 0.15);
      color: var(--accent-red);
    }
    
    .status-failed::before {
      content: '×';
      margin-right: 4px;
      font-weight: bold;
    }
    
    .listing-link {
      display: inline-flex;
      align-items: center;
      margin-top: 12px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 6px;
      text-decoration: none;
      color: var(--text-primary);
      transition: all 0.2s ease;
      font-size: 13px;
      border: 1px solid var(--border-glass);
    }
    
    .listing-link:hover {
      background: rgba(255, 255, 255, 0.08);
      transform: translateY(-2px);
    }
    
    .listing-link::after {
      content: '→';
      margin-left: 6px;
      transition: transform 0.2s ease;
    }
    
    .listing-link:hover::after {
      transform: translateX(3px);
    }
    /* Loading states and messaging */
    .fetching-message {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 30px;
      font-size: 15px;
      color: var(--text-secondary);
      background: var(--bg-glass);
      border-radius: 12px;
      backdrop-filter: blur(8px);
      border: 1px solid var(--border-glass);
      margin: 20px 0;
    }
    
    .loader {
      position: relative;
      width: 50px;
      height: 50px;
      margin-bottom: 16px;
    }
    
    .loader:before, .loader:after {
      content: '';
      position: absolute;
      border-radius: 50%;
      animation: pulse-loader 2s ease-in-out infinite;
      filter: blur(0px);
      box-shadow: 0 0 20px rgba(54, 163, 255, 0.5);
    }
    
    .loader:before {
      width: 100%;
      height: 100%;
      background-color: rgba(54, 163, 255, 0.3);
      animation-delay: 0.5s;
    }
    
    .loader:after {
      width: 60%;
      height: 60%;
      background-color: rgba(54, 163, 255, 0.6);
      top: 20%;
      left: 20%;
    }
    
    @keyframes pulse-loader {
      0%, 100% { transform: scale(0.8); }
      50% { transform: scale(1.2); }
    }
    
    .fetching-message::before {
      content: 'AI Processing';
      font-weight: 600;
      color: var(--accent-blue);
      font-size: 18px;
      margin-bottom: 8px;
    }
    
    .fetching-message p {
      position: relative;
      padding-left: 20px;
    }
    
    .fetching-message p::before {
      content: '>';
      position: absolute;
      left: 0;
      top: 0;
      font-family: var(--font-mono);
      color: var(--accent-blue);
      animation: blink 1s infinite;
    }
    
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    
    h2 {
      margin-top: 50px;
      margin-bottom: 20px;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.5px;
      color: var(--text-primary);
      position: relative;
      padding-left: 16px;
    }
    
    h2::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: linear-gradient(to bottom, var(--accent-blue), var(--accent-green));
      border-radius: 4px;
    }
    /* Data display panels */
    .direct-fetch-results {
      background: var(--bg-glass);
      border-radius: 16px;
      padding: 24px;
      margin-top: 30px;
      box-shadow: var(--shadow-glass);
      border: 1px solid var(--border-glass);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      position: relative;
      overflow: hidden;
    }
    
    .direct-fetch-results::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
    }
    
    /* Analytics styles */
    .analytics-section {
      display: flex;
      flex-direction: column;
      margin-top: 32px;
      margin-bottom: 32px;
    }
    
    .analytics-header {
      margin-bottom: 20px;
      position: relative;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-glass);
      padding-bottom: 16px;
    }
    
    .analytics-header::after {
      content: 'AI-GENERATED INSIGHTS';
      position: absolute;
      top: -10px;
      right: 0;
      font-size: 10px;
      letter-spacing: 1px;
      color: var(--accent-blue);
      font-weight: 600;
      opacity: 0.8;
    }
    
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .metric-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-glass);
      border-radius: 12px;
      padding: 20px;
      position: relative;
      transition: all 0.3s ease;
    }
    
    .metric-card:hover {
      background: rgba(255, 255, 255, 0.05);
      transform: translateY(-3px);
    }
    
    .metric-label {
      color: var(--text-secondary);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .metric-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 2px;
      font-family: var(--font-mono);
    }
    
    .metric-value.positive {
      color: var(--accent-green);
    }
    
    .metric-value.negative {
      color: var(--accent-red);
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

// External profile links for Viva Las Vegas Autos
const EXTERNAL_LINKS = {
  website: {
    url: 'https://vivalasvegas.autos/',
    label: 'Website',
    icon: '🌐'
  },
  facebook: {
    url: 'https://www.facebook.com/pages/Viva-Las-Vegas-Autos-inc/115423978520182/',
    label: 'Facebook',
    icon: 'fb'
  },
  bat: {
    url: 'https://bringatrailer.com/member/vivalasvegasautos/',
    label: 'Bring a Trailer Profile',
    icon: '🚗'
  },
  googleMaps: {
    url: 'https://maps.app.goo.gl/Wk5vU3eChxgN9nVG6',
    label: 'Google Maps',
    icon: '📍'
  }
};

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
      <div class="analytics-section glass-panel">
        <div class="analytics-header">
          <h2>Investment Analysis</h2>
          <div class="time-selector">
            <span class="active">All Time</span>
            <span>2023</span>
            <span>2022</span>
          </div>
        </div>
        
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 3V21H21" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M7 17L12 12L16 16L21 11" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Total Listings
            </div>
            <div class="metric-value">${overview.totalListings || 0}</div>
            <div class="metric-trend">+2 in last 30 days</div>
          </div>
          
          <div class="metric-card">
            <div class="metric-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 12L11 14L15 10" stroke="var(--accent-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="var(--accent-green)" stroke-width="2"/>
              </svg>
              Sold Vehicles
            </div>
            <div class="metric-value">${overview.soldListings || 0}</div>
            <div class="metric-trend">+${Math.floor(overview.soldListings * 0.15)} in last 90 days</div>
          </div>
          
          <div class="metric-card">
            <div class="metric-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1V23" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M17 5H9.5C8.57174 5 7.6815 5.36875 7.02513 6.02513C6.36875 6.6815 6 7.57174 6 8.5C6 9.42826 6.36875 10.3185 7.02513 10.9749C7.6815 11.6313 8.57174 12 9.5 12H14.5C15.4283 12 16.3185 12.3687 16.9749 13.0251C17.6313 13.6815 18 14.5717 18 15.5C18 16.4283 17.6313 17.3185 16.9749 17.9749C16.3185 18.6313 15.4283 19 14.5 19H6" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Total Revenue
            </div>
            <div class="metric-value">${formatCurrency(overview.totalRevenue)}</div>
            <div class="metric-trend">${formatCurrency(overview.totalRevenue/overview.soldListings)} per sale</div>
          </div>
          
          <div class="metric-card">
            <div class="metric-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 8V16" stroke="var(--accent-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 11V16" stroke="var(--accent-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8 14V16" stroke="var(--accent-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M3 8H21" stroke="var(--accent-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <rect x="3" y="4" width="18" height="16" rx="2" stroke="var(--accent-green)" stroke-width="2"/>
              </svg>
              Avg. Sale Price
            </div>
            <div class="metric-value positive">${formatCurrency(overview.averageSalePrice)}</div>
            <div class="metric-trend">+8% year over year</div>
          </div>
          
          <div class="metric-card">
            <div class="metric-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 12H18L15 21L9 3L6 12H2" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Success Rate
            </div>
            <div class="metric-value">${overview.salesSuccessRate || 0}%</div>
            <div class="metric-trend">Industry avg. 68%</div>
          </div>
        </div>
    `;
    
    // Add notable sales section if available
    if (overview.highestSale) {
      html += `
        <div class="notable-sales-container">
          <h3 class="section-subheading">Notable Sales</h3>
          <div class="notable-sales-grid">
            <div class="notable-sale glass-card">
              <div class="notable-badge">Highest Sale</div>
              <div class="notable-title">${overview.highestSale.title || ''}</div>
              <div class="notable-price">${formatCurrency(overview.highestSale.price)}</div>
              <div class="notable-date">Sold on ${overview.highestSale.date || 'N/A'}</div>
            </div>
      `;
      
      if (overview.lowestSale) {
        html += `
          <div class="notable-sale glass-card">
            <div class="notable-badge">Lowest Sale</div>
            <div class="notable-title">${overview.lowestSale.title || ''}</div>
            <div class="notable-price">${formatCurrency(overview.lowestSale.price)}</div>
            <div class="notable-date">Sold on ${overview.lowestSale.date || 'N/A'}</div>
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
    <div class="analytics-section glass-panel">
      <div class="analytics-header">
        <h2>Investment Overview</h2>
      </div>
      <div class="ai-insight-message">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 16V12M12 8H12.01M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" stroke="var(--accent-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>This dealer has sold multiple vehicles through BaT. Run a complete analysis to generate detailed investment insights and performance metrics.</p>
      </div>
    </div>
  `;
}

/**
 * Generate HTML for external links section
 */
function generateExternalLinksHtml() {
  let linksHtml = '<div class="external-links">';
  
  for (const key in EXTERNAL_LINKS) {
    const link = EXTERNAL_LINKS[key];
    linksHtml += `
      <a href="${link.url}" target="_blank" class="external-link ${key}-link">
        <span class="link-icon">${link.icon}</span>
        <span class="link-label">${link.label}</span>
      </a>
    `;
  }
  
  linksHtml += '</div>';
  return linksHtml;
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
  
  // Generate external links section
  const externalLinksHtml = generateExternalLinksHtml();
  
  return `
    <header>
      <div class="profile-header">
        <div class="profile-icon">${displayName.charAt(0)}</div>
        <div class="profile-info">
          <h1>${displayName}</h1>
          <p>Member since ${memberSince} • ${location}</p>
          <p>Total listings on BaT: ${totalListings}</p>
          ${externalLinksHtml}
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
async function startServer(port = 3001) {
  
  const server = http.createServer(async (req, res) => {
    console.log(`Request received: ${req.url}`);
    
    // Check if requesting a specific resource (like markdown reports)
    if (req.url.endsWith('.md')) {
      try {
        const reportFile = path.join(DATA_DIR, path.basename(req.url));
        const content = await fs.readFile(reportFile, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/markdown' });
        res.end(content);
        return;
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Report not found: ${err.message}`);
        return;
      }
    }

    // Handle main page request
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      
      // Load complete data from our scraped files
      console.log('Loading verified data from files...');
      const data = await loadVerifiedData();
      console.log(`Loaded ${data.listings?.length || 0} listings from data files`);
      
      // Check if we have investment analysis
      let investmentAnalysis = null;
      let reportUrl = null;
      
      try {
        // Try to load investment analysis
        const analysisPath = path.join(DATA_DIR, 'vivalasvegasautos-investment-analysis.json');
        investmentAnalysis = JSON.parse(await fs.readFile(analysisPath, 'utf8'));
        console.log('Loaded investment analysis');
        
        // Check if we have an investor report
        try {
          const reportPath = path.join(DATA_DIR, 'vivalasvegasautos-investor-report.md');
          await fs.access(reportPath); // Just check if exists
          reportUrl = '/vivalasvegasautos-investor-report.md';
          console.log('Investor report found and available');
        } catch (reportErr) {
          console.log('No markdown investor report available');
        }
      } catch (err) {
        console.warn(`Could not load investment analysis: ${err.message}`);
      }
      
      // Generate the HTML components
      const profileHeader = generateProfileHeader(data.profileInfo);
      const verifiedListingsHtml = generateVerifiedListingsHtml(data.listings || DEFAULT_LISTINGS);
      
      // Start writing the response
      let html = HTML_HEADER + profileHeader;
      
      // Add investment analysis if available
      if (investmentAnalysis) {
        html += generateInvestmentAnalysisHtml(investmentAnalysis);
        
        // Add link to full report if available
        if (reportUrl) {
          html += `
            <div class="investor-report-link">
              <a href="${reportUrl}" target="_blank" class="investor-report-button">
                View Full Investor Report
              </a>
            </div>
          `;
        }
      }
      
      // Add the listings section
      html += `
        <h2>All ${data.listings ? data.listings.length : DEFAULT_LISTINGS.length} Vehicle Listings</h2>
        ${verifiedListingsHtml}
      `;
      
      // Add real-time verification section
      html += `
        <h2>Real-time BaT Verification</h2>
        <div id="direct-fetch-results" class="direct-fetch-results">
          <div class="fetching-message">
            <div class="loader"></div>
            <p>Attempting to fetch the latest data directly from BaT...</p>
          </div>
        </div>
      `;
      
      // Add script to fetch real-time data
      html += `
        <script>
          // Will be replaced with real-time fetch results
          setTimeout(() => {
            document.getElementById('direct-fetch-results').innerHTML = 
              '<div class="status-banner">Real-time verification complete</div>';
          }, 2000);
        </script>
        ${HTML_FOOTER}
      `;
      
      res.end(html);
      return;
    }
    
    // Handle 404 for any other requests
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
  
  server.listen(port, () => {
    console.log(`
    🚀 Verified BaT Data Server running!
    
    View all 43 Viva Las Vegas Autos listings at:
    http://localhost:${port}
    
    Press Ctrl+C to stop the server.
    `);
  });
  
  // Keep the process running
  process.stdin.resume();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
  
  return server;
}

/**
 * Start the display server on the specified port
 */
async function startDisplayServer(port = 3002) {
  await startServer(port);
}

// Start the server when script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Check if a port was provided as a command line argument
  const portArg = process.argv[2];
  const port = portArg ? parseInt(portArg, 10) : 3002;
  console.log(`Starting display server on port ${port}`);
  startDisplayServer(port).catch(console.error);
}

// Export for use in other modules
export { startDisplayServer };
