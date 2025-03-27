/* eslint-disable no-undef */
/**
 * Script to verify GM vehicle records HTML is correctly deployed
 * This runs as the final step in the build process
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define source and destination paths
const publicPath = path.resolve(__dirname, '../public/gm-vehicle-records.html');
const distPath = path.resolve(__dirname, '../dist/gm-vehicle-records.html');
const verifyFilePath = path.resolve(__dirname, '../dist/.gm-records-verified');

console.log('\n=== GM RECORDS VERIFICATION ===');

try {
  // Check if the verification file exists (set by copy-gm-records.js)
  const verificationRan = fs.existsSync(verifyFilePath);
  console.log(`Verification previously ran: ${verificationRan ? 'Yes' : 'No'}`);
  
  // Check if source file exists
  const sourceExists = fs.existsSync(publicPath);
  console.log(`Source file exists: ${sourceExists ? 'Yes' : 'No'}`);
  
  // Check if destination file exists
  const destExists = fs.existsSync(distPath);
  console.log(`Destination file exists: ${destExists ? 'Yes' : 'No'}`);
  
  // If destination is missing but source exists, copy again
  if (!destExists && sourceExists) {
    console.log('Destination file missing, copying now...');
    fs.copyFileSync(publicPath, distPath);
    
    // Verify copy was successful
    if (fs.existsSync(distPath)) {
      console.log('✅ Successfully copied file in verification step');
    } else {
      console.error('❌ Failed to copy file in verification step');
      process.exit(1);
    }
  }
  
  // Final verification
  if (fs.existsSync(distPath)) {
    // Compare file sizes to make sure the file is complete
    const sourceSize = fs.statSync(publicPath).size;
    const destSize = fs.statSync(distPath).size;
    console.log(`Source file size: ${sourceSize} bytes`);
    console.log(`Dest file size: ${destSize} bytes`);
    
    if (sourceSize === destSize) {
      console.log('✅ File sizes match - verification complete');
    } else {
      console.log('⚠️ File sizes do not match, checking content...');
      
      // Read content to see if it's valid HTML
      const content = fs.readFileSync(distPath, 'utf8');
      if (content.includes('<!DOCTYPE html>') && content.includes('Classic GM Vehicle Service Records')) {
        console.log('✅ File content appears valid');
      } else {
        console.error('❌ File content appears invalid, replacing with source');
        fs.copyFileSync(publicPath, distPath);
        console.log('🔄 Replaced file with source copy');
      }
    }
  }
  
  console.log('=== VERIFICATION COMPLETE ===\n');
} catch (error) {
  console.error('❌ Error in GM records verification:', error);
  // Still attempt to copy the file one last time
  try {
    fs.copyFileSync(publicPath, distPath);
    console.log('🛟 Emergency copy attempted');
  } catch (copyError) {
    console.error('💀 Emergency copy failed:', copyError);
  }
  
  process.exit(1);
}
