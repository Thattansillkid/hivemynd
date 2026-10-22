import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The obsidian package ships types only; tests get a small stand-in.
    alias: { obsidian: fileURLToPath(new URL('./test/obsidian-stub.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests run listeners on ephemeral 127.0.0.1 ports; keep files isolated.
    pool: 'forks',
  },
});
