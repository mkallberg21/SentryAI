import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    // Point workspace imports at source rather than dist, so tests run without
    // a build step and a failing test always reflects the code on disk.
    alias: {
      '@sentryai/domain': src('domain'),
      '@sentryai/compliance': src('compliance'),
      '@sentryai/governance': src('governance'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
  },
})
