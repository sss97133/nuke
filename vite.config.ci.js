// Simplified Vite config for CI environments
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Simple configuration that should work in most CI environments
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: false, // Disable minification for faster builds
    // Simple entry point configuration
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      }
    }
  }
});
