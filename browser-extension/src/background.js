/**
 * Nuke Vehicle Discovery Browser Extension
 * Background Script - Handles API communication and authentication
 */

// API Configuration
const API_CONFIG = {
  baseUrl: 'https://api.nuke.app',  // Production API endpoint
  devBaseUrl: 'http://localhost:3000', // Development API endpoint when testing locally
  endpoints: {
    discover: '/vehicles/discover',
    timeline: '/vehicles/timeline/add',
    vehicles: '/vehicles',
    user: '/users',
    auth: '/auth',
    profile: '/profile'
  },
  // For testing, we'll use the active environment
  get activeBaseUrl() {
    // During development, you might want to use the dev endpoint
    // You can toggle between environments as needed
    return this.baseUrl;
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
 * Clears the authentication state and properly signs out the user
 * @returns {Promise<void>}
 */
async function clearAuthState() {
  try {
    // If we have a token, try to revoke it properly on the server
    if (authState.token) {
      try {
        // Make API call to revoke the token
        await fetch(`${API_CONFIG.baseUrl}/auth/revoke-token`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authState.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token: authState.token })
        });
      } catch (error) {
        console.warn('Error revoking token on server:', error);
        // Continue with local sign-out even if server call fails
      }
    }
    
    // Clear auth state
    authState = {
      token: null,
      userId: null,
      isAuthenticated: false,
      lastChecked: null
    };
    
    // Clear from storage - also remove user email and discovered vehicles
    chrome.storage.local.remove(['nukeAuthToken', 'nukeUserId', 'nukeLastChecked', 'nukeUserEmail']);
    
    // Keep discovered vehicles but mark them as not synced
    chrome.storage.local.get(['discoveredVehicles'], (result) => {
      if (result.discoveredVehicles && Array.isArray(result.discoveredVehicles)) {
        const vehicles = result.discoveredVehicles.map(vehicle => ({
          ...vehicle,
          synced: false
        }));
        chrome.storage.local.set({ discoveredVehicles: vehicles });
      }
    });
    
    // Notify popup if open
    chrome.runtime.sendMessage({
      action: 'signOut',
      success: true
    });
  } catch (error) {
    console.error('Error during sign-out:', error);
  }
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
    
    console.log('Discovering vehicle:', vehicle);
    
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
    // Ensure required fields exist and have default values if missing
    const vehicleData = {
      vin: vehicle.vin || null,
      year: vehicle.year || null,
      make: vehicle.make || '',
      model: vehicle.model || '',
      title: vehicle.title || 'Unknown Vehicle',
      description: vehicle.description || '',
      user_id: authState.userId,
      // Ensure URL is always available by using current tab URL as fallback
      source_url: (vehicle.url || window.location.href || ''),
      price: vehicle.price || '',
      public_vehicle: false,  // Default to private
      // Store all available data, even if some fields are missing
      discovered_data: {
        ...vehicle,
        // Ensure URL always exists in the discovered data
        url: (vehicle.url || window.location.href || ''),
      },
      timeline_events: [timelineEvent]
    };
    
    console.log('Prepared vehicle data for API:', vehicleData);
    
    // Make the actual API call
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
    
    // Store the discovered vehicle in local storage for recent list
    chrome.storage.local.get(['discoveredVehicles'], (result) => {
      const vehicles = result.discoveredVehicles || [];
      vehicles.unshift(responseData); // Add to beginning of array
      
      // Keep only the 10 most recent discoveries
      const recentVehicles = vehicles.slice(0, 10);
      chrome.storage.local.set({ discoveredVehicles: recentVehicles });
    });
    
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
 * Legacy authentication handler - kept for reference
 * NOT used in production
 */
async function handleAuthenticationLegacy() {
  try {
    // Create a direct login URL to your Nuke platform
    const authUrl = `${API_CONFIG.baseUrl}/auth/extension-login?redirect=${encodeURIComponent(chrome.identity.getRedirectURL())}`;
    
    console.log('Starting auth flow with URL:', authUrl);
    
    // Launch the web auth flow
    chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true
    }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        console.error('Auth error:', chrome.runtime.lastError);
        chrome.runtime.sendMessage({
          action: 'authError', 
          error: chrome.runtime.lastError.message
        });
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
        } else {
          console.error('Auth failed: Missing token or userId in redirect');
          chrome.runtime.sendMessage({
            action: 'authError', 
            error: 'Failed to extract authentication data'
          });
        }
      } else {
        console.error('Auth failed: No redirect URL returned');
        chrome.runtime.sendMessage({
          action: 'authError', 
          error: 'No redirect URL returned'
        });
      }
    });
  } catch (error) {
    console.error('Error during authentication:', error);
    chrome.runtime.sendMessage({
      action: 'authError', 
      error: error.message || 'Authentication failed'
    });
  }
}

/**
 * Handles user authentication via OAuth
 */
async function handleAuthentication() {
  try {
    // For debugging - let's log the redirect URL we'll use
    const redirectURL = chrome.identity.getRedirectURL();
    console.log('Redirect URL that will be used:', redirectURL);

    // Create a direct login URL to the Nuke platform with properly encoded redirect
    const authUrl = `${API_CONFIG.activeBaseUrl}${API_CONFIG.endpoints.auth}/extension-login?redirect=${encodeURIComponent(redirectURL)}`;
    
    console.log('Starting auth flow with URL:', authUrl);
    
    // Launch the web auth flow
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
      }, (redirectUrl) => {
        if (chrome.runtime.lastError) {
          console.error('Auth error:', chrome.runtime.lastError);
          chrome.runtime.sendMessage({
            action: 'authError', 
            error: chrome.runtime.lastError.message
          });
          reject(chrome.runtime.lastError);
          return;
        }
        
        console.log('Got redirect URL:', redirectUrl);
        
        if (redirectUrl) {
          // Extract token and user id from URL
          // Try different formats as the server might return data differently
          const url = new URL(redirectUrl);
          
          // Try hash parameters (SPA style)
          let params = new URLSearchParams(url.hash.substring(1));
          
          // If not in the hash, try query parameters
          if (!params.get('token') && !params.get('access_token')) {
            params = new URLSearchParams(url.search);
          }
          
          // Look for token in different possible names
          const token = params.get('token') || params.get('access_token');
          const userId = params.get('userId') || params.get('user_id');
          const email = params.get('email') || params.get('user_email');
          
          console.log('Extracted auth data:', { token: token ? 'EXISTS' : 'MISSING', userId: userId ? 'EXISTS' : 'MISSING', email: email ? 'EXISTS' : 'MISSING' });
          
          if (token && userId) {
            // Store auth info
            authState.token = token;
            authState.userId = userId;
            authState.isAuthenticated = true;
            authState.lastChecked = Date.now();
            
            chrome.storage.local.set({
              nukeAuthToken: token,
              nukeUserId: userId,
              nukeLastChecked: authState.lastChecked,
              nukeUserEmail: email || ''
            });
            
            // Notify any open popup
            chrome.runtime.sendMessage({
              action: 'authComplete',
              success: true,
              userEmail: email
            });
            
            resolve({ success: true, userEmail: email });
          } else {
            // For debugging - log the actual URL and params
            console.error('Auth failed: Missing token or userId in redirect');
            console.log('Redirect URL contents:', redirectUrl);
            console.log('URL parameters:', Array.from(params.entries()));
            
            const error = new Error('Failed to extract authentication data');
            chrome.runtime.sendMessage({
              action: 'authError', 
              error: error.message
            });
            reject(error);
          }
        } else {
          console.error('Auth failed: No redirect URL returned');
          const error = new Error('No redirect URL returned');
          chrome.runtime.sendMessage({
            action: 'authError', 
            error: error.message
          });
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('Error during authentication:', error);
    chrome.runtime.sendMessage({
      action: 'authError', 
      error: error.message || 'Authentication failed'
    });
    throw error;
  }
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'discoverVehicle') {
    handleVehicleDiscovery(message.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({
        success: false,
        error: error.message || 'Failed to discover vehicle'
      }));
    return true; // Required for async sendResponse
  }
  else if (message.action === 'signIn' || message.action === 'authenticate') {
    console.log('Received authentication request');
    // For troubleshooting - log the current manifest version
    chrome.runtime.getManifest && console.log('Manifest version:', chrome.runtime.getManifest().manifest_version);
    
    handleAuthentication()
      .then((result) => {
        console.log('Authentication successful, sending response');
        sendResponse({
          success: true,
          userEmail: result && result.userEmail
        });
      })
      .catch(error => {
        console.error('Authentication failed:', error);
        sendResponse({
          success: false,
          error: error.message || 'Authentication failed'
        });
      });
    return true; // Required for async sendResponse
  }
  else if (message.action === 'checkAuth') {
    sendResponse({
      isAuthenticated: authState.isAuthenticated,
      userId: authState.userId
    });
    return true;
  }
  else if (message.action === 'signOut' || message.action === 'logout') {
    clearAuthState()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error in sign-out:', error);
        sendResponse({ 
          success: false, 
          error: error.message || 'Sign-out failed'
        });
      });
    return true; // Required for async sendResponse
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
