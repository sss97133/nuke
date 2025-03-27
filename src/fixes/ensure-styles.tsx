/**
 * Style Fix Component for Production
 * 
 * This component ensures styles are properly loaded in the production environment.
 * It addresses the issue where the app may appear unstyled temporarily.
 */

import React, { useEffect } from 'react';

// Force-import main stylesheets to ensure they're included in the main bundle
import '../index.css';
import '../App.css';

// StyleFix component to ensure styles are properly loaded and applied
export const StyleFix = () => {
  useEffect(() => {
    // Force stylesheet reload if necessary
    const ensureStyles = () => {
      // Get all stylesheets
      const styleSheets = document.styleSheets;
      
      // Check if any styles failed to load
      let stylesLoaded = styleSheets.length > 0;
      
      // If styles aren't loaded correctly, attempt to reload them
      if (!stylesLoaded) {
        console.warn('Styles not detected, attempting to force reload...');
        
        // Create a new stylesheet link forcing a reload
        const linkElement = document.createElement('link');
        linkElement.rel = 'stylesheet';
        linkElement.href = '/index.css?t=' + Date.now(); // Add timestamp to bypass cache
        document.head.appendChild(linkElement);
        
        // Create a style tag with critical CSS to ensure basic styling
        const styleElement = document.createElement('style');
        styleElement.textContent = `
          /* Critical base styles */
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.5;
            color: #0f172a;
          }
          
          /* Ensure buttons are styled */
          button, a.button {
            padding: 0.5rem 1rem;
            border-radius: 0.375rem;
            background-color: #2563eb;
            color: white;
            font-weight: 500;
            cursor: pointer;
            border: none;
          }
          
          /* Layout classes */
          .container {
            width: 100%;
            max-width: 1280px;
            margin: 0 auto;
            padding: 0 1rem;
          }
          
          /* Card styling */
          .card {
            background-color: white;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            padding: 1rem;
          }
        `;
        document.head.appendChild(styleElement);
      }
    };

    // Run immediately
    ensureStyles();
    
    // Also run after a delay to catch late-loading issues
    const timeoutId = setTimeout(ensureStyles, 1000);
    
    return () => clearTimeout(timeoutId);
  }, []);
  
  // This component doesn't render anything visible
  return null;
};

export default StyleFix;
