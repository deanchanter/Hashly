import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
  },
});
