/**
 * Auth Redirect Test
 * 
 * This test utility verifies the authentication redirect functionality
 * within the vehicle-centric architecture of Nuke.
 */

import { supabase } from '../components/service-history/create-service-record/hooks/__mocks__/supabase-client';

/**
 * Mock window location for testing redirects
 */
function setupLocationMock() {
  // Store original location
  const originalLocation = window.location;
  
  // Mock location object
  const mockLocation = {
    href: window.location.href,
    replace: jest.fn(),
    reload: jest.fn(),
    origin: window.location.origin,
    pathname: window.location.pathname
  };
  
  // Define location as writable property
  Object.defineProperty(window, 'location', {
    writable: true,
    value: mockLocation
  });
  
  return {
    mockLocation,
    restore: () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation
      });
    }
  };
}

/**
 * Test the login and redirect flow
 */
export async function testAuthRedirect(): Promise<boolean> {
  console.log('=== Testing Auth Redirect Flow ===');
  
  // Setup location mock
  const { mockLocation, restore } = setupLocationMock();
  
  try {
    // Setup test user credentials
    const testUser = {
      email: 'test-owner@example.com',
      password: 'testPassword123!'
    };
    
    // Mock the toast function
    const mockToast = jest.fn();
    global.toast = mockToast;
    
    // Mock document methods for visual indicator
    document.createElement = jest.fn().mockReturnValue({
      style: {},
      innerText: '',
      appendChild: jest.fn()
    });
    document.body.appendChild = jest.fn();
    
    // Mock setTimeout
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = jest.fn().mockImplementation((callback, ms) => {
      // Immediately execute timeout functions for testing
      callback();
      return 123; // Mock timer ID
    });
    
    // Attempt to log in
    console.log(`Testing login for user: ${testUser.email}`);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: testUser.email,
      password: testUser.password
    });
    
    if (error) {
      console.error('Login failed:', error.message);
      restore();
      return false;
    }
    
    console.log('Login successful:', data.user?.id);
    
    // Check if redirect was attempted
    console.log('Checking redirects...');
    
    // Verify that location.href was set to /explore
    const wasRedirected = mockLocation.href.includes('/explore');
    console.log(`Redirect to /explore ${wasRedirected ? 'successful' : 'failed'}`);
    
    console.log('Redirect confirmation:', { 
      href: mockLocation.href,
      replaceCalled: mockLocation.replace.mock.calls.length > 0,
      reloadCalled: mockLocation.reload.mock.calls.length > 0
    });
    
    // Restore mocks
    window.setTimeout = originalSetTimeout;
    restore();
    
    return wasRedirected;
  } catch (err) {
    console.error('Unexpected error during redirect test:', err);
    restore();
    return false;
  }
}

/**
 * Manual test function for browser testing
 */
export function manualTestRedirect() {
  console.log('=== Manual Redirect Test Initiated ===');
  
  // Create a test login button
  const button = document.createElement('button');
  button.innerText = 'Test Login Redirect';
  button.style.position = 'fixed';
  button.style.top = '10px';
  button.style.right = '10px';
  button.style.zIndex = '9999';
  button.style.padding = '10px';
  button.style.backgroundColor = '#0066ff';
  button.style.color = 'white';
  button.style.border = 'none';
  button.style.borderRadius = '4px';
  button.style.cursor = 'pointer';
  
  // Add click handler
  button.onclick = () => {
    console.log('Manual redirect test clicked');
    window.location.href = '/explore';
    
    // Create a visual indicator
    const indicator = document.createElement('div');
    indicator.style.position = 'fixed';
    indicator.style.top = '0';
    indicator.style.left = '0';
    indicator.style.width = '100%';
    indicator.style.padding = '10px';
    indicator.style.backgroundColor = 'green';
    indicator.style.color = 'white';
    indicator.style.zIndex = '9999';
    indicator.style.textAlign = 'center';
    indicator.innerText = 'Redirecting to /explore...';
    document.body.appendChild(indicator);
  };
  
  document.body.appendChild(button);
  console.log('Manual test button added to page');
}

// Expose test functions to window for browser testing
if (typeof window !== 'undefined') {
  (window as any).testAuth = {
    testAuthRedirect,
    manualTestRedirect
  };
}
