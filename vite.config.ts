import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
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
  esbuild: {
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    loader: 'tsx',
    include: /\.(ts|tsx|js|jsx)$/,
    exclude: []
  },
  build: {
    outDir: 'dist',
    minify: 'terser',
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
  css: {
    modules: {
      localsConvention: 'camelCase'
    }
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
