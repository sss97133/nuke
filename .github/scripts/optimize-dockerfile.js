#!/usr/bin/env node

/**
 * Dockerfile Optimizer for Nuke Project
 * This script analyzes and fixes common Dockerfile issues that cause CI failures
 */

const fs = require('fs');
const path = require('path');

// Configuration
const DOCKERFILE_PATH = path.join(process.cwd(), 'Dockerfile');
const DOCKER_COMPOSE_PATH = path.join(process.cwd(), 'docker-compose.yml');
const BACKUP_SUFFIX = '.bak';

// Check if files exist
const dockerfileExists = fs.existsSync(DOCKERFILE_PATH);
const dockerComposeExists = fs.existsSync(DOCKER_COMPOSE_PATH);

console.log(`Starting Dockerfile optimization...`);
console.log(`Dockerfile exists: ${dockerfileExists}`);
console.log(`Docker Compose exists: ${dockerComposeExists}`);

// Common Dockerfile issues and their fixes
const dockerfileFixes = [
  // Fix base image issues
  {
    pattern: /FROM node:(latest|current)/g,
    replacement: 'FROM node:18-alpine',
    description: 'Updating to stable Node.js 18 Alpine image'
  },
  // Fix permission issues
  {
    pattern: /COPY package\*.json/g,
    replacement: 'COPY --chown=node:node package*.json',
    description: 'Adding proper file ownership for package.json'
  },
  // Fix npm install issues
  {
    pattern: /RUN npm (ci|install)(?!\s+\|\|)/g,
    replacement: 'RUN npm $1 || npm install --legacy-peer-deps',
    description: 'Adding fallback for npm install commands'
  },
  // Ensure proper environment setup
  {
    pattern: /COPY \. \./g,
    replacement: 'COPY --chown=node:node . .\nRUN chmod -R 755 /app',
    description: 'Setting proper permissions for app files'
  },
  // Make sure we have proper environment variables
  {
    pattern: /CMD \["npm", "start"\]/g,
    replacement: 'ENV NODE_ENV=production\nCMD ["npm", "start"]',
    description: 'Setting production environment'
  }
];

// Docker Compose fixes
const dockerComposeFixes = [
  // Fix restart policy
  {
    pattern: /restart: always/g,
    replacement: 'restart: unless-stopped',
    description: 'Changing restart policy to unless-stopped for better reliability'
  },
  // Ensure proper environment variables
  {
    pattern: /environment:/g,
    replacement: 'environment:\n      - NODE_ENV=production',
    description: 'Adding NODE_ENV production environment variable'
  }
];

// Fix Dockerfile
if (dockerfileExists) {
  try {
    // Backup original
    fs.copyFileSync(DOCKERFILE_PATH, DOCKERFILE_PATH + BACKUP_SUFFIX);
    console.log(`✅ Backed up Dockerfile to ${DOCKERFILE_PATH + BACKUP_SUFFIX}`);
    
    // Read content
    let dockerfileContent = fs.readFileSync(DOCKERFILE_PATH, 'utf8');
    
    // Apply fixes
    let fixesApplied = 0;
    dockerfileFixes.forEach(fix => {
      const originalContent = dockerfileContent;
      dockerfileContent = dockerfileContent.replace(fix.pattern, fix.replacement);
      
      if (originalContent !== dockerfileContent) {
        fixesApplied++;
        console.log(`✅ Applied fix: ${fix.description}`);
      }
    });
    
    // Add final USER instruction if missing
    if (!dockerfileContent.includes('USER node')) {
      dockerfileContent += '\n# Ensure non-root user for security\nUSER node\n';
      fixesApplied++;
      console.log('✅ Added USER node instruction for security');
    }
    
    // Write back
    fs.writeFileSync(DOCKERFILE_PATH, dockerfileContent);
    console.log(`✅ Updated Dockerfile with ${fixesApplied} optimizations`);
  } catch (error) {
    console.error(`❌ Error optimizing Dockerfile: ${error.message}`);
  }
}

// Fix Docker Compose
if (dockerComposeExists) {
  try {
    // Backup original
    fs.copyFileSync(DOCKER_COMPOSE_PATH, DOCKER_COMPOSE_PATH + BACKUP_SUFFIX);
    console.log(`✅ Backed up docker-compose.yml to ${DOCKER_COMPOSE_PATH + BACKUP_SUFFIX}`);
    
    // Read content
    let dockerComposeContent = fs.readFileSync(DOCKER_COMPOSE_PATH, 'utf8');
    
    // Apply fixes
    let fixesApplied = 0;
    dockerComposeFixes.forEach(fix => {
      const originalContent = dockerComposeContent;
      dockerComposeContent = dockerComposeContent.replace(fix.pattern, fix.replacement);
      
      if (originalContent !== dockerComposeContent) {
        fixesApplied++;
        console.log(`✅ Applied fix: ${fix.description}`);
      }
    });
    
    // Write back
    fs.writeFileSync(DOCKER_COMPOSE_PATH, dockerComposeContent);
    console.log(`✅ Updated docker-compose.yml with ${fixesApplied} optimizations`);
  } catch (error) {
    console.error(`❌ Error optimizing docker-compose.yml: ${error.message}`);
  }
}

// Add special handling for environment variables in docker build
try {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Check if we need to add special docker build scripts
    if (!packageJson.scripts || !packageJson.scripts['docker:build']) {
      packageJson.scripts = packageJson.scripts || {};
      packageJson.scripts['docker:build'] = 'docker build -t nuke:latest --build-arg NODE_ENV=production .';
      packageJson.scripts['docker:run'] = 'docker run -p 8080:8080 --env-file .env nuke:latest';
      
      // Write back
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log('✅ Added docker:build and docker:run scripts to package.json');
    }
  }
} catch (error) {
  console.error(`❌ Error updating package.json: ${error.message}`);
}

console.log('✨ Dockerfile optimization complete!');
