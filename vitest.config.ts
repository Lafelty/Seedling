import { defineConfig } from 'vitest/config';

// Pure-logic unit tests only (lib math): no DOM, no TF/MediaPipe models — the
// heavy deps in detectionCore are all dynamic import()s inside functions, so
// importing the pure helpers never loads them. Node environment is enough.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
