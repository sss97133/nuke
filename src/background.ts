/// <reference types="chrome" />

import { supabase } from '@/integrations/supabase/client';
import { Session } from '@supabase/supabase-js';

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Nuke extension installed');
  }
});

interface AuthMessage {
  type: 'AUTH_STATE_CHANGE';
  payload: Session | null;
}

// Listen for messages from the content script with improved error handling
chrome.runtime.onMessage.addListener((message: AuthMessage, sender, sendResponse) => {
  if (message.type === 'AUTH_STATE_CHANGE') {
    // Handle auth state changes with better error handling
    handleAuthStateChange(message.payload)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        console.error("Auth handling error:", error);
        sendResponse({ success: false, error: error.message });
      });
  }
  // Always return true for async response handling
  return true;
});

// Handle authentication state changes with improved WebSocket reliability
const handleAuthStateChange = async (session: Session | null) => {
  try {
    if (session) {
      // User is signed in
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) {
        console.error("Database query error:", error);
        return;
      }
      
      if (user) {
        // Update extension state
        await chrome.storage.local.set({ 
          user: {
            id: user.id,
            email: user.email,
            lastLogin: new Date().toISOString()
          }
        });
        console.log("User data stored in extension storage");
      }
    } else {
      // User is signed out
      await chrome.storage.local.remove(['user']);
      console.log("User data removed from extension storage");
    }
  } catch (error) {
    console.error("Error in handleAuthStateChange:", error);
    throw error; // Re-throw to allow proper handling
  }
};

// Set up Supabase auth listener with reconnection capability
const setupAuthListener = () => {
  try {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(`Auth event: ${event}`);
      handleAuthStateChange(session);
    });
    
    console.log("Auth listener established");
    return subscription;
  } catch (error) {
    console.error("Failed to set up auth listener:", error);
    
    // Attempt to reconnect after a delay
    setTimeout(setupAuthListener, 10000);
    return null;
  }
};

// Initialize auth listener
const authSubscription = setupAuthListener();

// Clean up subscription when extension is unloaded
chrome.runtime.onSuspend.addListener(() => {
  if (authSubscription) {
    authSubscription.unsubscribe();
    console.log("Auth subscription cleaned up");
  }
});
