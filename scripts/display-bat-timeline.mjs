#!/usr/bin/env node

/**
 * Display BaT Timeline Data
 * 
 * A simple viewer for the BaT timeline data we've collected.
 * Shows vehicle history in a structured format without requiring the full app.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

// Output directory for data files
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'bat-analysis');

// HTML templates
const HTML_HEADER = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vehicle Timeline Viewer</title>
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
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .stat-card {
      background: white;
      border-radius: 8px;
      padding: 15px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.05);
      text-align: center;
    }
    .stat-title {
      font-size: 14px;
      color: #666;
      margin-bottom: 5px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #2c3e50;
    }
    .timeline-container {
      background: white;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05);
    }
    .timeline {
      position: relative;
      margin: 40px 0;
    }
    .timeline::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 110px;
      width: 4px;
      background: #e0e0e0;
    }
    .timeline-item {
      position: relative;
      padding-left: 140px;
      margin-bottom: 30px;
    }
    .timeline-date {
      position: absolute;
      left: 0;
      width: 100px;
      text-align: right;
      color: #666;
      font-size: 14px;
    }
    .timeline-content {
      background: #fff;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      border-left: 3px solid #3498db;
      transition: all 0.3s ease;
    }
    .timeline-content:hover {
      transform: translateY(-3px);
      box-shadow: 0 5px 15px rgba(0,0,0,0.1);
    }
    .vehicle-card {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 20px;
    }
    .vehicle-image {
      width: 120px;
      height: 90px;
      object-fit: cover;
      border-radius: 5px;
      background: #f0f0f0;
    }
    .vehicle-title {
      margin: 0 0 10px;
      font-size: 18px;
      font-weight: 600;
    }
    .vehicle-price {
      font-weight: bold;
      color: #27ae60;
      margin-top: 5px;
      font-size: 18px;
    }
    .vehicle-meta {
      display: flex;
      gap: 10px;
      color: #666;
      font-size: 14px;
      margin-top: 5px;
    }
    .filter-options {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 20px;
    }
    .filter-button {
      background: #f0f0f0;
      border: none;
      padding: 8px 15px;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-button:hover, .filter-button.active {
      background: #3498db;
      color: white;
    }
    .confidence-indicator {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 5px;
    }
    .high-confidence {
      background-color: #27ae60;
    }
    .medium-confidence {
      background-color: #f39c12;
    }
    .low-confidence {
      background-color: #e74c3c;
    }
    .inventory-section {
      margin-top: 30px;
    }
    .inventory-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }
    .inventory-card {
      background: white;
      border-radius: 8px;
      padding: 15px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }
    .inventory-title {
      font-weight: bold;
      margin-bottom: 5px;
      font-size: 16px;
    }
    .inventory-count {
      display: flex;
      justify-content: space-between;
    }
    .inventory-bar {
      height: 10px;
      background: #e0e0e0;
      border-radius: 5px;
      margin-top: 5px;
      overflow: hidden;
    }
    .inventory-bar-fill {
      height: 100%;
      background: #3498db;
    }
    /* Navigation */
    nav {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    .nav-tab {
      padding: 10px 20px;
      background: #e0e0e0;
      border-radius: 5px 5px 0 0;
      cursor: pointer;
    }
    .nav-tab.active {
      background: white;
      font-weight: bold;
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    /* Contact info */
    .contact-methods {
      margin-top: 20px;
    }
    .contact-card {
      background: white;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 10px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }
    .contact-card h3 {
      margin-top: 0;
      font-size: 16px;
    }
    .notification-section {
      margin-top: 20px;
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.05);
    }
    .notification-button {
      background: #3498db;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-weight: bold;
      transition: all 0.2s;
    }
    .notification-button:hover {
      background: #2980b9;
    }
  </style>
</head>
<body>`;

const HTML_FOOTER = `
  <script>
    // Simple tab functionality
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active class from all tabs
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        // Add active class to clicked tab
        tab.classList.add('active');
        
        // Hide all tab content
        document.querySelectorAll('.tab-content').forEach(content => {
          content.classList.remove('active');
        });
        
        // Show the corresponding tab content
        const targetId = tab.dataset.target;
        document.getElementById(targetId).classList.add('active');
      });
    });
    
    // Filter functionality
    document.querySelectorAll('.filter-button').forEach(button => {
      button.addEventListener('click', () => {
        // Toggle active class
        button.classList.toggle('active');
        
        // Get all active filters
        const activeFilters = Array.from(document.querySelectorAll('.filter-button.active'))
          .map(el => el.dataset.make);
          
        // If no filters active, show all
        const timelineItems = document.querySelectorAll('.timeline-item');
        
        if (activeFilters.length === 0) {
          timelineItems.forEach(item => {
            item.style.display = 'block';
          });
          return;
        }
        
        // Filter timeline items
        timelineItems.forEach(item => {
          const make = item.dataset.make;
          if (activeFilters.includes(make)) {
            item.style.display = 'block';
          } else {
            item.style.display = 'none';
          }
        });
      });
    });
    
    // Notification subscription simulation
    document.querySelector('.notification-button').addEventListener('click', function() {
      this.textContent = 'Subscribed!';
      this.style.background = '#27ae60';
      alert('You would be notified when VivaLasVegasAutos lists new vehicles');
    });
  </script>
</body>
</html>`;

/**
 * Read the timeline data from JSON file
 */
async function loadTimelineData() {
  try {
    const timelineDataPath = path.join(DATA_DIR, 'timeline_events_vivalasvegasautos.json');
    const profileDataPath = path.join(DATA_DIR, 'unclaimed_profile_vivalasvegasautos.json');
    
    // Check if files exist
    try {
      await fs.access(timelineDataPath);
      await fs.access(profileDataPath);
    } catch (err) {
      console.error('Required data files not found:', err.message);
      return { events: [], profile: null };
    }
    
    // Read files
    const timelineJson = await fs.readFile(timelineDataPath, 'utf8');
    const profileJson = await fs.readFile(profileDataPath, 'utf8');
    
    return {
      events: JSON.parse(timelineJson),
      profile: JSON.parse(profileJson)
    };
  } catch (error) {
    console.error('Error loading timeline data:', error);
    return { events: [], profile: null };
  }
}

/**
 * Generate HTML for the profile header
 */
function generateProfileHeader(profile) {
  if (!profile) return '<h1>Vehicle Timeline</h1>';
  
  const { userInfo, salesActivity } = profile;
  
  return `
    <header>
      <div class="profile-header">
        <div class="profile-icon">${userInfo.displayName.charAt(0)}</div>
        <div>
          <h1>${userInfo.displayName}</h1>
          <p>Member since ${userInfo.memberSince} • ${userInfo.location}</p>
          <p>👍 ${userInfo.reputation?.thumbsUp || 0} Thumbs Up • 💬 ${userInfo.reputation?.totalComments || 0} Comments</p>
        </div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-title">Total Listings</div>
          <div class="stat-value">${salesActivity.totalListings}</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Sold Vehicles</div>
          <div class="stat-value">${salesActivity.soldVehicles}</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Active Listings</div>
          <div class="stat-value">${salesActivity.activeListings}</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Average Price</div>
          <div class="stat-value">$${salesActivity.avgPrice.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Total Sales</div>
          <div class="stat-value">$${salesActivity.totalSalesValue.toLocaleString()}</div>
        </div>
      </div>
    </header>
  `;
}

/**
 * Generate the filter buttons for timeline
 */
function generateFilterButtons(profile) {
  if (!profile || !profile.inventory || !profile.inventory.byMake) {
    return '';
  }
  
  const { byMake } = profile.inventory;
  
  const buttons = byMake.map(item => 
    `<button class="filter-button" data-make="${item.make}">${item.make} (${item.count})</button>`
  ).join('');
  
  return `
    <div class="filter-options">
      <strong>Filter by Make: </strong>
      ${buttons}
    </div>
  `;
}

/**
 * Generate the inventory section
 */
function generateInventorySection(profile) {
  if (!profile || !profile.inventory) return '';
  
  const { byMake, byDecade } = profile.inventory;
  
  const makeCards = byMake.map(item => `
    <div class="inventory-card">
      <div class="inventory-title">${item.make}</div>
      <div class="inventory-count">
        <span>${item.count} vehicles</span>
        <span>${item.percentage}%</span>
      </div>
      <div class="inventory-bar">
        <div class="inventory-bar-fill" style="width: ${item.percentage}%"></div>
      </div>
    </div>
  `).join('');
  
  const decadeCards = byDecade.map(item => `
    <div class="inventory-card">
      <div class="inventory-title">${item.decade}</div>
      <div class="inventory-count">
        <span>${item.count} vehicles</span>
        <span>${item.percentage}%</span>
      </div>
      <div class="inventory-bar">
        <div class="inventory-bar-fill" style="width: ${item.percentage}%"></div>
      </div>
    </div>
  `).join('');
  
  return `
    <div class="tab-content" id="inventory-tab">
      <h2>Inventory Analysis</h2>
      
      <h3>By Make</h3>
      <div class="inventory-grid">
        ${makeCards}
      </div>
      
      <h3>By Decade</h3>
      <div class="inventory-grid">
        ${decadeCards}
      </div>
    </div>
  `;
}

/**
 * Generate the communication profile section
 */
function generateCommunicationSection(profile) {
  if (!profile || !profile.communicationProfile) return '';
  
  const { communicationProfile } = profile;
  
  const commItems = Object.entries(communicationProfile).map(([key, value]) => `
    <div class="stat-card">
      <div class="stat-title">${key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}</div>
      <div class="stat-value" style="font-size: 18px;">${value}</div>
    </div>
  `).join('');
  
  return `
    <div class="tab-content" id="communication-tab">
      <h2>Communication Profile</h2>
      <div class="stats-grid">
        ${commItems}
      </div>
    </div>
  `;
}

/**
 * Generate the contact section
 */
function generateContactSection(profile) {
  if (!profile || !profile.contactSuggestions) return '';
  
  const { contactSuggestions } = profile;
  
  const contactCards = contactSuggestions.map(contact => `
    <div class="contact-card">
      <h3>${contact.method}</h3>
      <p>${contact.details || ''}</p>
      ${contact.query ? `<p><strong>Search Query:</strong> ${contact.query}</p>` : ''}
      ${contact.platforms ? `<p><strong>Platforms:</strong> ${contact.platforms.join(', ')}</p>` : ''}
    </div>
  `).join('');
  
  return `
    <div class="tab-content" id="contact-tab">
      <h2>Contact Information</h2>
      <p>This profile is currently unclaimed. Here are ways to help the dealer claim their profile:</p>
      
      <div class="contact-methods">
        ${contactCards}
      </div>
      
      <div class="notification-section">
        <h3>Get Notified About New Listings</h3>
        <p>You'll be notified when ${profile.userInfo.displayName} lists new vehicles on Bring a Trailer.</p>
        <button class="notification-button">Subscribe to Notifications</button>
      </div>
    </div>
  `;
}

/**
 * Generate the timeline HTML
 */
function generateTimelineHtml(events, profile) {
  if (!events || events.length === 0) {
    return '<div class="timeline-container"><p>No timeline events available.</p></div>';
  }
  
  // Sort events by date, descending
  const sortedEvents = [...events].sort((a, b) => new Date(b.date) - new Date(a.date));
  
  const timelineItems = sortedEvents.map(event => {
    const { date, confidence, metadata } = event;
    
    // Format date
    const eventDate = new Date(date);
    const formattedDate = eventDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    
    // Determine confidence class
    let confidenceClass = 'medium-confidence';
    if (confidence >= 0.9) confidenceClass = 'high-confidence';
    else if (confidence < 0.6) confidenceClass = 'low-confidence';
    
    // Format price
    const formattedPrice = metadata.price 
      ? `$${metadata.price.toLocaleString()}`
      : 'Price unknown';
    
    // Get placeholder image if missing
    const imageUrl = metadata.imageUrl || 'https://bringatrailer.com/wp-content/themes/fbs/images/bat-icon-256.png';
    
    return `
      <div class="timeline-item" data-make="${metadata.make || ''}">
        <div class="timeline-date">${formattedDate}</div>
        <div class="timeline-content">
          <div class="vehicle-card">
            <img class="vehicle-image" src="${imageUrl}" alt="${metadata.title || 'Vehicle'}" onerror="this.src='https://bringatrailer.com/wp-content/themes/fbs/images/bat-icon-256.png'">
            <div class="vehicle-details">
              <h3 class="vehicle-title">
                <span class="confidence-indicator ${confidenceClass}" title="Confidence: ${Math.round(confidence * 100)}%"></span>
                ${metadata.title || 'Unknown Vehicle'}
              </h3>
              <div class="vehicle-meta">
                <span>${metadata.year || ''}</span>
                ${metadata.make ? `<span>•</span><span>${metadata.make}</span>` : ''}
                ${metadata.model ? `<span>•</span><span>${metadata.model}</span>` : ''}
              </div>
              <div class="vehicle-price">${formattedPrice}</div>
              <div class="vehicle-meta">
                <span>Sold on Bring a Trailer</span>
                ${metadata.url ? `<span>•</span><a href="${metadata.url}" target="_blank">View Listing</a>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  return `
    <nav>
      <div class="nav-tab active" data-target="timeline-tab">Timeline</div>
      <div class="nav-tab" data-target="inventory-tab">Inventory</div>
      <div class="nav-tab" data-target="communication-tab">Communication</div>
      <div class="nav-tab" data-target="contact-tab">Contact</div>
    </nav>
    
    <div class="tab-content active" id="timeline-tab">
      <div class="timeline-container">
        <h2>Vehicle Timeline</h2>
        ${generateFilterButtons(profile)}
        <div class="timeline">
          ${timelineItems}
        </div>
      </div>
    </div>
    
    ${generateInventorySection(profile)}
    ${generateCommunicationSection(profile)}
    ${generateContactSection(profile)}
  `;
}

/**
 * Start the HTTP server
 */
async function startServer() {
  const port = 3000;
  
  const server = http.createServer(async (req, res) => {
    // Load the data
    const { events, profile } = await loadTimelineData();
    
    // Generate the HTML
    const profileHeader = generateProfileHeader(profile);
    const timelineHtml = generateTimelineHtml(events, profile);
    
    // Send the response
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      ${HTML_HEADER}
      ${profileHeader}
      ${timelineHtml}
      ${HTML_FOOTER}
    `);
  });
  
  server.listen(port, () => {
    console.log(`
    🚀 Server running!
    
    View Viva Las Vegas Autos profile and timeline at:
    http://localhost:${port}
    
    Press Ctrl+C to stop the server.
    `);
  });
}

// Start the server when script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch(console.error);
}
