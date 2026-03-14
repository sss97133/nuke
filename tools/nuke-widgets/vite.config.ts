import { defineConfig } from 'vite';
import { resolve } from 'path';

// ESM build: 3 widget entry points + loader
export default defineConfig({
  build: {
    lib: {
      entry: {
        'nuke-widgets': resolve(__dirname, 'src/loader/nuke-widgets-loader.ts'),
        'widgets/nuke-vehicle': resolve(__dirname, 'src/widgets/vehicle/nuke-vehicle.ts'),
        'widgets/nuke-vision': resolve(__dirname, 'src/widgets/vision/nuke-vision.ts'),
        'widgets/nuke-valuation': resolve(__dirname, 'src/widgets/valuation/nuke-valuation.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
