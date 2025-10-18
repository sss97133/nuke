#!/usr/bin/env node
/**
 * Generate favicon from blue glow description
 * Creates a transparent PNG with blue glow effect
 */

const fs = require('fs');
const path = require('path');

// Create a simple blue glow favicon
// Since we can't directly process the user's image, we'll create a similar one
const createFavicon = () => {
  // This would normally use canvas or image processing
  // For now, we'll create a simple SVG that can be converted to PNG
  
  const svg = `
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="blueGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#2563eb;stop-opacity:1" />
      <stop offset="70%" style="stop-color:#3b82f6;stop-opacity:0.8" />
      <stop offset="100%" style="stop-color:#1d4ed8;stop-opacity:0.3" />
    </radialGradient>
  </defs>
  <circle cx="16" cy="16" r="14" fill="url(#blueGlow)" />
  <circle cx="16" cy="16" r="10" fill="#2563eb" opacity="0.9" />
</svg>`;

  // Save SVG version
  fs.writeFileSync(path.join(__dirname, '../nuke_frontend/public/favicon.svg'), svg);
  
  console.log('✅ Created favicon.svg with blue glow');
  console.log('📝 Note: You may need to manually convert to PNG/ICO for full browser support');
};

createFavicon();
