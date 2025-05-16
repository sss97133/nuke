#!/usr/bin/env node

/**
 * Figma Setup Script
 * 
 * This script helps set up the Figma integration for the Nuke platform.
 * It provides instructions on how to set up your Figma API token and
 * create a new Figma file for the vehicle digital lifecycle design.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n\x1b[1m=== Nuke Figma Integration Setup ===\x1b[0m\n');
console.log('This script will help you set up Figma integration for the vehicle digital lifecycle UI design.\n');

console.log('\x1b[33mStep 1: Access your Figma API token\x1b[0m');
console.log('1. Go to https://www.figma.com/developers/api');
console.log('2. Click "Create a new personal access token"');
console.log('3. Give it a name like "Nuke Integration"');
console.log('4. Copy the generated token\n');

rl.question('Do you have your Figma API token ready? (yes/no): ', (answer) => {
  if (answer.toLowerCase() !== 'yes') {
    console.log('\n\x1b[31mPlease get your Figma API token first, then run this script again.\x1b[0m\n');
    rl.close();
    return;
  }

  rl.question('\nEnter your Figma API token: ', (token) => {
    // Add the token to .env file
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      let envContent = '';
      
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
        
        // Check if FIGMA_API_TOKEN already exists
        if (envContent.includes('FIGMA_API_TOKEN=')) {
          envContent = envContent.replace(/FIGMA_API_TOKEN=.*(\r?\n|$)/g, `FIGMA_API_TOKEN=${token}$1`);
        } else {
          envContent += `\nFIGMA_API_TOKEN=${token}\n`;
        }
      } else {
        envContent = `FIGMA_API_TOKEN=${token}\n`;
      }
      
      fs.writeFileSync(envPath, envContent);
      console.log('\n\x1b[32mFigma API token successfully added to .env file!\x1b[0m\n');
      
      console.log('\x1b[33mStep 2: Create a new Figma file\x1b[0m');
      console.log('1. Go to https://www.figma.com/');
      console.log('2. Click "+" to create a new file');
      console.log('3. Name it "Nuke - Vehicle Digital Lifecycle"');
      console.log('\nRefer to the HTML mockup at src/design/vehicle-timeline-mockup.html for design reference\n');
      
      console.log('\x1b[33mStep 3: Set up your Figma file structure\x1b[0m');
      console.log('Create the following frames in your Figma file:');
      console.log('1. Vehicle Timeline - For displaying the chronological history');
      console.log('2. Connector Framework - For showing the multi-source data integration');
      console.log('3. Physical Verification - For the PTZ verification center design');
      console.log('4. Investment Platform - For the fractional investment UI');
      
      console.log('\n\x1b[32mSetup guide complete! You can now use the HTML mockup as a reference for your Figma design.\x1b[0m\n');
      
      rl.close();
    } catch (error) {
      console.error('\n\x1b[31mError saving Figma API token:', error.message, '\x1b[0m\n');
      rl.close();
    }
  });
});
