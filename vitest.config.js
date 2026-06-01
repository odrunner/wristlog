import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // supabase/functions holds Deno edge-function tests (jsr: imports, Deno.test);
    // they run via `npm run test:functions` (deno test), not under vitest/Node.
    exclude: ['node_modules', 'e2e', 'supabase/functions/**'],
  },
});
