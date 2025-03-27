#!/usr/bin/env node

/**
 * This script helps fix dependency issues with the project
 * Run with: ts-node scripts/fix-deps.ts
 */

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ExecResult {
  stdout: string;
  stderr: string;
}

class DependencyFixError extends Error {
  constructor(message: string, public step: string) {
    super(message);
    this.name = 'DependencyFixError';
  }
}

async function safeExec(command: string, options: { stdio?: 'inherit' } = {}): Promise<ExecResult> {
  try {
    const output = execSync(command, options);
    return {
      stdout: output?.toString() ?? '',
      stderr: ''
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new DependencyFixError(
        `Command failed: ${command}\n${error.message}`,
        'execution'
      );
    }
    throw error;
  }
}

async function createNpmrc(): Promise<void> {
  const npmrcPath = path.join(process.cwd(), '.npmrc');
  try {
    const exists = await fs.access(npmrcPath).then(() => true).catch(() => false);
    if (!exists) {
      await fs.writeFile(npmrcPath, 'legacy-peer-deps=true\nfund=false\naudit=false\n');
    }
  } catch (error) {
    throw new DependencyFixError(
      `Failed to create .npmrc: ${error instanceof Error ? error.message : String(error)}`,
      'npmrc'
    );
  }
}

async function cleanNodeModules(): Promise<void> {
  const nodeModulesPath = path.join(process.cwd(), 'node_modules');
  try {
    await fs.rm(nodeModulesPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore error if directory doesn't exist
    if (error instanceof Error && !error.message.includes('ENOENT')) {
      throw new DependencyFixError(
        `Failed to remove node_modules: ${error.message}`,
        'clean'
      );
    }
  }
}

async function cleanPackageLock(): Promise<void> {
  const packageLockPath = path.join(process.cwd(), 'package-lock.json');
  try {
    await fs.unlink(packageLockPath);
  } catch (error) {
    // Ignore error if file doesn't exist
    if (error instanceof Error && !error.message.includes('ENOENT')) {
      throw new DependencyFixError(
        `Failed to remove package-lock.json: ${error.message}`,
        'clean'
      );
    }
  }
}

async function fixDependencies(): Promise<void> {
   
  console.info('🔧 Starting dependency fix process...');

  try {
    // Create .npmrc if needed
    await createNpmrc();

    // Clean up existing files
    await cleanNodeModules();
    await cleanPackageLock();

    // Install dependencies
     
    console.info('📦 Installing dependencies with npm...');
    await safeExec('npm install --legacy-peer-deps', { stdio: 'inherit' });

    // Test build
     
    console.info('🧪 Testing build...');
    await safeExec('npm run build', { stdio: 'inherit' });

     
    console.info('✅ Dependencies fixed successfully!\n');
     
    console.info('Next steps:\n1. Commit the new package-lock.json file\n2. Push to your repository');
  } catch (error) {
    if (error instanceof DependencyFixError) {
       
      console.error(`❌ Error during ${error.step}: ${error.message}`);
    } else {
       
      console.error('❌ Unexpected error:', error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

// Run the script
void fixDependencies();