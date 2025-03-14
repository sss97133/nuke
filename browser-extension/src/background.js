/**
 * Nuke Vehicle Discovery Browser Extension
 * Background Script - Handles API communication and authentication
 */

// API Configuration
const API_CONFIG = {
  baseUrl: 'https://api.nuke.app',  // Replace with your actual API endpoint
  endpoints: {
    discover: '/vehicles/discover',
    timeline: '/vehicles/timeline/add',
    auth: '/auth/session',
    profile: '/profile'
  }
};

// Authentication state
let authState = {
  token: null,
  userId: null,
  isAuthenticated: false,
  lastChecked: null
};

/**
 * Initializes the extension
 */
async function initialize() {
  console.log('Nuke: Vehicle Discovery extension initialized');
  
  // Load authentication state from storage
  chrome.storage.local.get(['nukeAuthToken', 'nukeUserId', 'nukeLastChecked'], (result) => {
    if (result.nukeAuthToken && result.nukeUserId) {
      authState.token = result.nukeAuthToken;
      authState.userId = result.nukeUserId;
      authState.lastChecked = result.nukeLastChecked || null;
      authState.isAuthenticated = true;
      
      // Validate token if it's been more than a day
      const now = Date.now();
      if (!authState.lastChecked || (now - authState.lastChecked > 24 * 60 * 60 * 1000)) {
        validateToken();
      }
    }
  });
}

/**
 * Validates the current authentication token
 */
async function validateToken() {
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.auth}/validate`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      // Update last checked time
      authState.lastChecked = Date.now();
      chrome.storage.local.set({ nukeLastChecked: authState.lastChecked });
    } else {
      // Token is invalid, clear auth state
      clearAuthState();
    }
  } catch (error) {
    console.error('Error validating token:', error);
  }
}

/**
 * Clears the authentication state
 */
function clearAuthState() {
  authState = {
    token: null,
    userId: null,
    isAuthenticated: false,
    lastChecked: null
  };
  
  chrome.storage.local.remove(['nukeAuthToken', 'nukeUserId', 'nukeLastChecked']);
}

/**
 * Handles the vehicle discovery process
 * @param {Object} vehicle - The vehicle data to discover
 * @returns {Promise<Object>} The result of the discovery
 */
async function handleVehicleDiscovery(vehicle) {
  try {
    // First, check if user is authenticated
    if (!authState.isAuthenticated) {
      return {
        success: false,
        error: 'You need to be signed in to Nuke to discover vehicles.',
        requiresAuth: true
      };
    }
    
    // Create timeline event with confidence scoring
    const now = new Date().toISOString();
    const timelineEvent = {
      vehicle_id: null,  // Will be assigned after vehicle creation
      event_type: 'discovery',
      source: vehicle.source,
      event_date: now,
      title: `Vehicle discovered on ${vehicle.source === 'craigslist' ? 'Craigslist' : 'Facebook Marketplace'}`,
      description: `This vehicle was discovered by the user while browsing ${vehicle.source === 'craigslist' ? 'Craigslist' : 'Facebook Marketplace'}.`,
      confidence_score: 0.8,  // Moderate confidence for discovered vehicles
      metadata: {
        listing_url: vehicle.url,
        price: vehicle.price,
        discovered_at: now
      },
      image_urls: vehicle.images || [],
      created_at: now
    };
    
    // Prepare vehicle data for API
    const vehicleData = {
      vin: vehicle.vin || null,
      year: vehicle.year || null,
      make: vehicle.make || '',
      model: vehicle.model || '',
      title: vehicle.title,
      description: vehicle.description,
      user_id: authState.userId,
      source_url: vehicle.url,
      price: vehicle.price,
      public_vehicle: false,  // Default to private
      discovered_data: vehicle,  // Store the original scraped data
      timeline_events: [timelineEvent]
    };
    
    // Send to API
    const response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.discover}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authState.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(vehicleData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: errorData.message || 'Failed to discover vehicle'
      };
    }
    
    const responseData = await response.json();
    
    // Return success response with profile URL
    return {
      success: true,
      vehicleId: responseData.id,
      profileUrl: `${API_CONFIG.baseUrl}${API_CONFIG.endpoints.profile}/${authState.userId}?tab=discovered`
    };
  } catch (error) {
    console.error('Error discovering vehicle:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred'
    };
  }
}

/**
 * Handles user authentication via OAuth
 */
async function handleAuthentication() {
  try {
    // Initiate OAuth flow with Facebook or direct Nuke auth
    chrome.identity.launchWebAuthFlow({
      url: `${API_CONFIG.baseUrl}/auth/extension-login?redirect=${chrome.identity.getRedirectURL()}`,
      interactive: true
    }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        console.error('Auth error:', chrome.runtime.lastError);
        return;
      }
      
      if (redirectUrl) {
        // Extract token and user id from URL
        const url = new URL(redirectUrl);
        const params = new URLSearchParams(url.hash.substring(1));
        
        const token = params.get('token');
        const userId = params.get('userId');
        
        if (token && userId) {
          // Store auth info
          authState.token = token;
          authState.userId = userId;
          authState.isAuthenticated = true;
          authState.lastChecked = Date.now();
          
          chrome.storage.local.set({
            nukeAuthToken: token,
            nukeUserId: userId,
            nukeLastChecked: authState.lastChecked
          });
          
          // Notify any open popup
          chrome.runtime.sendMessage({
            action: 'authComplete',
            success: true
          });
        }
      }
    });
  } catch (error) {
    console.error('Error during authentication:', error);
  }
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'discoverVehicle') {
    handleVehicleDiscovery(message.data)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message || 'An unexpected error occurred'
        });
      });
    return true;  // Indicates async response
  } else if (message.action === 'authenticate') {
    handleAuthentication()
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message || 'Authentication failed'
        });
      });
    return true;
  } else if (message.action === 'checkAuth') {
    sendResponse({
      isAuthenticated: authState.isAuthenticated,
      userId: authState.userId
    });
    return false;
  } else if (message.action === 'logout') {
    clearAuthState();
    sendResponse({ success: true });
    return false;
  }
});

// Extension popup events
chrome.action.onClicked.addListener((tab) => {
  // If we're on a vehicle listing page, trigger the discovery UI
  if (tab.url.includes('craigslist.org') || tab.url.includes('facebook.com/marketplace')) {
    chrome.tabs.sendMessage(tab.id, { action: 'showDiscoveryUI' });
  }
});

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

// Initialize when background script loads
initialize();
