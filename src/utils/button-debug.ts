/**
 * Button Debug Utilities
 * 
 * Provides tools for debugging and testing button functionality
 * across the Vehicle Timeline and other components.
 */

import { toast } from 'sonner';

// Debug mode flag - set to false in production
const DEBUG_MODE = import.meta.env.MODE === 'development';

/**
 * Enhanced click handler that logs action details
 * @param name Descriptive name of the button/action
 * @param handler The original handler function
 * @param logLevel Log level (info, warn, error)
 */
export function debugButton<T extends unknown[]>(
  name: string,
  handler?: (...args: T) => void | Promise<void>,
  logLevel: 'info' | 'warn' | 'error' = 'info'
) {
  return (...args: T) => {
    // In development, show visual feedback
    if (DEBUG_MODE) {
      console[logLevel](`Button clicked: ${name}`, ...args);
      
      // Show toast notification for better visibility
      toast.info(`Button: ${name}`, {
        description: handler ? 'Handler executed' : 'No handler implemented',
        duration: 2000,
      });
    }
    
    // Execute the original handler if provided
    if (handler) {
      return handler(...args);
    } else if (DEBUG_MODE) {
      console.warn(`No handler implemented for: ${name}`);
    }
  };
}

/**
 * Track a component's rendered buttons for coverage analysis
 */
export function trackButtonCoverage(componentName: string, buttonName: string) {
  if (DEBUG_MODE) {
    // Only track in development
    window.__buttonCoverage = window.__buttonCoverage || {};
    window.__buttonCoverage[componentName] = window.__buttonCoverage[componentName] || {};
    window.__buttonCoverage[componentName][buttonName] = true;
  }
}

/**
 * Interface for button testing patterns to ensure consistency
 */
export interface ButtonAction {
  name: string;
  handler: (...args: unknown[]) => void | Promise<void>;
  isImplemented: boolean;
  requiredPermissions?: string[];
}

/**
 * Interface for tracking button action data
 */
export interface ButtonActionData {
  action: string;
  component?: string;
  status: 'success' | 'error' | 'skipped' | 'not-implemented';
  data?: Record<string, any>;
  timestamp?: number;
}

// Type declaration for window object
declare global {
  interface Window {
    __buttonCoverage?: Record<string, Record<string, boolean>>;
    trackButtonAction?: (data: ButtonActionData) => void;
  }
}

/**
 * Create a consistent button action object
 */
export function createButtonAction(
  name: string, 
  handler?: (...args: unknown[]) => void | Promise<void>,
  options: {
    requiredPermissions?: string[];
  } = {}
): ButtonAction {
  return {
    name,
    handler: handler ? debugButton(name, handler) : debugButton(name),
    isImplemented: !!handler,
    requiredPermissions: options.requiredPermissions,
  };
}

/**
 * Track a button action for analytics and debugging
 */
export function trackButtonAction(data: ButtonActionData) {
  // Store tracking data for analytics
  const trackingData = {
    ...data,
    timestamp: data.timestamp || Date.now()
  };

  if (DEBUG_MODE) {
    console.log('[Button Action]', trackingData);
    
    // Add to coverage data
    if (data.component && data.action) {
      trackButtonCoverage(data.component, data.action);
    }
  }
  
  // Set global tracking function for cross-component usage
  window.trackButtonAction = trackButtonAction;
  
  return trackingData;
}

/**
 * Utility to connect button actions to components
 */
export function useButtonActions(componentName: string, actions: Record<string, ButtonAction>) {
  // Track all buttons in this component
  Object.keys(actions).forEach(key => {
    trackButtonCoverage(componentName, key);
  });
  
  return actions;
}
