import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react({
      // Optional: Explicitly set JSX runtime if needed, though usually automatic
      // jsxRuntime: 'automatic' 
    }),
    mode === 'development' && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss(),
        autoprefixer(),
      ],
    },
    modules: {
      localsConvention: 'camelCase'
    },
    // Force CSS extraction to ensure styles are included in the build
    // Note: Vite typically handles CSS splitting/extraction well by default.
    // Explicit extraction might not be needed unless default behavior is insufficient.
    // extract: true, // Uncomment if needed
  },
  esbuild: {
    loader: 'tsx',
    include: /\.(ts|tsx|js|jsx)$/,
    exclude: [],
  },
  build: {
    outDir: 'dist',
    minify: 'terser',
    sourcemap: true,
    cssCodeSplit: true, // Default is true, explicitly setting for clarity
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'assets/css/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },
  base: '/',
  server: {
    port: 5173,
    strictPort: true
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode)
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
        '.ts': 'tsx'
      },
    },
    include: ['@supabase/supabase-js']
  }
}));
