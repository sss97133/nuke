/**
 * ThemeToggle Component
 *
 * A reusable component that toggles between light and dark themes.
 * Integrates with the StyleFix system to ensure proper theme application.
 */

import React, { useState, useEffect } from 'react';

interface ThemeToggleProps {
  className?: string;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check initial theme on mount
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme');
    
    // Set initial state based on saved preference or system preference
    const initialDark = savedTheme 
      ? savedTheme === 'dark'
      : prefersDark;
    
    setIsDark(initialDark);
    updateTheme(initialDark);
    
    // Listen for system preference changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        setIsDark(e.matches);
        updateTheme(e.matches);
      }
    };
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const updateTheme = (dark: boolean) => {
    // Update document classes
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    // Apply theme colors
    const themeColors = dark
      ? {
          '--bg-primary': '#121212',
          '--bg-secondary': '#1e1e1e',
          '--text-primary': '#ffffff',
          '--text-secondary': '#a0a0a0',
          '--accent-color': '#3b82f6',
          '--border-color': 'rgba(255, 255, 255, 0.1)',
          '--card-bg': '#1e1e1e',
          '--hover-overlay': 'rgba(255, 255, 255, 0.05)',
        }
      : {
          '--bg-primary': '#ffffff',
          '--bg-secondary': '#f3f4f6',
          '--text-primary': '#111827',
          '--text-secondary': '#6b7280',
          '--accent-color': '#2563eb',
          '--border-color': 'rgba(0, 0, 0, 0.1)',
          '--card-bg': '#ffffff',
          '--hover-overlay': 'rgba(0, 0, 0, 0.02)',
        };

    // Apply theme variables to document root
    Object.entries(themeColors).forEach(([prop, value]) => {
      document.documentElement.style.setProperty(prop, value);
    });
    
    // Save preference
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  };

  const toggleTheme = () => {
    const newDarkState = !isDark;
    setIsDark(newDarkState);
    updateTheme(newDarkState);
  };

  return (
    <button
      onClick={toggleTheme}
      className={`inline-flex items-center justify-center rounded-md p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${className}`}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-5 w-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
          />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-5 w-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
          />
        </svg>
      )}
    </button>
  );
};

export default ThemeToggle;
