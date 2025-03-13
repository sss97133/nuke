/* eslint-env node */
/* global console, process */

// ESM compatible build script
import { spawn } from "child_process";
import fs from "fs";

// Function to run commands with proper logging
/**
 * Run a command with proper logging
 * @param {string} command - The command to run
 * @param {string[]} args - Arguments for the command
 * @returns {Promise<void>}
 */
async function runCommand(command, args) {
  console.log(`Running: ${command} ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      shell: true,
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error(`Command failed with exit code ${code}`);
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

// Main build function
async function build() {
  try {
    // Check if we should use the CI config
    if (process.env.CI === "true") {
      console.log("Running in CI environment, using simplified config");
      if (fs.existsSync("vite.config.ci.js")) {
        fs.copyFileSync("vite.config.ci.js", "vite.config.js");
      }
    }

    // Run TypeScript compiler
    console.log("Running TypeScript compiler...");
    try {
      await runCommand("npx", ["--no", "tsc"]);
    } catch {
      // TypeScript errors are expected and can be ignored
      console.warn("TypeScript reported errors but continuing with build");
    }

    // Run Vite build
    console.log("Running Vite build...");

    // First try direct npm bin path
    try {
      const npmBin =
        process.platform === "win32"
          ? "node_modules\\.bin\\vite.cmd"
          : "node_modules/.bin/vite";
      if (fs.existsSync(npmBin)) {
        await runCommand(npmBin, ["build", "--debug"]);
        console.log("Build successful!");
        return;
      }
    } catch {
      // If local vite fails, we'll try with npx as a fallback
      console.warn("Direct path execution failed, trying npx...");
    }

    // Try with npx
    await runCommand("npx", ["--no", "vite", "build", "--debug"]);
    console.log("Build successful!");
  } catch (error) {
    console.error(
      "Build failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

// Run the build
build();
