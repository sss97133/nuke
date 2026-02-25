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
          // Function-based manualChunks avoids TDZ issues from static config
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('recharts') || id.includes('d3-')) return 'vendor';
            if (id.includes('@supabase/')) return 'supabase';
            if (id.includes('pdfjs-dist')) return 'pdf';
            if (id.includes('three') || id.includes('@react-three')) return 'three';
            if (id.includes('exceljs')) return 'exceljs';
            if (id.includes('tesseract')) return 'tesseract';
            if (id.includes('leaflet')) return 'maps';
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
