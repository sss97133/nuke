/**
 * Nuke Vehicle Discovery Browser Extension
 * Popup Script - Handles the extension popup UI and interactions
 */

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
    chrome.runtime.sendMessage({ action: 'authenticate' });
    window.close();
  });
  
  // Sign out button
  elements.signOutButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'logout' }, () => {
      state.isAuthenticated = false;
      updateAuthUI();
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
  chrome.storage.local.get(['nukeUserEmail', 'nukeUserId'], (result) => {
    if (result.nukeUserEmail) {
      elements.userEmail.textContent = result.nukeUserEmail;
    } else {
      // TODO: Fetch user data from API
      elements.userEmail.textContent = 'Nuke User';
    }
  });
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
  
  // In a real implementation, this would call the API
  // For now, we'll use mock data
  setTimeout(() => {
    const mockVehicles = [
      {
        id: 'v1',
        title: '1987 GMC Suburban',
        year: 1987,
        make: 'GMC',
        model: 'Suburban',
        price: 5500,
        images: ['https://example.com/image1.jpg'],
        source: 'craigslist',
        discovered_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'v2',
        title: '2018 Tesla Model 3',
        year: 2018,
        make: 'Tesla',
        model: 'Model 3',
        price: 35000,
        images: ['https://example.com/image2.jpg'],
        source: 'facebook',
        discovered_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
      }
    ];
    
    state.recentVehicles = mockVehicles;
    updateRecentVehiclesUI();
  }, 1000);
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
    card.className = 'card vehicle-card';
    
    // Create image element
    const imageDiv = document.createElement('div');
    imageDiv.className = 'vehicle-image';
    if (vehicle.images && vehicle.images.length > 0) {
      imageDiv.style.backgroundImage = `url(${vehicle.images[0]})`;
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
  if (!state.currentVehicle) return;
  
  // Update button to show loading state
  elements.discoverButton.textContent = 'Discovering...';
  elements.discoverButton.disabled = true;
  
  // Send message to background script to handle discovery
  chrome.runtime.sendMessage({
    action: 'discoverVehicle',
    data: state.currentVehicle
  }, (response) => {
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
          chrome.runtime.sendMessage({ action: 'authenticate' });
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
  if (message.action === 'authComplete') {
    if (message.success) {
      state.isAuthenticated = true;
      updateAuthUI();
      loadUserData();
      loadRecentVehicles();
    }
  }
});

// Initialize when popup is loaded
document.addEventListener('DOMContentLoaded', initialize);
