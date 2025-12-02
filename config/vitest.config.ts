import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'nuke_frontend/src/**/*.test.ts',
      'nuke_frontend/src/**/*.test.tsx'
    ],
    coverage: {
      reporter: ['text', 'html']
    }
  }
})


