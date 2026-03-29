import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Expose both Vite-standard env vars and legacy names used in some deploy setups.
  // This lets production builds read `SUPABASE_URL` / `SUPABASE_ANON_KEY` if those are
  // what the platform provides, while still supporting `VITE_SUPABASE_*`.
  envPrefix: ['VITE_', 'SUPABASE_'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@docs': path.resolve(__dirname, './docs'),
    },
  },
  assetsInclude: ['**/*.md'],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // THREE.JS — @react-three/* goes here (only used by wiring page, lazy-loaded).
            // Dependency is one-way: three→vendor (for React). No circular dep.
            // Keeping @react-three in vendor was causing three.js (888 KB) + maps (1.9 MB)
            // to load on EVERY page as transitive vendor dependencies.
            if (id.includes('@react-three') || id.includes('/tunnel-rat/')) return 'three';
            if (id.includes('three')) return 'three';

            // MAPS — @deck.gl/react and react-map-gl go here (only used by map tab, lazy-loaded).
            // Dependency is one-way: maps→vendor (for React). No circular dep.
            if (
              id.includes('@deck.gl/react') ||
              id.includes('react-map-gl') ||
              id.includes('leaflet') ||
              id.includes('maplibre-gl') ||
              id.includes('deck.gl') ||
              id.includes('@deck.gl/')
            ) return 'maps';

            // React ecosystem — stays in vendor (always needed)
            if (
              id.includes('use-sync-external-store') ||
              id.includes('/zustand/') ||
              id.includes('react-dom') ||
              id.includes('/react/')
            ) return 'vendor';

            // Charts — lazy-loaded, only a few pages use recharts
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('@supabase/')) return 'supabase';
            if (id.includes('pdfjs-dist')) return 'pdf';
            if (id.includes('tesseract')) return 'tesseract';
          }
        },
      },
    },
    // Ensure production builds don't use eval
    target: 'esnext',
    minify: 'esbuild',
    // Use commonjs format for better compatibility
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/_archived/**',
    ],
  },
  optimizeDeps: {
    include: [
      'maplibre-gl',
      'deck.gl',
      '@deck.gl/core',
      '@deck.gl/layers',
      '@deck.gl/react',
      'react-map-gl/maplibre',
    ],
  },
  server: {
    port: 5174,
    host: '0.0.0.0', // Allow access from any IP on the network
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err: any, _req, res: any) => {
            console.log('Proxy error:', err);
            if (!res.headersSent) {
              res.writeHead(500, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              });
              res.end(JSON.stringify({
                error: 'Proxy Error',
                message: err.message,
                code: err.code || 'PROXY_ERROR'
              }));
            }
          });
          
          proxy.on('proxyReq', (_proxyReq, req: any, _res) => {
            console.log('Proxying request:', req.method, req.url);
          });
          
          proxy.on('proxyRes', (proxyRes: any, req: any, _res) => {
            console.log('Proxy response:', proxyRes.statusCode, req.url);
          });
        },
      },
      // Add a catch-all for better error handling
      '/proxy-health': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/proxy-health/, '/health')
      }
    },
  },
})
