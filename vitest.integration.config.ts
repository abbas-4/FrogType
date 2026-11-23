import { defineConfig } from 'vitest/config';

// Real HTTP against a local Supabase stack (`npx supabase start`). Never point this at production.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests-integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
