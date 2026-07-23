import { describe, it, expect } from 'vitest';
import { runTestsCheck, type RunTestsDeps } from '../src/preflight/run-tests.js';

function deps(over: Partial<RunTestsDeps> = {}): RunTestsDeps {
  return {
    readPackageJson: async () => ({ scripts: { test: 'vitest run' } }),
    runCommand: async () => ({ code: 0 }),
    ...over,
  };
}

describe('runTestsCheck — corre los tests del proyecto para el gate (§6)', () => {
  it('script de test presente y sale 0 → ok', async () => {
    const r = await runTestsCheck('/proj', deps());
    expect(r.ok).toBe(true);
  });

  it('script de test presente y sale ≠0 → not ok con detalle', async () => {
    const r = await runTestsCheck('/proj', deps({ runCommand: async () => ({ code: 1 }) }));
    expect(r.ok).toBe(false);
    expect(r.detail).toBeTruthy();
  });

  it('sin script de test → ok, dejando nota de que se omitió (no bloquea)', async () => {
    const r = await runTestsCheck('/proj', deps({ readPackageJson: async () => ({ scripts: {} }) }));
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/test/i);
  });

  it('sin package.json → ok con nota (no hay tests que correr)', async () => {
    const r = await runTestsCheck('/proj', deps({ readPackageJson: async () => null }));
    expect(r.ok).toBe(true);
  });

  it('corre `npm test`', async () => {
    let called: { cmd: string; args: string[] } | null = null;
    await runTestsCheck('/proj', deps({
      runCommand: async (_cwd, cmd, args) => { called = { cmd, args }; return { code: 0 }; },
    }));
    expect(called).toEqual({ cmd: 'npm', args: ['test'] });
  });
});
