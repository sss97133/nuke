/**
 * Mock Enabler Utility
 * 
 * This utility helps disable real Supabase connections when we want to use mock data
 * for local development and testing.
 */

// Flag to control whether to use mock implementations
const USE_MOCKS = true; // Re-enabled to prevent network issues

// Disable WebSocket connections to prevent errors
if (typeof window !== 'undefined' && USE_MOCKS) {
  // Override WebSocket to prevent connection attempts when using mocks
  const originalWebSocket = window.WebSocket;
  window.WebSocket = function MockWebSocket(url: string, protocols?: string | string[]) {
    console.log(`[MOCK] WebSocket connection prevented: ${url}`);
    
    // If the URL contains Supabase or our local development server, return a mock
    if (url.includes('54321') || url.includes('supabase')) {
      // Create a mock WebSocket that doesn't actually connect
      const mockWs = {} as WebSocket;
      
      // Add minimum required properties
      mockWs.close = () => console.log('[MOCK] WebSocket close called');
      mockWs.send = (data) => console.log('[MOCK] WebSocket send called');
      
      // Dispatch a mock close event after a short delay
      setTimeout(() => {
        if (mockWs.onclose) {
          const closeEvent = { code: 1000, reason: 'Mocks enabled', wasClean: true } as CloseEvent;
          mockWs.onclose(closeEvent);
        }
      }, 100);
      
      return mockWs;
    }
    
    // For non-Supabase WebSockets, use the original implementation
    return new originalWebSocket(url, protocols);
  } as any;
  
  // Define the MockWebSocket class with static properties
  // This avoids assigning to read-only properties
  Object.defineProperties(window.WebSocket, {
    'CONNECTING': { value: originalWebSocket.CONNECTING },
    'OPEN': { value: originalWebSocket.OPEN },
    'CLOSING': { value: originalWebSocket.CLOSING },
    'CLOSED': { value: originalWebSocket.CLOSED }
  });
  
  console.log('[MOCK] WebSocket connections to Supabase will be intercepted');
}

// Utility function to check if we're using mocks
export function isUsingMocks() {
  return USE_MOCKS;
}

// Export the flag for other modules to check
export default USE_MOCKS;
