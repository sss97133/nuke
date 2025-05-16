/**
 * CSS Utility Functions
 * 
 * These functions help with dynamic styling and theme management in the application.
 * They follow a functional approach and don't rely on mock data.
 */

import { useEffect } from 'react';

/**
 * Apply CSS variables to the document root element
 * @param variables - Object of CSS variable names and values
 */
export function applyCssVariables(variables: Record<string, string>): void {
  Object.entries(variables).forEach(([name, value]) => {
    if (document.documentElement) {
      document.documentElement.style.setProperty(`--${name}`, value);
    }
  });
}

/**
 * Apply theme colors based on the current theme
 * @param isDarkMode - Whether dark mode is enabled
 */
export function applyThemeColors(isDarkMode: boolean): void {
  const themeColors = isDarkMode
    ? {
        'bg-primary': '#121212',
        'bg-secondary': '#1e1e1e',
        'text-primary': '#ffffff',
        'text-secondary': '#a0a0a0',
        'accent-color': '#3b82f6',
      }
    : {
        'bg-primary': '#ffffff',
        'bg-secondary': '#f3f4f6',
        'text-primary': '#111827',
        'text-secondary': '#6b7280',
        'accent-color': '#2563eb',
      };

  applyCssVariables(themeColors);
}

/**
 * Hook for fixing CSS loading issues
 * This ensures styles are properly loaded without waiting for full app initialization
 */
export function useEnsureStyles(): void {
  useEffect(() => {
    // Force import critical stylesheets
    const ensureStylesheet = (href: string): void => {
      if (!document.querySelector(`link[href="${href}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
      }
    };

    // Add any critical stylesheets here
    ensureStylesheet('/src/index.css');
    
    // Apply default theme
    const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyThemeColors(prefersDarkMode);
    
    // Add dark mode detector
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent): void => {
      applyThemeColors(e.matches);
    };
    
    darkModeMediaQuery.addEventListener('change', handleChange);
    return () => {
      darkModeMediaQuery.removeEventListener('change', handleChange);
    };
  }, []);
}

/**
 * Generate consistent className strings
 * @param classes - Object with class names as keys and booleans as values
 */
export function classNames(...classes: (string | boolean | undefined | {[key: string]: boolean})[]): string {
  return classes
    .filter(Boolean)
    .map(cls => {
      if (typeof cls === 'object') {
        return Object.entries(cls)
          .filter(([_, value]) => Boolean(value))
          .map(([key]) => key)
          .join(' ');
      }
      return cls;
    })
    .join(' ');
}
