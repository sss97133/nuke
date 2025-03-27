/* eslint-disable no-undef */
/**
 * Script to fix production CSS and asset loading issues
 * This ensures all CSS files are properly included in the build
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the built index.html
const indexPath = path.resolve(__dirname, '../dist/index.html');
const cssDirectory = path.resolve(__dirname, '../dist/assets');

// Find all CSS files in the assets directory
const findCssFiles = (dir) => {
  const files = fs.readdirSync(dir);
  return files.filter(file => file.endsWith('.css'));
};

try {
  // Read the index.html file
  let html = fs.readFileSync(indexPath, 'utf8');
  
  // Find all CSS files in the assets directory
  const cssFiles = findCssFiles(cssDirectory);
  console.log(`Found ${cssFiles.length} CSS files:`);
  cssFiles.forEach(file => console.log(`- ${file}`));
  
  // Check if any CSS links are already in the HTML
  const cssLinksInHTML = html.match(/<link [^>]*rel=["']stylesheet["'][^>]*>/g) || [];
  console.log(`Found ${cssLinksInHTML.length} CSS links already in HTML`);
  
  // Create CSS link tags for any missing CSS files
  let cssLinks = '';
  for (const cssFile of cssFiles) {
    const cssPath = `/assets/${cssFile}`;
    if (!html.includes(cssPath)) {
      console.log(`Adding missing CSS file: ${cssPath}`);
      cssLinks += `<link rel="stylesheet" href="${cssPath}">\n`;
    }
  }
  
  // Insert the CSS links right before the closing head tag
  if (cssLinks) {
    html = html.replace('</head>', `${cssLinks}</head>`);
    
    // Write the modified HTML back to index.html
    fs.writeFileSync(indexPath, html);
    console.log('✅ Missing CSS links added to index.html');
  } else {
    console.log('ℹ️ No missing CSS files to add');
  }
  
  // Verify environment variables are properly injected
  if (!html.includes('window.__env')) {
    console.error('❌ Environment variables are not injected into index.html');
    // Run the inject-env script directly
    console.log('Running inject-env.js to fix environment variables...');
    import('../scripts/inject-env.js');
  } else {
    console.log('✅ Environment variables are properly injected');
  }
  
} catch (error) {
  console.error('❌ Failed to fix production assets:', error);
  process.exit(1);
}
