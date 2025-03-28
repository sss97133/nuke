const fs = require('fs');
const path = require('path');
const http = require('http');

/**
 * Simple dev server that exposes CSS and component definitions to Figma
 * This allows Figma to directly access your real vehicle component styling
 * without requiring Git operations
 */

const PORT = 3333;
const CSS_PATHS = [
  'src/components/VehicleCard.css',
  'src/styles/global-css-fixes.css'
];

// Map file extensions to MIME types
const MIME_TYPES = {
  '.css': 'text/css',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.tsx': 'application/typescript',
  '.ts': 'application/typescript'
};

const server = http.createServer((req, res) => {
  // Add CORS headers to allow Figma to access the files
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Special endpoint to list available stylesheets
  if (req.url === '/stylesheets') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ 
      stylesheets: CSS_PATHS,
      components: [
        {
          name: "VehicleCard",
          path: "src/components/VehicleCard.tsx"
        }
      ]
    }));
    return;
  }

  // Clean up the URL
  let filePath = req.url;
  if (filePath === '/') {
    filePath = '/index.html';
  }

  // Remove query parameters if any
  filePath = filePath.split('?')[0];
  
  // Convert URL to local file path
  filePath = path.join(__dirname, filePath.substring(1));
  
  // Check if file exists
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      res.statusCode = 404;
      res.end(`File not found: ${filePath}`);
      return;
    }
    
    // Get the file extension
    const ext = path.extname(filePath);
    
    // Set content type header
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'text/plain');
    
    // Create read stream and pipe to response
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    
    stream.on('error', (err) => {
      res.statusCode = 500;
      res.end(`Server Error: ${err.message}`);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Figma Dev Connect Server running at http://localhost:${PORT}`);
  console.log(`CSS files available at:`);
  CSS_PATHS.forEach(path => {
    console.log(`- http://localhost:${PORT}/${path}`);
  });
  console.log('\nAdd these URLs to your Figma Dev Mode to connect with your real component styling');
});
