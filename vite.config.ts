
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { checker } from 'vite-plugin-checker';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    checker({ typescript: true }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    minify: 'terser',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode)
  }
}));
