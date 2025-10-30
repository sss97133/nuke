/**
 * Test Mode Utilities
 * Helper functions for PIP tests and debugging
 */

export class TestMode {
  /**
   * Enable test mode with bypass auth
   * Useful for running PIP tests on production
   */
  static enableTestMode() {
    const testSession = {
      user: {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'test@n-zero.dev',
        user_metadata: {
          username: 'testuser',
          full_name: 'Test User'
        }
      },
      access_token: 'test-bypass-token',
      expires_at: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };

    localStorage.setItem('bypass-session', JSON.stringify(testSession));
    console.log('✅ Test mode enabled - reload page to activate');
    console.log('   User ID:', testSession.user.id);
  }

  /**
   * Disable test mode
   */
  static disableTestMode() {
    localStorage.removeItem('bypass-session');
    console.log('✅ Test mode disabled - reload page to use normal auth');
  }

  /**
   * Check if test mode is active
   */
  static isTestModeActive(): boolean {
    return !!localStorage.getItem('bypass-session');
  }

  /**
   * Set as owner of all vehicles (for testing owner-only features)
   */
  static async becomeOwnerOfAllVehicles() {
    if (!this.isTestModeActive()) {
      console.error('❌ Test mode must be enabled first');
      return false;
    }

    try {
      // This would require a special admin endpoint
      // For now, just log the intent
      console.log('🔧 Test mode: Acting as owner for all vehicles');
      console.log('   Note: Some features still require actual ownership in database');
      return true;
    } catch (error) {
      console.error('Failed to enable owner bypass:', error);
      return false;
    }
  }

  /**
   * Console helpers - expose to window for easy access
   */
  static exposeToConsole() {
    if (typeof window !== 'undefined') {
      (window as any).testMode = {
        enable: () => TestMode.enableTestMode(),
        disable: () => TestMode.disableTestMode(),
        isActive: () => TestMode.isTestModeActive(),
        becomeOwner: () => TestMode.becomeOwnerOfAllVehicles()
      };
      
      console.log('🧪 Test mode helpers available:');
      console.log('   window.testMode.enable() - Enable test mode');
      console.log('   window.testMode.disable() - Disable test mode');
      console.log('   window.testMode.isActive() - Check status');
      console.log('   window.testMode.becomeOwner() - Act as owner');
    }
  }
}

// Auto-expose in development
if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_MODE === 'true') {
  TestMode.exposeToConsole();
}

