import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { configDefaults } from 'vitest/config';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

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
      react(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      sourcemap: mode !== 'production', // Only generate sourcemaps for non-prod builds
      // Use Terser for production builds, but disable in CI for faster builds
      minify: mode === 'production' ? 'terser' : false,
      // Improved chunk splitting strategy
      rollupOptions: {
        output: {
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
          },
          // Optimize chunk size
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      // Set target to ensure wider browser compatibility
      target: 'es2020',
      // Ensure proper handling of dynamic imports
      dynamicImportVarsOptions: {
        warnOnError: true,
      },
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
      devSourcemap: true,
      preprocessorOptions: {
        // Add preprocessor options if using SASS/LESS
      },
    },
    // Add custom environment variables if needed
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __DEV_MODE__: mode !== 'production',
    },
  };
});
