/**
 * Production Style Manager Component
 * 
 * This component ensures styles are properly loaded and applied in all environments,
 * with special handling for Vercel static deployments. It implements a three-tier
 * approach consistent with our environment variable pattern.
 */

import React, { useEffect, useState } from 'react';

// Force-import main stylesheets to ensure they're included in the main bundle
import '../index.css';
import '../App.css';

// Enhanced StyleFix component with robust error handling and fallbacks
export const StyleFix = () => {
  const [styleStatus, setStyleStatus] = useState('checking');
  
  useEffect(() => {
    // Check if a stylesheet has any valid rules
    const hasRules = (sheet) => {
      try {
        // Check if the stylesheet has any CSS rules
        return sheet.cssRules && sheet.cssRules.length > 0;
      } catch (e) {
        // CORS errors will happen if the stylesheet is from a different origin
        // We'll assume it's valid in this case
        return true;
      }
    };
    
    // Verify if styles are properly loaded
    const verifyStyles = () => {
      const styleSheets = Array.from(document.styleSheets);
      const validStylesheets = styleSheets.filter(hasRules);
      
      // Check if we have valid stylesheets
      if (validStylesheets.length === 0) {
        console.warn('No valid stylesheets found - applying emergency styles');
        setStyleStatus('emergency');
        injectEmergencyStyles();
        return false;
      }
      
      // Additional check for common UI elements
      const buttons = document.querySelectorAll('button');
      if (buttons.length > 0) {
        const firstButton = buttons[0];
        const style = window.getComputedStyle(firstButton);
        
        // Check if buttons have styling applied
        if (style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent') {
          console.warn('Buttons appear unstyled - applying production styles');
          setStyleStatus('production-fix');
          injectProductionStyles();
          return false;
        }
      }
      
      setStyleStatus('loaded');
      return true;
    };
    
    // Force pre-load the main stylesheet
    const preloadStylesheet = () => {
      const linkPaths = [
        '/assets/index.css',
        '/index.css',
        '/styles.css',
        '/css/styles.css',
        '/css/main.css',
        '/main.css'
      ];
      
      linkPaths.forEach(path => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `${path}?t=${Date.now()}`; // Add timestamp to bypass cache
        link.setAttribute('data-stylefix', 'true');
        document.head.appendChild(link);
      });
    };
    
    // Apply emergency styles if everything else fails
    const injectEmergencyStyles = () => {
      // Create a style element for critical styles
      const style = document.createElement('style');
      style.setAttribute('data-stylefix', 'emergency');
      
      // Add extensive fallback styles
      style.textContent = `
        /* Base styles */
        body {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.5;
          color: #0f172a;
          background-color: #f8fafc;
          margin: 0;
          padding: 0;
        }
        
        /* Typography */
        h1, h2, h3, h4, h5, h6 {
          margin-top: 0;
          font-weight: 600;
          line-height: 1.25;
          color: #1e293b;
        }
        h1 { font-size: 2.25rem; }
        h2 { font-size: 1.875rem; }
        h3 { font-size: 1.5rem; }
        h4 { font-size: 1.25rem; }
        p { margin-top: 0; margin-bottom: 1rem; }
        
        /* Layout */
        .container {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 1rem;
        }
        .row {
          display: flex;
          flex-wrap: wrap;
          margin-right: -0.5rem;
          margin-left: -0.5rem;
        }
        .col, [class*="col-"] {
          position: relative;
          width: 100%;
          padding-right: 0.5rem;
          padding-left: 0.5rem;
        }
        
        /* Components */
        .card {
          position: relative;
          display: flex;
          flex-direction: column;
          min-width: 0;
          word-wrap: break-word;
          background-color: #fff;
          background-clip: border-box;
          border: 1px solid rgba(0, 0, 0, 0.125);
          border-radius: 0.5rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          overflow: hidden;
        }
        .card-header {
          padding: 1rem;
          margin-bottom: 0;
          background-color: rgba(0, 0, 0, 0.03);
          border-bottom: 1px solid rgba(0, 0, 0, 0.125);
        }
        .card-body {
          flex: 1 1 auto;
          padding: 1rem;
        }
        
        /* Navigation */
        .navbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 1rem;
          background-color: #2563eb;
          color: white;
        }
        .nav {
          display: flex;
          flex-wrap: wrap;
          padding-left: 0;
          margin-bottom: 0;
          list-style: none;
        }
        .nav-link {
          display: block;
          padding: 0.5rem 1rem;
          color: white;
          text-decoration: none;
        }
        
        /* Form elements */
        .form-control {
          display: block;
          width: 100%;
          padding: 0.375rem 0.75rem;
          font-size: 1rem;
          line-height: 1.5;
          color: #495057;
          background-color: #fff;
          background-clip: padding-box;
          border: 1px solid #ced4da;
          border-radius: 0.25rem;
          transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
        }
        
        /* Buttons */
        button, .btn, a.button {
          display: inline-block;
          font-weight: 500;
          color: #fff;
          text-align: center;
          vertical-align: middle;
          cursor: pointer;
          user-select: none;
          background-color: #2563eb;
          border: 1px solid transparent;
          padding: 0.5rem 1rem;
          font-size: 1rem;
          line-height: 1.5;
          border-radius: 0.375rem;
          transition: color 0.15s ease-in-out, background-color 0.15s ease-in-out, border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
          text-decoration: none;
        }
        button:hover, .btn:hover, a.button:hover {
          background-color: #1e40af;
          border-color: #1e40af;
        }
      `;
      
      document.head.appendChild(style);
    };
    
    // Apply production optimized styles
    const injectProductionStyles = () => {
      // Using design tokens from our UI library
      const style = document.createElement('style');
      style.setAttribute('data-stylefix', 'production');
      
      // Add tailored styles matching our design system
      style.textContent = `
        /* Optimized production styles - matches feature/ui-design-improvements branch */
        :root {
          --primary: #2563eb;
          --primary-hover: #1d4ed8;
          --secondary: #64748b;
          --secondary-hover: #475569;
          --success: #22c55e;
          --warning: #f59e0b;
          --danger: #ef4444;
          --info: #3b82f6;
          --light: #f8fafc;
          --dark: #0f172a;
          --body-bg: #f1f5f9;
          --card-bg: #ffffff;
          --border-color: #e2e8f0;
          --text-main: #1e293b;
          --text-light: #64748b;
          --radius-sm: 0.25rem;
          --radius: 0.375rem;
          --radius-md: 0.5rem;
          --radius-lg: 0.75rem;
          --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
          --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        }
        
        /* Core UI components - matching our design system */
        .container, .main-content {
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 1rem;
          width: 100%;
        }
        
        .card, .paper {
          background-color: var(--card-bg);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow);
          padding: 1.25rem;
          border: 1px solid var(--border-color);
        }
        
        button, .btn, .button, [type='button'], [type='submit'] {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.5rem 1rem;
          font-weight: 500;
          border-radius: var(--radius);
          transition: all 150ms ease;
          cursor: pointer;
          background-color: var(--primary);
          color: white;
          border: none;
          outline: none;
          font-size: 0.875rem;
          line-height: 1.5;
          box-shadow: var(--shadow-sm);
        }
        
        button:hover, .btn:hover, .button:hover, [type='button']:hover, [type='submit']:hover {
          background-color: var(--primary-hover);
          box-shadow: var(--shadow);
        }
        
        .btn-secondary {
          background-color: var(--secondary);
        }
        
        .btn-secondary:hover {
          background-color: var(--secondary-hover);
        }
        
        /* Navigation styles */
        nav, .nav, .navbar {
          display: flex;
          align-items: center;
          padding: 0.75rem 1rem;
          background-color: var(--card-bg);
          box-shadow: var(--shadow);
        }
        
        /* Form elements */
        input, select, textarea {
          display: block;
          width: 100%;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          line-height: 1.5;
          border: 1px solid var(--border-color);
          border-radius: var(--radius);
          background-color: var(--card-bg);
          transition: border-color 150ms ease, box-shadow 150ms ease;
        }
        
        input:focus, select:focus, textarea:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
        }
      `;
      
      document.head.appendChild(style);
    };

    // Initial preload
    preloadStylesheet();
    
    // Check immediately
    const initialCheck = setTimeout(() => {
      if (!verifyStyles()) {
        console.warn('Initial style check failed - applying fixes');
      }
    }, 100);
    
    // Check again after a delay in case styles load slowly
    const secondCheck = setTimeout(() => {
      if (!verifyStyles()) {
        console.warn('Secondary style check failed - applying enhanced fixes');
        // If second check still fails, use a more aggressive approach
        injectProductionStyles();
      }
    }, 1500);
    
    // One final check to catch late-loading issues after all content is loaded
    const finalCheck = setTimeout(() => {
      if (!verifyStyles()) {
        console.warn('Final style check failed - applying emergency fixes');
        injectEmergencyStyles();
      }
    }, 3000);
    
    // Clean up all timeouts on unmount
    return () => {
      clearTimeout(initialCheck);
      clearTimeout(secondCheck);
      clearTimeout(finalCheck);
    };
  }, []);
  
  return null;
};

// Ensure this component is properly tree-shaken when not in production
export default StyleFix;
