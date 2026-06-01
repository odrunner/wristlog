import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // supabase/functions holds Deno edge-function tests (jsr: imports, Deno.test);
    // they run via `npm run test:functions` (deno test), not under vitest/Node.
    exclude: ['node_modules', 'e2e', 'supabase/functions/**'],
    coverage: {
      provider: 'v8',
      // Gate ONLY the source vitest actually imports — wrotate_test.js, the
      // extracted pure-logic module. A whole-repo number is meaningless here:
      // it would include index.html (not importable; covered by E2E) and the
      // Deno functions (covered by deno test), dragging the figure to ~19%.
      // Scoping to the real unit-tested file makes the gate honest.
      include: ['wrotate_test.js'],
      // Thresholds locked just below current actuals (100/100/96/100) so the
      // gate fails CI on a coverage regression. `> 0` makes drops fail hard.
      thresholds: {
        statements: 99,
        functions: 99,
        lines: 99,
        branches: 94,
      },
    },
  },
});
