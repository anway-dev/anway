import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['connectors/*/src/*.integration.test.ts'],
    testTimeout: 120_000,   // containers take time to start
    hookTimeout: 120_000,
  },
})
