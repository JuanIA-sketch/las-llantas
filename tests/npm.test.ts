import { describe, it, expect } from 'vitest';
import { createNpmDeployer, type NpmDeployerDeps } from '../src/deployers/npm.js';

const noSleep = async () => {};

function deps(over: Partial<NpmDeployerDeps> = {}): NpmDeployerDeps {
  return {
    localVersion: '1.2.3',
    runPublish: async () => ({ code: 0 }),
    registryVersion: async () => ({ published: true, version: '1.2.3' }),
    retry: { attempts: 3, delayMs: 1, sleep: noSleep },
    ...over,
  };
}

describe('npm deployer — deploy (§6)', () => {
  it('npm publish sale 0 → ok', async () => {
    expect((await createNpmDeployer(deps()).deploy()).ok).toBe(true);
  });

  it('npm publish falla → not ok con detalle', async () => {
    const r = await createNpmDeployer(deps({ runPublish: async () => ({ code: 1 }) })).deploy();
    expect(r.ok).toBe(false);
    expect(r.detail).toBeTruthy();
  });
});

describe('npm deployer — verify vía npm view (§6)', () => {
  it('el registro refleja la versión publicada → ok', async () => {
    const r = await createNpmDeployer(deps()).verify({ ok: true });
    expect(r.ok).toBe(true);
  });

  it('el registro tarda en reflejarla y luego sí → se recupera con el reintento', async () => {
    let n = 0;
    const d = createNpmDeployer(deps({
      registryVersion: async () => { n++; return n < 2 ? { published: false, version: '' } : { published: true, version: '1.2.3' }; },
    }));
    const r = await d.verify({ ok: true });
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });

  it('el registro nunca refleja la versión → not ok', async () => {
    const d = createNpmDeployer(deps({ registryVersion: async () => ({ published: true, version: '1.2.2' }) }));
    expect((await d.verify({ ok: true })).ok).toBe(false);
  });
});

describe('npm deployer — rollback (no existe, §6)', () => {
  it('rollback no intentado, sugiere npm deprecate como acción manual', async () => {
    const r = await createNpmDeployer(deps()).rollback();
    expect(r).toMatchObject({ attempted: false, ok: false });
    expect(r.detail).toMatch(/deprecate/i);
  });
});
