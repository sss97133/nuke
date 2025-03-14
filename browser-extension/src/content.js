/**
 * Nuke Vehicle Discovery Browser Extension
 * Content Script - Detects vehicle listings and injects discovery buttons
 */

// Configuration
const config = {
  // DOM selectors for different platforms
  selectors: {
    craigslist: {
      listingContainer: '.result-info, .postinginfos',
      detailsContainer: '.mapAndAttrs, .attrgroup',
      titleElement: '.postingtitletext > h2, .postingtitle > h2',
      priceElement: '.price',
      imageContainer: '#thumbs, .swipe-wrap'
    },
    facebook: {
      listingContainer: '[data-testid="marketplace_pdp_component"]',
      detailsContainer: '[data-testid="marketplace_pdp_component"] div[style*="flex-direction: column"]',
      titleElement: '[data-testid="marketplace_pdp_component"] h1',
      priceElement: '[data-testid="marketplace_pdp_component"] span[style*="font-size: 24px"]',
      imageContainer: '[data-testid="marketplace_pdp_component"] div[style*="overflow: hidden"]'
    }
  },
  // Brand colors for the injected UI elements
  colors: {
    primary: '#3e63dd',
    secondary: '#f4f7ff',
    accent: '#ff4d4f',
    text: '#ffffff',
    background: 'rgba(62, 99, 221, 0.1)'
  }
};

// State
let currentPlatform = null;
let currentListing = null;
let nukeButtonInjected = false;
let nukeOverlayInjected = false;

/**
 * Determines which platform (craigslist/facebook) the user is currently on
 * @returns {string|null} The current platform or null if not supported
 */
function detectPlatform() {
  const url = window.location.href;
  if (url.includes('craigslist.org')) {
    return 'craigslist';
  } else if (url.includes('facebook.com/marketplace')) {
    return 'facebook';
  }
  return null;
}

/**
 * Extracts vehicle information from the current page based on platform
 * @param {string} platform - The current platform (craigslist/facebook)
 * @returns {Object} Extracted vehicle data
 */
function extractVehicleData(platform) {
  let vehicle = {
    title: '',
    price: '',
    year: null,
    make: '',
    model: '',
    description: '',
    images: [],
    url: window.location.href,
    source: platform,
    discovered_at: new Date().toISOString()
  };

  const selectors = config.selectors[platform];

  if (platform === 'craigslist') {
    // Extract data from Craigslist
    const titleEl = document.querySelector(selectors.titleElement);
    if (titleEl) {
      vehicle.title = titleEl.textContent.trim();
      
      // Try to parse year, make, model from title
      const titleParts = vehicle.title.split(' ');
      if (titleParts.length >= 3) {
        const yearCandidate = parseInt(titleParts[0], 10);
        if (!isNaN(yearCandidate) && yearCandidate > 1900 && yearCandidate < 2100) {
          vehicle.year = yearCandidate;
          vehicle.make = titleParts[1];
          vehicle.model = titleParts.slice(2).join(' ');
        }
      }
    }
    
    const priceEl = document.querySelector(selectors.priceElement);
    if (priceEl) {
      vehicle.price = priceEl.textContent.trim();
    }
    
    // Extract images
    const thumbs = document.querySelectorAll('#thumbs img');
    if (thumbs.length > 0) {
      vehicle.images = Array.from(thumbs).map(img => {
        // Convert thumbnail URL to full-size image URL
        return img.src.replace('/50x50c/', '/600x450/');
      });
    }
    
    // Extract description
    const postingBody = document.querySelector('#postingbody');
    if (postingBody) {
      vehicle.description = postingBody.textContent.trim();
    }
    
    // Extract additional details like odometer, condition, etc.
    const attrGroups = document.querySelectorAll('.attrgroup');
    const vehicleDetails = {};
    
    attrGroups.forEach(group => {
      const spans = group.querySelectorAll('span');
      spans.forEach(span => {
        const text = span.textContent.trim();
        if (text.includes(':')) {
          const [key, value] = text.split(':').map(s => s.trim());
          vehicleDetails[key.toLowerCase()] = value;
        } else if (text.includes('odometer')) {
          const odometerMatch = text.match(/(\d+)k?\s*odometer/i);
          if (odometerMatch) {
            vehicleDetails.odometer = odometerMatch[1];
          }
        } else if (text.includes('VIN')) {
          const vinMatch = text.match(/VIN:\s*([A-Z0-9]+)/i);
          if (vinMatch) {
            vehicle.vin = vinMatch[1];
          }
        }
      });
    });
    
    // Add extracted details to vehicle object
    vehicle.details = vehicleDetails;
    
  } else if (platform === 'facebook') {
    // Extract data from Facebook Marketplace
    const titleEl = document.querySelector(selectors.titleElement);
    if (titleEl) {
      vehicle.title = titleEl.textContent.trim();
      
      // Try to parse year, make, model from title
      const titleParts = vehicle.title.split(' ');
      if (titleParts.length >= 3) {
        const yearCandidate = parseInt(titleParts[0], 10);
        if (!isNaN(yearCandidate) && yearCandidate > 1900 && yearCandidate < 2100) {
          vehicle.year = yearCandidate;
          vehicle.make = titleParts[1];
          vehicle.model = titleParts.slice(2).join(' ');
        }
      }
    }
    
    const priceEl = document.querySelector(selectors.priceElement);
    if (priceEl) {
      vehicle.price = priceEl.textContent.trim();
    }
    
    // Extract images - Facebook uses a complex structure, but we can try to get main images
    const imageContainers = document.querySelectorAll('[data-testid="marketplace_pdp_component"] img');
    if (imageContainers.length > 0) {
      vehicle.images = Array.from(imageContainers)
        .filter(img => img.src && img.src.includes('scontent'))
        .map(img => img.src);
    }
    
    // Extract description
    const descriptionEls = document.querySelectorAll('[data-testid="marketplace_pdp_component"] span');
    descriptionEls.forEach(el => {
      if (el.textContent.length > 50) {
        vehicle.description = el.textContent.trim();
      }
    });
    
    // Extract additional details from structured data (when available)
    const detailsContainers = document.querySelectorAll('[data-testid="marketplace_pdp_component"] div[style*="flex-direction: column"]');
    const vehicleDetails = {};
    
    detailsContainers.forEach(container => {
      const rows = container.querySelectorAll('div[style*="flex-direction: row"]');
      rows.forEach(row => {
        const spans = row.querySelectorAll('span');
        if (spans.length >= 2) {
          const key = spans[0].textContent.trim().toLowerCase();
          const value = spans[1].textContent.trim();
          vehicleDetails[key] = value;
          
          // Special handling for VIN
          if (key.includes('vin')) {
            vehicle.vin = value;
          }
        }
      });
    });
    
    // Add extracted details to vehicle object
    vehicle.details = vehicleDetails;
  }
  
  // Clean up the data
  if (vehicle.price) {
    vehicle.price = vehicle.price.replace(/[^0-9.]/g, '');
    vehicle.price = parseFloat(vehicle.price) || 0;
  }
  
  return vehicle;
}

/**
 * Creates and injects the "Discover with Nuke" button
 */
function injectNukeButton() {
  if (nukeButtonInjected) return;
  
  const platform = detectPlatform();
  if (!platform) return;
  
  const selectors = config.selectors[platform];
  const container = document.querySelector(selectors.detailsContainer);
  if (!container) return;
  
  // Create the button
  const button = document.createElement('button');
  button.id = 'nuke-discover-button';
  button.textContent = 'Discover with Nuke';
  button.style.cssText = `
    background-color: ${config.colors.primary};
    color: ${config.colors.text};
    border: none;
    border-radius: 4px;
    padding: 8px 16px;
    font-weight: bold;
    margin-top: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.3s ease;
  `;
  
  // Add icon
  const icon = document.createElement('span');
  icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  icon.style.marginRight = '8px';
  button.prepend(icon);
  
  // Add hover effect
  button.addEventListener('mouseover', () => {
    button.style.backgroundColor = '#2a4cb9';
  });
  
  button.addEventListener('mouseout', () => {
    button.style.backgroundColor = config.colors.primary;
  });
  
  // Add click handler
  button.addEventListener('click', (e) => {
    e.preventDefault();
    showNukeOverlay();
  });
  
  // Inject button
  container.appendChild(button);
  nukeButtonInjected = true;
  
  console.log('Nuke: Vehicle discovery button injected');
}

/**
 * Creates and shows the Nuke overlay for confirming vehicle discovery
 */
function showNukeOverlay() {
  if (nukeOverlayInjected) {
    document.getElementById('nuke-overlay').style.display = 'flex';
    return;
  }
  
  const platform = detectPlatform();
  if (!platform) return;
  
  // Extract vehicle data
  currentListing = extractVehicleData(platform);
  
  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'nuke-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    font-family: Arial, sans-serif;
  `;
  
  // Create modal content
  const modal = document.createElement('div');
  modal.style.cssText = `
    background-color: white;
    border-radius: 8px;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    padding: 24px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  `;
  
  // Create header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  `;
  
  const title = document.createElement('h2');
  title.textContent = 'Discover Vehicle with Nuke';
  title.style.margin = '0';
  
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  `;
  closeBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
  });
  
  header.appendChild(title);
  header.appendChild(closeBtn);
  
  // Create vehicle preview
  const preview = document.createElement('div');
  preview.style.cssText = `
    margin-bottom: 20px;
    padding: 16px;
    background-color: ${config.colors.background};
    border-radius: 4px;
  `;
  
  const vehicleTitle = document.createElement('h3');
  vehicleTitle.textContent = currentListing.title;
  vehicleTitle.style.marginTop = '0';
  
  const vehicleDetails = document.createElement('div');
  vehicleDetails.style.cssText = `
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 16px;
  `;
  
  // Add extracted details
  const details = [
    { label: 'Year', value: currentListing.year || 'Unknown' },
    { label: 'Make', value: currentListing.make || 'Unknown' },
    { label: 'Model', value: currentListing.model || 'Unknown' },
    { label: 'Price', value: currentListing.price ? `$${currentListing.price}` : 'Unknown' },
    { label: 'VIN', value: currentListing.vin || 'Unknown' },
    { label: 'Source', value: platform === 'craigslist' ? 'Craigslist' : 'Facebook Marketplace' },
  ];
  
  details.forEach(detail => {
    const detailItem = document.createElement('div');
    detailItem.innerHTML = `<strong>${detail.label}:</strong> ${detail.value}`;
    vehicleDetails.appendChild(detailItem);
  });
  
  // Add thumbnail if available
  let thumbnail = null;
  if (currentListing.images && currentListing.images.length > 0) {
    thumbnail = document.createElement('div');
    thumbnail.style.cssText = `
      width: 100%;
      height: 200px;
      background-image: url(${currentListing.images[0]});
      background-size: cover;
      background-position: center;
      border-radius: 4px;
      margin-bottom: 16px;
    `;
  }
  
  // Add title, details, and thumbnail to preview
  preview.appendChild(vehicleTitle);
  if (thumbnail) preview.appendChild(thumbnail);
  preview.appendChild(vehicleDetails);
  
  // Create actions section
  const actions = document.createElement('div');
  actions.style.cssText = `
    display: flex;
    justify-content: space-between;
    gap: 12px;
  `;
  
  // Create cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    flex: 1;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background-color: white;
    cursor: pointer;
  `;
  cancelBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
  });
  
  // Create discover button
  const discoverBtn = document.createElement('button');
  discoverBtn.textContent = 'Discover Vehicle';
  discoverBtn.style.cssText = `
    flex: 2;
    padding: 10px;
    border: none;
    border-radius: 4px;
    background-color: ${config.colors.primary};
    color: white;
    font-weight: bold;
    cursor: pointer;
  `;
  discoverBtn.addEventListener('click', () => {
    discoverVehicle(currentListing);
  });
  
  actions.appendChild(cancelBtn);
  actions.appendChild(discoverBtn);
  
  // Assemble modal
  modal.appendChild(header);
  modal.appendChild(preview);
  modal.appendChild(actions);
  
  // Add modal to overlay
  overlay.appendChild(modal);
  
  // Add overlay to page
  document.body.appendChild(overlay);
  nukeOverlayInjected = true;
}

/**
 * Sends vehicle data to the Nuke platform
 * @param {Object} vehicle - The vehicle data to send
 */
async function discoverVehicle(vehicle) {
  // Get the status display element or create one
  let statusDisplay = document.getElementById('nuke-status');
  if (!statusDisplay) {
    statusDisplay = document.createElement('div');
    statusDisplay.id = 'nuke-status';
    statusDisplay.style.cssText = `
      margin-top: 16px;
      padding: 12px;
      border-radius: 4px;
      text-align: center;
    `;
    document.getElementById('nuke-overlay').querySelector('div').appendChild(statusDisplay);
  }
  
  try {
    // Show loading state
    statusDisplay.style.backgroundColor = '#f0f0f0';
    statusDisplay.innerHTML = '<div style="display: flex; justify-content: center; align-items: center;"><div class="nuke-spinner"></div><span style="margin-left: 10px;">Discovering vehicle...</span></div>';
    
    // Send message to background script to handle the API call
    chrome.runtime.sendMessage({
      action: 'discoverVehicle',
      data: vehicle
    }, (response) => {
      if (response.success) {
        // Success state
        statusDisplay.style.backgroundColor = '#e6f7e6';
        statusDisplay.innerHTML = `
          <div style="color: #2e7d32; font-weight: bold;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 8px;">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/>
            </svg>
            Vehicle discovered successfully!
          </div>
          <p>This vehicle has been added to your Nuke profile.</p>
          <button id="nuke-view-profile" style="margin-top: 10px; padding: 8px 16px; background-color: ${config.colors.primary}; color: white; border: none; border-radius: 4px; cursor: pointer;">View in Profile</button>
        `;
        
        // Add event listener to view profile button
        document.getElementById('nuke-view-profile').addEventListener('click', () => {
          window.open(response.profileUrl, '_blank');
        });
        
        // Close the overlay after 3 seconds
        setTimeout(() => {
          document.getElementById('nuke-overlay').style.display = 'none';
        }, 3000);
      } else {
        // Error state
        statusDisplay.style.backgroundColor = '#fdecea';
        statusDisplay.innerHTML = `
          <div style="color: #d32f2f; font-weight: bold;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 8px;">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/>
            </svg>
            Error discovering vehicle
          </div>
          <p>${response.error || 'An unexpected error occurred.'}</p>
          <button id="nuke-try-again" style="margin-top: 10px; padding: 8px 16px; background-color: ${config.colors.primary}; color: white; border: none; border-radius: 4px; cursor: pointer;">Try Again</button>
        `;
        
        // Add event listener to try again button
        document.getElementById('nuke-try-again').addEventListener('click', () => {
          discoverVehicle(vehicle);
        });
      }
    });
  } catch (error) {
    console.error('Error discovering vehicle:', error);
    
    // Error state
    statusDisplay.style.backgroundColor = '#fdecea';
    statusDisplay.innerHTML = `
      <div style="color: #d32f2f; font-weight: bold;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 8px;">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/>
        </svg>
        Error discovering vehicle
      </div>
      <p>${error.message || 'An unexpected error occurred.'}</p>
      <button id="nuke-try-again" style="margin-top: 10px; padding: 8px 16px; background-color: ${config.colors.primary}; color: white; border: none; border-radius: 4px; cursor: pointer;">Try Again</button>
    `;
    
    // Add event listener to try again button
    document.getElementById('nuke-try-again').addEventListener('click', () => {
      discoverVehicle(vehicle);
    });
  }
}

// Add CSS for spinner
const style = document.createElement('style');
style.textContent = `
  .nuke-spinner {
    border: 3px solid rgba(0, 0, 0, 0.1);
    border-radius: 50%;
    border-top: 3px solid ${config.colors.primary};
    width: 16px;
    height: 16px;
    animation: nuke-spin 1s linear infinite;
  }
  
  @keyframes nuke-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

// Add event listeners for page changes (especially useful for SPA-like websites)
const observer = new MutationObserver(() => {
  // Avoid excessive injection attempts
  setTimeout(() => {
    if (!nukeButtonInjected) {
      injectNukeButton();
    }
  }, 500);
});

// Start observing
observer.observe(document.body, { childList: true, subtree: true });

// Initial injection
window.addEventListener('load', () => {
  injectNukeButton();
});

// Initialize immediately if document is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  injectNukeButton();
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCurrentVehicle') {
    const platform = detectPlatform();
    if (platform) {
      sendResponse({ 
        vehicle: extractVehicleData(platform),
        success: true 
      });
    } else {
      sendResponse({ success: false, error: 'Unsupported platform' });
    }
    return true;
  }
});

console.log('Nuke: Vehicle Discovery content script loaded');
