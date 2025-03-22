/* eslint-disable no-console, no-undef */
/**
 * Script to copy GM vehicle records HTML file from public to dist directory
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define source and destination paths
const sourcePath = path.resolve(__dirname, '../public/gm-vehicle-records.html');
const destPath = path.resolve(__dirname, '../dist/gm-vehicle-records.html');

try {
  // Check if source file exists
  if (!fs.existsSync(sourcePath)) {
    console.error('❌ Error: Source file does not exist:', sourcePath);
    process.exit(1);
  }

  // Ensure dist directory exists
  const distDir = path.dirname(destPath);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
    console.log('✅ Created dist directory');
  }

  // Copy the file
  fs.copyFileSync(sourcePath, destPath);
  console.log('✅ Successfully copied GM records HTML to dist folder');

  // Verify the file was copied
  if (fs.existsSync(destPath)) {
    console.log('✅ Verified file exists at destination:', destPath);
  } else {
    console.error('❌ Error: File was not copied to destination');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error copying GM records HTML file:', error);
  process.exit(1);
}
