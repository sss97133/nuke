import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { configDefaults } from 'vitest/config';
import { componentTagger } from "lovable-tagger";
import autoprefixer from 'autoprefixer';
import postcssNesting from 'postcss-nesting';
import tsconfigPaths from 'vite-tsconfig-paths';
import { splitVendorChunkPlugin } from 'vite';
import { compression } from 'vite-plugin-compression2';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');
  const isProd = mode === 'production';

  return {
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      exclude: [...configDefaults.exclude, 'e2e/*'],
      root: './',
      transformMode: {
        web: [/\.[jt]sx?$/]
      },
      coverage: {
        reporter: ['text', 'html'],
        exclude: [
          'node_modules/',
          'src/setupTests.ts',
        ]
      }
    },
    server: {
      host: "::",
      port: 8080,
      // Add CORS handling for local development if needed
      cors: true,
    },
    plugins: [
      react({
        babel: {
          plugins: isProd ? [
            ['transform-remove-console', { exclude: ['error', 'warn'] }]
          ] : []
        }
      }),
      mode === 'development' && componentTagger(),
      tsconfigPaths(),
      splitVendorChunkPlugin(),
      compression({
        algorithm: 'gzip',
        exclude: [/\.(br)$/, /\.(gz)$/],
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      sourcemap: !isProd,
      minify: isProd ? 'terser' : false,
      outDir: 'dist',
      target: 'esnext',
      assetsInlineLimit: 4096,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          background: path.resolve(__dirname, 'src/background.ts'),
        },
        output: {
          entryFileNames: isProd ? 'assets/[name].[hash].js' : 'assets/[name].js',
          chunkFileNames: isProd ? 'assets/[name].[hash].js' : 'assets/[name].js',
          assetFileNames: isProd ? 'assets/[name].[hash].[ext]' : 'assets/[name].[ext]',
          manualChunks: (id) => {
            // Core dependencies
            if (id.includes('node_modules/react') || 
                id.includes('node_modules/react-dom') || 
                id.includes('node_modules/react-router-dom')) {
              return 'vendor-react';
            }
            
            // UI components
            if (id.includes('node_modules/@radix-ui')) {
              return 'vendor-ui';
            }
            
            // Form handling
            if (id.includes('node_modules/react-hook-form') || 
                id.includes('node_modules/@hookform')) {
              return 'vendor-form';
            }
            
            // Data fetching
            if (id.includes('node_modules/@tanstack')) {
              return 'vendor-query';
            }
            
            // Charts and 3D
            if (id.includes('node_modules/recharts')) {
              return 'vendor-charts';
            }
            if (id.includes('node_modules/three')) {
              return 'vendor-three';
            }
            
            // Animation
            if (id.includes('node_modules/framer-motion')) {
              return 'vendor-animation';
            }
            
            // Utilities
            if (id.includes('node_modules/date-fns') || 
                id.includes('node_modules/lodash')) {
              return 'vendor-utils';
            }
            
            // Meta
            if (id.includes('node_modules/react-helmet-async')) {
              return 'vendor-helmet';
            }

            // Split large vendor chunks
            if (id.includes('node_modules/')) {
              const match = id.match(/node_modules\/([^/]+)/);
              if (match) {
                const packageName = match[1];
                if (packageName.length > 20) {
                  return `vendor-${packageName.slice(0, 20)}`;
                }
              }
            }
          }
        },
      },
      terserOptions: isProd ? {
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
      } : undefined,
    },
    // Optimize dependency pre-bundling
    optimizeDeps: {
      include: [
        'react', 
        'react-dom', 
        'react-router-dom',
        'jotai',
        '@tanstack/react-query',
        'react-helmet-async',
      ],
      exclude: ['fsevents'],
      force: true,
      esbuildOptions: {
        target: 'es2020',
        treeShaking: true,
        minify: true,
      }
    },
    // Adjust CSS handling for better performance
    css: {
      devSourcemap: !isProd,
      modules: {
        generateScopedName: isProd ? '[hash:base64:8]' : '[local]_[hash:base64:5]',
      },
      postcss: {
        plugins: [
          autoprefixer,
          postcssNesting,
        ],
      },
    },
    // Add custom environment variables if needed
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __DEV_MODE__: !isProd,
      __PROD_MODE__: isProd,
      // Fix for production environment
      'process.env': {
        NODE_ENV: JSON.stringify(isProd ? 'production' : 'development'),
      },
    },
  };
});
