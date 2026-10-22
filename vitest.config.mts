import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Tests run listeners on ephemeral 127.0.0.1 ports; keep files isolated.
    pool: 'forks',
  },
});
