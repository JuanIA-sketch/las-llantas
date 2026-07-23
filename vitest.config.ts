import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Los tests de integración lanzan procesos reales (git) sobre repos
    // temporales; bajo paralelismo pueden pasar el default de 5s.
    testTimeout: 30000,
  },
});
