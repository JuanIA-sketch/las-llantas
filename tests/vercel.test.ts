import { describe, it, expect } from 'vitest';
import { createVercelDeployer, type VercelDeployerDeps } from '../src/deployers/vercel.js';

const noSleep = async () => {};

function deps(over: Partial<VercelDeployerDeps> = {}): VercelDeployerDeps {
  return {
    runVercel: async () => ({ code: 0, stdout: 'Production: https://app-abc.vercel.app' }),
    httpGet: async () => ({ status: 200 }),
    hasPrevious: true,
    retry: { attempts: 3, delayMs: 10, sleep: noSleep },
    ...over,
  };
}

describe('vercel deployer — deploy (§6)', () => {
  it('deploy exitoso parsea la URL de producción del output', async () => {
    const d = createVercelDeployer(deps());
    const r = await d.deploy();
    expect(r).toMatchObject({ ok: true, url: 'https://app-abc.vercel.app' });
  });

  it('vercel --prod sale ≠0 → deploy no ok con detalle', async () => {
    const d = createVercelDeployer(deps({ runVercel: async () => ({ code: 1, stdout: 'error' }) }));
    const r = await d.deploy();
    expect(r.ok).toBe(false);
    expect(r.detail).toBeTruthy();
  });

  it('sale 0 pero sin URL en el output → deploy no ok (no puede verificar a ciegas)', async () => {
    const d = createVercelDeployer(deps({ runVercel: async () => ({ code: 0, stdout: 'listo, sin url' }) }));
    expect((await d.deploy()).ok).toBe(false);
  });

  it('corre `vercel --prod`', async () => {
    let args: string[] = [];
    const d = createVercelDeployer(deps({
      runVercel: async (a) => { args = a; return { code: 0, stdout: 'https://x.vercel.app' }; },
    }));
    await d.deploy();
    expect(args).toEqual(['--prod']);
  });
});

describe('vercel deployer — verify con reintentos (§6)', () => {
  const deployed = { ok: true, url: 'https://app-abc.vercel.app' };

  it('200 al primer intento → ok', async () => {
    const d = createVercelDeployer(deps());
    const r = await d.verify(deployed);
    expect(r).toMatchObject({ ok: true, status: 200 });
  });

  it('503 y luego 200 → se recupera en el reintento', async () => {
    let n = 0;
    const d = createVercelDeployer(deps({
      httpGet: async () => { n++; return { status: n === 1 ? 503 : 200 }; },
    }));
    const r = await d.verify(deployed);
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });

  it('siempre 503 → agota reintentos y declara fallo', async () => {
    const d = createVercelDeployer(deps({ httpGet: async () => ({ status: 503 }) }));
    const r = await d.verify(deployed);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });

  it('usa el endpoint /salud cuando el proyecto lo expone', async () => {
    let hit = '';
    const d = createVercelDeployer(deps({
      healthPath: '/salud',
      httpGet: async (url) => { hit = url; return { status: 200 }; },
    }));
    await d.verify(deployed);
    expect(hit).toBe('https://app-abc.vercel.app/salud');
  });
});

describe('vercel deployer — rollback (§6)', () => {
  it('con deployment anterior → intenta rollback y reporta éxito', async () => {
    let args: string[] = [];
    const d = createVercelDeployer(deps({
      hasPrevious: true,
      runVercel: async (a) => { args = a; return { code: 0, stdout: 'rolled back' }; },
    }));
    const r = await d.rollback();
    expect(r).toMatchObject({ attempted: true, ok: true });
    expect(args[0]).toBe('rollback');
  });

  it('primer deploy (sin anterior) → NO intenta rollback, reporta claro [§9]', async () => {
    const d = createVercelDeployer(deps({ hasPrevious: false }));
    const r = await d.rollback();
    expect(r).toMatchObject({ attempted: false, ok: false });
    expect(r.detail).toMatch(/primer deploy|anterior/i);
  });

  it('rollback intentado pero el comando falla → attempted true, ok false (no falla en silencio)', async () => {
    const d = createVercelDeployer(deps({
      hasPrevious: true,
      runVercel: async () => ({ code: 1, stdout: 'boom' }),
    }));
    const r = await d.rollback();
    expect(r).toMatchObject({ attempted: true, ok: false });
    expect(r.detail).toBeTruthy();
  });
});
