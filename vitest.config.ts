import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      enabled: true,
      reporter: ['text-summary', 'html', 'clover'],
      reportsDirectory: 'reports/coverage',
    },
    reporters: ['default', 'html', 'github-actions'],
    outputFile: {
      html: 'reports/tests/index.html',
    },
  },
})
