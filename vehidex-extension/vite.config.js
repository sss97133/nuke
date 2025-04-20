import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist', // Output folder for bundled files
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: 'src/popup.js',
        supabaseClient: 'src/supabaseClient.js'
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]'
      }
    }
  }
});
