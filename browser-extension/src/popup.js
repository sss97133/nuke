/**
 * Nuke Vehicle Discovery Browser Extension
 * Popup Script - Handles the extension popup UI and interactions
 */

// Initialize the API configuration
const API_CONFIG = {
  baseUrl: 'https://nuke.app/api',  // Replace with actual API URL when deploying
  endpoints: {
    discover: '/vehicles/discover',
    vehicles: '/vehicles',
    user: '/users',
    profile: '/profile',
    recent: '/vehicles/recent',
    timeline: '/timeline'
  }
};

// DOM Elements
const elements = {
  // Views
  signedInView: document.getElementById('signed-in-view'),
  notSignedInView: document.getElementById('not-signed-in-view'),
  
  // Tabs
  tabDiscover: document.getElementById('tab-discover'),
  tabRecent: document.getElementById('tab-recent'),
  tabSettings: document.getElementById('tab-settings'),
  
  // Tab Content
  discoverContent: document.getElementById('discover-content'),
  recentContent: document.getElementById('recent-content'),
  settingsContent: document.getElementById('settings-content'),
  
  // Discover Tab Elements
  currentVehicle: document.getElementById('current-vehicle'),
  notVehicleMessage: document.getElementById('not-vehicle-message'),
  vehicleImage: document.getElementById('vehicle-image'),
  vehicleTitle: document.getElementById('vehicle-title'),
  vehicleMeta: document.getElementById('vehicle-meta'),
  vehicleSource: document.getElementById('vehicle-source'),
  discoverButton: document.getElementById('discover-button'),
  
  // Recent Tab Elements
  recentVehicles: document.getElementById('recent-vehicles'),
  recentCount: document.getElementById('recent-count'),
  viewAllButton: document.getElementById('view-all-button'),
  
  // Settings Tab Elements
  userEmail: document.getElementById('user-email'),
  autoDiscover: document.getElementById('auto-discover'),
  saveHistory: document.getElementById('save-history'),
  signOutButton: document.getElementById('sign-out-button'),
  
  // Auth Elements
  signInButton: document.getElementById('sign-in-button')
};

// State
let state = {
  isAuthenticated: false,
  currentVehicle: null,
  currentTab: 'discover',
  recentVehicles: [],
  settings: {
    autoDiscover: false,
    saveHistory: true
  }
};

/**
 * Initializes the popup
 */
async function initialize() {
  // Check authentication status
  chrome.runtime.sendMessage({ action: 'checkAuth' }, (response) => {
    state.isAuthenticated = response.isAuthenticated;
    updateAuthUI();
    
    if (state.isAuthenticated) {
      loadUserData();
      loadRecentVehicles();
    }
  });
  
  // Check if we're on a vehicle listing page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentUrl = tabs[0].url;
    const isVehiclePage = 
      (currentUrl.includes('craigslist.org') && 
       (currentUrl.includes('/cars-trucks/') || 
        currentUrl.includes('/auto-parts/') || 
        currentUrl.includes('/motorcycles/'))) || 
      (currentUrl.includes('facebook.com/marketplace') && 
       currentUrl.includes('vehicles'));
    
    if (isVehiclePage) {
      loadCurrentVehicle(tabs[0].id);
    } else {
      elements.currentVehicle.style.display = 'none';
      elements.notVehicleMessage.style.display = 'block';
    }
  });
  
  // Load settings
  chrome.storage.local.get(['nukeSettings'], (result) => {
    if (result.nukeSettings) {
      state.settings = { ...state.settings, ...result.nukeSettings };
      updateSettingsUI();
    }
  });
  
  // Set up event listeners
  setupEventListeners();
}

/**
 * Sets up all event listeners for the popup UI
 */
function setupEventListeners() {
  // Tab navigation
  elements.tabDiscover.addEventListener('click', () => switchTab('discover'));
  elements.tabRecent.addEventListener('click', () => switchTab('recent'));
  elements.tabSettings.addEventListener('click', () => switchTab('settings'));
  
  // Discover button
  elements.discoverButton.addEventListener('click', handleDiscoverClick);
  
  // View all button
  elements.viewAllButton.addEventListener('click', () => {
    chrome.storage.local.get(['nukeUserId'], (result) => {
      if (result.nukeUserId) {
        chrome.tabs.create({ 
          url: `https://nuke.app/profile/${result.nukeUserId}?tab=discovered` 
        });
      }
    });
  });
  
  // Sign in button
  elements.signInButton.addEventListener('click', () => {
    // Show a loading indicator
    elements.signInButton.innerHTML = '<div class="spinner" style="width:16px;height:16px;margin:0 auto;"></div>';
    elements.signInButton.disabled = true;
    
    console.log('Sign in button clicked, sending authentication request');
    
    // Send message to background script to start real authentication flow
    chrome.runtime.sendMessage({ action: 'signIn' }, (response) => {
      if (response && response.success) {
        // Success is handled by the message listener
        console.log('Authentication request sent!');
      } else {
        console.error('Authentication request failed:', response && response.error);
        
        // Show error
        elements.signInButton.innerHTML = 'Sign In with Nuke';
        elements.signInButton.disabled = false;
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'status status-error';
        errorDiv.textContent = (response && response.error) || 'Authentication failed. Please try again.';
        elements.notSignedInView.insertBefore(errorDiv, elements.notSignedInView.firstChild);
        
        setTimeout(() => {
          errorDiv.remove();
        }, 5000);
      }
    });
  });
  
  // Sign out button
  elements.signOutButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'signOut' }, (response) => {
      if (response && response.success) {
        state.isAuthenticated = false;
        updateAuthUI();
        // Clear any displayed vehicle data
        elements.currentVehicle.style.display = 'none';
        elements.notVehicleMessage.style.display = 'block';
      }
    });
  });
  
  // Settings toggles
  elements.autoDiscover.addEventListener('change', (e) => {
    state.settings.autoDiscover = e.target.checked;
    saveSettings();
  });
  
  elements.saveHistory.addEventListener('change', (e) => {
    state.settings.saveHistory = e.target.checked;
    saveSettings();
  });
}

/**
 * Switches between tabs in the popup
 * @param {string} tabName - The tab to switch to
 */
function switchTab(tabName) {
  // Update state
  state.currentTab = tabName;
  
  // Update tab UI
  elements.tabDiscover.classList.toggle('active', tabName === 'discover');
  elements.tabRecent.classList.toggle('active', tabName === 'recent');
  elements.tabSettings.classList.toggle('active', tabName === 'settings');
  
  // Show/hide content
  elements.discoverContent.style.display = tabName === 'discover' ? 'block' : 'none';
  elements.recentContent.style.display = tabName === 'recent' ? 'block' : 'none';
  elements.settingsContent.style.display = tabName === 'settings' ? 'block' : 'none';
}

/**
 * Updates the UI based on authentication state
 */
function updateAuthUI() {
  elements.signedInView.style.display = state.isAuthenticated ? 'block' : 'none';
  elements.notSignedInView.style.display = state.isAuthenticated ? 'none' : 'block';
}

/**
 * Updates the settings UI based on current settings
 */
function updateSettingsUI() {
  elements.autoDiscover.checked = state.settings.autoDiscover;
  elements.saveHistory.checked = state.settings.saveHistory;
}

/**
 * Saves settings to storage
 */
function saveSettings() {
  chrome.storage.local.set({ nukeSettings: state.settings });
}

/**
 * Loads user data from storage or API
 */
function loadUserData() {
  chrome.storage.local.get(['nukeUserEmail', 'nukeUserId', 'nukeAuthToken'], (result) => {
    if (result.nukeUserEmail) {
      elements.userEmail.textContent = result.nukeUserEmail;
    } else if (result.nukeAuthToken && result.nukeUserId) {
      // If we have a token but no email, try to fetch user data from API
      fetchUserProfile(result.nukeAuthToken, result.nukeUserId);
    } else {
      elements.userEmail.textContent = 'Nuke User';
    }
  });
}

/**
 * Fetches user profile data from the API
 * @param {string} token - Authentication token
 * @param {string} userId - User ID
 */
async function fetchUserProfile(token, userId) {
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.user}/${userId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch user profile');
    }
    
    const userData = await response.json();
    
    if (userData && userData.email) {
      elements.userEmail.textContent = userData.email;
      chrome.storage.local.set({ nukeUserEmail: userData.email });
    }
    
    return userData;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}

/**
 * Loads the current vehicle from the active tab
 * @param {number} tabId - The ID of the active tab
 */
function loadCurrentVehicle(tabId) {
  chrome.tabs.sendMessage(tabId, { action: 'getCurrentVehicle' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting current vehicle:', chrome.runtime.lastError);
      elements.currentVehicle.style.display = 'none';
      elements.notVehicleMessage.style.display = 'block';
      return;
    }
    
    if (response && response.success && response.vehicle) {
      state.currentVehicle = response.vehicle;
      updateCurrentVehicleUI();
      elements.currentVehicle.style.display = 'block';
      elements.notVehicleMessage.style.display = 'none';
    } else {
      elements.currentVehicle.style.display = 'none';
      elements.notVehicleMessage.style.display = 'block';
    }
  });
}

/**
 * Updates the UI with current vehicle data
 */
function updateCurrentVehicleUI() {
  const vehicle = state.currentVehicle;
  
  if (!vehicle) return;
  
  // Set title
  elements.vehicleTitle.textContent = vehicle.title || 'Unknown Vehicle';
  
  // Set meta info
  let metaText = '';
  if (vehicle.year) metaText += vehicle.year + ' ';
  if (vehicle.make) metaText += vehicle.make + ' ';
  if (vehicle.model) metaText += vehicle.model + ' ';
  if (vehicle.price) metaText += '• $' + vehicle.price;
  elements.vehicleMeta.textContent = metaText || 'Details not available';
  
  // Set source badge
  elements.vehicleSource.textContent = vehicle.source === 'craigslist' ? 'Craigslist' : 'Facebook';
  elements.vehicleSource.className = 'badge badge-' + vehicle.source;
  
  // Set image if available
  if (vehicle.images && vehicle.images.length > 0) {
    elements.vehicleImage.style.backgroundImage = `url(${vehicle.images[0]})`;
  } else if (vehicle.image_urls && vehicle.image_urls.length > 0) {
    // Handle the API response format which might have image_urls instead of images
    elements.vehicleImage.style.backgroundImage = `url(${vehicle.image_urls[0]})`;
  } else if (vehicle.timeline_events && vehicle.timeline_events.length > 0) {
    // Look for images in timeline events
    const eventWithImages = vehicle.timeline_events.find(event => 
      event.image_urls && event.image_urls.length > 0
    );
    
    if (eventWithImages && eventWithImages.image_urls.length > 0) {
      elements.vehicleImage.style.backgroundImage = `url(${eventWithImages.image_urls[0]})`;
    } else {
      elements.vehicleImage.style.backgroundImage = 'none';
      elements.vehicleImage.style.backgroundColor = '#e5e7eb';
    }
  } else {
    elements.vehicleImage.style.backgroundImage = 'none';
    elements.vehicleImage.style.backgroundColor = '#e5e7eb';
  }
}

/**
 * Loads recently discovered vehicles
 */
function loadRecentVehicles() {
  elements.recentVehicles.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  
  // First check storage for cached vehicles
  chrome.storage.local.get(['discoveredVehicles', 'nukeAuthToken', 'nukeUserId'], async (result) => {
    try {
      // If we have auth token and user id, fetch from API
      if (result.nukeAuthToken && result.nukeUserId) {
        const response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.vehicles}?user_id=${result.nukeUserId}&limit=10`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${result.nukeAuthToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch vehicles');
        }
        
        const data = await response.json();
        
        if (data && Array.isArray(data.vehicles)) {
          // Update storage with the latest vehicles
          chrome.storage.local.set({ discoveredVehicles: data.vehicles });
          
          state.recentVehicles = data.vehicles;
          updateRecentVehiclesUI();
          return;
        }
      }
      
      // Fall back to storage if API call fails or we're not authenticated
      if (result.discoveredVehicles && Array.isArray(result.discoveredVehicles)) {
        state.recentVehicles = result.discoveredVehicles;
        updateRecentVehiclesUI();
      } else {
        // No vehicles found
        state.recentVehicles = [];
        updateRecentVehiclesUI();
      }
    } catch (error) {
      console.error('Error loading recent vehicles:', error);
      
      // If we have cached vehicles in storage, use those
      if (result.discoveredVehicles && Array.isArray(result.discoveredVehicles)) {
        state.recentVehicles = result.discoveredVehicles;
      } else {
        state.recentVehicles = [];
      }
      
      updateRecentVehiclesUI();
    }
  });
}

/**
 * Updates the UI with recently discovered vehicles
 */
function updateRecentVehiclesUI() {
  const vehicles = state.recentVehicles;
  
  if (!vehicles || vehicles.length === 0) {
    elements.recentVehicles.innerHTML = '<div class="message">No vehicles discovered yet.</div>';
    elements.recentCount.textContent = '0 vehicles';
    return;
  }
  
  elements.recentCount.textContent = `${vehicles.length} vehicles`;
  elements.recentVehicles.innerHTML = '';
  
  vehicles.forEach(vehicle => {
    const card = document.createElement('div');
    card.className = 'card glass vehicle-card';
    
    // Create image element
    const imageDiv = document.createElement('div');
    imageDiv.className = 'vehicle-image';
    
    // Try to find an image from various possible sources in the API response
    let imageUrl = null;
    
    if (vehicle.images && vehicle.images.length > 0) {
      imageUrl = vehicle.images[0];
    } else if (vehicle.image_urls && vehicle.image_urls.length > 0) {
      imageUrl = vehicle.image_urls[0];
    } else if (vehicle.timeline_events && vehicle.timeline_events.length > 0) {
      // Look for images in timeline events
      const eventWithImages = vehicle.timeline_events.find(event => 
        event.image_urls && event.image_urls.length > 0
      );
      
      if (eventWithImages && eventWithImages.image_urls.length > 0) {
        imageUrl = eventWithImages.image_urls[0];
      }
    }
    
    if (imageUrl) {
      imageDiv.style.backgroundImage = `url(${imageUrl})`;
    } else {
      imageDiv.style.backgroundColor = '#e5e7eb';
    }
    
    // Create details container
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'vehicle-details';
    
    // Create title
    const title = document.createElement('h3');
    title.className = 'vehicle-title';
    title.textContent = vehicle.title;
    
    // Create meta info
    const meta = document.createElement('p');
    meta.className = 'vehicle-meta';
    let metaText = '';
    if (vehicle.year) metaText += vehicle.year + ' ';
    if (vehicle.make) metaText += vehicle.make + ' ';
    if (vehicle.model) metaText += vehicle.model + ' ';
    if (vehicle.price) metaText += '• $' + vehicle.price;
    meta.textContent = metaText;
    
    // Create source badge
    const source = document.createElement('span');
    source.className = 'badge badge-' + vehicle.source;
    source.textContent = vehicle.source === 'craigslist' ? 'Craigslist' : 'Facebook';
    
    // Assemble card
    detailsDiv.appendChild(title);
    detailsDiv.appendChild(meta);
    detailsDiv.appendChild(source);
    card.appendChild(imageDiv);
    card.appendChild(detailsDiv);
    
    // Add click handler to view vehicle
    card.addEventListener('click', () => {
      chrome.storage.local.get(['nukeUserId'], (result) => {
        if (result.nukeUserId) {
          chrome.tabs.create({ 
            url: `https://nuke.app/profile/${result.nukeUserId}/vehicle/${vehicle.id}` 
          });
        }
      });
    });
    
    elements.recentVehicles.appendChild(card);
  });
}

/**
 * Handles the discover button click
 */
function handleDiscoverClick() {
  if (!state.currentVehicle) {
    console.error('No vehicle to discover');
    return;
  }
  
  // Update button to show loading state
  elements.discoverButton.textContent = 'Discovering...';
  elements.discoverButton.disabled = true;
  
  // Get the current tab URL to ensure we have a valid URL for the vehicle
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs || !tabs.length) {
      console.error('Could not get current tab');
      return;
    }
    
    // Create a complete vehicle object with all required properties
    // This ensures we're using real data for the vehicle discovery
    const vehicleToDiscover = {
      ...state.currentVehicle,
      url: state.currentVehicle.url || tabs[0].url, // Ensure URL exists
      title: state.currentVehicle.title || 'Unknown Vehicle',
      description: state.currentVehicle.description || '',
      source: state.currentVehicle.source || 'extension',
      discovered_at: new Date().toISOString()
    };
    
    console.log('Discovering vehicle with data:', vehicleToDiscover);
    
    // Send message to background script to handle discovery
    chrome.runtime.sendMessage({
      action: 'discoverVehicle',
      data: vehicleToDiscover
    }, (response) => {
      console.log('Discovery response:', response);
      
      // Reset button
      elements.discoverButton.innerHTML = '<span class="icon">+</span> Discover This Vehicle';
      elements.discoverButton.disabled = false;
    
    if (response.success) {
      // Show success status and add to recent vehicles
      const statusDiv = document.createElement('div');
      statusDiv.className = 'status status-success';
      statusDiv.textContent = 'Vehicle successfully discovered!';
      elements.discoverContent.insertBefore(statusDiv, elements.currentVehicle);
      
      // Auto-switch to recent tab after discovery
      setTimeout(() => {
        switchTab('recent');
        loadRecentVehicles(); // Refresh the list
        
        // Remove status message after a while
        setTimeout(() => {
          statusDiv.remove();
        }, 5000);
      }, 1500);
    } else {
      // Show error status
      const statusDiv = document.createElement('div');
      statusDiv.className = 'status status-error';
      
      if (response.requiresAuth) {
        statusDiv.textContent = 'You need to sign in to discover vehicles.';
        
        // Add sign in button
        const signInBtn = document.createElement('button');
        signInBtn.textContent = 'Sign In';
        signInBtn.style.marginTop = '8px';
        signInBtn.addEventListener('click', () => {
          console.log('Sign in button clicked from error message');
          chrome.runtime.sendMessage({ action: 'signIn' });
          window.close();
        });
        
        statusDiv.appendChild(document.createElement('br'));
        statusDiv.appendChild(signInBtn);
      } else {
        statusDiv.textContent = response.error || 'Failed to discover vehicle.';
      }
      
      elements.discoverContent.insertBefore(statusDiv, elements.currentVehicle);
      
      // Remove status message after a while
      setTimeout(() => {
        statusDiv.remove();
      }, 5000);
    }
  });
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in popup:', message.action);
  
  if (message.action === 'authComplete') {
    if (message.success) {
      console.log('Authentication completed successfully');
      state.isAuthenticated = true;
      updateAuthUI();
      loadUserData();
      loadRecentVehicles();
      
      // If we have a userEmail from the authentication process, use it
      if (message.userEmail) {
        elements.userEmail.textContent = message.userEmail;
        chrome.storage.local.set({ nukeUserEmail: message.userEmail });
      }
    }
  } else if (message.action === 'authError') {
    console.error('Authentication error:', message.error);
    
    // Show error message to user
    const errorDiv = document.createElement('div');
    errorDiv.className = 'status status-error';
    errorDiv.textContent = message.error || 'Authentication failed. Please try again.';
    
    if (state.isAuthenticated) {
      // Show in the settings panel if already authenticated
      elements.settingsContent.insertBefore(errorDiv, elements.settingsContent.firstChild);
    } else {
      // Show in the not-signed-in view
      elements.notSignedInView.insertBefore(errorDiv, elements.notSignedInView.firstChild);
    }
    
    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
  }
});

// Initialize when popup is loaded
document.addEventListener('DOMContentLoaded', initialize);
