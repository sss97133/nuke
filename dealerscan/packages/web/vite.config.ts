import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
  resolve: {
    alias: {
      '@dealerscan/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})
