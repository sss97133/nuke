import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) return 'vendor';
            if (id.includes('supabase')) return 'supabase';
            if (id.includes('headlessui') || id.includes('heroicons') || id.includes('lucide')) return 'ui';
            if (id.includes('hook-form') || id.includes('zod')) return 'forms';
            if (id.includes('pdfjs') || id.includes('pdf')) return 'pdf';
            if (id.includes('exif') || id.includes('piexif') || id.includes('tesseract')) return 'image-processing';
            if (id.includes('axios') || id.includes('dropbox')) return 'networking';
            return 'vendor-misc';
          }

          // Split app code by feature
          if (id.includes('/pages/')) return 'pages';
          if (id.includes('/components/')) return 'components';
          if (id.includes('/services/')) return 'services';
          if (id.includes('/hooks/')) return 'hooks';
        }
      }
    }
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
