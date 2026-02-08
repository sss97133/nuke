import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@dealerscan/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})
