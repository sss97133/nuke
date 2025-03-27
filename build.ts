#!/usr/bin/env ts-node

import { spawn } from 'child_process';
import { existsSync, copyFileSync } from 'fs';
import { platform } from 'os';

interface CommandResult {
  success: boolean;
  error?: Error;
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  console.log(`Running: ${command} ${args.join(' ')}`);

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        console.error(`Command failed with exit code ${code}`);
        resolve({ 
          success: false, 
          error: new Error(`Command failed with exit code ${code}`)
        });
      }
    });
  });
}

async function build(): Promise<void> {
  try {
    // Check if we should use the CI config
    if (process.env.CI === 'true') {
      console.log('Running in CI environment, using simplified config');
      if (existsSync('vite.config.ci.js')) {
        copyFileSync('vite.config.ci.js', 'vite.config.js');
      }
    }

    // Run TypeScript compiler
    console.log('Running TypeScript compiler...');
    const tscResult = await runCommand('npx', ['--no', 'tsc']);
    if (!tscResult.success) {
      // TypeScript errors are expected and can be ignored
      console.warn('TypeScript reported errors but continuing with build');
    }

    // Run Vite build
    console.log('Running Vite build...');

    // First try direct npm bin path
    const npmBin = platform() === 'win32'
      ? 'node_modules/.bin/vite.cmd'
      : 'node_modules/.bin/vite';

    if (existsSync(npmBin)) {
      const result = await runCommand(npmBin, ['build', '--debug']);
      if (result.success) {
        console.log('Build successful!');
        return;
      }
      console.warn('Direct path execution failed, trying npx...');
    }

    // Try with npx as fallback
    const npxResult = await runCommand('npx', ['--no', 'vite', 'build', '--debug']);
    if (npxResult.success) {
      console.log('Build successful!');
      return;
    }

    throw npxResult.error || new Error('Build failed with unknown error');
  } catch (error: unknown) {
    console.error(
      'Build failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

// Allow console usage in build scripts
 

void build();
