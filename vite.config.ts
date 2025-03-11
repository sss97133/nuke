import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { configDefaults } from 'vitest/config';
import { componentTagger } from "lovable-tagger";

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
      target: 'es2020',
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
          },
        },
      },
      terserOptions: isProd ? {
        compress: {
          drop_console: true,
          drop_debugger: true,
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
      ],
      exclude: ['fsevents'],
      force: true,
      esbuildOptions: {
        target: 'es2020',
      }
    },
    // Adjust CSS handling for better performance
    css: {
      devSourcemap: !isProd,
      modules: {
        generateScopedName: isProd ? '[hash:base64:8]' : '[local]_[hash:base64:5]',
      },
    },
    // Add custom environment variables if needed
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __DEV_MODE__: !isProd,
      __PROD_MODE__: isProd,
    },
  };
});

