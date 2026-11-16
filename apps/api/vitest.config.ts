import { defineConfig } from 'vitest/config'

// Each test file starts its own embedded Postgres and runs the migrations, which can take
// several seconds on a small CI machine.
export default defineConfig({
  test: { hookTimeout: 30_000, testTimeout: 30_000 },
})
