import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import autoprefixer from 'autoprefixer';
import { componentTagger } from "lovable-tagger";
import tailwindcssPostcss from '@tailwindcss/postcss';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react({
      // Force Babel compilation for TSX files, hoping it handles generics better
      // in the Vercel build environment than ESBuild seems to be doing.
      jsxImportSource: '@emotion/react', // Keep if using Emotion, else remove
      babel: {
        plugins: [
          // Add any necessary Babel plugins here if needed
          // e.g., ['@babel/plugin-proposal-decorators', { legacy: true }]
        ],
        // Ensure TSX files are processed by Babel
        parserOpts: {
          plugins: ['jsx', 'typescript'],
        },
      },
      // Ensure esbuild is NOT used for TSX transforms by the react plugin
      // Fast Refresh should be handled by Babel config/plugins if needed
      // esbuild: { include: /\.(ts|jsx)$/, exclude: /\.tsx$/ }
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
        tailwindcssPostcss(),
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
