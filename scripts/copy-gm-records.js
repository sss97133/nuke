 
/**
 * Script to copy GM vehicle records HTML file from public to dist directory
 * This script ensures the file is properly copied and retained throughout the build process
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

// Create a function to copy the file
function copyGmRecordsFile() {
  // Check if source file exists
  if (!fs.existsSync(sourcePath)) {
    console.error('❌ Error: Source file does not exist:', sourcePath);
    return false;
  }

  // Ensure dist directory exists
  const distDir = path.dirname(destPath);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
    console.log('✅ Created dist directory');
  }

  try {
    // Copy the file
    fs.copyFileSync(sourcePath, destPath);
    console.log('✅ Successfully copied GM records HTML to dist folder');
    return true;
  } catch (err) {
    console.error('❌ Error copying file:', err);
    return false;
  }
}

try {
  // Initial copy
  let success = copyGmRecordsFile();
  if (!success) {
    console.error('Failed during initial copy');
    process.exit(1);
  }

  // Verify the file exists
  if (!fs.existsSync(destPath)) {
    console.error('❌ Error: File not found at destination after copy');
    process.exit(1);
  }

  // Read the copied file to ensure it's valid
  const fileContent = fs.readFileSync(destPath, 'utf8');
  if (!fileContent.includes('<!DOCTYPE html>')) {
    console.error('❌ Error: Copied file does not appear to be valid HTML');
    // Try copying again
    success = copyGmRecordsFile();
    if (!success) {
      process.exit(1);
    }
  }

  // Create a verification file to check later
  const verifyFilePath = path.resolve(__dirname, '../dist/.gm-records-verified');
  fs.writeFileSync(verifyFilePath, new Date().toISOString());
  console.log('✅ Created verification file for post-build check');

  // Register a process exit handler to verify at the end of the build
  process.on('exit', () => {
    // Check once more if the file exists at build completion
    if (!fs.existsSync(destPath)) {
      console.log('⚠️ GM records file missing at process exit, copying again...');
      copyGmRecordsFile();
    }
  });

  console.log('✅ GM Records file copy process completed successfully');
} catch (error) {
  console.error('❌ Error in GM records copy process:', error);
  process.exit(1);
}
