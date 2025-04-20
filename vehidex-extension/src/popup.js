import { supabase } from './supabaseClient.js';

const captureBtn = document.getElementById('capture-vehicle');
const statusMsg = document.getElementById('status-message');
const statusIndicator = document.getElementById('status-indicator');
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const loginEmail = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const userEmail = document.getElementById('user-email');
const continueAnonBtn = document.getElementById('continue-anon-btn');
const anonOptions = document.getElementById('anon-options');
const anonInfoIcon = document.getElementById('anon-info-icon');
const anonInfoText = document.getElementById('anon-info-text');

let currentUser = null;
let usingAnonymous = true;

function showStatus(msg, type = 'info', timeout = 3000) {
  if (!statusMsg) return;
  statusMsg.textContent = msg;
  statusMsg.className = `status ${type}`;
  statusMsg.style.display = 'block';
  if (timeout > 0) setTimeout(() => { statusMsg.style.display = 'none'; }, timeout);
}

function setIndicator(color) {
  if (!statusIndicator) return;
  statusIndicator.classList.remove('status-red', 'status-green');
  if (color === 'green') statusIndicator.classList.add('status-green');
  else statusIndicator.classList.add('status-red');
}

function updateAuthUI(user, anon) {
  currentUser = user;
  usingAnonymous = anon;
  if (loginForm) loginForm.style.display = (!user && !anon) ? 'flex' : 'none';
  if (userInfo) userInfo.style.display = (user && !anon) ? 'flex' : 'none';
  if (anonOptions) anonOptions.style.display = (!user && !anon) || anon ? 'flex' : 'none';
  if (userEmail && user) userEmail.textContent = user.email;
}

// Enhanced session persistence for Nuke's vehicle-centric architecture
// This ensures each capture is properly attributed to the right user

// Listen for auth state changes
supabase.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event, session ? 'Session exists' : 'No session');
  if (event === 'SIGNED_IN') {
    // Save user to persist between browser sessions
    chrome.storage.local.set({ 'nuke_user': session.user });
    updateAuthUI(session.user, false);
  } else if (event === 'SIGNED_OUT') {
    // Clear stored user data
    chrome.storage.local.remove('nuke_user');
    updateAuthUI(null, false);
  }
});

// On startup, check local storage first, then Supabase
chrome.storage.local.get(['nuke_user'], async (result) => {
  if (result.nuke_user) {
    console.log('Found stored user:', result.nuke_user.email);
    updateAuthUI(result.nuke_user, false);
  } else {
    // Fall back to checking Supabase session
    const { data: { user } } = await supabase.auth.getUser();
    updateAuthUI(user, !user);
  }
});

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginEmail.value;
    const password = loginPassword.value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      showStatus(error.message, 'error', 4000);
    } else {
      updateAuthUI(data.user, false);
      showStatus('Signed in!', 'success');
    }
  });
}
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    updateAuthUI(null, false);
    showStatus('Signed out.', 'info');
  });
}
if (continueAnonBtn) {
  continueAnonBtn.addEventListener('click', () => {
    updateAuthUI(null, true);
    showStatus('Continuing anonymously.', 'info');
  });
}
if (anonInfoIcon && anonInfoText) {
  anonInfoIcon.addEventListener('click', () => {
    anonInfoText.style.display = anonInfoText.style.display === 'none' ? 'inline-block' : 'none';
  });
}

if (captureBtn) {
  captureBtn.addEventListener('click', () => {
    setIndicator('red');
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'extractVehicleData' }, async function(data) {
        if (chrome.runtime.lastError) {
          showStatus('Error: ' + chrome.runtime.lastError.message, 'error', 4000);
          setIndicator('red');
          return;
        }
        if (data) {
          const { html, ...vehicleData } = data;
          const user_id = currentUser ? currentUser.id : null;
          const capture = {
            url: vehicleData.url,
            html,
            images: vehicleData.images || [],
            user_id,
            captured_at: new Date().toISOString(),
            meta: vehicleData
          };
          let error = null;
          try {
            const { error: supabaseError } = await supabase.from('captures').insert([capture]);
            error = supabaseError;
          } catch (e) {
            error = e;
          }
          if (!error) {
            setIndicator('green');
            showStatus('Vehicle sent to Nuke!', 'success');
            setTimeout(() => setIndicator('red'), 1800);
          } else {
            setIndicator('red');
            showStatus('Failed to save to Nuke: ' + (error.message || error), 'error', 5000);
          }
        } else {
          setIndicator('red');
          showStatus('No data extracted.', 'error');
        }
      });
    });
  });
}
