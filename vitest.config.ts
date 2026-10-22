import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __PDFX_TEST__: 'false',
    __APP_VERSION__: '"test"',
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/web/src/**/*.test.{ts,tsx}',
      'tools/*/src/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 60000,
  },
});
