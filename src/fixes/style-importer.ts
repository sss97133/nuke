/**
 * CSS and Style Importer
 * 
 * This utility ensures all necessary CSS files are correctly imported and bundled.
 * It helps prevent style loading issues in different environments.
 */

/* global console */

// Import global styles
import '../index.css';
import '../App.css';

// Import component-specific styles 
import '../components/VehicleTimeline/VehicleTimeline.css';
import '../pages/VehicleTimelinePage.css';

// Add additional component styles as needed here

console.log('Styles imported successfully');

export default function ensureStyles(): boolean {
  // This function is just a wrapper to ensure the imports above are included
  return true;
} 