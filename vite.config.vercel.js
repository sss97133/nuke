 
 
 
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import autoprefixer from 'autoprefixer';
import postcssNesting from 'postcss-nesting';

// Vercel-optimized configuration
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ['transform-remove-console', { exclude: ['error', 'warn'] }]
        ]
      }
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      'react-syntax-highlighter/dist/esm/': 'react-syntax-highlighter/dist/cjs/',
    },
    mainFields: ['browser', 'module', 'main'],
  },
  build: {
    sourcemap: false,
    minify: 'terser',
    outDir: 'dist',
    target: 'es2015', // More compatible target
    assetsInlineLimit: 4096,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1500,
    manifest: true, // Generate a proper manifest
    modulePreload: {
      polyfill: true, // Add module preload polyfill
    },
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        format: 'es', // Ensure ES modules format
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': [
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-toast',
            'class-variance-authority',
            'clsx',
            'tailwind-merge',
          ],
          'vendor-utils': ['date-fns', 'zod', 'jotai'],
          'vendor-charts': ['recharts'],
          'vendor-three': ['three'],
          'vendor-form': ['react-hook-form', '@hookform/resolvers'],
          'vendor-animation': ['framer-motion'],
          'vendor-helmet': ['react-helmet-async'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log'],
        passes: 2,
      },
      format: {
        comments: false,
      },
      mangle: {
        properties: false,
      },
    },
  },
  optimizeDeps: {
    include: [
      'react', 
      'react-dom', 
      'react-router-dom',
      'jotai',
      '@tanstack/react-query',
      'react-helmet-async',
      'react-syntax-highlighter',
      'react-syntax-highlighter/dist/cjs/styles/prism',
    ],
    exclude: ['fsevents'],
    force: true,
    esbuildOptions: {
      target: 'es2020',
      treeShaking: true,
      minify: true,
    }
  },
  css: {
    devSourcemap: false,
    modules: {
      generateScopedName: '[hash:base64:8]',
    },
    postcss: {
      plugins: [
        autoprefixer,
        postcssNesting,
      ],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __DEV_MODE__: false,
    __PROD_MODE__: true,
    'process.env': {
      NODE_ENV: JSON.stringify('production'),
    },
  },
});
