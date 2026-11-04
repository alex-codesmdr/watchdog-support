import { defineConfig } from 'vitest/config';

// Property tests run thousands of cases; give them headroom when CI runs packages in parallel.
export default defineConfig({ test: { testTimeout: 30_000 } });
