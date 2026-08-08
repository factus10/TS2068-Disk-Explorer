import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The parsers are plain Node code — no DOM, no Electron. The one
    // component test renders to markup rather than to a DOM, so this stays true.
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
