
/// <reference types="chrome" />

import { supabase } from '@/integrations/supabase/client';

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Nuke extension installed');
  }
});

interface AuthMessage {
  type: 'AUTH_STATE_CHANGE';
  payload: any;
}

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((message: AuthMessage, sender, sendResponse) => {
  if (message.type === 'AUTH_STATE_CHANGE') {
    // Handle auth state changes
    handleAuthStateChange(message.payload);
  }
  // Always return true for async response handling
  return true;
});

// Handle authentication state changes
const handleAuthStateChange = async (session: any) => {
  if (session) {
    // User is signed in
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) console.error("Database query error:", error);
    if (user) {
      // Update extension state
      chrome.storage.local.set({ 
        user: {
          id: user.id,
          email: user.email,
          lastLogin: new Date().toISOString()
        }
      });
    }
  } else {
    // User is signed out
    chrome.storage.local.remove(['user']);
  }
};

// Set up Supabase auth listener
supabase.auth.onAuthStateChange((event, session) => {
  handleAuthStateChange(session);
});
