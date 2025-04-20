// Listen for downloadHtmlCopy messages from content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadHtmlCopy' && request.url && request.filename) {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: true
    });
  }
});

// --- VehiDex Popup Logic ---
import { supabase } from './supabaseClient.js';

// Get DOM elements
const captureBtn = document.getElementById('capture-vehicle');
const statusMsg = document.getElementById('status-message');
const countSpan = document.getElementById('count');

// Auth section
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const userEmail = document.getElementById('user-email');
const userName = document.getElementById('user-name');
const userInitial = document.getElementById('user-initial');
const anonModeBtn = document.getElementById('anon-mode-btn');
const loginPrompt = document.getElementById('login-prompt');

// Capture status elements
const statusIndicator = document.getElementById('status-indicator');

let currentUser = null;
let usingAnonymous = false;
let anonymousCaptureCount = 0;

// Helper: Show status
function showStatus(msg, type = 'info', timeout = 3000) {
  statusMsg.innerHTML = msg;
  statusMsg.className = `status ${type}`;
  statusMsg.style.display = 'flex';
  if (timeout > 0) setTimeout(() => { statusMsg.style.display = 'none'; }, timeout);
}

// Helper: Update vehicle count
function updateCount() {
  chrome.storage.local.get(['vehicles'], function(result) {
    const vehicles = result.vehicles || [];
    countSpan.textContent = vehicles.length;
  });
}

function updateAuthUI(user) {
  currentUser = user;

  if (user) {
    // User is logged in - show user info and hide login form
    loginForm.style.display = 'none';
    userInfo.style.display = 'block';
    
    // Update user information display
    userEmail.textContent = user.email || '';
    
    // Generate name from email if no name is available
    const displayName = user.user_metadata?.name || user.email.split('@')[0];
    userName.textContent = displayName;
    
    // Set avatar initial from first letter of name
    userInitial.textContent = displayName.charAt(0).toUpperCase();
    
    // Update capture button to show connection to Nuke's vehicle-centric platform
    captureBtn.classList.add('active');
    captureBtn.title = 'Capture vehicle data and send to your Nuke profile';
    
    // Reset anonymous mode when logged in
    usingAnonymous = false;
    anonymousCaptureCount = 0;
    
  } else if (usingAnonymous) {
    // User is using anonymous mode
    loginForm.style.display = 'none';
    userInfo.style.display = 'none';
    
    // Update capture button to show anonymous mode
    captureBtn.classList.add('active');
    captureBtn.title = 'Capture vehicle data anonymously';
    
    // Show login prompt after multiple anonymous captures
    if (anonymousCaptureCount >= 3 && loginPrompt) {
      loginPrompt.style.display = 'block';
    }
    
  } else {
    // User is not logged in - show login form
    loginForm.style.display = 'block';
    userInfo.style.display = 'none';
    
    // Update capture button to show login recommended
    captureBtn.classList.remove('active');
    captureBtn.title = 'Login recommended to attribute vehicle captures to your profile';
    
    // Hide login prompt initially
    if (loginPrompt) {
      loginPrompt.style.display = 'none';
    }
  }
}

// On load, check auth state
// Add helper function to pretty-print JSON data (for debugging/viewing captures)
function prettyFormatJSON(json) {
  if (!json) return 'No data';
  try {
    // If it's a string, parse it first
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    
    // Extract key vehicle data if available
    if (data.make && data.model) {
      const year = data.year || 'Unknown year';
      const make = data.make || '';
      const model = data.model || '';
      const price = data.price ? `$${data.price}` : 'Price unknown';
      const attrs = [];
      
      if (data.odometer) attrs.push(`${data.odometer} miles`);
      if (data.transmission) attrs.push(data.transmission);
      if (data.exterior_color) attrs.push(data.exterior_color);
      
      return `${year} ${make} ${model} - ${price}\n${attrs.join(', ')}`;
    }
    
    // Fall back to pretty JSON
    return JSON.stringify(data, null, 2);
  } catch (e) {
    console.error('Error formatting JSON:', e);
    return 'Invalid JSON data';
  }
}

// Enhanced session persistence for Nuke's vehicle-centric architecture
// Check local storage first for cached user and anonymous mode preference
chrome.storage.local.get(['nuke_user', 'anon_mode', 'anon_capture_count'], async (result) => {
  try {
    console.log('Checking auth state...');
    
    // Set anonymous capture count from storage or default to 0
    anonymousCaptureCount = result.anon_capture_count || 0;
    console.log('Anonymous capture count:', anonymousCaptureCount);
    
    // Important: Make login visible by default
    loginForm.style.display = 'block';
    
    if (result.nuke_user) {
      console.log('Found stored user:', result.nuke_user.email);
      // Use the cached user info initially for fast UI display
      updateAuthUI(result.nuke_user);
      
      // Still verify with Supabase to ensure token is valid
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // If still valid, update with latest user info
        updateAuthUI(user);
      } else {
        // Token expired, check if we should go to anon mode
        chrome.storage.local.remove('nuke_user');
        
        // If anon_mode was previously set, use it
        if (result.anon_mode) {
          usingAnonymous = true;
          updateAuthUI(null); // Will hide login form if in anon mode
        } else {
          // Show login form by default if not in anon mode
          usingAnonymous = false;
          updateAuthUI(null);
        }
      }
    } else {
      // No cached user, check if anonymous mode preference
      usingAnonymous = result.anon_mode || false;
      
      // If in anonymous mode, hide login
      if (usingAnonymous) {
        updateAuthUI(null);
      } else {
        // Show login form explicitly
        loginForm.style.display = 'block';
        userInfo.style.display = 'none';
      }
      
      // Check Supabase as a fallback
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        updateAuthUI(user);
      }
    }
  } catch (error) {
    console.error('Error checking auth state:', error);
    // Ensure login is visible on error
    loginForm.style.display = 'block';
    userInfo.style.display = 'none';
  }
});

// Anonymous mode handling
if (anonModeBtn) {
  anonModeBtn.addEventListener('click', () => {
    usingAnonymous = true;
    updateAuthUI(null);
    showStatus(`
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      Using anonymous mode - captures not attributed to your profile
    `, 'info', 3000);
    
    // Store anonymous preference in storage
    chrome.storage.local.set({ 'anon_mode': true });
  });
}

// Monitor auth state changes to maintain persistent vehicle attribution
supabase.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event);
  
  if (event === 'SIGNED_IN' && session?.user) {
    // Cache user info for persistent login connection to Nuke platform
    chrome.storage.local.set({ 
      'nuke_user': session.user,
      'anon_mode': false  // Turn off anonymous mode when signing in
    });
    updateAuthUI(session.user);
    
    // Show success message about connection to vehicle-centric platform
    showStatus(`
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
      Connected to Nuke - vehicle captures will be attributed to your profile
    `, 'success', 3000);
    
  } else if (event === 'SIGNED_OUT') {
    // Clear cached user on logout but don't clear anonymous mode preference
    chrome.storage.local.remove('nuke_user');
    
    // Check if we should stay in anonymous mode or go to login screen
    chrome.storage.local.get(['anon_mode'], (result) => {
      if (result.anon_mode) {
        usingAnonymous = true;
      } else {
        usingAnonymous = false;
      }
      updateAuthUI(null);
    });
    
    // Show info message about disconnection
    showStatus('Disconnected from Nuke platform', 'info', 3000);
  }
});

// Login handler
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginEmail.value;
    const password = loginPassword.value;
    
    // Show loading indicator
    loginBtn.innerHTML = '<span class="loading"></span> Signing in...';
    loginBtn.disabled = true;
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    // Reset button
    loginBtn.innerHTML = 'Sign In';
    loginBtn.disabled = false;
    
    if (error) {
      showStatus(`
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        ${error.message}
      `, 'error', 4000);
    } else {
      updateAuthUI(data.user);
      showStatus(`
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6L9 17l-5-5"></path>
        </svg>
        Connected to Nuke Platform
      `, 'success');
    }
  });
}

// Logout handler
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    await supabase.auth.signOut();
    updateAuthUI(null);
    logoutBtn.disabled = false;
  });
}

// Set up indicator function (red/green for capture status)
function setIndicator(color) {
  statusIndicator.classList.remove('status-red', 'status-green');
  statusIndicator.classList.add(`status-${color}`);
}

if (captureBtn) {
  captureBtn.addEventListener('click', () => {
    // Show active state
    captureBtn.classList.add('capturing');
    setIndicator('red');
    
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'extractVehicleData' }, async function(data) {
        if (chrome.runtime.lastError) {
          showStatus(`
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            Error: ${chrome.runtime.lastError.message}
          `, 'error', 4000);
          setIndicator('red');
          captureBtn.classList.remove('capturing');
          return;
        }
        
        if (data) {
          // Extract user attribution for Nuke's vehicle-centric platform
          const user_id = currentUser ? currentUser.id : null;
          let userAttribution = "";
          
          if (user_id) {
            userAttribution = `<div style="margin-top:8px;font-size:12px;">✓ Attribution: ${currentUser.email}</div>`;
          } else {
            userAttribution = `<div style="margin-top:8px;font-size:12px;color:var(--danger);">⚠️ Anonymous capture (login to claim credit)</div>`;
          }
          
          // Extract HTML and structured data
          const { html, ...vehicleData } = data;
          
          // Enhanced vehicle data capture for digital identity
          const capture = {
            url: vehicleData.url,
            html,
            images: vehicleData.images || [],
            user_id,
            captured_at: new Date().toISOString(),
            meta: vehicleData
          };
          
          // Display info about the vehicle being captured
          let vehicleInfo = "";
          if (vehicleData.year && vehicleData.make && vehicleData.model) {
            vehicleInfo = `${vehicleData.year} ${vehicleData.make} ${vehicleData.model}`;
          } else if (vehicleData.title) {
            vehicleInfo = vehicleData.title;
          } else {
            vehicleInfo = "Vehicle data";
          }
          
          // Process vehicle capture in the Nuke platform
          let error = null;
          try {
            // Animated capturing progress indicator
            showStatus(`
              <div style="display:flex;flex-direction:column;width:100%;">
                <div>Capturing vehicle data...</div>
                <div class="progress-bar"></div>
              </div>
            `, 'info', 0);
            
            const { error: supabaseError } = await supabase.from('captures').insert([capture]);
            error = supabaseError;
          } catch (e) {
            error = e;
          }
          
          if (!error) {
            // Success - vehicle added to Nuke's persistent digital identity system
            setIndicator('green');
            
            // Track anonymous captures and prompt for login after multiple
            if (usingAnonymous) {
              anonymousCaptureCount++;
              chrome.storage.local.set({ 'anon_capture_count': anonymousCaptureCount });
              console.log('Anonymous capture count increased to:', anonymousCaptureCount);
              
              // Show login prompt after multiple anonymous captures
              if (anonymousCaptureCount >= 3 && loginPrompt) {
                loginPrompt.style.display = 'block';
                
                // Add prompt in the status message
                userAttribution += `
                  <div style="margin-top:8px;font-size:12px;color:var(--warning);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    You've made ${anonymousCaptureCount} anonymous captures. Sign in to claim credit!
                  </div>
                `;
              }
            }
            
            // Show capture success with vehicle info
            showStatus(`
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6L9 17l-5-5"></path>
              </svg>
              <div style="display:flex;flex-direction:column;">
                <div>${vehicleInfo} added to Nuke</div>
                ${userAttribution}
              </div>
            `, 'success', 5000);
            
            // Update count display
            updateCount();
            
            // Reset indicator after delay
            setTimeout(() => setIndicator('red'), 2000);
          } else {
            // Error in the capture process
            setIndicator('red');
            console.error('Supabase save error:', error);
            let errorMsg = error && typeof error === 'object' ? (error.message || JSON.stringify(error)) : error;
            
            showStatus(`
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
              Failed to save to Nuke: ${errorMsg}
            `, 'error', 10000);
          }
        } else {
          // No data could be extracted
          setIndicator('red');
          showStatus(`
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            No vehicle data could be extracted from this page
          `, 'error', 5000);
        }
        
        // Reset capturing state
        captureBtn.classList.remove('capturing');
      });
    });
  });
}

// Save All Images
if (saveImagesBtn) {
  saveImagesBtn.addEventListener('click', () => {
    chrome.storage.local.get(['vehicles'], function(result) {
      const vehicles = result.vehicles || [];
      if (vehicles.length === 0) {
        showStatus('No vehicles to save images from.', 'error');
        return;
      }
      const last = vehicles[vehicles.length - 1];
      if (!last.images || last.images.length === 0) {
        showStatus('No images found for last vehicle.', 'error');
        return;
      }
      last.images.forEach((imgUrl, idx) => {
        chrome.downloads.download({ url: imgUrl, filename: `vehidex_image_${idx + 1}.jpg` });
      });
      showStatus('Downloading images...', 'success');
    });
  });
}

// Export JSON
if (exportJsonBtn) {
  exportJsonBtn.addEventListener('click', () => {
    chrome.storage.local.get(['vehicles'], function(result) {
      const vehicles = result.vehicles || [];
      const blob = new Blob([JSON.stringify(vehicles, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: 'vehidex_collection.json' });
      showStatus('Exported as JSON!', 'success');
    });
  });
}

// Export CSV
function toCSV(vehicles) {
  if (!vehicles.length) return '';
  const keys = Object.keys(vehicles[0]);
  const rows = [keys.join(',')];
  for (const v of vehicles) {
    rows.push(keys.map(k => '"' + (v[k] ? String(v[k]).replace(/"/g, '""') : '') + '"').join(','));
  }
  return rows.join('\n');
}
if (exportCsvBtn) {
  exportCsvBtn.addEventListener('click', () => {
    chrome.storage.local.get(['vehicles'], function(result) {
      const vehicles = result.vehicles || [];
      const csv = toCSV(vehicles);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: 'vehidex_collection.csv' });
      showStatus('Exported as CSV!', 'success');
    });
  });
}

// Export for Nuke (JSON, but could be customized)
if (exportNukeBtn) {
  exportNukeBtn.addEventListener('click', () => {
    chrome.storage.local.get(['vehicles'], function(result) {
      const vehicles = result.vehicles || [];
      const blob = new Blob([JSON.stringify(vehicles, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: 'vehidex_nuke_import.json' });
      showStatus('Exported for Nuke!', 'success');
    });
  });
}

// On load
updateCount();
