import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The parsers are plain Node code — no DOM, no Electron.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
